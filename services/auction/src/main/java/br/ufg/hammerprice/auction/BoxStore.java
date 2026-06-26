package br.ufg.hammerprice.auction;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.locks.ReentrantLock;

/**
 * Núcleo do leilão no modelo ROUND-BASED: uma caixa por rodada.
 *
 * <p>A cada rodada, o servidor SORTEIA o tipo de uma única caixa (pesos do {@code
 * balance.yaml}), expõe as odds públicas e abre o leilão. Toda a sala disputa a MESMA
 * caixa: um único {@link ReentrantLock} serializa os lances concorrentes e as transições
 * de rodada — a invariante que ele protege é o estado da rodada corrente (caixa, líder,
 * cronômetro). O vencedor é o ÚLTIMO lance válido antes do cronômetro zerar (ordem dada
 * pelo lock = timestamp do servidor). A rodada tem vida própria: o cronômetro é armado já
 * no início (fecha mesmo sem lances); lances nos segundos finais ESTENDEM o prazo
 * (anti-sniping). Ao fechar, o vencedor é debitado (Settle) e pode ABRIR a caixa; após uma
 * pausa curta (intermission) a próxima rodada começa com uma nova caixa aleatória. Se
 * ninguém der lance, a rodada encerra sem vencedor e a próxima começa.
 */
public final class BoxStore {

    /** Parâmetros do leilão (do balance.yaml), injetados para facilitar testes. */
    public record Settings(long timerBaseMs, long antiSnipeWindowMs, long antiSnipeResetMs,
                           long incrementPct, long incrementAbs, long intermissionMs) {}

    /** Dependência da Carteira: reservar, devolver e debitar (arremate). */
    public interface Wallet {
        boolean reserve(String playerId, String boxId, long amount);
        void release(String playerId, String boxId);
        void settle(String playerId, String boxId, long amount);
    }

    /** Notificação de caixa arrematada (publicação de eventos é wired pelo servidor/gateway). */
    public interface CloseListener {
        void onSold(String boxId, String winner, long price);
    }

    /** Fonte da afinidade do jogador (item → pontos percentuais). Default: sem afinidade. */
    public interface AffinitySource {
        Map<String, Integer> forPlayer(String playerId);
    }

    /** Resultado de um lance. */
    public record BidResult(boolean accepted, String reason, long currentBid, String leader, long timerMs) {}

    /** Estado da sala: rodada atual + caixa em leilão (com odds públicas). */
    public record RoomState(int round, boolean active, String boxId, String boxType,
                            long currentBid, String leader, long timerMs,
                            Map<String, Integer> odds) {}

    /** Resultado de uma abertura de caixa (sorteio do item). */
    public record OpenResult(boolean ok, String reason, String item, boolean isMimic) {}

    /** Caixa arrematada à espera de abertura pelo vencedor. */
    private record PendingOpen(String winner, String boxType, long price) {}

    /** Pesos default do sorteio de tipo (fallback se o balance.yaml não trouxer). */
    private static final LinkedHashMap<String, Integer> DEFAULT_WEIGHTS = new LinkedHashMap<>();
    static {
        DEFAULT_WEIGHTS.put("BRONZE", 50);
        DEFAULT_WEIGHTS.put("SILVER", 30);
        DEFAULT_WEIGHTS.put("GOLD", 15);
        DEFAULT_WEIGHTS.put("VAULT", 5);
    }

    private final Wallet wallet;
    private final Settings cfg;
    private final BoxOpener opener;

    // Sorteio do tipo de caixa (pesos cumulativos), acessado só sob `lock`.
    private final String[] types;
    private final int[] cumWeights;
    private final int totalWeight;
    private final Random typeRng;

    private final ScheduledExecutorService scheduler =
            Executors.newSingleThreadScheduledExecutor(r -> {
                Thread t = new Thread(r, "round-timer");
                t.setDaemon(true);
                return t;
            });

    // ---- estado da rodada corrente, protegido por `lock` ----
    private final ReentrantLock lock = new ReentrantLock();
    private int roundNo = 0;
    private boolean active = false;   // false durante a pausa entre rodadas
    private boolean ended = false;    // a rodada corrente já foi fechada?
    private String boxId = "";
    private String boxType = "";
    private long curBid = 0;
    private String leader = "";
    private long deadlineMs = 0;
    private ScheduledFuture<?> closeTask;
    private final AtomicInteger boxSeq = new AtomicInteger();

    // Caixas arrematadas aguardando abertura pelo vencedor + ids já abertos.
    private final ConcurrentHashMap<String, PendingOpen> pendingOpens = new ConcurrentHashMap<>();
    private final Set<String> opened = ConcurrentHashMap.newKeySet();
    private volatile CloseListener closeListener = (id, w, p) -> {};
    private volatile AffinitySource affinitySource = p -> Map.of();

    /** Cria o leilão e abre a rodada 1 imediatamente. */
    public BoxStore(Wallet wallet, Settings cfg, BoxOpener opener,
                    Map<String, Integer> typeWeights, Random typeRng) {
        this.wallet = wallet;
        this.cfg = cfg;
        this.opener = opener;
        this.typeRng = typeRng;
        Map<String, Integer> src = (typeWeights == null || typeWeights.isEmpty())
                ? DEFAULT_WEIGHTS : typeWeights;
        LinkedHashMap<String, Integer> w = new LinkedHashMap<>();
        src.forEach((k, v) -> { if (v != null && v > 0) w.put(k, v); });
        this.types = w.keySet().toArray(new String[0]);
        this.cumWeights = new int[types.length];
        int acc = 0;
        int i = 0;
        for (int v : w.values()) {
            acc += v;
            cumWeights[i++] = acc;
        }
        this.totalWeight = acc;
        startRound();
    }

    public void setCloseListener(CloseListener l) {
        this.closeListener = (l == null) ? (id, w, p) -> {} : l;
    }

    public void setAffinitySource(AffinitySource s) {
        this.affinitySource = (s == null) ? p -> Map.of() : s;
    }

    /** Sorteia o tipo da caixa pelos pesos cumulativos (sob o lock). */
    private String pickType() {
        if (totalWeight <= 0) {
            return "BRONZE";
        }
        int r = typeRng.nextInt(totalWeight); // [0, total)
        for (int i = 0; i < cumWeights.length; i++) {
            if (r < cumWeights[i]) {
                return types[i];
            }
        }
        return types[types.length - 1];
    }

    /** Abre uma nova rodada com uma caixa de tipo sorteado e arma o cronômetro. */
    private void startRound() {
        lock.lock();
        try {
            roundNo++;
            boxId = "box-" + boxSeq.incrementAndGet();
            boxType = pickType();
            curBid = 0;
            leader = "";
            ended = false;
            active = true;
            armTimer(true); // a rodada começa com o cronômetro-base armado (fecha mesmo sem lances)
        } finally {
            lock.unlock();
        }
    }

    /** Incremento mínimo: percentual do lance atual, com piso absoluto (balance.yaml). */
    private long minIncrement(long cur) {
        long inc = cur * cfg.incrementPct() / 100;
        return Math.max(inc, cfg.incrementAbs());
    }

    /** Aplica um lance de forma atômica na caixa da rodada; estende o cronômetro. */
    public BidResult placeBid(String reqBoxId, String playerId, long amount) {
        lock.lock();
        try {
            if (!boxId.equals(reqBoxId)) {
                return new BidResult(false, "UNKNOWN_BOX", 0, "", 0);
            }
            if (!active) {
                return new BidResult(false, "BOX_CLOSED", curBid, leader, 0);
            }
            if (amount < curBid + minIncrement(curBid)) {
                return new BidResult(false, "TOO_LOW", curBid, leader, remainingMs());
            }
            // Reserva o saldo do novo lance ANTES de aceitar (chamada síncrona à Carteira).
            if (!wallet.reserve(playerId, boxId, amount)) {
                return new BidResult(false, "INSUFFICIENT_BALANCE", curBid, leader, remainingMs());
            }
            // Devolve a reserva do líder anterior (se for outro jogador).
            if (!leader.isEmpty() && !leader.equals(playerId)) {
                wallet.release(leader, boxId);
            }
            curBid = amount;
            leader = playerId;
            armTimer(false); // reseta/estende o cronômetro (anti-sniping)
            return new BidResult(true, "OK", curBid, leader, remainingMs());
        } finally {
            lock.unlock();
        }
    }

    /** (Re)arma o cronômetro sob o lock. No início da rodada: base cheio. Em lances nos
     *  segundos finais: estende menos (anti-sniping). */
    private void armTimer(boolean roundStart) {
        long now = System.currentTimeMillis();
        long extend;
        if (roundStart) {
            extend = cfg.timerBaseMs();
        } else {
            long remaining = deadlineMs - now;
            extend = (remaining <= cfg.antiSnipeWindowMs()) ? cfg.antiSnipeResetMs() : cfg.timerBaseMs();
        }
        deadlineMs = now + extend;
        if (closeTask != null) {
            closeTask.cancel(false);
        }
        closeTask = scheduler.schedule(this::closeRound, extend, TimeUnit.MILLISECONDS);
    }

    /** Fecha a rodada: debita o vencedor (se houver) e agenda/dispara a próxima. */
    private void closeRound() {
        String soldId = null;
        String soldWinner = null;
        String soldType = null;
        long soldPrice = 0;
        boolean startNext = false;
        lock.lock();
        try {
            if (ended) {
                return;
            }
            // Disparo obsoleto: um lance estendeu o prazo; o fechamento real virá depois.
            if (System.currentTimeMillis() < deadlineMs) {
                return;
            }
            ended = true;
            active = false;
            if (!leader.isEmpty()) {
                wallet.settle(leader, boxId, curBid); // o vencedor paga de fato
                soldId = boxId;
                soldWinner = leader;
                soldType = boxType;
                soldPrice = curBid;
            }
            // Próxima rodada: imediata quando não há pausa (determinístico em teste);
            // caso contrário, agendada após a intermission.
            if (cfg.intermissionMs() <= 0) {
                startNext = true;
            } else {
                scheduler.schedule(this::startRound, cfg.intermissionMs(), TimeUnit.MILLISECONDS);
            }
        } finally {
            lock.unlock();
        }
        if (soldWinner != null) {
            // O vencedor poderá ABRIR a caixa arrematada (sorteio do item).
            pendingOpens.put(soldId, new PendingOpen(soldWinner, soldType, soldPrice));
            closeListener.onSold(soldId, soldWinner, soldPrice);
        }
        if (startNext) {
            startRound();
        }
    }

    /**
     * Abre uma caixa arrematada: valida que é o vencedor e que não foi aberta, e sorteia
     * o item (RNG server-side) pelas odds do tipo + afinidade do jogador. Idempotente por
     * remoção atômica do registro pendente.
     */
    public OpenResult openBox(String reqBoxId, String playerId) {
        PendingOpen po = pendingOpens.get(reqBoxId);
        if (po == null) {
            return new OpenResult(false, opened.contains(reqBoxId) ? "ALREADY_OPENED" : "UNKNOWN_BOX", "", false);
        }
        if (!po.winner().equals(playerId)) {
            return new OpenResult(false, "NOT_WINNER", "", false);
        }
        if (!pendingOpens.remove(reqBoxId, po)) {
            return new OpenResult(false, "ALREADY_OPENED", "", false); // corrida: já aberta
        }
        opened.add(reqBoxId);
        String item = opener.draw(po.boxType(), affinitySource.forPlayer(playerId));
        return new OpenResult(true, "OK", item, "MIMIC".equals(item));
    }

    /** Estado da sala: rodada atual + a caixa em leilão (odds públicas quando ativa). */
    public RoomState roomState() {
        lock.lock();
        try {
            Map<String, Integer> odds = active ? opener.oddsFor(boxType) : Map.of();
            return new RoomState(roundNo, active, boxId, boxType, curBid, leader, remainingMs(), odds);
        } finally {
            lock.unlock();
        }
    }

    private long remainingMs() {
        if (!active || deadlineMs == 0) {
            return 0;
        }
        return Math.max(deadlineMs - System.currentTimeMillis(), 0);
    }

    /** Encerra o agendador de cronômetros (chamado no shutdown do servidor). */
    public void shutdown() {
        scheduler.shutdownNow();
    }

    // ---- Apoio a testes (visível no mesmo pacote) ----

    /** Força o fechamento imediato da rodada corrente (determinístico em teste). */
    void closeNow() {
        lock.lock();
        try {
            deadlineMs = System.currentTimeMillis() - 1;
        } finally {
            lock.unlock();
        }
        closeRound();
    }

    /** Ajusta o tempo restante da rodada para simular cenários de anti-sniping. */
    void setRemainingForTest(long ms) {
        lock.lock();
        try {
            deadlineMs = System.currentTimeMillis() + ms;
        } finally {
            lock.unlock();
        }
    }
}
