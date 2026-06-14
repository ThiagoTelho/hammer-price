package br.ufg.hammerprice.auction;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Estado das caixas em leilão e a lógica do lance atômico.
 *
 * <p>FATIA VERTICAL: estado em memória, um lock POR CAIXA — lances em caixas
 * diferentes correm em paralelo; lances na MESMA caixa são serializados. O
 * cronômetro é apenas um prazo informativo (sem fechamento automático ainda);
 * a thread de timer/anti-sniping, o RNG de abertura e o particionamento por
 * vault entram em etapas posteriores.
 */
public final class BoxStore {

    /** Tempo do cronômetro reiniciado a cada lance (ms). */
    private static final long TIMER_BASE_MS = 20_000;

    /** Dependência da Carteira usada para reservar/devolver saldo. */
    public interface Wallet {
        boolean reserve(String playerId, String boxId, long amount);
        void release(String playerId, String boxId);
    }

    private static final class Box {
        final ReentrantLock lock = new ReentrantLock();
        final String id;
        final String type;
        long curBid = 0;
        String leader = "";
        long deadlineMs;

        Box(String id, String type, long deadlineMs) {
            this.id = id;
            this.type = type;
            this.deadlineMs = deadlineMs;
        }
    }

    /** Resultado de um lance. */
    public record BidResult(boolean accepted, String reason, long currentBid, String leader, long timerMs) {}

    /** Visão de uma caixa para o estado do vault. */
    public record Snapshot(String boxId, String boxType, String leader, long currentBid, long timerMs) {}

    private final Wallet wallet;
    private final Map<String, Box> boxes = new LinkedHashMap<>();

    /** Cria o estado inicial com um conjunto fixo de caixas (fatia vertical). */
    public BoxStore(Wallet wallet) {
        this.wallet = wallet;
        long now = System.currentTimeMillis();
        seed("box-1", "BRONZE", now);
        seed("box-2", "SILVER", now);
        seed("box-3", "GOLD", now);
        seed("box-4", "VAULT", now);
    }

    private void seed(String id, String type, long now) {
        boxes.put(id, new Box(id, type, now + TIMER_BASE_MS));
    }

    /** Incremento mínimo: 5% do lance atual, mínimo absoluto de 5. */
    private static long minIncrement(long cur) {
        long inc = cur * 5 / 100;
        return Math.max(inc, 5);
    }

    /** Aplica um lance de forma atômica para a caixa indicada. */
    public BidResult placeBid(String boxId, String playerId, long amount) {
        Box b = boxes.get(boxId);
        if (b == null) {
            return new BidResult(false, "UNKNOWN_BOX", 0, "", 0);
        }

        b.lock.lock();
        try {
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
            b.deadlineMs = System.currentTimeMillis() + TIMER_BASE_MS; // reseta o cronômetro
            return new BidResult(true, "OK", b.curBid, b.leader, remainingMs(b));
        } finally {
            b.lock.unlock();
        }
    }

    /** Snapshot das caixas, na ordem de criação. */
    public List<Snapshot> snapshot() {
        List<Snapshot> out = new ArrayList<>(boxes.size());
        for (Box b : boxes.values()) {
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
        long ms = b.deadlineMs - System.currentTimeMillis();
        return Math.max(ms, 0);
    }
}
