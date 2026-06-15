// Gateway de tempo-real do Hammer Price (fatia vertical).
//
// - Mantém conexões WebSocket dos jogadores.
// - Traduz a ação PLACE_BID em uma chamada gRPC SÍNCRONA ao Leilão.
// - Faz fan-out dos eventos a todos os clientes (broadcast em processo).
//
// Próxima etapa: o fan-out passa a usar Redis Pub/Sub (para múltiplas
// instâncias de gateway) e entra uma fila RabbitMQ para o worker.
import { WebSocketServer, WebSocket } from "ws";
import { placeBid, getVaultState, AUCTION_GRPC } from "./grpcClients.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const ROOM = "room-1"; // sala única na fatia vertical

interface Client {
  ws: WebSocket;
  playerId: string;
}

const clients = new Set<Client>();

function broadcast(msg: unknown): void {
  const data = JSON.stringify(msg);
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

// Última visão conhecida de cada caixa, para detectar arremates (uma caixa some
// quando é arrematada e reposta por outra com novo id).
let lastBoxes = new Map<string, { leader: string; currentBid: number }>();

async function broadcastState(): Promise<void> {
  try {
    const state = await getVaultState(ROOM);
    const current = new Map(state.boxes.map((b) => [b.boxId, { leader: b.leader, currentBid: b.currentBid }]));
    // Caixa que sumiu e tinha líder => foi arrematada. (Interim: na Fase 4 isso vira
    // evento box.sold via Redis Pub/Sub, sem polling.)
    for (const [boxId, prev] of lastBoxes) {
      if (!current.has(boxId) && prev.leader) {
        broadcast({ type: "BOX_SOLD", boxId, winner: prev.leader, price: prev.currentBid });
      }
    }
    lastBoxes = current;
    broadcast({ type: "STATE", boxes: state.boxes });
  } catch (err) {
    console.error("gateway: falha ao obter estado do vault:", err);
  }
}

// Poll periódico: surfacia cronômetros e arremates (fechamento é assíncrono no leilão).
const STATE_POLL_MS = Number(process.env.STATE_POLL_MS ?? 1000);
setInterval(broadcastState, STATE_POLL_MS);

const wss = new WebSocketServer({ port: PORT });
console.log(`gateway: WebSocket ouvindo em ws://localhost:${PORT} (leilão em ${AUCTION_GRPC})`);

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const playerId = url.searchParams.get("player") || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
  const client: Client = { ws, playerId };
  clients.add(client);
  console.log(`gateway: ${playerId} conectou (${clients.size} online)`);

  // Snapshot inicial só para quem conectou.
  try {
    const state = await getVaultState(ROOM);
    ws.send(JSON.stringify({ type: "WELCOME", playerId, boxes: state.boxes }));
  } catch (err) {
    ws.send(JSON.stringify({ type: "ERROR", reason: "AUCTION_UNAVAILABLE" }));
  }

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === "PLACE_BID") {
      try {
        const reply = await placeBid(ROOM, msg.boxId, playerId, Number(msg.amount));
        // Resposta SÍNCRONA a quem deu o lance (aceito/rejeitado).
        ws.send(
          JSON.stringify({
            type: reply.accepted ? "BID_ACCEPTED" : "BID_REJECTED",
            boxId: msg.boxId,
            reason: reply.reason,
            currentBid: reply.currentBid,
            leader: reply.leader,
            timerMs: reply.timerMs,
          }),
        );
        // Evento ASSÍNCRONO difundido a todos quando o lance é aceito.
        if (reply.accepted) {
          broadcast({
            type: "BID_PLACED",
            boxId: msg.boxId,
            leader: playerId,
            amount: reply.currentBid,
            timerMs: reply.timerMs,
          });
          await broadcastState();
        }
      } catch (err) {
        console.error("gateway: erro no PLACE_BID:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "BID_FAILED" }));
      }
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    console.log(`gateway: ${playerId} saiu (${clients.size} online)`);
  });
});
