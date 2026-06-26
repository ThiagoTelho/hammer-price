// Gateway de tempo-real do Hammer Price.
//
// - Mantém as conexões WebSocket dos jogadores.
// - Traduz ações (PLACE_BID, OPEN_BOX) em chamadas gRPC SÍNCRONAS ao Leilão — a
//   confirmação (aceito/rejeitado, item sorteado) volta bloqueante a quem pediu.
// - Faz fan-out ASSÍNCRONO: assina o canal Redis Pub/Sub do Leilão e difunde os
//   eventos do jogo a todos os clientes (substitui o polling em processo). Assim o
//   gateway é stateless e replicável (várias instâncias assinam o mesmo canal).
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { placeBid, getRoomState, openBox, AUCTION_GRPC, type Box } from "./grpcClients.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const ROOM = process.env.ROOM_ID ?? "room-1";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const EVENTS_CHANNEL = `room:${ROOM}:events`;

interface Client {
  ws: WebSocket;
  playerId: string;
}

const clients = new Set<Client>();

function broadcast(msg: unknown): void {
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
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

// Fan-out assíncrono (pub-sub): assina o canal de eventos do Leilão (e do worker, que
// publica MARKET_UPDATED no mesmo canal) e repassa cada evento — já no formato das
// mensagens WS — a todos os clientes conectados.
const sub = new Redis(REDIS_URL);
sub.on("connect", () => console.log(`gateway: assinando ${EVENTS_CHANNEL} em ${REDIS_URL}`));
sub.on("error", (e) => console.error("gateway: erro no Redis:", e.message));
sub.subscribe(EVENTS_CHANNEL).catch((e) => console.error("gateway: falha ao assinar:", e.message));
sub.on("message", (_channel, message) => {
  // O payload já é uma mensagem WS pronta ({ type, ... }); repassa verbatim.
  broadcast(message);
});

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
        // SÍNCRONO: confirmação só para quem deu o lance. O evento BID_PLACED chega a
        // todos de forma ASSÍNCRONA via Redis Pub/Sub (publicado pelo Leilão).
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
      } catch (err) {
        console.error("gateway: erro no PLACE_BID:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "BID_FAILED" }));
      }
    }

    if (msg.type === "OPEN_BOX") {
      try {
        const reply = await openBox(ROOM, msg.boxId, playerId);
        // SÍNCRONO ao vencedor (resultado do sorteio); o BOX_OPENED chega a todos via Redis.
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
