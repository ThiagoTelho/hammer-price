package br.ufg.hammerprice.wallet;

import br.ufg.hammerprice.wallet.grpc.Ack;
import br.ufg.hammerprice.wallet.grpc.PlayerQuery;
import br.ufg.hammerprice.wallet.grpc.PlayerState;
import br.ufg.hammerprice.wallet.grpc.ReleaseRequest;
import br.ufg.hammerprice.wallet.grpc.ReserveReply;
import br.ufg.hammerprice.wallet.grpc.ReserveRequest;
import br.ufg.hammerprice.wallet.grpc.WalletGrpc;
import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.stub.StreamObserver;

/** Servidor gRPC da Carteira (fatia vertical). */
public final class WalletServer {

    static final class WalletService extends WalletGrpc.WalletImplBase {
        private final WalletStore store = new WalletStore();

        @Override
        public void reserve(ReserveRequest req, StreamObserver<ReserveReply> obs) {
            WalletStore.ReserveResult r = store.reserve(req.getPlayerId(), req.getBoxId(), req.getAmount());
            obs.onNext(ReserveReply.newBuilder()
                    .setOk(r.ok())
                    .setBalance(r.balance())
                    .setReserved(r.reserved())
                    .setReason(r.ok() ? "OK" : "INSUFFICIENT_BALANCE")
                    .build());
            obs.onCompleted();
        }

        @Override
        public void release(ReleaseRequest req, StreamObserver<Ack> obs) {
            boolean ok = store.release(req.getPlayerId(), req.getBoxId());
            obs.onNext(Ack.newBuilder().setOk(ok).build());
            obs.onCompleted();
        }

        @Override
        public void getPlayer(PlayerQuery req, StreamObserver<PlayerState> obs) {
            WalletStore.PlayerView v = store.get(req.getPlayerId());
            obs.onNext(PlayerState.newBuilder()
                    .setPlayerId(req.getPlayerId())
                    .setBalance(v.balance())
                    .setReserved(v.reserved())
                    .build());
            obs.onCompleted();
        }
    }

    public static void main(String[] args) throws Exception {
        int port = parsePort(System.getenv("WALLET_ADDR"), 50052);
        Server server = ServerBuilder.forPort(port)
                .addService(new WalletService())
                .build()
                .start();
        System.out.println("wallet: ouvindo em :" + port);
        Runtime.getRuntime().addShutdownHook(new Thread(server::shutdown));
        server.awaitTermination();
    }

    /** Aceita ":50052" ou "50052"; usa o padrão se vazio. */
    private static int parsePort(String env, int fallback) {
        if (env == null || env.isBlank()) {
            return fallback;
        }
        String s = env.startsWith(":") ? env.substring(1) : env;
        return Integer.parseInt(s.trim());
    }
}
