// Gateway de tempo-real do Hammer Price (fatia vertical).
//
// - Mantém conexões WebSocket dos jogadores.
// - Traduz a ação PLACE_BID em uma chamada gRPC SÍNCRONA ao Leilão.
// - Faz fan-out dos eventos a todos os clientes (broadcast em processo).
//
// Próxima etapa: o fan-out passa a usar Redis Pub/Sub (para múltiplas
// instâncias de gateway) e entra uma fila RabbitMQ para o worker.
import { WebSocketServer, WebSocket } from "ws";
import { placeBid, getRoomState, openBox, AUCTION_GRPC, type Box } from "./grpcClients.js";

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

function boxView(b: Box) {
  return {
    boxId: b.boxId,
    boxType: b.boxType,
    currentBid: b.currentBid,
    leader: b.leader,
    timerMs: b.timerMs,
    odds: b.odds,
  };
}

// Última visão da rodada, para derivar início/fim de rodada via polling. (Interim: na
// Fase 4/5 isso vira eventos round.started/box.sold/round.ended via Redis Pub/Sub.)
let lastRound: { round: number; active: boolean; boxId: string; leader: string; currentBid: number; boxType: string } | null = null;

async function broadcastState(): Promise<void> {
  try {
    const s = await getRoomState(ROOM);
    const box = s.box;

    // Fim da rodada anterior: estava ativa e agora trocou de rodada ou entrou em pausa.
    if (lastRound && lastRound.active && (s.round !== lastRound.round || !s.active)) {
      if (lastRound.leader) {
        broadcast({ type: "BOX_SOLD", boxId: lastRound.boxId, boxType: lastRound.boxType, winner: lastRound.leader, price: lastRound.currentBid });
        broadcast({ type: "ROUND_ENDED", round: lastRound.round, boxId: lastRound.boxId, winner: lastRound.leader, price: lastRound.currentBid });
      } else {
        broadcast({ type: "ROUND_ENDED", round: lastRound.round, boxId: lastRound.boxId, winner: null, price: 0 });
      }
    }

    // Início de uma nova rodada (inclui a primeira observação).
    if (s.active && (!lastRound || s.round !== lastRound.round)) {
      broadcast({ type: "ROUND_STARTED", round: s.round, box: boxView(box), endsAt: s.endsAt });
    }

    lastRound = { round: s.round, active: s.active, boxId: box.boxId, leader: box.leader, currentBid: box.currentBid, boxType: box.boxType };
    broadcast({ type: "ROOM_STATE", round: s.round, active: s.active, box: s.active ? boxView(box) : null, endsAt: s.endsAt });
  } catch (err) {
    console.error("gateway: falha ao obter estado da sala:", err);
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

  // Snapshot inicial só para quem conectou: a rodada e a caixa atuais.
  try {
    const s = await getRoomState(ROOM);
    ws.send(
      JSON.stringify({
        type: "WELCOME",
        playerId,
        round: s.round,
        active: s.active,
        box: s.active ? boxView(s.box) : null,
        endsAt: s.endsAt,
      }),
    );
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

    if (msg.type === "OPEN_BOX") {
      try {
        const reply = await openBox(ROOM, msg.boxId, playerId);
        // Resposta SÍNCRONA ao vencedor (resultado do sorteio).
        ws.send(
          JSON.stringify({
            type: "OPEN_RESULT",
            boxId: msg.boxId,
            ok: reply.ok,
            reason: reply.reason,
            item: reply.item,
            isMimic: reply.isMimic,
          }),
        );
        // Evento ASSÍNCRONO difundido a todos quando a abertura dá certo.
        if (reply.ok) {
          broadcast({
            type: "BOX_OPENED",
            boxId: msg.boxId,
            player: playerId,
            item: reply.item,
            isMimic: reply.isMimic,
          });
        }
      } catch (err) {
        console.error("gateway: erro no OPEN_BOX:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "OPEN_FAILED" }));
      }
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    console.log(`gateway: ${playerId} saiu (${clients.size} online)`);
  });
});
