package br.ufg.hammerprice.auction;

import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Collections;
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
}
