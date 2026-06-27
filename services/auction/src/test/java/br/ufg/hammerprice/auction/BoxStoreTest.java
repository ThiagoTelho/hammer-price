package br.ufg.hammerprice.auction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

/** Testes do núcleo do leilão round-based, com foco na corrida de lances (concorrência). */
class BoxStoreTest {

    /** Carteira de teste: aceita reservas e contabiliza reserve/release/settle. */
    static final class StubWallet implements BoxStore.Wallet {
        final AtomicInteger reserves = new AtomicInteger();
        final AtomicInteger releases = new AtomicInteger();
        final List<String> settles = Collections.synchronizedList(new ArrayList<>());
        final List<Integer> settleDiscounts = Collections.synchronizedList(new ArrayList<>());
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
        public void settle(String p, String b, long a, int discountPct) {
            settles.add(p + ":" + b + ":" + a);
            settleDiscounts.add(discountPct);
        }
    }

    // Atalho p/ os testes de carta (fase 2): sem efeitos, salvo os passados.
    private static void setEffects(BoxStore s, List<String> gavel, List<String> cursed,
                                   Map<String, Integer> discounts, int boxTierBoost) {
        s.setPendingEffects(List.of(), List.of(), cursed, gavel, List.of(), discounts, boxTierBoost);
    }

    // base 20s, janela anti-snipe 5s, reset 8s, incremento 5% / mín. 5, intermission 0
    // (pausa zero = a próxima rodada começa imediatamente → determinístico em teste),
    // janela de abertura sem lances 45s.
    private static final BoxStore.Settings SETTINGS =
            new BoxStore.Settings(20_000, 5_000, 8_000, 5, 5, 0, 45_000, 1, 4);

    private static Map<String, Integer> weights() {
        LinkedHashMap<String, Integer> w = new LinkedHashMap<>();
        w.put("WOODEN", 50);
        w.put("IRON", 30);
        w.put("ROYAL", 15);
        w.put("VAULT", 5);
        return w;
    }

    private static BoxStore newStore(BoxStore.Wallet w) {
        return new BoxStore(w, SETTINGS, testOpener(), weights(), new Random(42));
    }

    private static BoxOpener testOpener() {
        BoxOpener.Odds odds = t -> Map.of("COPPER", 60, "SILVER", 30, "GOLD", 9, "DIAMOND", 1, "MIMIC", 0);
        return new BoxOpener(odds, 42L); // seed fixa: determinístico
    }

    @Test
    void concurrentBidsStayConsistent() throws Exception {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            String boxId = store.roomState().boxId(); // caixa da rodada 1
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
                        long cur = store.roomState().currentBid();
                        long amount = cur + 5 + (i % 7); // tenta superar o atual
                        BoxStore.BidResult r = store.placeBid(boxId, player, amount);
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

            long finalBid = store.roomState().currentBid();
            long maxAccepted = accepted.stream().mapToLong(Long::longValue).max().orElse(-1);
            assertEquals(maxAccepted, finalBid, "o líder final deve ter o maior lance aceito");
            assertEquals(acceptedCount.get(), w.reserves.get(), "cada lance aceito reserva exatamente uma vez");
            assertFalse(accepted.isEmpty(), "ao menos um lance deve ter sido aceito");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void roundCloseSettlesWinnerAndAdvances() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            BoxStore.RoomState r1 = store.roomState();
            assertEquals(1, r1.round(), "começa na rodada 1");
            assertTrue(r1.active());
            String b1 = r1.boxId();

            assertTrue(store.placeBid(b1, "ana", 100).accepted());
            store.closeNow();

            assertEquals(1, w.settles.size(), "o vencedor é debitado uma vez ao fechar");
            assertEquals("ana:" + b1 + ":100", w.settles.get(0));

            BoxStore.RoomState r2 = store.roomState();
            assertEquals(2, r2.round(), "a rodada avança ao fechar");
            assertTrue(r2.active(), "a nova rodada está ativa");
            assertEquals("", r2.leader(), "a nova rodada começa sem líder");
            assertNotEquals(b1, r2.boxId(), "o id da caixa muda na nova rodada");
            assertEquals("UNKNOWN_BOX", store.placeBid(b1, "bob", 200).reason(),
                    "a caixa da rodada anterior não aceita mais lances");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void noBidRoundEndsWithoutWinnerAndAdvances() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            int round0 = store.roomState().round();
            store.closeNow(); // ninguém deu lance
            assertTrue(w.settles.isEmpty(), "sem lances, ninguém é debitado");
            BoxStore.RoomState next = store.roomState();
            assertEquals(round0 + 1, next.round(), "a rodada avança mesmo sem lances");
            assertTrue(next.active());
            assertEquals("", next.leader());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void auctionTimerStartsOnlyAfterFirstBid() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            // Sem lances, a rodada usa a janela de abertura longa (no_bid_timeout, ~45s),
            // e NÃO o cronômetro de leilão (20s) — prova que o relógio não arma no início.
            assertTrue(store.roomState().timerMs() > 30_000,
                    "rodada recém-aberta usa a janela longa (~45s), veio " + store.roomState().timerMs());
            // O 1º lance inicia o cronômetro de leilão (~20s).
            String b = store.roomState().boxId();
            BoxStore.BidResult first = store.placeBid(b, "ana", 50);
            assertTrue(first.accepted());
            assertTrue(first.timerMs() > 15_000 && first.timerMs() <= 20_000,
                    "o 1º lance arma o cronômetro de leilão (~20s), veio " + first.timerMs());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void antiSnipeExtendsInsteadOfFullReset() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            String b = store.roomState().boxId();
            BoxStore.BidResult first = store.placeBid(b, "ana", 50);
            assertTrue(first.accepted());
            assertTrue(first.timerMs() > 15_000, "primeiro lance mantém o cronômetro cheio (~20s)");

            store.setRemainingForTest(2_000); // faltando 2s (dentro da janela de 5s)
            BoxStore.BidResult snipe = store.placeBid(b, "bob", 100);
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
            String b = store.roomState().boxId();
            assertTrue(store.placeBid(b, "ana", 100).accepted());
            BoxStore.BidResult low = store.placeBid(b, "bob", 102); // < 100 + 5
            assertFalse(low.accepted());
            assertEquals("TOO_LOW", low.reason());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void winnerOpensBoxOnce() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            String b = store.roomState().boxId();
            assertTrue(store.placeBid(b, "ana", 100).accepted());
            store.closeNow();

            BoxStore.OpenResult r = store.openBox(b, "ana");
            assertTrue(r.ok(), "o vencedor abre a caixa");
            assertEquals("OK", r.reason());
            assertFalse(r.item().isEmpty(), "o sorteio retorna um item");
            // item real rende de 1 a 4 unidades; Mímico não rende item (quantity 0)
            if (r.isMimic()) {
                assertEquals(0, r.quantity(), "Mímico não rende itens");
            } else {
                assertTrue(r.quantity() >= 1 && r.quantity() <= 4, "1..4 itens, veio " + r.quantity());
            }
            // segunda abertura da mesma caixa é rejeitada
            assertEquals("ALREADY_OPENED", store.openBox(b, "ana").reason());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void openBoxRejectsNonWinnerAndUnknown() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            String b = store.roomState().boxId();
            assertTrue(store.placeBid(b, "ana", 100).accepted());
            store.closeNow();
            assertEquals("NOT_WINNER", store.openBox(b, "bob").reason());
            assertEquals("UNKNOWN_BOX", store.openBox("box-999", "ana").reason());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void randomTypeIsWeightedAndDeterministic() {
        Map<String, Integer> weights = weights();
        BoxStore a = new BoxStore(new StubWallet(), SETTINGS, testOpener(), weights, new Random(7));
        BoxStore b = new BoxStore(new StubWallet(), SETTINGS, testOpener(), weights, new Random(7));
        try {
            List<String> seqA = new ArrayList<>();
            List<String> seqB = new ArrayList<>();
            for (int i = 0; i < 30; i++) {
                seqA.add(a.roomState().boxType());
                seqB.add(b.roomState().boxType());
                a.closeNow();
                b.closeNow();
            }
            assertEquals(seqA, seqB, "mesma seed → mesma sequência de tipos sorteados");
            assertTrue(weights.keySet().containsAll(new HashSet<>(seqA)),
                    "todo tipo sorteado pertence ao conjunto de pesos");
            assertTrue(new HashSet<>(seqA).size() > 1, "o sorteio varia entre tipos");
        } finally {
            a.shutdown();
            b.shutdown();
        }
    }

    // ---- Cartas (fase 2): efeitos aplicados no Leilão ----

    @Test
    void upgradeRaisesBoxTier() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            setEffects(store, List.of(), List.of(), Map.of(), 3); // Reforço alto → topo do ladder
            store.closeNow(); // abre a próxima rodada aplicando o pending
            assertEquals("VAULT", store.roomState().boxType(), "Reforço sobe ao topo do ladder de raridade");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void gavelDoublesRivalIncrement() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            setEffects(store, List.of("ana"), List.of(), Map.of(), 0); // Martelo da ana
            store.closeNow();
            String b = store.roomState().boxId();
            assertTrue(store.placeBid(b, "ana", 100).accepted(), "o autor do Martelo lança normal");
            BoxStore.BidResult low = store.placeBid(b, "bob", 105); // +5 (incremento normal) não basta
            assertFalse(low.accepted(), "rival precisa do DOBRO do incremento");
            assertEquals("TOO_LOW", low.reason());
            assertTrue(store.placeBid(b, "bob", 110).accepted(), "rival com +10 (2× incremento) é aceito");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void discountPassesPctToSettle() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            setEffects(store, List.of(), List.of(), Map.of("ana", 30), 0); // Desconto de 30% p/ ana
            store.closeNow();
            String b = store.roomState().boxId();
            assertTrue(store.placeBid(b, "ana", 200).accepted());
            store.closeNow();
            assertEquals(30, w.settleDiscounts.get(w.settleDiscounts.size() - 1),
                    "o Desconto repassa o % ao settle da Carteira");
        } finally {
            store.shutdown();
        }
    }

    @Test
    void curseForcesMimicOnWinner() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            setEffects(store, List.of(), List.of("ana"), Map.of(), 0); // Maldição em ana
            store.closeNow();
            String b = store.roomState().boxId();
            assertTrue(store.placeBid(b, "ana", 100).accepted());
            store.closeNow();
            BoxStore.OpenResult r = store.openBox(b, "ana");
            // O opener de teste nunca dá Mímico (peso 0) → isMimic prova o efeito da Maldição.
            assertTrue(r.isMimic(), "a Maldição abre a caixa do alvo como Mímico");
            assertEquals("MIMIC", r.item());
            assertEquals(0, r.quantity());
        } finally {
            store.shutdown();
        }
    }

    @Test
    void peekDropMatchesOpenedItem() {
        StubWallet w = new StubWallet();
        BoxStore store = newStore(w);
        try {
            String b = store.roomState().boxId();
            BoxStore.OpenResult peek = store.peekDrop(); // Visão: drop pré-sorteado
            assertTrue(peek.ok());
            assertFalse(peek.item().isEmpty(), "há um drop pré-sorteado para a rodada");
            assertTrue(store.placeBid(b, "ana", 100).accepted());
            store.closeNow();
            BoxStore.OpenResult open = store.openBox(b, "ana");
            assertEquals(peek.item(), open.item(), "a Visão revela exatamente o item que a caixa dá");
            assertEquals(peek.quantity(), open.quantity(), "e a mesma quantidade");
        } finally {
            store.shutdown();
        }
    }
}
