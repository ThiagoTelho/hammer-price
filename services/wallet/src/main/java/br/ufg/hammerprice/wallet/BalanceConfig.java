package br.ufg.hammerprice.wallet;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import org.yaml.snakeyaml.Yaml;

/**
 * Lê os parâmetros de balanceamento de {@code balance.yaml} em runtime, para ajuste
 * em playtest sem recompilar (ver docs/03-regras-de-negocio.md). O caminho vem da
 * variável de ambiente {@code BALANCE_CONFIG} (padrão {@code /config/balance.yaml},
 * montado no container). Se o arquivo não existir, cai nos defaults passados a cada
 * getter — o serviço continua subindo.
 */
public final class BalanceConfig {

    private final Map<String, Object> root;

    private BalanceConfig(Map<String, Object> root) {
        this.root = root == null ? Collections.emptyMap() : root;
    }

    public static BalanceConfig load() {
        String path = System.getenv().getOrDefault("BALANCE_CONFIG", "/config/balance.yaml");
        try {
            Path p = Path.of(path);
            if (Files.exists(p)) {
                try (InputStream in = Files.newInputStream(p)) {
                    Map<String, Object> data = new Yaml().load(in);
                    System.out.println("wallet: balance.yaml carregado de " + path);
                    return new BalanceConfig(data);
                }
            }
            System.err.println("wallet: " + path + " não encontrado; usando defaults");
        } catch (Exception e) {
            System.err.println("wallet: falha ao ler " + path + " (" + e.getMessage() + "); usando defaults");
        }
        return new BalanceConfig(Collections.emptyMap());
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> section(String name) {
        Object s = root.get(name);
        return s instanceof Map ? (Map<String, Object>) s : Collections.emptyMap();
    }

    /** Valor inteiro de {@code match.<key>}, ou {@code def} se ausente/ inválido. */
    public long matchLong(String key, long def) {
        Object v = section("match").get(key);
        return v instanceof Number ? ((Number) v).longValue() : def;
    }

    /** Valor base de um item, de {@code items.<TYPE>} (fallback para venda sem mercado). */
    public long itemValue(String type, long def) {
        Object v = section("items").get(type);
        return v instanceof Number ? ((Number) v).longValue() : def;
    }

    /** Valor inteiro de {@code affinity.<key>} (ex.: gain_per_burn_pct, cap_pct). */
    public long affinityLong(String key, long def) {
        Object v = section("affinity").get(key);
        return v instanceof Number ? ((Number) v).longValue() : def;
    }

    /** Itens exigidos por uma coleção, de {@code collections.<kind>.requires}. */
    public Map<String, Integer> collectionRequires(String kind) {
        Object c = section("collections").get(kind);
        Object req = (c instanceof Map<?, ?> m) ? m.get("requires") : null;
        if (!(req instanceof Map<?, ?> r)) {
            return Collections.emptyMap();
        }
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : r.entrySet()) {
            if (e.getValue() instanceof Number n) {
                out.put(String.valueOf(e.getKey()), n.intValue());
            }
        }
        return out;
    }

    /** Bônus de uma coleção, de {@code collections.<kind>.bonus}. */
    public long collectionBonus(String kind) {
        Object c = section("collections").get(kind);
        Object b = (c instanceof Map<?, ?> m) ? m.get("bonus") : null;
        return b instanceof Number n ? n.longValue() : 0;
    }
}
