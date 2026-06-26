// Gateway de tempo-real do Hammer Price.
//
// - Mantém as conexões WebSocket dos jogadores.
// - CICLO DE PARTIDA (gerido aqui, em memória) sobre os SLOTS de sala particionados:
//   criar sala (vira host + código) → entrar por código → lobby → host inicia (≥2) →
//   partida com tempo fixo → fim → patrimônio + ranking. Cada slot (room-1, room-2) é uma
//   instância de Leilão própria (partição R6) → até 2 partidas simultâneas.
// - PARTICIONAMENTO: ações (gRPC síncrono) e fan-out de eventos vão à instância da sala.
// - Fan-out ASSÍNCRONO: assina o canal Redis Pub/Sub de cada sala (só durante a partida).
import { WebSocketServer, WebSocket } from "ws";
import Redis from "ioredis";
import { placeBid, getRoomState, openBox, getPlayer, sellItem, burnItem, formCollection, advanceRound, type Box } from "./grpcClients.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_REPLICA_URL = process.env.REDIS_REPLICA_URL ?? REDIS_URL;
// Teto do intervalo entre rodadas (o gateway abre antes se todos marcarem "pronto").
const INTERMISSION_MS = Number(process.env.INTERMISSION_MAX_SECONDS ?? 120) * 1000;

// Mapa slot de sala -> endereço da instância de Leilão dona da sala (a partição R6).
function parseRoutes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of s.split(",")) {
    const [room, addr] = pair.split("=");
    if (room && addr) out[room.trim()] = addr.trim();
  }
  return out;
}
const ROUTES = parseRoutes(process.env.ROOM_ROUTES ?? "room-1=localhost:50051");
const WALLET_ROUTES = parseRoutes(process.env.WALLET_ROUTES ?? "room-1=localhost:50052");
const ROOMS = Object.keys(ROUTES);

interface Client {
  ws: WebSocket;
  playerId: string;
  room: string | null; // slot da sala, definido ao criar/entrar
}
const clients = new Set<Client>();

// Estado de partida por slot de sala (em memória — gateway único nesta etapa).
interface Match {
  status: "WAITING" | "RUNNING" | "ENDED";
  code: string;
  host: string;
  totalRounds: number;
  roundsPlayed: number;
  ready: Set<string>;
  intermissionEndsAt: number;
}
const matches: Record<string, Match | null> = {};
for (const r of ROOMS) matches[r] = null;
const codeToRoom = new Map<string, string>();

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string {
  let code = "";
  do {
    code = Array.from({ length: 5 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
  } while (codeToRoom.has(code));
  return code;
}

function playersIn(room: string): string[] {
  return [...clients].filter((c) => c.room === room).map((c) => c.playerId);
}

// Slot livre = sem partida, ou partida ENCERRADA e sem jogadores conectados.
function freeSlot(): string | null {
  for (const r of ROOMS) {
    const m = matches[r];
    if (!m || (m.status === "ENDED" && playersIn(r).length === 0)) return r;
  }
  return null;
}

function broadcastToRoom(room: string, msg: unknown): void {
  const data = typeof msg === "string" ? msg : JSON.stringify(msg);
  for (const c of clients) {
    if (c.room === room && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

function roomStateMsg(room: string) {
  const m = matches[room];
  return {
    type: "ROOM_STATE",
    room,
    code: m?.code ?? "",
    status: m?.status ?? "WAITING",
    host: m?.host ?? "",
    players: playersIn(room),
    totalRounds: m?.totalRounds ?? 0,
  };
}

function inRunningMatch(c: Client): boolean {
  return !!c.room && matches[c.room]?.status === "RUNNING";
}

function boxView(b: Box) {
  return { boxId: b.boxId, boxType: b.boxType, currentBid: b.currentBid, leader: b.leader, timerMs: b.timerMs, odds: b.odds };
}

async function sendWallet(c: Client): Promise<void> {
  if (!c.room) return;
  const waddr = WALLET_ROUTES[c.room];
  if (!waddr) return;
  try {
    const p = await getPlayer(waddr, c.playerId);
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(
        JSON.stringify({
          type: "WALLET_UPDATED",
          balance: p.balance,
          reserved: p.reserved,
          inventory: p.inventory,
          affinities: p.affinities,
          collections: p.collections,
        }),
      );
    }
  } catch {
    /* wallet shard indisponível */
  }
}

async function currentMarket(): Promise<Record<string, number>> {
  try {
    const raw = await replica.get("market:prices");
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

// Estado de jogo (rodada/caixa/mercado) para uma conexão — enviado ao iniciar a partida.
async function sendGameState(c: Client): Promise<void> {
  if (!c.room) return;
  const addr = ROUTES[c.room];
  try {
    const s = await getRoomState(addr, c.room);
    let market: Record<string, number> | null = null;
    try {
      const raw = await replica.get("market:prices");
      if (raw) market = JSON.parse(raw);
    } catch {
      /* sem snapshot */
    }
    if (c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(
        JSON.stringify({
          type: "WELCOME",
          playerId: c.playerId,
          room: c.room,
          round: s.round,
          active: s.active,
          box: s.active ? boxView(s.box) : null,
          endsAt: s.endsAt,
          market,
        }),
      );
    }
    void sendWallet(c);
  } catch {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "ERROR", reason: "AUCTION_UNAVAILABLE" }));
  }
}

// Fim da partida: patrimônio = dinheiro + itens LIVRES a preço de mercado + bônus de
// coleções (doc 03 §8). Ordena e difunde o ranking.
async function endMatch(room: string): Promise<void> {
  const m = matches[room];
  if (!m || m.status !== "RUNNING") return;
  m.status = "ENDED";
  if (codeToRoom.get(m.code) === room) codeToRoom.delete(m.code);
  const prices = await currentMarket();
  const ranking: { playerId: string; money: number; items: number; bonus: number; net: number }[] = [];
  for (const playerId of playersIn(room)) {
    try {
      const p = await getPlayer(WALLET_ROUTES[room], playerId);
      const items = p.inventory.filter((i) => i.state === "FREE").reduce((s, i) => s + (prices[i.type] ?? 0), 0);
      const bonus = p.collections.reduce((s, c) => s + c.bonus, 0);
      ranking.push({ playerId, money: p.balance, items, bonus, net: p.balance + items + bonus });
    } catch {
      /* jogador indisponível */
    }
  }
  ranking.sort((a, b) => b.net - a.net);
  broadcastToRoom(room, { type: "MATCH_ENDED", ranking });
  broadcastToRoom(room, roomStateMsg(room));
}

// Fan-out assíncrono por sala — só repassa eventos de jogo enquanto a partida está RUNNING.
const sub = new Redis(REDIS_URL);
sub.on("error", (e) => console.error("gateway: erro no Redis:", e.message));
for (const room of ROOMS) {
  sub.subscribe(`room:${room}:events`).catch((e) => console.error(`gateway: falha ao assinar ${room}:`, e.message));
}
const MONEY_EVENTS = new Set(["BID_PLACED", "BOX_SOLD", "BOX_OPENED"]);
sub.on("message", (channel, message) => {
  const mt = /^room:(.+):events$/.exec(channel);
  if (!mt) return;
  const room = mt[1];
  const m = matches[room];
  if (m?.status !== "RUNNING") return; // ignora fora da partida
  broadcastToRoom(room, message);
  let ev: any;
  try {
    ev = JSON.parse(message);
  } catch {
    return;
  }
  if (MONEY_EVENTS.has(ev.type)) {
    for (const c of clients) if (c.room === room) void sendWallet(c);
  }
  if (ev.type === "ROUND_ENDED") {
    m.roundsPlayed++;
    if (m.roundsPlayed >= m.totalRounds) {
      void endMatch(room); // última rodada → fim da partida
    } else {
      // Intervalo: jogadores gerenciam o inventário; abre a próxima ao "todos prontos" ou no teto.
      m.ready.clear();
      m.intermissionEndsAt = Date.now() + INTERMISSION_MS;
      broadcastToRoom(room, { type: "ROUND_INTERMISSION", endsAt: m.intermissionEndsAt, roundsPlayed: m.roundsPlayed, totalRounds: m.totalRounds });
      broadcastToRoom(room, { type: "READY_STATE", ready: 0, total: playersIn(room).length });
    }
  } else if (ev.type === "ROUND_STARTED") {
    m.intermissionEndsAt = 0;
    m.ready.clear();
  }
});

const replica = new Redis(REDIS_REPLICA_URL);
replica.on("error", (e) => console.error("gateway: erro na réplica Redis:", e.message));

const wss = new WebSocketServer({ port: PORT });
console.log(`gateway: WebSocket ouvindo em ws://localhost:${PORT} (slots: ${ROOMS.join(", ")})`);

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  const playerId = url.searchParams.get("player") || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
  const client: Client = { ws, playerId, room: null };
  clients.add(client);
  ws.send(JSON.stringify({ type: "HELLO", playerId, slotsTotal: ROOMS.length }));

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ---- Lobby ----
    if (msg.type === "CREATE_ROOM") {
      const slot = freeSlot();
      if (!slot) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "NO_ROOMS_AVAILABLE" }));
        return;
      }
      const prev = matches[slot];
      if (prev && codeToRoom.get(prev.code) === slot) codeToRoom.delete(prev.code);
      const code = genCode();
      const rounds = Math.max(1, Math.min(20, Number(msg.rounds) || 8));
      matches[slot] = { status: "WAITING", code, host: playerId, totalRounds: rounds, roundsPlayed: 0, ready: new Set(), intermissionEndsAt: 0 };
      codeToRoom.set(code, slot);
      client.room = slot;
      console.log(`gateway: ${playerId} criou a sala ${slot} (código ${code})`);
      ws.send(JSON.stringify({ type: "ROOM_JOINED", room: slot, code, host: true }));
      broadcastToRoom(slot, roomStateMsg(slot));
      return;
    }

    if (msg.type === "JOIN_ROOM") {
      const slot = codeToRoom.get(String(msg.code ?? "").toUpperCase());
      const m = slot ? matches[slot] : null;
      if (!slot || !m) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "ROOM_NOT_FOUND" }));
        return;
      }
      if (m.status !== "WAITING") {
        ws.send(JSON.stringify({ type: "ERROR", reason: "MATCH_ALREADY_STARTED" }));
        return;
      }
      client.room = slot;
      console.log(`gateway: ${playerId} entrou na sala ${slot}`);
      ws.send(JSON.stringify({ type: "ROOM_JOINED", room: slot, code: m.code, host: m.host === playerId }));
      broadcastToRoom(slot, roomStateMsg(slot));
      return;
    }

    if (msg.type === "START_MATCH") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (!slot || !m) return ws.send(JSON.stringify({ type: "ERROR", reason: "NOT_IN_ROOM" }));
      if (m.host !== playerId) return ws.send(JSON.stringify({ type: "ERROR", reason: "NOT_HOST" }));
      if (m.status !== "WAITING") return ws.send(JSON.stringify({ type: "ERROR", reason: "ALREADY_STARTED" }));
      if (playersIn(slot).length < 2) return ws.send(JSON.stringify({ type: "ERROR", reason: "NEED_2_PLAYERS" }));
      m.status = "RUNNING";
      m.roundsPlayed = 0;
      m.ready.clear();
      m.intermissionEndsAt = 0;
      console.log(`gateway: partida iniciada na sala ${slot} (${playersIn(slot).length} jogadores, ${m.totalRounds} rodadas)`);
      broadcastToRoom(slot, { type: "MATCH_STARTED", totalRounds: m.totalRounds, roundsPlayed: 0 });
      broadcastToRoom(slot, roomStateMsg(slot));
      // Garante uma rodada ATIVA já no início (caso o Leilão esteja num intervalo longo).
      try {
        await advanceRound(ROUTES[slot], slot);
      } catch {
        /* segue com o estado atual */
      }
      for (const c of clients) if (c.room === slot) await sendGameState(c);
      return;
    }

    if (msg.type === "END_MATCH") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.host === playerId && m.status === "RUNNING") await endMatch(slot);
      return;
    }

    // Jogador marca "pronto" durante o intervalo → adianta a rodada se todos prontos.
    if (msg.type === "READY") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.status === "RUNNING" && m.intermissionEndsAt > Date.now()) {
        m.ready.add(playerId);
        const total = playersIn(slot).length;
        broadcastToRoom(slot, { type: "READY_STATE", ready: m.ready.size, total });
        if (m.ready.size >= total) {
          m.intermissionEndsAt = 0;
          try {
            await advanceRound(ROUTES[slot], slot);
          } catch (e) {
            console.error("gateway: advanceRound:", e);
          }
        }
      }
      return;
    }

    // ---- Ações de jogo (só durante a partida) ----
    if (!inRunningMatch(client)) {
      if (["PLACE_BID", "OPEN_BOX", "SELL_ITEM", "BURN_ITEM", "FORM_COLLECTION"].includes(msg.type)) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "MATCH_NOT_RUNNING" }));
      }
      return;
    }
    const room = client.room!;
    const addr = ROUTES[room];
    const waddr = WALLET_ROUTES[room];

    if (msg.type === "PLACE_BID") {
      try {
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
        if (reply.accepted) void sendWallet(client);
      } catch (err) {
        console.error("gateway: erro no PLACE_BID:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "BID_FAILED" }));
      }
    }

    if (msg.type === "OPEN_BOX") {
      try {
        const reply = await openBox(addr, room, msg.boxId, playerId);
        ws.send(
          JSON.stringify({ type: "OPEN_RESULT", boxId: msg.boxId, ok: reply.ok, reason: reply.reason, item: reply.item, isMimic: reply.isMimic }),
        );
        if (reply.ok) void sendWallet(client);
      } catch (err) {
        console.error("gateway: erro no OPEN_BOX:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "OPEN_FAILED" }));
      }
    }

    if (msg.type === "SELL_ITEM") {
      try {
        const prices = await currentMarket();
        const reply = await sellItem(waddr, playerId, msg.itemId, prices);
        ws.send(JSON.stringify({ type: "SELL_RESULT", ok: reply.ok, reason: reply.reason, itemType: reply.type, price: reply.price }));
        if (reply.ok) void sendWallet(client);
      } catch (err) {
        console.error("gateway: erro no SELL_ITEM:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "SELL_FAILED" }));
      }
    }

    if (msg.type === "BURN_ITEM") {
      try {
        const reply = await burnItem(waddr, playerId, msg.itemId);
        ws.send(JSON.stringify({ type: "BURN_RESULT", ok: reply.ok, reason: reply.reason, itemType: reply.type, affinity: reply.affinity }));
        if (reply.ok) void sendWallet(client);
      } catch (err) {
        console.error("gateway: erro no BURN_ITEM:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "BURN_FAILED" }));
      }
    }

    if (msg.type === "FORM_COLLECTION") {
      try {
        const reply = await formCollection(waddr, playerId, msg.kind);
        ws.send(JSON.stringify({ type: "FORM_RESULT", ok: reply.ok, reason: reply.reason, kind: msg.kind, bonus: reply.bonus }));
        if (reply.ok) void sendWallet(client);
      } catch (err) {
        console.error("gateway: erro no FORM_COLLECTION:", err);
        ws.send(JSON.stringify({ type: "ERROR", reason: "FORM_FAILED" }));
      }
    }
  });

  ws.on("close", () => {
    clients.delete(client);
    const slot = client.room;
    if (!slot || !matches[slot]) return;
    const m = matches[slot]!;
    if (playersIn(slot).length === 0) {
      if (codeToRoom.get(m.code) === slot) codeToRoom.delete(m.code);
      matches[slot] = null;
      console.log(`gateway: sala ${slot} esvaziou e foi liberada`);
    } else {
      if (m.host === playerId) m.host = playersIn(slot)[0]; // reatribui o host
      broadcastToRoom(slot, roomStateMsg(slot));
    }
  });
});
