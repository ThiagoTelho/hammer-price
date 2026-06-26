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
 * pelo lock = timestamp do servidor). A rodada tem vida própria: o cronômetro de leilão
 * (timerBaseMs, ~20s) começa SÓ no 1º lance — antes disso a rodada fica aberta esperando
 * interesse; lances nos segundos finais ESTENDEM o prazo (anti-sniping). Uma janela de
 * abertura mais longa (noBidTimeoutMs) é a rede de segurança: se ninguém der lance até lá,
 * o lote fecha SEM vencedor e a partida segue (não trava). Ao fechar, o vencedor é debitado
 * (Settle) e pode ABRIR a caixa; após uma pausa (intermission) a próxima rodada começa com
 * uma nova caixa aleatória.
 */
public final class BoxStore {

    /** Parâmetros do leilão (do balance.yaml), injetados para facilitar testes. */
    public record Settings(long timerBaseMs, long antiSnipeWindowMs, long antiSnipeResetMs,
                           long incrementPct, long incrementAbs, long intermissionMs,
                           long noBidTimeoutMs, int minItems, int maxItems) {}

    /** Dependência da Carteira: reservar, devolver e debitar (arremate). */
    public interface Wallet {
        boolean reserve(String playerId, String boxId, long amount);
        void release(String playerId, String boxId);
        void settle(String playerId, String boxId, long amount);
    }

    /**
     * Notificação do ciclo de rodada (a publicação de eventos é wired pelo servidor).
     * Chamada SEMPRE fora do lock — o ouvinte pode fazer I/O (publicar em Redis/RabbitMQ).
     * {@code onRoundEnded} traz {@code winner == ""} quando a rodada fecha sem lances.
     */
    public interface RoundListener {
        void onRoundStarted(RoomState state);
        void onRoundEnded(int round, String boxId, String boxType, String winner, long price);
    }

    /** Resultado de um lance. */
    public record BidResult(boolean accepted, String reason, long currentBid, String leader, long timerMs) {}

    /** Estado da sala: rodada atual + caixa em leilão (com odds públicas). */
    public record RoomState(int round, boolean active, String boxId, String boxType,
                            long currentBid, String leader, long timerMs,
                            Map<String, Integer> odds) {}

    /** Resultado de uma abertura de caixa (item sorteado + quantos). {@code quantity}=0 no Mímico. */
    public record OpenResult(boolean ok, String reason, String item, int quantity, boolean isMimic) {}

    /** Caixa arrematada à espera de abertura pelo vencedor. */
    private record PendingOpen(String winner, String boxType, long price) {}

    /** Pesos default do sorteio de tipo (fallback se o balance.yaml não trouxer). */
    private static final LinkedHashMap<String, Integer> DEFAULT_WEIGHTS = new LinkedHashMap<>();
    static {
        DEFAULT_WEIGHTS.put("WOODEN", 50);
        DEFAULT_WEIGHTS.put("IRON", 30);
        DEFAULT_WEIGHTS.put("ROYAL", 15);
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
    private volatile boolean inIntermission = false;   // entre rodadas: aguarda "todos prontos" ou o teto
    private volatile ScheduledFuture<?> nextRoundTask;  // fallback que abre a próxima rodada no teto de tempo
    private final AtomicInteger boxSeq = new AtomicInteger();

    // Caixas arrematadas aguardando abertura pelo vencedor + ids já abertos.
    private final ConcurrentHashMap<String, PendingOpen> pendingOpens = new ConcurrentHashMap<>();
    private final Set<String> opened = ConcurrentHashMap.newKeySet();
    private static final RoundListener NO_OP = new RoundListener() {
        public void onRoundStarted(RoomState s) {}
        public void onRoundEnded(int r, String b, String t, String w, long p) {}
    };
    private volatile RoundListener roundListener = NO_OP;

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

    public void setRoundListener(RoundListener l) {
        this.roundListener = (l == null) ? NO_OP : l;
    }

    /** Sorteia o tipo da caixa pelos pesos cumulativos (sob o lock). */
    private String pickType() {
        if (totalWeight <= 0) {
            return "WOODEN";
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
        RoomState snap;
        lock.lock();
        try {
            roundNo++;
            boxId = "box-" + boxSeq.incrementAndGet();
            boxType = pickType();
            curBid = 0;
            leader = "";
            ended = false;
            active = true;
            armOpening(); // janela de abertura SEM lances; o cronômetro de leilão só arma no 1º lance
            snap = stateLocked();
        } finally {
            lock.unlock();
        }
        roundListener.onRoundStarted(snap); // fora do lock (pode publicar em Redis/RabbitMQ)
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
            boolean firstBid = leader.isEmpty(); // 1º lance da rodada → inicia o cronômetro de leilão
            // Devolve a reserva do líder anterior (se for outro jogador).
            if (!leader.isEmpty() && !leader.equals(playerId)) {
                wallet.release(leader, boxId);
            }
            curBid = amount;
            leader = playerId;
            armBid(firstBid); // 1º lance: tempo-base cheio; demais: reseta/estende (anti-sniping)
            return new BidResult(true, "OK", curBid, leader, remainingMs());
        } finally {
            lock.unlock();
        }
    }

    /** (Re)agenda o fechamento da rodada para daqui a {@code extendMs} (sob o lock). */
    private void scheduleClose(long extendMs) {
        deadlineMs = System.currentTimeMillis() + extendMs;
        if (closeTask != null) {
            closeTask.cancel(false);
        }
        closeTask = scheduler.schedule(this::closeRound, extendMs, TimeUnit.MILLISECONDS);
    }

    /** Janela de abertura SEM lances: a rodada espera o 1º lance. Se ninguém der lance dentro
     *  de {@code noBidTimeoutMs}, fecha sem vencedor (não trava a partida). */
    private void armOpening() {
        scheduleClose(cfg.noBidTimeoutMs());
    }

    /** Cronômetro de leilão a cada lance. O 1º lance dá o tempo-base cheio; lances nos
     *  segundos finais estendem menos (anti-sniping). */
    private void armBid(boolean firstBid) {
        long extend;
        if (firstBid) {
            extend = cfg.timerBaseMs();
        } else {
            long remaining = deadlineMs - System.currentTimeMillis();
            extend = (remaining <= cfg.antiSnipeWindowMs()) ? cfg.antiSnipeResetMs() : cfg.timerBaseMs();
        }
        scheduleClose(extend);
    }

    /** Fecha a rodada: debita o vencedor (se houver) e agenda/dispara a próxima. */
    private void closeRound() {
        int endedRound;
        String endedBoxId;
        String endedType;
        String winner;
        long price;
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
            endedRound = roundNo;
            endedBoxId = boxId;
            endedType = boxType;
            winner = leader; // "" se ninguém deu lance
            price = curBid;
            if (!winner.isEmpty()) {
                wallet.settle(winner, endedBoxId, price); // o vencedor paga de fato
            }
            // Próxima rodada: imediata quando não há pausa (determinístico em teste);
            // caso contrário, agendada após a intermission.
            if (cfg.intermissionMs() <= 0) {
                startNext = true; // sem intervalo (determinístico em teste)
            } else {
                // Intervalo entre rodadas: abre a próxima no TETO de tempo, salvo se
                // advanceRound() for chamado antes (todos os jogadores prontos).
                inIntermission = true;
                nextRoundTask = scheduler.schedule(this::startNextRound, cfg.intermissionMs(), TimeUnit.MILLISECONDS);
            }
        } finally {
            lock.unlock();
        }
        if (!winner.isEmpty()) {
            // O vencedor poderá ABRIR a caixa arrematada (sorteio do item).
            pendingOpens.put(endedBoxId, new PendingOpen(winner, endedType, price));
        }
        roundListener.onRoundEnded(endedRound, endedBoxId, endedType, winner, price); // fora do lock
        if (startNext) {
            startRound();
        }
    }

    /** Sai do intervalo e abre a próxima rodada — guardado para abrir UMA vez só
     *  (vence o teto de tempo OU o "todos prontos", o que vier primeiro). */
    private void startNextRound() {
        boolean go = false;
        lock.lock();
        try {
            if (inIntermission) {
                inIntermission = false;
                go = true;
            }
        } finally {
            lock.unlock();
        }
        if (go) {
            startRound();
        }
    }

    /**
     * Encerra o intervalo agora e abre a próxima rodada (ex.: todos prontos). Se for chamado
     * durante uma rodada SEM lances (ex.: início de partida herdando uma rodada já em
     * andamento), REINICIA a rodada do zero — assim a partida sempre começa com a janela de
     * abertura cheia, em vez de herdar uma janela quase vencida.
     */
    public void advanceRound() {
        ScheduledFuture<?> t = nextRoundTask;
        if (t != null) {
            t.cancel(false);
        }
        boolean restartFresh = false;
        lock.lock();
        try {
            if (active && leader.isEmpty() && !inIntermission) {
                restartFresh = true;
            }
        } finally {
            lock.unlock();
        }
        if (restartFresh) {
            startRound(); // nova caixa + janela de abertura cheia (cancela o fechamento pendente)
        } else {
            startNextRound();
        }
    }

    /**
     * Abre uma caixa arrematada: valida que é o vencedor e que não foi aberta, e sorteia
     * o item (RNG server-side) pelas odds públicas do tipo + a quantidade. Idempotente por
     * remoção atômica do registro pendente.
     */
    public OpenResult openBox(String reqBoxId, String playerId) {
        PendingOpen po = pendingOpens.get(reqBoxId);
        if (po == null) {
            return new OpenResult(false, opened.contains(reqBoxId) ? "ALREADY_OPENED" : "UNKNOWN_BOX", "", 0, false);
        }
        if (!po.winner().equals(playerId)) {
            return new OpenResult(false, "NOT_WINNER", "", 0, false);
        }
        if (!pendingOpens.remove(reqBoxId, po)) {
            return new OpenResult(false, "ALREADY_OPENED", "", 0, false); // corrida: já aberta
        }
        opened.add(reqBoxId);
        String item = opener.draw(po.boxType());
        boolean mimic = "MIMIC".equals(item);
        // Mímico é penalidade única (sem itens); item real rende de min..max unidades.
        int quantity = mimic ? 0 : opener.drawQuantity(cfg.minItems(), cfg.maxItems());
        return new OpenResult(true, "OK", item, quantity, mimic);
    }

    /** Estado da sala: rodada atual + a caixa em leilão (odds públicas quando ativa). */
    public RoomState roomState() {
        lock.lock();
        try {
            return stateLocked();
        } finally {
            lock.unlock();
        }
    }

    /** Constrói o estado da sala assumindo que o lock já é mantido pelo chamador. */
    private RoomState stateLocked() {
        Map<String, Integer> odds = active ? opener.oddsFor(boxType) : Map.of();
        return new RoomState(roundNo, active, boxId, boxType, curBid, leader, remainingMs(), odds);
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

    /**
     * Fecha a rodada corrente IMEDIATAMENTE (ex.: todos os jogadores passaram/fold). Liquida
     * o líder se houver; sem líder, encerra sem vencedor. Idempotente (guardado por {@code ended}).
     */
    public void forceClose() {
        lock.lock();
        try {
            deadlineMs = System.currentTimeMillis() - 1; // vence o cronômetro -> closeRound fecha de fato
        } finally {
            lock.unlock();
        }
        closeRound();
    }

    // ---- Apoio a testes (visível no mesmo pacote) ----

    /** Força o fechamento imediato da rodada corrente (determinístico em teste). */
    void closeNow() {
        forceClose();
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
