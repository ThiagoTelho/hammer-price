package br.ufg.hammerprice.auction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Testes do núcleo do leilão, com foco na corrida de lances (concorrência). */
class BoxStoreTest {

    /** Carteira de teste: aceita reservas e contabiliza reserve/release/settle. */
    static final class StubWallet implements BoxStore.Wallet {
        final AtomicInteger reserves = new AtomicInteger();
        final AtomicInteger releases = new AtomicInteger();
        final List<String> settles = Collections.synchronizedList(new ArrayList<>());
        volatile boolean allowReserve = true;

        @Override
        public boolean reserve(String p, String b, long a) {
            reserves.incrementAndGet();
            return allowReserve;
        }

        @Override
        public void release(String p, String b) {
            releases.incrementAndGet();
        }

        @Override
        public void settle(String p, String b, long a) {
            settles.add(p + ":" + b + ":" + a);
        }
    }

    private static BoxStore newStore(BoxStore.Wallet w) {
        // base 20s, janela anti-snipe 5s, reset 8s, incremento 5% / mín. 5
        return new BoxStore(w, new BoxStore.Settings(20_000, 5_000, 8_000, 5, 5));
    }

    private static long currentBid(BoxStore s, String boxId) {
        for (BoxStore.Snapshot snap : s.snapshot()) {
            if (snap.boxId().equals(boxId)) {
                return snap.currentBid();
            }
        }
        return -1;
    }

    @Test
    void concurrentBidsStayConsistent() throws Exception {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            int threads = 8;
            int iters = 200;
            ExecutorService pool = Executors.newFixedThreadPool(threads);
            CountDownLatch start = new CountDownLatch(1);
            Set<Long> accepted = Collections.synchronizedSet(new HashSet<>());
            AtomicInteger acceptedCount = new AtomicInteger();
            List<Future<?>> futs = new ArrayList<>();

            for (int t = 0; t < threads; t++) {
                String player = "p" + t;
                futs.add(pool.submit(() -> {
                    start.await();
                    for (int i = 0; i < iters; i++) {
                        long cur = currentBid(store, "box-1");
                        long amount = cur + 5 + (i % 7); // tenta superar o atual
                        BoxStore.BidResult r = store.placeBid("box-1", player, amount);
                        if (r.accepted()) {
                            acceptedCount.incrementAndGet();
                            // Invariante: nenhum valor é aceito duas vezes (lances serializados).
                            assertTrue(accepted.add(r.currentBid()), "valor aceito duplicado: " + r.currentBid());
                        }
                    }
                    return null;
                }));
            }
            start.countDown();
            for (Future<?> f : futs) {
                f.get(30, TimeUnit.SECONDS);
            }
            pool.shutdown();

            long finalBid = currentBid(store, "box-1");
            long maxAccepted = accepted.stream().mapToLong(Long::longValue).max().orElse(-1);
            assertEquals(maxAccepted, finalBid, "o líder final deve ter o maior lance aceito");
            assertEquals(acceptedCount.get(), w.reserves.get(), "cada lance aceito reserva exatamente uma vez");
            assertFalse(accepted.isEmpty(), "ao menos um lance deve ter sido aceito");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void autoCloseSettlesWinnerAndReplenishes() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            assertTrue(store.placeBid("box-1", "ana", 100).accepted());
            store.closeNow("box-1");

            assertEquals(1, w.settles.size(), "o vencedor é debitado uma vez ao fechar");
            assertEquals("ana:box-1:100", w.settles.get(0));

            List<BoxStore.Snapshot> snap = store.snapshot();
            assertEquals(4, snap.size(), "a oferta é mantida (caixa reposta)");
            assertEquals("", snap.get(0).leader(), "o slot reposto começa sem líder");
            assertNotEquals("box-1", snap.get(0).boxId(), "o id muda ao repor a caixa");
            assertEquals("UNKNOWN_BOX", store.placeBid("box-1", "bob", 200).reason(),
                    "a caixa arrematada não aceita mais lances");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void antiSnipeExtendsInsteadOfFullReset() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            BoxStore.BidResult first = store.placeBid("box-2", "ana", 50);
            assertTrue(first.accepted());
            assertTrue(first.timerMs() > 15_000, "primeiro lance arma o cronômetro cheio (~20s)");

            store.setRemainingForTest("box-2", 2_000); // faltando 2s (dentro da janela de 5s)
            BoxStore.BidResult snipe = store.placeBid("box-2", "bob", 100);
            assertTrue(snipe.accepted());
            assertTrue(snipe.timerMs() > 5_000 && snipe.timerMs() <= 8_000,
                    "lance no fim estende para ~8s (anti-sniping), veio " + snipe.timerMs());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void belowMinIncrementRejected() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            assertTrue(store.placeBid("box-3", "ana", 100).accepted());
            BoxStore.BidResult low = store.placeBid("box-3", "bob", 102); // < 100 + 5
            assertFalse(low.accepted());
            assertEquals("TOO_LOW", low.reason());
        } finally {
            store.shutdown();
        }
    }
}
