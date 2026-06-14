// Teste manual da fatia vertical: conecta clientes ao gateway e exercita lances.
import { WebSocket } from "ws";

const URL = "ws://localhost:8080";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function open(player) {
  return new Promise((res) => {
    const ws = new WebSocket(`${URL}?player=${player}`);
    ws.on("message", (d) => {
      const m = JSON.parse(d.toString());
      if (["WELCOME", "BID_ACCEPTED", "BID_REJECTED", "BID_PLACED"].includes(m.type)) {
        console.log(`[${player}] <- ${m.type} ${m.boxId ?? ""} ${m.reason ?? ""} ${m.currentBid ?? m.amount ?? ""}`.trim());
      }
    });
    ws.on("open", () => res(ws));
  });
}

const bid = (ws, boxId, amount) => ws.send(JSON.stringify({ type: "PLACE_BID", boxId, amount }));

const ana = await open("ana");
const bob = await open("bob");
await sleep(300);

console.log("\n# 1) ana dá lance 50 em box-1 (válido)");
bid(ana, "box-1", 50);
await sleep(400);

console.log("\n# 2) bob supera com 100 em box-1 (devolve reserva da ana)");
bid(bob, "box-1", 100);
await sleep(400);

console.log("\n# 3) ana tenta 30 em box-1 (muito baixo, abaixo do atual)");
bid(ana, "box-1", 30);
await sleep(400);

console.log("\n# 4) bob tenta 5000 em box-2 (acima do orçamento de 1000 -> rejeita)");
bid(bob, "box-2", 5000);
await sleep(400);

console.log("\n# 5) ana dá 200 em box-3 e 800 em box-4 (soma 1000, ok)");
bid(ana, "box-3", 200);
await sleep(300);
bid(ana, "box-4", 800);
await sleep(300);

console.log("\n# 6) ana tenta mais 100 em box-2 (saldo gastável esgotado -> rejeita)");
bid(ana, "box-2", 100);
await sleep(500);

ana.close();
bob.close();
process.exit(0);
