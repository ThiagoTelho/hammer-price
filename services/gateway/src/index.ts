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
import { placeBid, getRoomState, openBox, getPlayer, sellItem, burnItem, formCollection, advanceRound, forceClose, resetPlayer, type Box } from "./grpcClients.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_REPLICA_URL = process.env.REDIS_REPLICA_URL ?? REDIS_URL;
// Teto do intervalo entre rodadas (o gateway abre antes se todos marcarem "pronto").
const INTERMISSION_MS = Number(process.env.INTERMISSION_MAX_SECONDS ?? 120) * 1000;
// Capacidade máxima de jogadores por sala.
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS_PER_ROOM ?? 15);

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
  lastChat?: number; // timestamp do último chat (anti-spam leve)
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
  folded: Set<string>; // quem passou a vez NESTA rodada (zera a cada rodada)
  spectators: Set<string>; // quem desistiu e só assiste (persiste a partida)
  leader: string; // líder atual da rodada (p/ decidir o fechamento por fold)
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

// Jogadores que ainda disputam (exclui quem desistiu/assiste) — base do fold e do "pronto".
function activeBidders(room: string): string[] {
  const m = matches[room];
  return m ? playersIn(room).filter((p) => !m.spectators.has(p)) : [];
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

// "Leitura da mesa" (estilo pôquer): difunde o patrimônio VIVO de cada jogador da sala
// a todos — quem está rico, quem gastou. Os lances recentes o frontend lê dos BID_PLACED.
async function broadcastPlayersPanel(room: string): Promise<void> {
  const m = matches[room];
  if (!m || m.status !== "RUNNING") return;
  const prices = await currentMarket();
  const players = await Promise.all(
    playersIn(room).map(async (id) => {
      const spectating = m.spectators.has(id);
      try {
        const p = await getPlayer(WALLET_ROUTES[room], id);
        const free = p.inventory.filter((i) => i.state === "FREE");
        const items = free.reduce((s, i) => s + (prices[i.type] ?? 0), 0);
        const bonus = p.collections.reduce((s, c) => s + c.bonus, 0);
        return { id, money: p.balance, reserved: p.reserved, itemCount: free.length, net: p.balance + items + bonus, spectating };
      } catch {
        return { id, money: 0, reserved: 0, itemCount: 0, net: 0, spectating };
      }
    }),
  );
  broadcastToRoom(room, { type: "PLAYERS_PANEL", players });
}

// Se todos os que ainda disputam (exceto o líder) passaram, fecha a rodada já (o líder vence).
async function maybeCloseByFold(room: string): Promise<void> {
  const m = matches[room];
  if (!m || m.status !== "RUNNING") return;
  const bidders = activeBidders(room);
  if (bidders.length === 0) return;
  const remaining = bidders.filter((p) => p !== m.leader && !m.folded.has(p));
  if (remaining.length === 0) {
    try {
      await forceClose(ROUTES[room], room);
    } catch (e) {
      console.error("gateway: forceClose:", e);
    }
  }
}

// Fan-out assíncrono por sala — só repassa eventos de jogo enquanto a partida está RUNNING.
const sub = new Redis(REDIS_URL);
// Conexão separada para PUBLICAR o chat (a `sub` está em modo subscribe e não publica).
const pub = new Redis(REDIS_URL);
sub.on("error", (e) => console.error("gateway: erro no Redis:", e.message));
pub.on("error", (e) => console.error("gateway: erro no Redis (pub):", e.message));
for (const room of ROOMS) {
  sub.subscribe(`room:${room}:events`).catch((e) => console.error(`gateway: falha ao assinar ${room}:`, e.message));
  // Canal de chat por sala (pub/sub) — funciona em qualquer estado (lobby/partida/fim).
  sub.subscribe(`room:${room}:chat`).catch((e) => console.error(`gateway: falha ao assinar chat ${room}:`, e.message));
}
const MONEY_EVENTS = new Set(["BID_PLACED", "BOX_SOLD", "BOX_OPENED"]);
// Eventos que mudam o patrimônio de alguém ou abrem rodada → republica a "leitura da mesa".
const PANEL_EVENTS = new Set(["BOX_SOLD", "BOX_OPENED", "ROUND_STARTED", "ROUND_ENDED"]);
sub.on("message", (channel, message) => {
  // Chat: difunde a todos da sala independentemente do estado da partida.
  const chatMt = /^room:(.+):chat$/.exec(channel);
  if (chatMt) {
    broadcastToRoom(chatMt[1], message);
    return;
  }
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
  if (PANEL_EVENTS.has(ev.type)) void broadcastPlayersPanel(room);
  if (ev.type === "BID_PLACED" && typeof ev.leader === "string") {
    m.leader = ev.leader; // acompanha o líder p/ decidir o fechamento por fold
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
      broadcastToRoom(room, { type: "READY_STATE", ready: 0, total: activeBidders(room).length });
    }
  } else if (ev.type === "ROUND_STARTED") {
    m.intermissionEndsAt = 0;
    m.ready.clear();
    m.folded.clear(); // novo lote → todos podem dar lance de novo
    m.leader = "";
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
      const rounds = Math.max(8, Math.min(40, Number(msg.rounds) || 16));
      matches[slot] = { status: "WAITING", code, host: playerId, totalRounds: rounds, roundsPlayed: 0, ready: new Set(), intermissionEndsAt: 0, folded: new Set(), spectators: new Set(), leader: "" };
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
      if (playersIn(slot).length >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "ROOM_FULL" }));
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
      m.folded.clear();
      m.spectators.clear();
      m.leader = "";
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
      void broadcastPlayersPanel(slot);
      return;
    }

    if (msg.type === "END_MATCH") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.host === playerId && m.status === "RUNNING") await endMatch(slot);
      return;
    }

    // Jogar novamente na MESMA sala: zera as carteiras e volta ao lobby (host, partida encerrada).
    if (msg.type === "PLAY_AGAIN") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.host === playerId && m.status === "ENDED") {
        await Promise.all(playersIn(slot).map((p) => resetPlayer(WALLET_ROUTES[slot], p).catch(() => {})));
        m.status = "WAITING";
        m.roundsPlayed = 0;
        m.ready.clear();
        m.intermissionEndsAt = 0;
        m.folded.clear();
        m.spectators.clear();
        m.leader = "";
        if (!codeToRoom.has(m.code)) codeToRoom.set(m.code, slot); // reabre o código
        broadcastToRoom(slot, roomStateMsg(slot));
        for (const c of clients) if (c.room === slot) void sendWallet(c);
      }
      return;
    }

    // Jogador marca "pronto" durante o intervalo → adianta a rodada se todos prontos.
    if (msg.type === "READY") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.status === "RUNNING" && m.intermissionEndsAt > Date.now() && !m.spectators.has(playerId)) {
        m.ready.add(playerId);
        const total = activeBidders(slot).length;
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

    // Passar a vez NESTA rodada. Se todos (exceto o líder) passarem, o líder vence já.
    if (msg.type === "FOLD") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.status === "RUNNING" && !m.spectators.has(playerId)) {
        m.folded.add(playerId);
        broadcastToRoom(slot, { type: "FOLD_STATE", folded: m.folded.size, total: activeBidders(slot).length });
        await maybeCloseByFold(slot);
      }
      return;
    }

    // Desistir da partida e só assistir (permanece no ranking com o patrimônio atual).
    if (msg.type === "GIVE_UP") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (slot && m && m.status === "RUNNING" && !m.spectators.has(playerId)) {
        m.spectators.add(playerId);
        m.folded.delete(playerId);
        ws.send(JSON.stringify({ type: "SPECTATING" }));
        broadcastToRoom(slot, { type: "FOLD_STATE", folded: m.folded.size, total: activeBidders(slot).length });
        void broadcastPlayersPanel(slot);
        await maybeCloseByFold(slot); // sair pode deixar só o líder
      }
      return;
    }

    // Chat da sala (pub/sub Redis) — disponível no lobby, na partida e no fim; espectador também.
    if (msg.type === "CHAT_SEND") {
      const room = client.room;
      if (!room) return;
      const now = Date.now();
      if (now - (client.lastChat ?? 0) < 400) return; // anti-spam leve
      const text = String(msg.text ?? "").trim().slice(0, 300);
      if (!text) return;
      client.lastChat = now;
      pub.publish(`room:${room}:chat`, JSON.stringify({ type: "CHAT", player: playerId, text, ts: now }));
      return;
    }

    // ---- Ações de jogo (só durante a partida e para quem NÃO é espectador) ----
    const GAME_ACTIONS = ["PLACE_BID", "OPEN_BOX", "SELL_ITEM", "BURN_ITEM", "FORM_COLLECTION"];
    if (!inRunningMatch(client)) {
      if (GAME_ACTIONS.includes(msg.type)) ws.send(JSON.stringify({ type: "ERROR", reason: "MATCH_NOT_RUNNING" }));
      return;
    }
    if (matches[client.room!]?.spectators.has(playerId)) {
      if (GAME_ACTIONS.includes(msg.type)) ws.send(JSON.stringify({ type: "ERROR", reason: "SPECTATING" }));
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
          JSON.stringify({ type: "OPEN_RESULT", boxId: msg.boxId, ok: reply.ok, reason: reply.reason, item: reply.item, quantity: reply.quantity, isMimic: reply.isMimic }),
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
