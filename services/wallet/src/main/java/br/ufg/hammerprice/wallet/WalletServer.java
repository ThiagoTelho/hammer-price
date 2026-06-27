package br.ufg.hammerprice.wallet;

import br.ufg.hammerprice.wallet.grpc.Ack;
import br.ufg.hammerprice.wallet.grpc.AddItemRequest;
import br.ufg.hammerprice.wallet.grpc.BuyCardReply;
import br.ufg.hammerprice.wallet.grpc.Collection;
import br.ufg.hammerprice.wallet.grpc.ConsumeCardRequest;
import br.ufg.hammerprice.wallet.grpc.FormCollectionRequest;
import br.ufg.hammerprice.wallet.grpc.FormReply;
import br.ufg.hammerprice.wallet.grpc.Item;
import br.ufg.hammerprice.wallet.grpc.MimicReply;
import br.ufg.hammerprice.wallet.grpc.PlayerQuery;
import br.ufg.hammerprice.wallet.grpc.PlayerState;
import br.ufg.hammerprice.wallet.grpc.ReleaseRequest;
import br.ufg.hammerprice.wallet.grpc.ReserveReply;
import br.ufg.hammerprice.wallet.grpc.ReserveRequest;
import br.ufg.hammerprice.wallet.grpc.SellItemRequest;
import br.ufg.hammerprice.wallet.grpc.SellReply;
import br.ufg.hammerprice.wallet.grpc.SettleRequest;
import br.ufg.hammerprice.wallet.grpc.TransferReply;
import br.ufg.hammerprice.wallet.grpc.TransferRequest;
import br.ufg.hammerprice.wallet.grpc.WalletGrpc;
import io.grpc.Server;
import io.grpc.ServerBuilder;
import io.grpc.stub.StreamObserver;
import java.util.HashMap;
import java.util.Map;

/** Servidor gRPC da Carteira (fatia vertical). */
public final class WalletServer {

    static final class WalletService extends WalletGrpc.WalletImplBase {
        private static final String[] ITEM_TYPES = {"COPPER", "SILVER", "GOLD", "DIAMOND"};
        private final WalletStore store;
        private final BalanceConfig cfg;

        WalletService(WalletStore store, BalanceConfig cfg) {
            this.store = store;
            this.cfg = cfg;
        }

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
        public void settle(SettleRequest req, StreamObserver<Ack> obs) {
            boolean ok = store.settle(req.getPlayerId(), req.getBoxId());
            obs.onNext(Ack.newBuilder().setOk(ok).build());
            obs.onCompleted();
        }

        @Override
        public void addItem(AddItemRequest req, StreamObserver<Ack> obs) {
            int qty = Math.max(1, req.getQuantity()); // 0 (campo ausente) trata como 1
            for (int i = 0; i < qty; i++) {
                store.addItem(req.getPlayerId(), req.getType());
            }
            obs.onNext(Ack.newBuilder().setOk(true).build());
            obs.onCompleted();
        }

        @Override
        public void sellItem(SellItemRequest req, StreamObserver<SellReply> obs) {
            // Preço por tipo: valor base do balance.yaml, sobreposto pelo mercado do gateway.
            Map<String, Long> prices = new HashMap<>();
            for (String t : ITEM_TYPES) {
                prices.put(t, cfg.itemValue(t, 0));
            }
            prices.putAll(req.getPricesMap());
            WalletStore.SellResult r = store.sellItem(req.getPlayerId(), req.getItemId(), prices);
            obs.onNext(SellReply.newBuilder()
                    .setOk(r.ok()).setReason(r.reason()).setPrice(r.price())
                    .setType(r.type()).setBalance(r.balance()).build());
            obs.onCompleted();
        }

        @Override
        public void formCollection(FormCollectionRequest req, StreamObserver<FormReply> obs) {
            Map<String, Integer> requires = cfg.collectionRequires(req.getKind());
            long bonus = cfg.collectionBonus(req.getKind());
            WalletStore.FormResult r = store.formCollection(req.getPlayerId(), req.getKind(), requires, bonus);
            obs.onNext(FormReply.newBuilder().setOk(r.ok()).setReason(r.reason()).setBonus(r.bonus()).build());
            obs.onCompleted();
        }

        @Override
        public void resetPlayer(PlayerQuery req, StreamObserver<Ack> obs) {
            store.reset(req.getPlayerId());
            obs.onNext(Ack.newBuilder().setOk(true).build());
            obs.onCompleted();
        }

        @Override
        public void applyMimic(PlayerQuery req, StreamObserver<MimicReply> obs) {
            int pct = (int) cfg.mimicLong("steal_money_pct", 10);
            WalletStore.MimicResult r = store.applyMimic(req.getPlayerId(), pct);
            obs.onNext(MimicReply.newBuilder()
                    .setKind(r.kind()).setDetail(r.detail()).setValue(r.value()).build());
            obs.onCompleted();
        }

        @Override
        public void buyCard(PlayerQuery req, StreamObserver<BuyCardReply> obs) {
            long base = cfg.cardLong("base_price", 80);
            long step = cfg.cardLong("price_step", 40);
            int handMax = (int) cfg.cardLong("hand_max", 6);
            WalletStore.BuyCardResult r = store.buyCard(req.getPlayerId(), base, step, handMax, cfg.cardWeights());
            obs.onNext(BuyCardReply.newBuilder()
                    .setOk(r.ok()).setReason(r.reason()).setCard(r.card()).setPrice(r.price()).setBalance(r.balance()).build());
            obs.onCompleted();
        }

        @Override
        public void consumeCard(ConsumeCardRequest req, StreamObserver<Ack> obs) {
            boolean ok = store.consumeCard(req.getPlayerId(), req.getCard());
            obs.onNext(Ack.newBuilder().setOk(ok).build());
            obs.onCompleted();
        }

        @Override
        public void transfer(TransferRequest req, StreamObserver<TransferReply> obs) {
            long moved = store.transfer(req.getFromPlayer(), req.getToPlayer(), req.getAmount());
            obs.onNext(TransferReply.newBuilder().setOk(moved > 0).setMoved(moved).build());
            obs.onCompleted();
        }

        @Override
        public void getPlayer(PlayerQuery req, StreamObserver<PlayerState> obs) {
            WalletStore.PlayerView v = store.get(req.getPlayerId());
            long nextPrice = cfg.cardLong("base_price", 80) + cfg.cardLong("price_step", 40) * v.cards().size();
            PlayerState.Builder b = PlayerState.newBuilder()
                    .setPlayerId(req.getPlayerId())
                    .setBalance(v.balance())
                    .setReserved(v.reserved())
                    .setNextCardPrice(nextPrice);
            for (WalletStore.Item it : v.items()) {
                b.addInventory(Item.newBuilder()
                        .setId(it.id())
                        .setType(it.type())
                        .setState(it.state())
                        .build());
            }
            for (WalletStore.FormedCollection c : v.collections()) {
                b.addCollections(Collection.newBuilder().setKind(c.kind()).setBonus(c.bonus()).build());
            }
            for (String card : v.cards()) {
                b.addCards(card);
            }
            obs.onNext(b.build());
            obs.onCompleted();
        }
    }

    public static void main(String[] args) throws Exception {
        int port = parsePort(System.getenv("WALLET_ADDR"), 50052);
        BalanceConfig cfg = BalanceConfig.load();
        long initialBudget = cfg.matchLong("initial_budget", 1000);
        Server server = ServerBuilder.forPort(port)
                .addService(new WalletService(new WalletStore(initialBudget), cfg))
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
