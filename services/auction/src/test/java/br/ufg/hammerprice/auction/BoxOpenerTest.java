package br.ufg.hammerprice.auction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** Testes do sorteio de abertura: determinismo (seed), renormalização e afinidade. */
class BoxOpenerTest {

    // Odds Bronze (em pontos percentuais), iguais para qualquer tipo neste teste.
    private static final BoxOpener.Odds BRONZE =
            t -> Map.of("COPPER", 60, "SILVER", 30, "GOLD", 9, "DIAMOND", 1, "MIMIC", 0);

    @Test
    void sameSeedGivesSameSequence() {
        BoxOpener a = new BoxOpener(BRONZE, 7);
        BoxOpener b = new BoxOpener(BRONZE, 7);
        for (int i = 0; i < 100; i++) {
            assertEquals(a.draw("BRONZE", Map.of()), b.draw("BRONZE", Map.of()));
        }
    }

    @Test
    void effectiveDistributionSumsToOneAndIsNonNegative() {
        BoxOpener o = new BoxOpener(BRONZE, 1);
        Map<String, Double> eff = o.effectiveDistribution("BRONZE", Map.of("DIAMOND", 15));
        double sum = eff.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(1.0, sum, 1e-9, "Σ P_efetiva deve ser 1");
        eff.values().forEach(v -> assertTrue(v >= 0, "nenhuma probabilidade negativa"));
        assertTrue(eff.get("DIAMOND") > 0.01, "afinidade aumenta a fração de DIAMOND");
    }

    @Test
    void zeroAffinityMatchesBaseNormalized() {
        BoxOpener o = new BoxOpener(BRONZE, 1);
        Map<String, Double> eff = o.effectiveDistribution("BRONZE", Map.of());
        assertEquals(0.60, eff.get("COPPER"), 1e-9);
        assertEquals(0.01, eff.get("DIAMOND"), 1e-9);
    }

    @Test
    void affinityRaisesDrawFrequency() {
        BoxOpener noAff = new BoxOpener(BRONZE, 123);
        BoxOpener withAff = new BoxOpener(BRONZE, 123); // mesma sequência de RNG
        Map<String, Integer> aff = Map.of("DIAMOND", 15);
        int base = 0;
        int boosted = 0;
        for (int i = 0; i < 5000; i++) {
            if (noAff.draw("BRONZE", Map.of()).equals("DIAMOND")) {
                base++;
            }
            if (withAff.draw("BRONZE", aff).equals("DIAMOND")) {
                boosted++;
            }
        }
        assertTrue(boosted > base,
                "afinidade deve aumentar a frequência de DIAMOND (" + boosted + " vs " + base + ")");
    }
}
