package br.ufg.hammerprice.auction;

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
 * getter — os serviços continuam subindo.
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
                    System.out.println("auction: balance.yaml carregado de " + path);
                    return new BalanceConfig(data);
                }
            }
            System.err.println("auction: " + path + " não encontrado; usando defaults");
        } catch (Exception e) {
            System.err.println("auction: falha ao ler " + path + " (" + e.getMessage() + "); usando defaults");
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

    /** Valor inteiro de {@code round.<key>}, ou {@code def} se ausente/ inválido. */
    public long roundLong(String key, long def) {
        Object v = section("round").get(key);
        return v instanceof Number ? ((Number) v).longValue() : def;
    }

    /**
     * Pesos do sorteio do TIPO de caixa por rodada, de {@code round.box_type_weights}
     * (ex.: {@code {BRONZE=50, SILVER=30, GOLD=15, VAULT=5}}). Ordem preservada (YAML).
     * Retorna mapa vazio se ausente — o chamador deve ter um fallback.
     */
    public Map<String, Integer> boxTypeWeights() {
        Object w = section("round").get("box_type_weights");
        if (!(w instanceof Map<?, ?> m)) {
            return Collections.emptyMap();
        }
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (e.getValue() instanceof Number n) {
                out.put(String.valueOf(e.getKey()), n.intValue());
            }
        }
        return out;
    }

    /**
     * Distribuição de drop (odds, em pontos percentuais) de um tipo de caixa, lida de
     * {@code box_odds.<tipo>}. Ex.: {@code {COPPER=60, SILVER=30, GOLD=9, DIAMOND=1, MIMIC=0}}.
     * Retorna mapa vazio se ausente — o chamador deve ter um fallback.
     */
    public Map<String, Integer> boxOdds(String boxType) {
        Object byType = section("box_odds").get(boxType);
        if (!(byType instanceof Map<?, ?> m)) {
            return Collections.emptyMap();
        }
        Map<String, Integer> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> e : m.entrySet()) {
            if (e.getValue() instanceof Number n) {
                out.put(String.valueOf(e.getKey()), n.intValue());
            }
        }
        return out;
    }
}
