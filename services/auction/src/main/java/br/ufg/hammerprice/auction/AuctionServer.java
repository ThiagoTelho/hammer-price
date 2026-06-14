package br.ufg.hammerprice.auction;

import br.ufg.hammerprice.auction.grpc.AuctionGrpc;
import br.ufg.hammerprice.auction.grpc.Box;
import br.ufg.hammerprice.auction.grpc.PlaceBidReply;
import br.ufg.hammerprice.auction.grpc.PlaceBidRequest;
import br.ufg.hammerprice.auction.grpc.VaultQuery;
import br.ufg.hammerprice.auction.grpc.VaultState;
import br.ufg.hammerprice.wallet.grpc.ReleaseRequest;
import br.ufg.hammerprice.wallet.grpc.ReserveRequest;
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
    }

    public static void main(String[] args) throws Exception {
        int port = parsePort(System.getenv("AUCTION_ADDR"), 50051);
        String walletAddr = System.getenv().getOrDefault("WALLET_GRPC", "localhost:50052");

        ManagedChannel channel = ManagedChannelBuilder.forTarget(walletAddr)
                .usePlaintext()
                .build();
        BoxStore.Wallet gw = new WalletGateway(WalletGrpc.newBlockingStub(channel));

        Server server = ServerBuilder.forPort(port)
                .addService(new AuctionService(new BoxStore(gw)))
                .build()
                .start();
        System.out.println("auction: ouvindo em :" + port + " (carteira em " + walletAddr + ")");
        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            server.shutdown();
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
