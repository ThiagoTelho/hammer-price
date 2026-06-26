package br.ufg.hammerprice.auction;

import br.ufg.hammerprice.auction.grpc.AdvanceReply;
import br.ufg.hammerprice.auction.grpc.AuctionGrpc;
import br.ufg.hammerprice.auction.grpc.Box;
import br.ufg.hammerprice.auction.grpc.OpenBoxReply;
import br.ufg.hammerprice.auction.grpc.OpenBoxRequest;
import br.ufg.hammerprice.auction.grpc.PlaceBidReply;
import br.ufg.hammerprice.auction.grpc.PlaceBidRequest;
import br.ufg.hammerprice.auction.grpc.RoomQuery;
import br.ufg.hammerprice.auction.grpc.RoomState;
import java.util.Map;
import java.util.Random;
import br.ufg.hammerprice.wallet.grpc.AddItemRequest;
import br.ufg.hammerprice.wallet.grpc.Affinity;
import br.ufg.hammerprice.wallet.grpc.MimicReply;
import br.ufg.hammerprice.wallet.grpc.PlayerQuery;
import br.ufg.hammerprice.wallet.grpc.PlayerState;
import br.ufg.hammerprice.wallet.grpc.ReleaseRequest;
import br.ufg.hammerprice.wallet.grpc.ReserveRequest;
import br.ufg.hammerprice.wallet.grpc.SettleRequest;
import br.ufg.hammerprice.wallet.grpc.WalletGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.stub.StreamObserver;
import java.util.HashMap;
import java.util.concurrent.TimeUnit;

/** Servidor gRPC do Leilão (fatia vertical). Também é CLIENTE gRPC da Carteira. */
public final class AuctionServer {

    /** Adapta o cliente gRPC da Carteira à interface {@link BoxStore.Wallet}. */
    static final class WalletGateway implements BoxStore.Wallet {
        private final WalletGrpc.WalletBlockingStub stub;

        WalletGateway(WalletGrpc.WalletBlockingStub stub) {
            this.stub = stub;
        }

        @Override
        public boolean reserve(String playerId, String boxId, long amount) {
            try {
                return stub.withDeadlineAfter(2, TimeUnit.SECONDS)
                        .reserve(ReserveRequest.newBuilder()
                                .setPlayerId(playerId).setBoxId(boxId).setAmount(amount).build())
                        .getOk();
            } catch (Exception e) {
                System.err.println("auction: erro ao reservar saldo: " + e.getMessage());
                return false;
            }
        }

        @Override
        public void release(String playerId, String boxId) {
            try {
                stub.withDeadlineAfter(2, TimeUnit.SECONDS)
                        .release(ReleaseRequest.newBuilder()
                                .setPlayerId(playerId).setBoxId(boxId).build());
            } catch (Exception e) {
                System.err.println("auction: erro ao devolver reserva: " + e.getMessage());
            }
        }

        @Override
        public void settle(String playerId, String boxId, long amount) {
            try {
                stub.withDeadlineAfter(2, TimeUnit.SECONDS)
                        .settle(SettleRequest.newBuilder()
                                .setPlayerId(playerId).setBoxId(boxId).setAmount(amount).build());
            } catch (Exception e) {
                System.err.println("auction: erro ao debitar o vencedor: " + e.getMessage());
            }
        }

        /** Credita ao inventário do jogador o item sorteado na abertura da caixa. */
        void addItem(String playerId, String type) {
            try {
                stub.withDeadlineAfter(2, TimeUnit.SECONDS)
                        .addItem(AddItemRequest.newBuilder()
                                .setPlayerId(playerId).setType(type).build());
            } catch (Exception e) {
                System.err.println("auction: erro ao creditar item: " + e.getMessage());
            }
        }

        /** Aplica a penalidade do Mímico (abertura de 💀) e retorna o que aconteceu (ou null). */
        MimicReply applyMimic(String playerId) {
            try {
                return stub.withDeadlineAfter(2, TimeUnit.SECONDS)
                        .applyMimic(PlayerQuery.newBuilder().setPlayerId(playerId).build());
            } catch (Exception e) {
                System.err.println("auction: erro ao aplicar penalidade do Mímico: " + e.getMessage());
                return null;
            }
        }

        /** Lê a afinidade do jogador (alimenta o RNG da abertura). */
        java.util.Map<String, Integer> getAffinity(String playerId) {
            try {
                PlayerState ps = stub.withDeadlineAfter(2, TimeUnit.SECONDS)
                        .getPlayer(PlayerQuery.newBuilder().setPlayerId(playerId).build());
                HashMap<String, Integer> out = new HashMap<>();
                for (Affinity a : ps.getAffinitiesList()) {
                    out.put(a.getType(), a.getPoints());
                }
                return out;
            } catch (Exception e) {
                System.err.println("auction: erro ao ler afinidade: " + e.getMessage());
                return java.util.Map.of();
            }
        }
    }

    static final class AuctionService extends AuctionGrpc.AuctionImplBase {
        private final BoxStore store;
        private final EventPublisher events;
        private final WalletGateway wallet;

        AuctionService(BoxStore store, EventPublisher events, WalletGateway wallet) {
            this.store = store;
            this.events = events;
            this.wallet = wallet;
        }

        @Override
        public void placeBid(PlaceBidRequest req, StreamObserver<PlaceBidReply> obs) {
            BoxStore.BidResult r = store.placeBid(req.getBoxId(), req.getPlayerId(), req.getAmount());
            // SÍNCRONO: confirmação bloqueante (aceito/rejeitado) volta a quem deu o lance.
            obs.onNext(PlaceBidReply.newBuilder()
                    .setAccepted(r.accepted())
                    .setReason(r.reason())
                    .setCurrentBid(r.currentBid())
                    .setLeader(r.leader())
                    .setTimerMs(r.timerMs())
                    .build());
            obs.onCompleted();
            // ASSÍNCRONO: o evento é difundido a todos via Redis Pub/Sub (sem o emissor esperar).
            if (r.accepted()) {
                events.bidPlaced(req.getBoxId(), req.getPlayerId(), r.currentBid(), r.timerMs());
            }
        }

        @Override
        public void getRoomState(RoomQuery req, StreamObserver<RoomState> obs) {
            BoxStore.RoomState st = store.roomState();
            Box box = Box.newBuilder()
                    .setBoxId(st.boxId())
                    .setBoxType(st.boxType())
                    .setCurrentBid(st.currentBid())
                    .setLeader(st.leader())
                    .setTimerMs(st.timerMs())
                    .putAllOdds(st.odds())
                    .build();
            obs.onNext(RoomState.newBuilder()
                    .setRound(st.round())
                    .setActive(st.active())
                    .setBox(box)
                    .setEndsAt(st.active() ? System.currentTimeMillis() + st.timerMs() : 0)
                    .build());
            obs.onCompleted();
        }

        @Override
        public void openBox(OpenBoxRequest req, StreamObserver<OpenBoxReply> obs) {
            BoxStore.OpenResult r = store.openBox(req.getBoxId(), req.getPlayerId());
            // Aplica o efeito na Carteira ANTES de responder, para que o saldo já reflita
            // a penalidade quando o gateway reler a carteira do vencedor.
            MimicReply pen = null;
            if (r.ok()) {
                if (r.isMimic()) {
                    pen = wallet.applyMimic(req.getPlayerId()); // 💀 penaliza (não vira item)
                } else {
                    wallet.addItem(req.getPlayerId(), r.item()); // credita o item sorteado
                }
            }
            obs.onNext(OpenBoxReply.newBuilder()
                    .setOk(r.ok())
                    .setReason(r.reason())
                    .setItem(r.item())
                    .setIsMimic(r.isMimic())
                    .build());
            obs.onCompleted();
            if (r.ok()) {
                // Difunde o resultado (+ penalidade do Mímico) e enfileira box.opened (RabbitMQ).
                events.boxOpened(req.getBoxId(), req.getPlayerId(), r.item(), r.isMimic(),
                        pen == null ? "" : pen.getKind(), pen == null ? "" : pen.getDetail());
            }
        }

        @Override
        public void advanceRound(RoomQuery req, StreamObserver<AdvanceReply> obs) {
            store.advanceRound(); // encerra o intervalo e abre já a próxima rodada
            obs.onNext(AdvanceReply.newBuilder().setStarted(true).build());
            obs.onCompleted();
        }

        @Override
        public void forceClose(RoomQuery req, StreamObserver<AdvanceReply> obs) {
            store.forceClose(); // todos passaram -> fecha a rodada já (o líder vence)
            obs.onNext(AdvanceReply.newBuilder().setStarted(true).build());
            obs.onCompleted();
        }
    }

    /** Odds de fallback (espelham o balance.yaml) caso a config não esteja disponível. */
    private static final Map<String, Map<String, Integer>> DEFAULT_ODDS = Map.of(
            "BRONZE", Map.of("COPPER", 60, "SILVER", 30, "GOLD", 9, "DIAMOND", 1, "MIMIC", 0),
            "SILVER", Map.of("COPPER", 35, "SILVER", 40, "GOLD", 20, "DIAMOND", 4, "MIMIC", 1),
            "GOLD", Map.of("COPPER", 15, "SILVER", 30, "GOLD", 40, "DIAMOND", 12, "MIMIC", 3),
            "VAULT", Map.of("COPPER", 5, "SILVER", 15, "GOLD", 35, "DIAMOND", 40, "MIMIC", 5));

    public static void main(String[] args) throws Exception {
        int port = parsePort(System.getenv("AUCTION_ADDR"), 50051);
        String walletAddr = System.getenv().getOrDefault("WALLET_GRPC", "localhost:50052");

        ManagedChannel channel = ManagedChannelBuilder.forTarget(walletAddr)
                .usePlaintext()
                .build();
        WalletGateway gw = new WalletGateway(WalletGrpc.newBlockingStub(channel));

        BalanceConfig cfg = BalanceConfig.load();
        BoxStore.Settings settings = new BoxStore.Settings(
                cfg.matchLong("box_timer_seconds", 20) * 1000,
                cfg.matchLong("antisnipe_window_seconds", 5) * 1000,
                cfg.matchLong("antisnipe_reset_seconds", 8) * 1000,
                cfg.matchLong("min_bid_increment_pct", 5),
                cfg.matchLong("min_bid_increment_abs", 5),
                cfg.roundLong("intermission_max_seconds", 120) * 1000,
                cfg.matchLong("no_bid_timeout_seconds", 45) * 1000);

        // RNG de abertura: usa odds do balance.yaml (com fallback) e seed injetável.
        BoxOpener.Odds oddsSource = type -> {
            Map<String, Integer> m = cfg.boxOdds(type);
            return m.isEmpty() ? DEFAULT_ODDS.getOrDefault(type, Map.of()) : m;
        };
        String seedEnv = System.getenv("RNG_SEED");
        BoxOpener opener = (seedEnv == null || seedEnv.isBlank())
                ? new BoxOpener(oddsSource)
                : new BoxOpener(oddsSource, Long.parseLong(seedEnv.trim()));
        System.out.println("auction: RNG de abertura " + (seedEnv == null || seedEnv.isBlank()
                ? "aleatório" : "com seed " + seedEnv.trim()));

        // Sorteio do tipo de caixa por rodada: pesos do balance.yaml; seed derivada do
        // RNG_SEED (distinta da seed de abertura) para rodadas reproduzíveis em teste.
        Map<String, Integer> typeWeights = cfg.boxTypeWeights();
        Random typeRng = (seedEnv == null || seedEnv.isBlank())
                ? new Random()
                : new Random(Long.parseLong(seedEnv.trim()) ^ 0x9E3779B97F4A7C15L);

        // Publicador assíncrono: Redis Pub/Sub (broadcast) + RabbitMQ (messaging durável).
        String roomId = System.getenv().getOrDefault("ROOM_ID", "room-1");
        EventPublisher events = new EventPublisher(roomId,
                System.getenv("REDIS_URL"), System.getenv("RABBITMQ_URL"));

        BoxStore store = new BoxStore(gw, settings, opener, typeWeights, typeRng);
        // Afinidade do jogador (do "queimar") alimenta o RNG da abertura: lida da Carteira.
        store.setAffinitySource(gw::getAffinity);
        // A cada início/fim de rodada (thread do cronômetro), difunde os eventos do jogo.
        store.setRoundListener(new BoxStore.RoundListener() {
            @Override
            public void onRoundStarted(BoxStore.RoomState s) {
                events.roundStarted(s.round(), s.boxId(), s.boxType(), s.currentBid(),
                        s.leader(), s.timerMs(), s.odds(), System.currentTimeMillis() + s.timerMs());
            }

            @Override
            public void onRoundEnded(int round, String boxId, String boxType, String winner, long price) {
                if (!winner.isEmpty()) {
                    events.boxSold(boxId, boxType, winner, price);
                }
                events.roundEnded(round, boxId, winner, price);
            }
        });

        Server server = ServerBuilder.forPort(port)
                .addService(new AuctionService(store, events, gw))
                .build()
                .start();
        System.out.println("auction: ouvindo em :" + port + " (carteira em " + walletAddr + ")");
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.shutdown();
            store.shutdown();
            events.close();
            channel.shutdown();
        }));
        server.awaitTermination();
    }

    private static int parsePort(String env, int fallback) {
        if (env == null || env.isBlank()) {
            return fallback;
        }
        String s = env.startsWith(":") ? env.substring(1) : env;
        return Integer.parseInt(s.trim());
    }
}
