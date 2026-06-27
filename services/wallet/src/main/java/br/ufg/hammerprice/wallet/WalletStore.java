package br.ufg.hammerprice.wallet;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
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
        /** Coleções formadas (itens travados + bônus). */
        final List<FormedCollection> collections = new ArrayList<>();
        /** Mão de cartas de habilidade (tipos). */
        final List<String> cards = new ArrayList<>();

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

    /** Coleção formada por um jogador. */
    public record FormedCollection(String kind, long bonus) {}

    /** Resultado de uma tentativa de formar coleção. */
    public record FormResult(boolean ok, String reason, long bonus) {}

    /** Resultado da penalidade do Mímico. {@code kind}: MONEY | ITEM | COLLECTION | NONE. */
    public record MimicResult(String kind, String detail, long value) {}

    /** Resultado da compra de uma carta. {@code reason}: OK | INSUFFICIENT | HAND_FULL | NO_CARDS. */
    public record BuyCardResult(boolean ok, String reason, String card, long price, long balance) {}

    /** Estado consultável de um jogador (saldo, reservas, inventário, coleções e cartas). */
    public record PlayerView(long balance, long reserved, List<Item> items,
                             List<FormedCollection> collections, List<String> cards) {}

    private final Map<String, Player> players = new HashMap<>();
    private final AtomicLong itemSeq = new AtomicLong();
    private final Random rng = new Random(); // sorteio da penalidade do Mímico

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
     * A carta Desconto abate {@code discountPct}% do débito (libera a reserva, debita menos).
     * Idempotente; retorna {@code false} se não havia reserva para a caixa.
     */
    public synchronized boolean settle(String playerId, String boxId, int discountPct) {
        Player p = players.get(playerId);
        if (p == null) {
            return false;
        }
        Long amt = p.byBox.remove(boxId);
        if (amt == null) {
            return false; // nada reservado nesta caixa (já liquidado/devolvido)
        }
        p.reserved -= amt;
        int pct = Math.max(0, Math.min(100, discountPct));
        p.balance -= amt - (amt * pct / 100); // débito real, com Desconto se houver
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

    private static int countFree(Player p, String type) {
        int n = 0;
        for (Item it : p.items) {
            if (it.type().equals(type) && "FREE".equals(it.state())) {
                n++;
            }
        }
        return n;
    }

    /**
     * Forma uma coleção: se o jogador tem os itens LIVRES exigidos, trava-os
     * ({@code FREE -> LOCKED_COLLECTION}) e registra a coleção com seu bônus. Atômica.
     * Itens excedentes continuam livres (podem formar outra coleção do mesmo tipo).
     */
    public synchronized FormResult formCollection(String playerId, String kind,
                                                  Map<String, Integer> requires, long bonus) {
        if (requires.isEmpty()) {
            return new FormResult(false, "UNKNOWN_KIND", 0);
        }
        Player p = getOrCreate(playerId);
        for (Map.Entry<String, Integer> e : requires.entrySet()) {
            if (countFree(p, e.getKey()) < e.getValue()) {
                return new FormResult(false, "NOT_ENOUGH", 0);
            }
        }
        for (Map.Entry<String, Integer> e : requires.entrySet()) {
            int toLock = e.getValue();
            for (int i = 0; i < p.items.size() && toLock > 0; i++) {
                Item it = p.items.get(i);
                if (it.type().equals(e.getKey()) && "FREE".equals(it.state())) {
                    p.items.set(i, new Item(it.id(), it.type(), "LOCKED_COLLECTION"));
                    toLock--;
                }
            }
        }
        p.collections.add(new FormedCollection(kind, bonus));
        return new FormResult(true, "OK", bonus);
    }

    /**
     * Aplica a penalidade do Mímico (abertura de 💀): sorteia UMA entre roubar uma fração
     * do dinheiro, roubar um item LIVRE ou anular o bônus de uma coleção formada — escolhendo
     * apenas entre as opções possíveis (dinheiro é sempre possível). Atômica.
     */
    public synchronized MimicResult applyMimic(String playerId, int moneyPct) {
        Player p = getOrCreate(playerId);
        List<String> options = new ArrayList<>();
        options.add("MONEY"); // sempre possível
        List<Item> free = new ArrayList<>();
        for (Item it : p.items) {
            if ("FREE".equals(it.state())) {
                free.add(it);
            }
        }
        if (!free.isEmpty()) {
            options.add("ITEM");
        }
        if (!p.collections.isEmpty()) {
            options.add("COLLECTION");
        }
        String kind = options.get(rng.nextInt(options.size()));
        switch (kind) {
            case "ITEM": {
                Item victim = free.get(rng.nextInt(free.size()));
                p.items.remove(victim);
                return new MimicResult("ITEM", "1 " + victim.type(), 0);
            }
            case "COLLECTION": {
                FormedCollection c = p.collections.remove(rng.nextInt(p.collections.size()));
                return new MimicResult("COLLECTION", "coleção " + c.kind() + " (-" + c.bonus() + ")", c.bonus());
            }
            default: { // MONEY
                long stolen = Math.max(0, p.balance) * moneyPct / 100;
                p.balance -= stolen;
                return new MimicResult("MONEY", stolen + " de dinheiro", stolen);
            }
        }
    }

    /**
     * Compra uma carta aleatória (sorteada pelos {@code weights}). Preço CRESCENTE:
     * {@code basePrice + step × cartas_já_compradas}. Debita e adiciona à mão. Atômica.
     */
    public synchronized BuyCardResult buyCard(String playerId, long basePrice, long step,
                                              int handMax, Map<String, Integer> weights) {
        Player p = getOrCreate(playerId);
        // Preço CRESCENTE pelo tamanho da mão: comprar sobe; usar (consumir) faz cair de volta.
        long price = basePrice + step * p.cards.size();
        if (p.cards.size() >= handMax) {
            return new BuyCardResult(false, "HAND_FULL", "", price, p.balance);
        }
        if (p.balance < price) {
            return new BuyCardResult(false, "INSUFFICIENT", "", price, p.balance);
        }
        String card = drawCard(weights);
        if (card.isEmpty()) {
            return new BuyCardResult(false, "NO_CARDS", "", price, p.balance);
        }
        p.balance -= price;
        p.cards.add(card);
        return new BuyCardResult(true, "OK", card, price, p.balance);
    }

    /** Sorteio ponderado de um tipo de carta (cumulativo). */
    private String drawCard(Map<String, Integer> weights) {
        int total = 0;
        for (int w : weights.values()) {
            total += Math.max(0, w);
        }
        if (total <= 0) {
            return "";
        }
        int r = rng.nextInt(total);
        int acc = 0;
        for (Map.Entry<String, Integer> e : weights.entrySet()) {
            acc += Math.max(0, e.getValue());
            if (r < acc) {
                return e.getKey();
            }
        }
        return weights.keySet().iterator().next();
    }

    /** Remove UMA carta do tipo da mão do jogador (ao jogar). Retorna false se não tiver. */
    public synchronized boolean consumeCard(String playerId, String card) {
        Player p = players.get(playerId);
        return p != null && p.cards.remove(card);
    }

    /** Move até {@code amount} de {@code from} para {@code to} (sem deixar negativo). Retorna o movido. */
    public synchronized long transfer(String from, String to, long amount) {
        if (amount <= 0 || from.equals(to)) {
            return 0;
        }
        Player f = getOrCreate(from);
        long move = Math.min(amount, Math.max(0, f.balance));
        if (move <= 0) {
            return 0;
        }
        f.balance -= move;
        getOrCreate(to).balance += move;
        return move;
    }

    /** Zera o jogador para uma nova partida: orçamento inicial, sem itens/coleções/cartas. */
    public synchronized void reset(String playerId) {
        players.put(playerId, new Player(initialBudget));
    }

    /** Retorna o estado atual do jogador (saldo, reservas, inventário e coleções). */
    public synchronized PlayerView get(String playerId) {
        Player p = getOrCreate(playerId);
        return new PlayerView(p.balance, p.reserved, List.copyOf(p.items), List.copyOf(p.collections),
                List.copyOf(p.cards));
    }
}
