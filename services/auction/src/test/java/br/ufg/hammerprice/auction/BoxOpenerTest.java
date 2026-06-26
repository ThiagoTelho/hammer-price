package br.ufg.hammerprice.auction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Map;
import org.junit.jupiter.api.Test;

/** Testes do sorteio de abertura: determinismo (seed), normalização das odds e quantidade. */
class BoxOpenerTest {

    // Odds (em pontos percentuais); o lambda ignora o tipo neste teste.
    private static final BoxOpener.Odds ODDS =
            t -> Map.of("COPPER", 60, "SILVER", 30, "GOLD", 9, "DIAMOND", 1, "MIMIC", 0);

    @Test
    void sameSeedGivesSameSequence() {
        BoxOpener a = new BoxOpener(ODDS, 7);
        BoxOpener b = new BoxOpener(ODDS, 7);
        for (int i = 0; i < 100; i++) {
            assertEquals(a.draw("WOODEN"), b.draw("WOODEN"));
        }
    }

    @Test
    void distributionSumsToOneAndMatchesBaseOdds() {
        BoxOpener o = new BoxOpener(ODDS, 1);
        Map<String, Double> dist = o.distribution("WOODEN");
        double sum = dist.values().stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(1.0, sum, 1e-9, "Σ P deve ser 1");
        dist.values().forEach(v -> assertTrue(v >= 0, "nenhuma probabilidade negativa"));
        assertEquals(0.60, dist.get("COPPER"), 1e-9, "odds públicas = aplicadas");
        assertEquals(0.01, dist.get("DIAMOND"), 1e-9);
    }

    @Test
    void quantityStaysInConfiguredRange() {
        BoxOpener o = new BoxOpener(ODDS, 42);
        for (int i = 0; i < 200; i++) {
            int q = o.drawQuantity(1, 4);
            assertTrue(q >= 1 && q <= 4, "1..4 itens, veio " + q);
        }
    }
}
