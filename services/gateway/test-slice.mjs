// Teste manual da fatia vertical (modelo round-based): conecta clientes ao gateway e
// exercita lances na caixa da RODADA atual. Há uma única caixa por vez, então a caixa é
// descoberta dinamicamente pelo WELCOME/ROUND_STARTED em vez de ids fixos.
import { WebSocket } from "ws";

const URL = "ws://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(player) {
  return new Promise((res) => {
    const ws = new WebSocket(`${URL}?player=${player}`);
    ws.boxId = null;
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      // Captura a caixa da rodada atual (WELCOME / ROUND_STARTED / ROOM_STATE trazem `box`).
      if (m.box?.boxId) ws.boxId = m.box.boxId;
      if (["WELCOME", "BID_ACCEPTED", "BID_REJECTED", "BID_PLACED", "ROUND_STARTED"].includes(m.type)) {
        const id = m.boxId ?? m.box?.boxId ?? "";
        console.log(`[${player}] <- ${m.type} ${id} ${m.reason ?? ""} ${m.currentBid ?? m.amount ?? ""}`.trim());
      }
    });
    ws.on("open", () => res(ws));
  });
}

const bid = (ws, boxId, amount) => ws.send(JSON.stringify({ type: "PLACE_BID", boxId, amount }));

const ana = await open("ana");
const bob = await open("bob");
await sleep(400);

const box = ana.boxId; // a caixa da rodada atual (toda a sala disputa a MESMA caixa)
console.log(`\n# caixa da rodada atual: ${box}`);

console.log("\n# 1) ana dá lance 50 (válido: confirmação síncrona + broadcast assíncrono)");
bid(ana, box, 50);
await sleep(400);

console.log("\n# 2) bob supera com 100 (devolve a reserva da ana)");
bid(bob, box, 100);
await sleep(400);

console.log("\n# 3) ana tenta 102 (abaixo do incremento mínimo de 5% -> rejeita)");
bid(ana, box, 102);
await sleep(400);

console.log("\n# 4) bob tenta 5000 (acima do orçamento de 1000 -> saldo insuficiente)");
bid(bob, box, 5000);
await sleep(500);

ana.close();
bob.close();
process.exit(0);
