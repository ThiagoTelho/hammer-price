package br.ufg.hammerprice.auction;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReferenceArray;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Estado das caixas em leilão + ciclo de vida completo do lance.
 *
 * <p>Concorrência: um {@link ReentrantLock} POR CAIXA serializa os lances e o
 * fechamento daquela caixa (lances em caixas diferentes correm em paralelo). O
 * vencedor é o ÚLTIMO lance válido antes do cronômetro zerar — o lock dá a ordem
 * autoritativa pelo timestamp do servidor. Um cronômetro por caixa fecha o leilão
 * automaticamente; lances nos segundos finais ESTENDEM o prazo (anti-sniping).
 * Ao fechar, o vencedor é debitado (Settle) e a caixa é REPOSTA por uma nova no
 * mesmo slot, mantendo a oferta.
 */
public final class BoxStore {

    /** Parâmetros do leilão (do balance.yaml), injetados para facilitar testes. */
    public record Settings(long timerBaseMs, long antiSnipeWindowMs, long antiSnipeResetMs,
                           long incrementPct, long incrementAbs) {}

    /** Dependência da Carteira: reservar, devolver e debitar (arremate). */
    public interface Wallet {
        boolean reserve(String playerId, String boxId, long amount);
        void release(String playerId, String boxId);
        void settle(String playerId, String boxId, long amount);
    }

    /** Notificação de caixa arrematada (publicação de eventos é wired pelo servidor). */
    public interface CloseListener {
        void onSold(String boxId, String winner, long price);
    }

    /** Fonte da afinidade do jogador (item → pontos percentuais). Default: sem afinidade. */
    public interface AffinitySource {
        Map<String, Integer> forPlayer(String playerId);
    }

    private static final String[] TYPES = {"BRONZE", "SILVER", "GOLD", "VAULT"};

    private static final class Box {
        final ReentrantLock lock = new ReentrantLock();
        final int slot;
        final String id;
        final String type;
        long curBid = 0;
        String leader = "";
        long deadlineMs = 0;        // 0 = cronômetro não armado (sem lances ainda)
        boolean sold = false;
        ScheduledFuture<?> closeTask;

        Box(int slot, String id, String type) {
            this.slot = slot;
            this.id = id;
            this.type = type;
        }
    }

    /** Resultado de um lance. */
    public record BidResult(boolean accepted, String reason, long currentBid, String leader, long timerMs) {}

    /** Visão de uma caixa para o estado do vault. */
    public record Snapshot(String boxId, String boxType, String leader, long currentBid, long timerMs) {}

    /** Caixa arrematada à espera de abertura pelo vencedor. */
    private record PendingOpen(String winner, String boxType, long price) {}

    /** Resultado de uma abertura de caixa (sorteio do item). */
    public record OpenResult(boolean ok, String reason, String item, boolean isMimic) {}

    private final Wallet wallet;
    private final Settings cfg;
    private final BoxOpener opener;
    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "box-timer");
                t.setDaemon(true);
                return t;
            });
    private final ConcurrentHashMap<String, Box> byId = new ConcurrentHashMap<>();
    private final AtomicReferenceArray<Box> slots;
    private final AtomicInteger boxSeq = new AtomicInteger();
    private volatile CloseListener closeListener = (id, w, p) -> {};
    // Caixas arrematadas aguardando abertura pelo vencedor + ids já abertos.
    private final ConcurrentHashMap<String, PendingOpen> pendingOpens = new ConcurrentHashMap<>();
    private final Set<String> opened = ConcurrentHashMap.newKeySet();
    private volatile AffinitySource affinitySource = p -> Map.of();

    /** Cria o conjunto inicial de caixas (uma por tipo), com o cronômetro desarmado. */
    public BoxStore(Wallet wallet, Settings cfg, BoxOpener opener) {
        this.wallet = wallet;
        this.cfg = cfg;
        this.opener = opener;
        this.slots = new AtomicReferenceArray<>(TYPES.length);
        for (int i = 0; i < TYPES.length; i++) {
            Box b = new Box(i, "box-" + boxSeq.incrementAndGet(), TYPES[i]);
            slots.set(i, b);
            byId.put(b.id, b);
        }
    }

    public void setCloseListener(CloseListener l) {
        this.closeListener = (l == null) ? (id, w, p) -> {} : l;
    }

    /** Incremento mínimo: percentual do lance atual, com piso absoluto (balance.yaml). */
    private long minIncrement(long cur) {
        long inc = cur * cfg.incrementPct() / 100;
        return Math.max(inc, cfg.incrementAbs());
    }

    /** Aplica um lance de forma atômica; arma/estende o cronômetro da caixa. */
    public BidResult placeBid(String boxId, String playerId, long amount) {
        Box b = byId.get(boxId);
        if (b == null) {
            return new BidResult(false, "UNKNOWN_BOX", 0, "", 0);
        }
        b.lock.lock();
        try {
            if (b.sold) {
                return new BidResult(false, "BOX_CLOSED", b.curBid, b.leader, 0);
            }
            if (amount < b.curBid + minIncrement(b.curBid)) {
                return new BidResult(false, "TOO_LOW", b.curBid, b.leader, remainingMs(b));
            }
            // Reserva o saldo do novo lance ANTES de aceitar (chamada síncrona à Carteira).
            if (!wallet.reserve(playerId, boxId, amount)) {
                return new BidResult(false, "INSUFFICIENT_BALANCE", b.curBid, b.leader, remainingMs(b));
            }
            // Devolve a reserva do líder anterior (se for outro jogador).
            if (!b.leader.isEmpty() && !b.leader.equals(playerId)) {
                wallet.release(b.leader, boxId);
            }
            b.curBid = amount;
            b.leader = playerId;
            armTimer(b);   // reseta/estende o cronômetro (anti-sniping)
            return new BidResult(true, "OK", b.curBid, b.leader, remainingMs(b));
        } finally {
            b.lock.unlock();
        }
    }

    /** Reseta o cronômetro (sob o lock da caixa). Nos segundos finais, estende menos (anti-sniping). */
    private void armTimer(Box b) {
        long now = System.currentTimeMillis();
        long extend;
        if (b.deadlineMs == 0) {
            extend = cfg.timerBaseMs();   // primeiro lance: arma o cronômetro cheio
        } else {
            long remaining = b.deadlineMs - now;
            extend = (remaining <= cfg.antiSnipeWindowMs()) ? cfg.antiSnipeResetMs() : cfg.timerBaseMs();
        }
        b.deadlineMs = now + extend;
        if (b.closeTask != null) {
            b.closeTask.cancel(false);
        }
        b.closeTask = scheduler.schedule(() -> closeBox(b), extend, TimeUnit.MILLISECONDS);
    }

    /** Fecha a caixa: debita o vencedor, marca como vendida e repõe a oferta. */
    private void closeBox(Box b) {
        String soldId = null;
        String soldWinner = null;
        String soldType = null;
        long soldPrice = 0;
        b.lock.lock();
        try {
            if (b.sold) {
                return;
            }
            // Disparo obsoleto: um lance estendeu o prazo; o fechamento real virá depois.
            if (System.currentTimeMillis() < b.deadlineMs) {
                return;
            }
            if (b.leader.isEmpty()) {
                return;   // ninguém deu lance: a caixa segue aberta
            }
            wallet.settle(b.leader, b.id, b.curBid);   // o vencedor paga de fato
            b.sold = true;
            soldId = b.id;
            soldWinner = b.leader;
            soldType = b.type;
            soldPrice = b.curBid;
            replace(b);
        } finally {
            b.lock.unlock();
        }
        if (soldWinner != null) {
            // O vencedor poderá ABRIR a caixa arrematada (sorteio do item).
            pendingOpens.put(soldId, new PendingOpen(soldWinner, soldType, soldPrice));
            closeListener.onSold(soldId, soldWinner, soldPrice);
        }
    }

    public void setAffinitySource(AffinitySource s) {
        this.affinitySource = (s == null) ? p -> Map.of() : s;
    }

    /**
     * Abre uma caixa arrematada: valida que é o vencedor e que não foi aberta, e sorteia
     * o item (RNG server-side) pelas odds do tipo + afinidade do jogador. Idempotente por
     * remoção atômica do registro pendente.
     */
    public OpenResult openBox(String boxId, String playerId) {
        PendingOpen po = pendingOpens.get(boxId);
        if (po == null) {
            return new OpenResult(false, opened.contains(boxId) ? "ALREADY_OPENED" : "UNKNOWN_BOX", "", false);
        }
        if (!po.winner().equals(playerId)) {
            return new OpenResult(false, "NOT_WINNER", "", false);
        }
        if (!pendingOpens.remove(boxId, po)) {
            return new OpenResult(false, "ALREADY_OPENED", "", false); // corrida: já aberta
        }
        opened.add(boxId);
        String item = opener.draw(po.boxType(), affinitySource.forPlayer(playerId));
        return new OpenResult(true, "OK", item, "MIMIC".equals(item));
    }

    /** Substitui a caixa fechada por uma nova no mesmo slot (mantém a oferta). */
    private void replace(Box old) {
        String type = TYPES[boxSeq.get() % TYPES.length];
        Box fresh = new Box(old.slot, "box-" + boxSeq.incrementAndGet(), type);
        slots.set(old.slot, fresh);
        byId.put(fresh.id, fresh);
        byId.remove(old.id);
    }

    /** Snapshot das caixas, por slot. */
    public List<Snapshot> snapshot() {
        List<Snapshot> out = new ArrayList<>(slots.length());
        for (int i = 0; i < slots.length(); i++) {
            Box b = slots.get(i);
            b.lock.lock();
            try {
                out.add(new Snapshot(b.id, b.type, b.leader, b.curBid, remainingMs(b)));
            } finally {
                b.lock.unlock();
            }
        }
        return out;
    }

    private static long remainingMs(Box b) {
        if (b.deadlineMs == 0) {
            return 0;
        }
        return Math.max(b.deadlineMs - System.currentTimeMillis(), 0);
    }

    /** Encerra o agendador de cronômetros (chamado no shutdown do servidor). */
    public void shutdown() {
        scheduler.shutdownNow();
    }

    // ---- Apoio a testes (visível no mesmo pacote) ----

    /** Força o fechamento imediato da caixa (determinístico em teste). */
    void closeNow(String boxId) {
        Box b = byId.get(boxId);
        if (b == null) {
            return;
        }
        b.lock.lock();
        try {
            b.deadlineMs = System.currentTimeMillis() - 1;
        } finally {
            b.lock.unlock();
        }
        closeBox(b);
    }

    /** Ajusta o tempo restante da caixa para simular cenários de anti-sniping. */
    void setRemainingForTest(String boxId, long ms) {
        Box b = byId.get(boxId);
        if (b == null) {
            return;
        }
        b.lock.lock();
        try {
            b.deadlineMs = System.currentTimeMillis() + ms;
        } finally {
            b.lock.unlock();
        }
    }
}
