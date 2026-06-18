package br.ufg.hammerprice.auction;

import br.ufg.hammerprice.auction.grpc.AuctionGrpc;
import br.ufg.hammerprice.auction.grpc.Box;
import br.ufg.hammerprice.auction.grpc.OpenBoxReply;
import br.ufg.hammerprice.auction.grpc.OpenBoxRequest;
import br.ufg.hammerprice.auction.grpc.PlaceBidReply;
import br.ufg.hammerprice.auction.grpc.PlaceBidRequest;
import br.ufg.hammerprice.auction.grpc.VaultQuery;
import br.ufg.hammerprice.auction.grpc.VaultState;
import java.util.Map;
import br.ufg.hammerprice.wallet.grpc.ReleaseRequest;
import br.ufg.hammerprice.wallet.grpc.ReserveRequest;
import br.ufg.hammerprice.wallet.grpc.SettleRequest;
import br.ufg.hammerprice.wallet.grpc.WalletGrpc;
import io.grpc.ManagedChannel;
import io.grpc.ManagedChannelBuilder;
import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.stub.StreamObserver;
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
    }

    static final class AuctionService extends AuctionGrpc.AuctionImplBase {
        private final BoxStore store;

        AuctionService(BoxStore store) {
            this.store = store;
        }

        @Override
        public void placeBid(PlaceBidRequest req, StreamObserver<PlaceBidReply> obs) {
            BoxStore.BidResult r = store.placeBid(req.getBoxId(), req.getPlayerId(), req.getAmount());
            obs.onNext(PlaceBidReply.newBuilder()
                    .setAccepted(r.accepted())
                    .setReason(r.reason())
                    .setCurrentBid(r.currentBid())
                    .setLeader(r.leader())
                    .setTimerMs(r.timerMs())
                    .build());
            obs.onCompleted();
        }

        @Override
        public void getVaultState(VaultQuery req, StreamObserver<VaultState> obs) {
            VaultState.Builder vs = VaultState.newBuilder();
            for (BoxStore.Snapshot s : store.snapshot()) {
                vs.addBoxes(Box.newBuilder()
                        .setBoxId(s.boxId())
                        .setBoxType(s.boxType())
                        .setCurrentBid(s.currentBid())
                        .setLeader(s.leader())
                        .setTimerMs(s.timerMs())
                        .build());
            }
            obs.onNext(vs.build());
            obs.onCompleted();
        }

        @Override
        public void openBox(OpenBoxRequest req, StreamObserver<OpenBoxReply> obs) {
            BoxStore.OpenResult r = store.openBox(req.getBoxId(), req.getPlayerId());
            obs.onNext(OpenBoxReply.newBuilder()
                    .setOk(r.ok())
                    .setReason(r.reason())
                    .setItem(r.item())
                    .setIsMimic(r.isMimic())
                    .build());
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
        BoxStore.Wallet gw = new WalletGateway(WalletGrpc.newBlockingStub(channel));

        BalanceConfig cfg = BalanceConfig.load();
        BoxStore.Settings settings = new BoxStore.Settings(
                cfg.matchLong("box_timer_seconds", 20) * 1000,
                cfg.matchLong("antisnipe_window_seconds", 5) * 1000,
                cfg.matchLong("antisnipe_reset_seconds", 8) * 1000,
                cfg.matchLong("min_bid_increment_pct", 5),
                cfg.matchLong("min_bid_increment_abs", 5));

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

        BoxStore store = new BoxStore(gw, settings, opener);
        store.setCloseListener((boxId, winner, price) ->
                System.out.println("auction: caixa " + boxId + " arrematada por " + winner + " (" + price + ")"));

        Server server = ServerBuilder.forPort(port)
                .addService(new AuctionService(store))
                .build()
                .start();
        System.out.println("auction: ouvindo em :" + port + " (carteira em " + walletAddr + ")");
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.shutdown();
            store.shutdown();
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
