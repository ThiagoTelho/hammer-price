package br.ufg.hammerprice.auction;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;

/**
 * Sorteio do item ao abrir uma caixa (server-side, RNG com seed injetável).
 *
 * <p>O item é sorteado pelas **odds públicas** do tipo da caixa (as mesmas exibidas aos
 * jogadores), normalizadas para somar 1. Ver docs/03-regras-de-negocio.md §4.
 *
 * <p>Invariantes garantidas: {@code Σ P = 1} e {@code P(item) ≥ 0}. A seed torna o sorteio
 * reproduzível em testes.
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

    /** Odds base (públicas) de um tipo de caixa — as probabilidades exibidas aos jogadores. */
    public Map<String, Integer> oddsFor(String boxType) {
        return odds.forType(boxType);
    }

    /**
     * Distribuição normalizada (soma 1) a partir das odds base do tipo.
     * Mantida visível no pacote para teste das invariantes.
     */
    Map<String, Double> distribution(String boxType) {
        Map<String, Integer> base = odds.forType(boxType);
        Map<String, Double> dist = new LinkedHashMap<>();
        double sum = 0;
        for (Map.Entry<String, Integer> e : base.entrySet()) {
            double v = Math.max(0, e.getValue());
            dist.put(e.getKey(), v);
            sum += v;
        }
        for (Map.Entry<String, Double> e : dist.entrySet()) {
            e.setValue(sum > 0 ? e.getValue() / sum : 0);
        }
        return dist;
    }

    /**
     * Sorteia um item ao abrir uma caixa do tipo dado, pelas odds públicas. {@code synchronized}
     * porque o {@link Random} com seed é compartilhado (sequência reproduzível) e as aberturas
     * podem ser concorrentes.
     */
    public synchronized String draw(String boxType) {
        Map<String, Double> dist = distribution(boxType);
        double r = rng.nextDouble(); // [0, 1)
        double cumulative = 0;
        String last = "";
        for (Map.Entry<String, Double> e : dist.entrySet()) {
            cumulative += e.getValue();
            last = e.getKey();
            if (r < cumulative) {
                return e.getKey();
            }
        }
        return last; // segurança contra arredondamento de ponto flutuante
    }

    /**
     * Sorteia QUANTOS itens do tipo sortido o baú rende: inteiro uniforme em [min, max]
     * (camada extra de sorte). Usa o mesmo RNG com seed — reproduzível em testes.
     */
    public synchronized int drawQuantity(int min, int max) {
        int lo = Math.max(1, min);
        int hi = Math.max(lo, max);
        return (hi == lo) ? lo : lo + rng.nextInt(hi - lo + 1);
    }
}
