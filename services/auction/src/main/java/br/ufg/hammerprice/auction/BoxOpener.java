package br.ufg.hammerprice.auction;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;

/**
 * Sorteio do item ao abrir uma caixa (server-side, RNG com seed injetável).
 *
 * <p>A probabilidade efetiva de cada item é a odd base do tipo da caixa SOMADA à
 * afinidade do jogador (em pontos percentuais), com piso 0 e RENORMALIZAÇÃO para
 * somar 1 — incluindo o Mímico, que é "espremido" quando a afinidade sobe as demais.
 * Ver docs/03-regras-de-negocio.md §4.
 *
 * <p>Invariantes garantidas: {@code Σ P_efetiva = 1} e {@code P_efetiva(item) ≥ 0}.
 * A seed torna o sorteio reproduzível em testes.
 */
public final class BoxOpener {

    /** Fonte das odds base por tipo de caixa (item → pontos percentuais). */
    public interface Odds {
        Map<String, Integer> forType(String boxType);
    }

    private final Odds odds;
    private final Random rng;

    public BoxOpener(Odds odds, long seed) {
        this.odds = odds;
        this.rng = new Random(seed);
    }

    /** RNG não determinístico (produção, quando RNG_SEED não é definido). */
    public BoxOpener(Odds odds) {
        this.odds = odds;
        this.rng = new Random();
    }

    /**
     * Odds base (públicas) de um tipo de caixa — as probabilidades exibidas aos jogadores.
     * Sem afinidade, são iguais às efetivamente aplicadas no sorteio (ver {@link #draw}).
     */
    public Map<String, Integer> oddsFor(String boxType) {
        return odds.forType(boxType);
    }

    /**
     * Distribuição efetiva: {@code max(0, base + afinidade)} renormalizada para somar 1.
     * Mantida visível no pacote para teste das invariantes.
     */
    Map<String, Double> effectiveDistribution(String boxType, Map<String, Integer> affinity) {
        Map<String, Integer> base = odds.forType(boxType);
        Map<String, Double> eff = new LinkedHashMap<>();
        double sum = 0;
        for (Map.Entry<String, Integer> e : base.entrySet()) {
            double v = Math.max(0, e.getValue() + affinity.getOrDefault(e.getKey(), 0));
            eff.put(e.getKey(), v);
            sum += v;
        }
        for (Map.Entry<String, Double> e : eff.entrySet()) {
            e.setValue(sum > 0 ? e.getValue() / sum : 0);
        }
        return eff;
    }

    /**
     * Sorteia um item para o jogador abrindo uma caixa do tipo dado, considerando sua
     * afinidade. {@code synchronized} porque o {@link Random} com seed é compartilhado
     * (sequência reproduzível) e as aberturas podem ser concorrentes.
     */
    public synchronized String draw(String boxType, Map<String, Integer> affinity) {
        Map<String, Double> eff = effectiveDistribution(boxType, affinity);
        double r = rng.nextDouble(); // [0, 1)
        double cumulative = 0;
        String last = "";
        for (Map.Entry<String, Double> e : eff.entrySet()) {
            cumulative += e.getValue();
            last = e.getKey();
            if (r < cumulative) {
                return e.getKey();
            }
        }
        return last; // segurança contra arredondamento de ponto flutuante
    }
}
