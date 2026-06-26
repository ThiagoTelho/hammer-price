// Gateway de tempo-real do Hammer Price.
//
// - Mantém as conexões WebSocket dos jogadores, cada uma associada a uma SALA.
// - PARTICIONAMENTO POR SALA: cada sala é dona de uma instância de Leilão. O gateway
//   roteia as ações (gRPC SÍNCRONO) e o fan-out de eventos para a instância dona da sala.
// - Fan-out ASSÍNCRONO: assina o canal Redis Pub/Sub de cada sala e difunde os eventos
//   apenas aos clientes daquela sala. O gateway é stateless e replicável.
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { placeBid, getRoomState, openBox, getPlayer, type Box } from "./grpcClients.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_REPLICA_URL = process.env.REDIS_REPLICA_URL ?? REDIS_URL;

// Mapa sala -> endereço da instância de Leilão dona da sala (a partição).
// Ex.: ROOM_ROUTES="room-1=auction-vault1:50051,room-2=auction-vault2:50051"
function parseRoutes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split(",")) {
    const [room, addr] = pair.split("=");
    if (room && addr) out[room.trim()] = addr.trim();
  }
  return out;
}
const ROUTES = parseRoutes(process.env.ROOM_ROUTES ?? "room-1=localhost:50051");
const ROOMS = Object.keys(ROUTES);
const DEFAULT_ROOM = ROOMS[0];
// Carteira por sala (mesma partição do Leilão): a wallet shard de onde se lê o estado do jogador.
const WALLET_ROUTES = parseRoutes(process.env.WALLET_ROUTES ?? "room-1=localhost:50052");

interface Client {
  ws: WebSocket;
  playerId: string;
  room: string;
}

const clients = new Set<Client>();

function broadcastToRoom(room: string, msg: unknown): void {
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const c of clients) {
    if (c.room === room && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
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

// Envia ao jogador (PRIVADO) o seu estado de carteira: saldo, reservas e inventário,
// lido da sua wallet shard (a sala determina o shard).
async function sendWallet(c: Client): Promise<void> {
  const waddr = WALLET_ROUTES[c.room];
  if (!waddr) return;
  try {
    const p = await getPlayer(waddr, c.playerId);
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(
        JSON.stringify({ type: "WALLET_UPDATED", balance: p.balance, reserved: p.reserved, inventory: p.inventory }),
      );
    }
  } catch {
    /* wallet shard indisponível → segue sem atualização */
  }
}

// Fan-out assíncrono por sala: assina o canal de eventos de CADA sala e repassa cada
// evento apenas aos clientes daquela sala (o canal `room:{id}:events` identifica a sala).
const sub = new Redis(REDIS_URL);
sub.on("error", (e) => console.error("gateway: erro no Redis:", e.message));
for (const room of ROOMS) {
  sub.subscribe(`room:${room}:events`).catch((e) => console.error(`gateway: falha ao assinar ${room}:`, e.message));
}
// Eventos que mexem em dinheiro/itens → atualizam o HUD de carteira de quem está na sala.
const MONEY_EVENTS = new Set(["BID_PLACED", "BOX_SOLD", "BOX_OPENED"]);
sub.on("message", (channel, message) => {
  const m = /^room:(.+):events$/.exec(channel);
  if (!m) return;
  const room = m[1];
  broadcastToRoom(room, message);
  try {
    const ev = JSON.parse(message);
    if (MONEY_EVENTS.has(ev.type)) {
      for (const c of clients) if (c.room === room) void sendWallet(c);
    }
  } catch {
    /* mensagem não-JSON → ignora */
  }
});
console.log(`gateway: salas particionadas → ${JSON.stringify(ROUTES)}`);

// Leituras do snapshot de mercado vão à RÉPLICA do Redis (replicação do estado quente):
// o worker escreve no primário, a réplica espelha, e o gateway lê daqui no WELCOME.
const replica = new Redis(REDIS_REPLICA_URL);
replica.on("error", (e) => console.error("gateway: erro na réplica Redis:", e.message));

const wss = new WebSocketServer({ port: PORT });
console.log(`gateway: WebSocket ouvindo em ws://localhost:${PORT}`);

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const playerId = url.searchParams.get("player") || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
  const reqRoom = url.searchParams.get("room") ?? DEFAULT_ROOM;
  const room = ROUTES[reqRoom] ? reqRoom : DEFAULT_ROOM; // sala válida ou a padrão
  const addr = ROUTES[room]; // instância de Leilão dona desta sala
  const client: Client = { ws, playerId, room };
  clients.add(client);
  console.log(`gateway: ${playerId} conectou na ${room} (${clients.size} online)`);

  // Snapshot inicial só para quem conectou: a rodada e a caixa atuais da SUA sala.
  try {
    const s = await getRoomState(addr, room);
    // Snapshot de mercado lido da RÉPLICA (não do primário) — leitura eventual.
    let market: Record<string, number> | null = null;
    try {
      const raw = await replica.get("market:prices");
      if (raw) market = JSON.parse(raw);
    } catch {
      /* réplica indisponível → segue sem snapshot de mercado */
    }
    ws.send(
      JSON.stringify({
        type: "WELCOME",
        playerId,
        room,
        round: s.round,
        active: s.active,
        box: s.active ? boxView(s.box) : null,
        endsAt: s.endsAt,
        market,
      }),
    );
    void sendWallet(client); // HUD inicial: saldo, reservas e inventário
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
        // SÍNCRONO, roteado para a instância dona da sala. O BID_PLACED chega a todos
        // os clientes da sala de forma ASSÍNCRONA via Redis Pub/Sub.
        const reply = await placeBid(addr, room, msg.boxId, playerId, Number(msg.amount));
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
        if (reply.accepted) void sendWallet(client); // a reserva do jogador mudou
      } catch (err) {
        console.error("gateway: erro no PLACE_BID:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "BID_FAILED" }));
      }
    }

    if (msg.type === "OPEN_BOX") {
      try {
        const reply = await openBox(addr, room, msg.boxId, playerId);
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
        if (reply.ok) void sendWallet(client); // item creditado ao inventário
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
