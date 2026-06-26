package br.ufg.hammerprice.wallet;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Estado de saldo/reservas dos jogadores.
 *
 * <p>FATIA VERTICAL: estado em memória, com métodos {@code synchronized} (lock único)
 * serializando os acessos concorrentes e garantindo a invariante "saldo gastável
 * nunca negativo". Numa etapa posterior, o lock vira Redlock (distribuído entre
 * instâncias) e o estado vai para o PostgreSQL com ledger append-only.
 */
public final class WalletStore {

    /** Orçamento concedido a um jogador na primeira interação (do balance.yaml). */
    private final long initialBudget;

    public WalletStore(long initialBudget) {
        this.initialBudget = initialBudget;
    }

    private static final class Player {
        long balance;
        long reserved = 0;
        /** Reservas ativas por caixa, para permitir Release/Settle idempotentes. */
        final Map<String, Long> byBox = new HashMap<>();
        /** Inventário: itens obtidos ao abrir caixas. */
        final List<Item> items = new ArrayList<>();
        /** Afinidade por tipo (pontos percentuais), aumentada ao "queimar" itens. */
        final Map<String, Integer> affinity = new HashMap<>();

        Player(long balance) {
            this.balance = balance;
        }
    }

    /** Item do inventário. {@code state}: FREE | LOCKED_COLLECTION | CONSUMED. */
    public record Item(String id, String type, String state) {}

    /** Resultado de uma tentativa de reserva. */
    public record ReserveResult(boolean ok, long balance, long reserved) {}

    /** Resultado de uma venda de item. */
    public record SellResult(boolean ok, String reason, long price, String type, long balance) {}

    /** Resultado de uma queima de item (afinidade resultante). */
    public record BurnResult(boolean ok, String reason, String type, int affinity) {}

    /** Estado consultável de um jogador (saldo, reservas, inventário e afinidades). */
    public record PlayerView(long balance, long reserved, List<Item> items, Map<String, Integer> affinities) {}

    private final Map<String, Player> players = new HashMap<>();
    private final AtomicLong itemSeq = new AtomicLong();

    private Player getOrCreate(String id) {
        return players.computeIfAbsent(id, k -> new Player(initialBudget));
    }

    /**
     * Tenta reservar {@code amount} do saldo gastável do jogador para uma caixa.
     * Se já havia reserva naquela caixa, ela é substituída pelo novo valor.
     * Retorna ok=false se o saldo gastável for insuficiente. Operação atômica.
     */
    public synchronized ReserveResult reserve(String playerId, String boxId, long amount) {
        Player p = getOrCreate(playerId);
        long prev = p.byBox.getOrDefault(boxId, 0L); // reserva anterior desta caixa
        // saldo gastável considerando que a reserva anterior será devolvida
        long spendable = p.balance - (p.reserved - prev);
        if (amount > spendable) {
            return new ReserveResult(false, p.balance, p.reserved);
        }
        p.reserved = p.reserved - prev + amount;
        p.byBox.put(boxId, amount);
        return new ReserveResult(true, p.balance, p.reserved);
    }

    /**
     * Devolve ao saldo gastável a reserva que o jogador tinha numa caixa
     * (ex.: quando é superado). Idempotente.
     */
    public synchronized boolean release(String playerId, String boxId) {
        Player p = players.get(playerId);
        if (p == null) {
            return true;
        }
        Long amt = p.byBox.remove(boxId);
        if (amt != null) {
            p.reserved -= amt;
        }
        return true;
    }

    /**
     * Converte a reserva da caixa em débito definitivo: o vencedor PAGA ao arrematar.
     * Debita do saldo e zera a reserva daquela caixa. Idempotente (se não houver reserva,
     * não faz nada). Usa o valor reservado como verdade (ignora divergências do {@code amount}).
     * Retorna {@code false} se não havia reserva para a caixa.
     */
    public synchronized boolean settle(String playerId, String boxId) {
        Player p = players.get(playerId);
        if (p == null) {
            return false;
        }
        Long amt = p.byBox.remove(boxId);
        if (amt == null) {
            return false; // nada reservado nesta caixa (já liquidado/devolvido)
        }
        p.reserved -= amt;
        p.balance -= amt; // débito real: o dinheiro sai do saldo
        return true;
    }

    /**
     * Credita um item ao inventário do jogador (item sorteado ao abrir uma caixa).
     * A carteira gera o id do item. Operação atômica.
     */
    public synchronized Item addItem(String playerId, String type) {
        Player p = getOrCreate(playerId);
        Item it = new Item("itm-" + itemSeq.incrementAndGet(), type, "FREE");
        p.items.add(it);
        return it;
    }

    private static Item findItem(Player p, String itemId) {
        for (Item it : p.items) {
            if (it.id().equals(itemId)) {
                return it;
            }
        }
        return null;
    }

    /**
     * Vende um item LIVRE pelo preço de mercado do seu tipo (resolvido pelo chamador e
     * passado em {@code prices}). Remove o item e credita o valor ao saldo. Atômica.
     */
    public synchronized SellResult sellItem(String playerId, String itemId, Map<String, Long> prices) {
        Player p = players.get(playerId);
        Item it = (p == null) ? null : findItem(p, itemId);
        if (it == null) {
            return new SellResult(false, "ITEM_NOT_FOUND", 0, "", p == null ? 0 : p.balance);
        }
        if (!"FREE".equals(it.state())) {
            return new SellResult(false, "ITEM_LOCKED", 0, it.type(), p.balance);
        }
        long price = prices.getOrDefault(it.type(), 0L);
        p.items.remove(it);
        p.balance += price;
        return new SellResult(true, "OK", price, it.type(), p.balance);
    }

    /**
     * Queima um item LIVRE: destrói o item e soma {@code gain} à afinidade pelo seu tipo,
     * com teto {@code cap}. Rejeitada se a afinidade já estiver no teto. Atômica.
     */
    public synchronized BurnResult burnItem(String playerId, String itemId, int gain, int cap) {
        Player p = players.get(playerId);
        Item it = (p == null) ? null : findItem(p, itemId);
        if (it == null) {
            return new BurnResult(false, "ITEM_NOT_FOUND", "", 0);
        }
        if (!"FREE".equals(it.state())) {
            return new BurnResult(false, "ITEM_LOCKED", it.type(), p.affinity.getOrDefault(it.type(), 0));
        }
        int cur = p.affinity.getOrDefault(it.type(), 0);
        if (cur >= cap) {
            return new BurnResult(false, "AT_CAP", it.type(), cur);
        }
        int next = Math.min(cap, cur + gain);
        p.affinity.put(it.type(), next);
        p.items.remove(it);
        return new BurnResult(true, "OK", it.type(), next);
    }

    /** Retorna o estado atual do jogador (saldo, reservas, inventário e afinidades). */
    public synchronized PlayerView get(String playerId) {
        Player p = getOrCreate(playerId);
        return new PlayerView(p.balance, p.reserved, List.copyOf(p.items), Map.copyOf(p.affinity));
    }
}
