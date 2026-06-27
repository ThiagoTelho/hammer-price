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
        void settle(String playerId, String boxId, long amount, int discountPct);
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

    /** Resultado de uma abertura de caixa (item sorteado + quantos). {@code quantity}=0 no Mímico.
     *  {@code insured}: o vencedor tinha Seguro (o servidor não aplica a penalidade).
     *  {@code cursed}: o Mímico veio de uma Maldição (revela ao vencedor que foi amaldiçoado). */
    public record OpenResult(boolean ok, String reason, String item, int quantity, boolean isMimic, boolean insured, boolean cursed, boolean cardDropped) {}

    /** Caixa arrematada à espera de abertura pelo vencedor (com efeitos de carta + drop pré-sorteado). */
    private record PendingOpen(String winner, String boxType, long price,
                               boolean doubleLoot, boolean cursed, boolean insured,
                               String dropItem, int dropQty, boolean dropCard) {}

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
    private final Map<String, Integer> cardChances; // % de a caixa de cada tipo vir TAMBÉM com carta

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
    private String dropItem = "";   // item pré-sorteado da caixa da rodada (carta Visão revela)
    private int dropQty = 0;        // quantidade pré-sorteada
    private boolean dropCard = false; // a caixa também vem com uma carta? (pré-sorteado por tipo)
    private long curBid = 0;
    private String leader = "";
    private long deadlineMs = 0;
    private ScheduledFuture<?> closeTask;
    private volatile boolean inIntermission = false;   // entre rodadas: aguarda "todos prontos" ou o teto
    private volatile ScheduledFuture<?> nextRoundTask;  // fallback que abre a próxima rodada no teto de tempo
    private final AtomicInteger boxSeq = new AtomicInteger();

    // Efeitos de cartas (sob `lock`). `pending` = empurrado pelo gateway p/ a próxima rodada;
    // `round` = efeitos da rodada corrente (resolvidos por jogador no fechamento → PendingOpen).
    private Effects pending = new Effects();
    private Effects round = new Effects();

    /** Efeitos de carta de uma rodada (jogadores afetados + ajustes da caixa). */
    private static final class Effects {
        Set<String> doubleLoot = new java.util.HashSet<>(); // Dobro
        Set<String> insured = new java.util.HashSet<>();     // Seguro
        Set<String> cursed = new java.util.HashSet<>();      // Maldição (alvo)
        Set<String> gavel = new java.util.HashSet<>();       // Martelo (fontes: rivais pagam +)
        Set<String> insight = new java.util.HashSet<>();     // Visão (veem o drop)
        Map<String, Integer> discounts = new java.util.HashMap<>(); // Desconto (jogador→%)
        int boxTierBoost = 0;                                // Reforço (níveis a subir)
        void clear() {
            doubleLoot = new java.util.HashSet<>();
            insured = new java.util.HashSet<>();
            cursed = new java.util.HashSet<>();
            gavel = new java.util.HashSet<>();
            insight = new java.util.HashSet<>();
            discounts = new java.util.HashMap<>();
            boxTierBoost = 0;
        }
    }

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
                    Map<String, Integer> typeWeights, Map<String, Integer> cardChances, Random typeRng) {
        this.wallet = wallet;
        this.cfg = cfg;
        this.opener = opener;
        this.typeRng = typeRng;
        this.cardChances = (cardChances == null) ? Map.of() : cardChances;
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

    /** Efeitos de carta para a PRÓXIMA rodada (empurrados pelo gateway antes do advance). */
    public void setPendingEffects(java.util.Collection<String> doubleLoot,
                                  java.util.Collection<String> insured,
                                  java.util.Collection<String> cursed,
                                  java.util.Collection<String> gavel,
                                  java.util.Collection<String> insight,
                                  Map<String, Integer> discounts,
                                  int boxTierBoost) {
        lock.lock();
        try {
            pending.clear();
            pending.doubleLoot.addAll(doubleLoot);
            pending.insured.addAll(insured);
            pending.cursed.addAll(cursed);
            pending.gavel.addAll(gavel);
            pending.insight.addAll(insight);
            pending.discounts.putAll(discounts);
            pending.boxTierBoost = boxTierBoost;
        } finally {
            lock.unlock();
        }
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

    /** Sobe o nível do baú em {@code boost} posições no ladder de raridade (cap no topo). */
    private String boostTier(String type, int boost) {
        if (boost <= 0) {
            return type;
        }
        for (int i = 0; i < types.length; i++) {
            if (types[i].equals(type)) {
                return types[Math.min(types.length - 1, i + boost)];
            }
        }
        return type;
    }

    /** Abre uma nova rodada com uma caixa de tipo sorteado e arma o cronômetro. */
    private void startRound() {
        RoomState snap;
        lock.lock();
        try {
            // Efeitos de carta empurrados no intervalo passam a valer NESTA rodada.
            round = pending;
            pending = new Effects();
            roundNo++;
            boxId = "box-" + boxSeq.incrementAndGet();
            boxType = boostTier(pickType(), round.boxTierBoost); // carta Reforço sobe o nível
            // Pré-sorteia o drop (item + quantidade) — fixo p/ a rodada; a carta Visão revela.
            dropItem = opener.draw(boxType);
            dropQty = "MIMIC".equals(dropItem) ? 0 : opener.drawQuantity(cfg.minItems(), cfg.maxItems());
            // Pré-sorteia se a caixa também vem com uma carta (chance por tipo, do balance.yaml).
            int cardChance = cardChances.getOrDefault(boxType, 0);
            dropCard = cardChance > 0 && typeRng.nextInt(100) < cardChance;
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
            long inc = minIncrement(curBid);
            // Carta Martelo: quem NÃO jogou a carta precisa subir o DOBRO do incremento mínimo.
            if (!round.gavel.isEmpty() && !round.gavel.contains(playerId)) {
                inc *= 2;
            }
            if (amount < curBid + inc) {
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
        boolean winDouble = false;   // Dobro: a abertura do vencedor rende o dobro
        boolean winCursed = false;   // Maldição: a vitória abre como Mímico
        boolean winInsured = false;  // Seguro: sem penalidade de Mímico
        int winDiscount = 0;         // Desconto: % de abatimento no arremate do vencedor
        String winDropItem = "";     // drop pré-sorteado da caixa arrematada
        int winDropQty = 0;
        boolean winDropCard = false; // a caixa arrematada também traz carta?
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
            // Resolve os efeitos de carta do vencedor (lidos sob o lock) p/ valerem na abertura.
            winDouble = round.doubleLoot.contains(winner);
            winCursed = round.cursed.contains(winner);
            winInsured = round.insured.contains(winner);
            winDiscount = round.discounts.getOrDefault(winner, 0);
            winDropItem = dropItem;
            winDropQty = dropQty;
            winDropCard = dropCard;
            if (!winner.isEmpty()) {
                wallet.settle(winner, endedBoxId, price, winDiscount); // o vencedor paga (com Desconto)
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
            // O vencedor poderá ABRIR a caixa arrematada (sorteio do item) — com seus efeitos de carta.
            pendingOpens.put(endedBoxId, new PendingOpen(winner, endedType, price, winDouble, winCursed, winInsured, winDropItem, winDropQty, winDropCard));
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
            return new OpenResult(false, opened.contains(reqBoxId) ? "ALREADY_OPENED" : "UNKNOWN_BOX", "", 0, false, false, false, false);
        }
        if (!po.winner().equals(playerId)) {
            return new OpenResult(false, "NOT_WINNER", "", 0, false, false, false, false);
        }
        if (!pendingOpens.remove(reqBoxId, po)) {
            return new OpenResult(false, "ALREADY_OPENED", "", 0, false, false, false, false); // corrida: já aberta
        }
        opened.add(reqBoxId);
        // Usa o drop PRÉ-SORTEADO da rodada (carta Visão revela esse mesmo item).
        String item = po.cursed() ? "MIMIC" : po.dropItem(); // Maldição força Mímico
        boolean mimic = "MIMIC".equals(item);
        int quantity = mimic ? 0 : (po.doubleLoot() ? po.dropQty() * 2 : po.dropQty()); // Dobro = ×2
        // insured: o servidor de leilão pula a penalidade do Mímico (Seguro).
        // A carta só acompanha caixa COM itens (Mímico não dá carta).
        return new OpenResult(true, "OK", item, quantity, mimic, po.insured(), po.cursed(), !mimic && po.dropCard());
    }

    /** Item pré-sorteado da caixa da rodada corrente (carta Visão). Vazio se não houver rodada ativa. */
    public OpenResult peekDrop() {
        lock.lock();
        try {
            if (!active) {
                return new OpenResult(false, "", "", 0, false, false, false, false);
            }
            return new OpenResult(true, "OK", dropItem, dropQty, "MIMIC".equals(dropItem), false, false, false);
        } finally {
            lock.unlock();
        }
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

    /**
     * Limpa o rastreamento de aberturas (caixas arrematadas pendentes + ids já abertos) — chamado
     * no início de cada partida para não acumular estado de jogos anteriores (evita vazamento lento).
     */
    public void resetOpens() {
        pendingOpens.clear();
        opened.clear();
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
