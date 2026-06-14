package br.ufg.hammerprice.wallet;

import java.util.HashMap;
import java.util.Map;

/**
 * Estado de saldo/reservas dos jogadores.
 *
 * <p>FATIA VERTICAL: estado em memória, com métodos {@code synchronized} (lock único)
 * serializando os acessos concorrentes e garantindo a invariante "saldo gastável
 * nunca negativo". Numa etapa posterior, o lock vira Redlock (distribuído entre
 * instâncias) e o estado vai para o PostgreSQL com ledger append-only.
 */
public final class WalletStore {

    /** Orçamento concedido a um jogador na primeira interação. */
    public static final long INITIAL_BUDGET = 1000;

    private static final class Player {
        long balance = INITIAL_BUDGET;
        long reserved = 0;
        /** Reservas ativas por caixa, para permitir Release idempotente. */
        final Map<String, Long> byBox = new HashMap<>();
    }

    /** Resultado de uma tentativa de reserva. */
    public record ReserveResult(boolean ok, long balance, long reserved) {}

    /** Estado consultável de um jogador. */
    public record PlayerView(long balance, long reserved) {}

    private final Map<String, Player> players = new HashMap<>();

    private Player getOrCreate(String id) {
        return players.computeIfAbsent(id, k -> new Player());
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

    /** Retorna o estado atual do jogador (criando-o se necessário). */
    public synchronized PlayerView get(String playerId) {
        Player p = getOrCreate(playerId);
        return new PlayerView(p.balance, p.reserved);
    }
}
