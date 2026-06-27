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
import { placeBid, getRoomState, openBox, getPlayer, sellItem, formCollection, advanceRound, forceClose, resetOpens, resetPlayer, buyCard, consumeCard, transfer, setRoundEffects, peekDrop, type Box } from "./grpcClients.js";

const PORT = Number(process.env.GATEWAY_PORT ?? 8080);
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const REDIS_REPLICA_URL = process.env.REDIS_REPLICA_URL ?? REDIS_URL;
// Teto do intervalo entre rodadas (o gateway abre antes se todos marcarem "pronto").
const INTERMISSION_MS = Number(process.env.INTERMISSION_MAX_SECONDS ?? 120) * 1000;
// Capacidade máxima de jogadores por sala.
const MAX_PLAYERS = Number(process.env.MAX_PLAYERS_PER_ROOM ?? 15);
// Imposto (carta TAX): quanto cada rival paga ao autor (espelha cards.tax_amount do balance.yaml).
const CARD_TAX = Number(process.env.CARD_TAX ?? 25);
const CARD_DISCOUNT_PCT = Number(process.env.CARD_DISCOUNT_PCT ?? 30); // Desconto: % de abatimento no arremate
// Quem é NOTIFICADO ao jogar a carta (CARD_PLAYED): "self" (só quem jogou), "target" (quem jogou +
// o alvo) ou "group" (toda a sala). Cartas que só afetam quem usou não incomodam os demais.
const CARD_SCOPE: Record<string, "self" | "target" | "group"> = {
  // Maldição é "self": o ALVO NÃO é avisado — senão ele só evitaria dar lance (a maldição só
  // dispara se ele vencer). Só quem lançou vê; o alvo descobre ao abrir o Mímico.
  DOUBLE: "self", INSURANCE: "self", DISCOUNT: "self", INSIGHT: "self", SHIELD: "self", CURSE: "self",
  BLOCK: "target",
  TAX: "group", GAVEL: "group", UPGRADE: "group",
};
// Heartbeat: termina conexões mortas (que não respondem ao ping) → libera o slot da sala.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_SECONDS ?? 30) * 1000;
// Reaper: libera salas sem nenhuma atividade de cliente por este tempo (lobbies/partidas abandonados).
const ROOM_IDLE_MS = Number(process.env.ROOM_IDLE_MINUTES ?? 15) * 60 * 1000;
// Reconexão: tempo que um assento fica guardado após a queda do socket (refresh, blip de rede).
const RECONNECT_GRACE_MS = Number(process.env.RECONNECT_GRACE_MINUTES ?? 3) * 60 * 1000;

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
  isAlive: boolean; // heartbeat: respondeu ao último ping? (conexões mortas são terminadas)
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
  lastActivity: number; // último ms com mensagem de algum cliente da sala (p/ reaper de inatividade)
  pendingCards: { source: string; cardType: string; target?: string }[]; // cartas jogadas p/ a próxima rodada
  blocked: Set<string>; // bloqueados de dar lance NESTA rodada (carta Bloqueio)
  shielded: Set<string>; // imunes a efeitos ofensivos (carta Escudo — fase 2)
  disconnected: Map<string, number>; // playerId → epoch da queda do socket (assento guardado p/ reconexão)
  effectsMsg: unknown | null; // último CARD_EFFECTS difundido (replay na reconexão)
  playedThisInterval: Set<string>; // quem já jogou UMA carta neste intervalo (zera a cada intervalo)
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

// Nome de exibição a partir do playerId `nome#sufixo`.
function nameOf(id: string): string {
  const i = id.indexOf("#");
  return i >= 0 ? id.slice(0, i) : id;
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
          collections: p.collections,
          cards: p.cards,
          nextCardPrice: p.nextCardPrice,
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

// Reconexão: restaura a fase/host/posição do jogador e reenvia o estado vivo da partida.
async function resumeSnapshot(c: Client): Promise<void> {
  const room = c.room;
  const m = room ? matches[room] : null;
  if (!room || !m) return;
  if (c.ws.readyState === WebSocket.OPEN) {
    c.ws.send(
      JSON.stringify({
        type: "RESUMED",
        room,
        code: m.code,
        host: m.host === c.playerId,
        status: m.status,
        totalRounds: m.totalRounds,
        roundsPlayed: m.roundsPlayed,
        spectator: m.spectators.has(c.playerId),
        folded: m.folded.has(c.playerId),
      }),
    );
  }
  if (m.status === "RUNNING") {
    await sendGameState(c); // WELCOME (rodada/caixa/mercado) + carteira
    if (m.intermissionEndsAt > Date.now() && c.ws.readyState === WebSocket.OPEN) {
      c.ws.send(JSON.stringify({ type: "ROUND_INTERMISSION", endsAt: m.intermissionEndsAt, roundsPlayed: m.roundsPlayed, totalRounds: m.totalRounds }));
    }
    if (m.effectsMsg && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m.effectsMsg)); // selos/bloqueio da rodada
  } else {
    void sendWallet(c);
  }
  broadcastToRoom(room, roomStateMsg(room)); // os demais veem o jogador de volta
  void broadcastPlayersPanel(room);
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

// Efeitos do LEILÃO acumulados das cartas jogadas no intervalo. O Escudo (alvo protegido)
// ANULA a Maldição; os demais buffs são do próprio jogador. Empurrado via SetRoundEffects.
function auctionEffectsOf(m: Match): {
  doubleLoot: string[]; insured: string[]; cursed: string[];
  gavel: string[]; insight: string[];
  discounts: { player: string; pct: number }[]; boxTierBoost: number;
} {
  const shielded = new Set(m.pendingCards.filter((c) => c.cardType === "SHIELD").map((c) => c.source));
  const doubleLoot: string[] = [], insured: string[] = [], cursed: string[] = [];
  const gavel: string[] = [], insight: string[] = [];
  const discounts: { player: string; pct: number }[] = [];
  let boxTierBoost = 0;
  for (const c of m.pendingCards) {
    if (c.cardType === "DOUBLE") doubleLoot.push(c.source);
    else if (c.cardType === "INSURANCE") insured.push(c.source);
    else if (c.cardType === "GAVEL") gavel.push(c.source);
    else if (c.cardType === "INSIGHT") insight.push(c.source);
    else if (c.cardType === "DISCOUNT") discounts.push({ player: c.source, pct: CARD_DISCOUNT_PCT });
    else if (c.cardType === "UPGRADE") boxTierBoost += 1;
    else if (c.cardType === "CURSE" && c.target && !shielded.has(c.target)) cursed.push(c.target); // Escudo anula
  }
  return { doubleLoot, insured, cursed, gavel, insight, discounts, boxTierBoost };
}

// Ao iniciar a rodada: aplica efeitos do gateway (Escudo, Imposto, Bloqueio), revela a Visão
// em privado e difunde os efeitos ativos p/ a UI.
async function resolveRoundCards(room: string): Promise<void> {
  const m = matches[room];
  if (!m) return;
  const cards = m.pendingCards;
  m.pendingCards = [];
  m.blocked.clear();
  m.shielded.clear();
  for (const c of cards) if (c.cardType === "SHIELD") m.shielded.add(c.source); // Escudo anula ofensivas
  const doubleLoot: string[] = [], insured: string[] = [], gavel: string[] = [];
  const insightSources: string[] = [];
  // Maldição NÃO entra no CARD_EFFECTS (não revela ao alvo) — o efeito vai pelo auction.
  for (const c of cards) {
    if (c.cardType === "BLOCK" && c.target && !m.shielded.has(c.target)) m.blocked.add(c.target);
    else if (c.cardType === "DOUBLE") doubleLoot.push(c.source);
    else if (c.cardType === "INSURANCE") insured.push(c.source);
    else if (c.cardType === "GAVEL") gavel.push(c.source);
    else if (c.cardType === "INSIGHT") insightSources.push(c.source);
    else if (c.cardType === "TAX") {
      for (const rival of activeBidders(room)) {
        if (rival !== c.source && !m.shielded.has(rival)) {
          try {
            await transfer(WALLET_ROUTES[room], rival, c.source, CARD_TAX);
          } catch (e) {
            console.error("gateway: imposto:", e);
          }
        }
      }
    }
  }
  // Visão: revela o drop pré-sorteado (a caixa já foi sorteada no startRound) em privado.
  if (insightSources.length) {
    try {
      const d = await peekDrop(ROUTES[room], room);
      for (const src of insightSources) {
        const cl = [...clients].find((x) => x.room === room && x.playerId === src);
        if (cl) cl.ws.send(JSON.stringify({ type: "INSIGHT", item: d.item, quantity: d.quantity }));
      }
    } catch (e) {
      console.error("gateway: peekDrop:", e);
    }
  }
  m.effectsMsg = { type: "CARD_EFFECTS", blocked: [...m.blocked], doubleLoot, insured, shielded: [...m.shielded], gavel };
  broadcastToRoom(room, m.effectsMsg);
  for (const c of clients) if (c.room === room) void sendWallet(c);
  void broadcastPlayersPanel(room);
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
    m.blocked.clear(); // efeitos de carta da rodada expiram
    m.shielded.clear();
    m.effectsMsg = null;
    m.roundsPlayed++;
    if (m.roundsPlayed >= m.totalRounds) {
      void endMatch(room); // última rodada → fim da partida
    } else {
      // Intervalo: jogadores gerenciam o inventário; abre a próxima ao "todos prontos" ou no teto.
      m.ready.clear();
      m.playedThisInterval.clear(); // novo intervalo → cada jogador pode jogar 1 carta de novo
      m.intermissionEndsAt = Date.now() + INTERMISSION_MS;
      broadcastToRoom(room, { type: "ROUND_INTERMISSION", endsAt: m.intermissionEndsAt, roundsPlayed: m.roundsPlayed, totalRounds: m.totalRounds });
      broadcastToRoom(room, { type: "READY_STATE", ready: 0, total: activeBidders(room).length });
    }
  } else if (ev.type === "ROUND_STARTED") {
    m.intermissionEndsAt = 0;
    m.ready.clear();
    m.folded.clear(); // novo lote → todos podem dar lance de novo
    m.leader = "";
    void resolveRoundCards(room); // aplica Imposto/Bloqueio e difunde os efeitos ativos
  }
});

const replica = new Redis(REDIS_REPLICA_URL);
replica.on("error", (e) => console.error("gateway: erro na réplica Redis:", e.message));

const wss = new WebSocketServer({ port: PORT });
console.log(`gateway: WebSocket ouvindo em ws://localhost:${PORT} (slots: ${ROOMS.join(", ")})`);

// Heartbeat: a cada HEARTBEAT_MS, mata quem não respondeu ao último ping (o `close`
// resultante libera o slot da sala). Evita conexões "fantasma" presas após queda de rede.
const heartbeat = setInterval(() => {
  for (const c of clients) {
    if (!c.isAlive) {
      c.ws.terminate();
      continue;
    }
    c.isAlive = false;
    try {
      c.ws.ping();
    } catch {
      /* socket já caindo */
    }
  }
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

// Reaper: libera salas sem QUALQUER mensagem de cliente há ROOM_IDLE_MS (lobby/partida abandonados).
setInterval(() => {
  const now = Date.now();
  for (const room of ROOMS) {
    const m = matches[room];
    if (!m || now - m.lastActivity <= ROOM_IDLE_MS) continue;
    for (const c of clients) {
      if (c.room === room) {
        try {
          c.ws.send(JSON.stringify({ type: "ROOM_CLOSED", reason: "IDLE" }));
        } catch {
          /* ignora */
        }
        c.room = null;
      }
    }
    if (codeToRoom.get(m.code) === room) codeToRoom.delete(m.code);
    matches[room] = null;
    console.log(`gateway: sala ${room} liberada por inatividade`);
  }
}, Math.min(60_000, ROOM_IDLE_MS)); // checa a cada 60s (ou mais rápido se o teto de inatividade for curto)

// Graça de reconexão: descarta assentos cujo dono não voltou a tempo; se a sala ficou sem
// ninguém vivo nem reconexão pendente, libera já (sem esperar o reaper de inatividade).
setInterval(() => {
  const now = Date.now();
  for (const room of ROOMS) {
    const m = matches[room];
    if (!m) continue;
    let changed = false;
    for (const [pid, at] of m.disconnected) {
      if (now - at > RECONNECT_GRACE_MS) {
        m.disconnected.delete(pid);
        changed = true;
        console.log(`gateway: assento de ${pid} liberado (graça de reconexão expirou)`);
      }
    }
    if (playersIn(room).length === 0 && m.disconnected.size === 0) {
      if (codeToRoom.get(m.code) === room) codeToRoom.delete(m.code);
      matches[room] = null;
    } else if (changed) {
      broadcastToRoom(room, roomStateMsg(room));
      void broadcastPlayersPanel(room);
    }
  }
}, Math.min(30_000, RECONNECT_GRACE_MS));

wss.on("connection", (ws, req) => {
  const url = new URL(req.url ?? "", "http://localhost");
  // Identidade ÚNICA: nome (display, sem '#') + sufixo aleatório → `ana#a3f`. Evita que dois
  // jogadores de mesmo nome colidam de sessão. O frontend mostra só o nome (antes do '#').
  const rawName = (url.searchParams.get("player") || "").replace(/#/g, "").trim().slice(0, 20) || "jogador";

  // RECONEXÃO: o frontend reapresenta o playerId salvo + a sala. Se o assento ainda existe
  // (guardado pela graça em `m.disconnected`, ou outro socket vivo do mesmo id), religa em vez
  // de criar uma identidade nova — carteira/cartas/host/posição na rodada são preservados.
  const resumeId = (url.searchParams.get("resume") || "").trim();
  const resumeRoom = (url.searchParams.get("room") || "").trim();
  let resumedRoom: string | null = null;
  if (resumeId && resumeRoom && matches[resumeRoom] && matches[resumeRoom]!.status !== "ENDED") {
    const m = matches[resumeRoom]!;
    if (m.disconnected.has(resumeId) || playersIn(resumeRoom).includes(resumeId)) {
      resumedRoom = resumeRoom;
      m.disconnected.delete(resumeId);
    }
  }

  let playerId = "";
  if (resumedRoom) {
    playerId = resumeId;
  } else {
    do {
      playerId = `${rawName}#${Math.random().toString(36).slice(2, 6)}`;
    } while ([...clients].some((c) => c.playerId === playerId));
  }
  const client: Client = { ws, playerId, room: resumedRoom, isAlive: true };
  clients.add(client);
  ws.on("pong", () => { client.isAlive = true; }); // resposta ao heartbeat → conexão viva
  ws.send(JSON.stringify({ type: "HELLO", playerId, name: nameOf(playerId), slotsTotal: ROOMS.length }));
  if (resumedRoom) {
    void resumeSnapshot(client); // reenvia o estado da sessão e avisa os demais
  } else if (resumeId) {
    ws.send(JSON.stringify({ type: "RESUME_FAILED" })); // sessão expirou/sala fechou → menu
  }

  ws.on("message", async (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // Marca atividade da sala (p/ o reaper de inatividade não liberar salas em uso).
    if (client.room && matches[client.room]) matches[client.room]!.lastActivity = Date.now();

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
      matches[slot] = { status: "WAITING", code, host: playerId, totalRounds: rounds, roundsPlayed: 0, ready: new Set(), intermissionEndsAt: 0, folded: new Set(), spectators: new Set(), leader: "", pendingCards: [], blocked: new Set(), shielded: new Set(), lastActivity: Date.now(), disconnected: new Map(), effectsMsg: null, playedThisInterval: new Set() };
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
      m.pendingCards = [];
      m.blocked.clear();
      m.shielded.clear();
      m.playedThisInterval.clear();
      console.log(`gateway: partida iniciada na sala ${slot} (${playersIn(slot).length} jogadores, ${m.totalRounds} rodadas)`);
      broadcastToRoom(slot, { type: "MATCH_STARTED", totalRounds: m.totalRounds, roundsPlayed: 0 });
      broadcastToRoom(slot, roomStateMsg(slot));
      // Nova partida: limpa o rastreio de aberturas do Leilão (não acumula estado entre jogos).
      try {
        await resetOpens(ROUTES[slot], slot);
      } catch {
        /* ignora */
      }
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
        m.pendingCards = [];
        m.blocked.clear();
        m.shielded.clear();
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

    // Sair da sala DE VEZ (volta ao menu): tira o jogador do ranking e NÃO guarda assento.
    if (msg.type === "LEAVE_ROOM") {
      const slot = client.room;
      client.room = null;
      ws.send(JSON.stringify({ type: "LEFT_ROOM" }));
      const m = slot ? matches[slot] : null;
      if (!slot || !m) return;
      // Remove o jogador de todos os conjuntos da partida.
      m.spectators.delete(playerId);
      m.folded.delete(playerId);
      m.ready.delete(playerId);
      m.blocked.delete(playerId);
      m.shielded.delete(playerId);
      m.disconnected.delete(playerId);
      m.playedThisInterval.delete(playerId);
      // Sala sem ninguém vivo nem reconexão pendente → libera; senão, reatribui host e atualiza.
      if (playersIn(slot).length === 0 && m.disconnected.size === 0) {
        if (codeToRoom.get(m.code) === slot) codeToRoom.delete(m.code);
        matches[slot] = null;
        console.log(`gateway: ${playerId} saiu — sala ${slot} esvaziou e foi liberada`);
      } else {
        if (m.host === playerId) m.host = playersIn(slot)[0] ?? m.host; // host passa a alguém vivo
        broadcastToRoom(slot, roomStateMsg(slot));
        broadcastToRoom(slot, { type: "FOLD_STATE", folded: m.folded.size, total: activeBidders(slot).length });
        void broadcastPlayersPanel(slot);
        await maybeCloseByFold(slot); // sair pode deixar só o líder ativo
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

    // Comprar uma carta aleatória (preço crescente) — durante a partida, não-espectador.
    if (msg.type === "BUY_CARD") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (!slot || !m || m.status !== "RUNNING" || m.spectators.has(playerId)) return;
      try {
        const r = await buyCard(WALLET_ROUTES[slot], playerId);
        ws.send(JSON.stringify({ type: "CARD_BOUGHT", ok: r.ok, reason: r.reason, card: r.card, price: r.price }));
        if (r.ok) {
          void sendWallet(client);
          broadcastToRoom(slot, { type: "CARD_NOTICE", player: playerId }); // público, sem revelar a carta
        }
      } catch (e) {
        console.error("gateway: BUY_CARD:", e);
      }
      return;
    }

    // Jogar uma carta — SÓ no intervalo (o efeito vale para a próxima rodada). Revelada à mesa.
    if (msg.type === "PLAY_CARD") {
      const slot = client.room;
      const m = slot ? matches[slot] : null;
      if (!slot || !m || m.status !== "RUNNING" || m.intermissionEndsAt <= Date.now() || m.spectators.has(playerId)) return;
      // Uma carta por intervalo: barra a 2ª jogada do mesmo jogador no mesmo intervalo.
      if (m.playedThisInterval.has(playerId)) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "ALREADY_PLAYED_CARD" }));
        return;
      }
      const cardType = String(msg.cardType ?? "");
      const target = msg.target ? String(msg.target) : undefined;
      // Cartas ofensivas de alvo único exigem um alvo válido (jogador da sala, não você).
      const targeted = ["BLOCK", "CURSE"].includes(cardType);
      if (targeted && (!target || target === playerId || !playersIn(slot).includes(target))) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "INVALID_TARGET" }));
        return;
      }
      let consumed = false;
      try {
        consumed = (await consumeCard(WALLET_ROUTES[slot], playerId, cardType)).ok; // valida posse
      } catch (e) {
        console.error("gateway: consumeCard:", e);
      }
      if (!consumed) {
        ws.send(JSON.stringify({ type: "ERROR", reason: "NO_SUCH_CARD" }));
        return;
      }
      m.pendingCards.push({ source: playerId, cardType, target });
      m.playedThisInterval.add(playerId); // consumiu sua jogada deste intervalo
      // Notifica só quem a carta afeta: o próprio (self), o alvo (target) ou toda a sala (group).
      const cardPlayedMsg = { type: "CARD_PLAYED", source: playerId, cardType, target: target ?? "" };
      const scope = CARD_SCOPE[cardType] ?? "group";
      if (scope === "group") {
        broadcastToRoom(slot, cardPlayedMsg);
      } else {
        const recipients = new Set<string>([playerId]);
        if (scope === "target" && target) recipients.add(target);
        const data = JSON.stringify(cardPlayedMsg);
        for (const c of clients) {
          if (c.room === slot && recipients.has(c.playerId) && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
        }
      }
      // Empurra os efeitos do Leilão (idempotente: o conjunto acumulado) p/ a próxima rodada.
      try {
        await setRoundEffects(ROUTES[slot], slot, auctionEffectsOf(m));
      } catch (e) {
        console.error("gateway: setRoundEffects:", e);
      }
      void sendWallet(client); // a mão diminuiu
      return;
    }

    // ---- Ações de jogo (só durante a partida e para quem NÃO é espectador) ----
    const GAME_ACTIONS = ["PLACE_BID", "OPEN_BOX", "SELL_ITEM", "FORM_COLLECTION"];
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
      if (matches[room]?.blocked.has(playerId)) {
        ws.send(JSON.stringify({ type: "BID_REJECTED", boxId: msg.boxId, reason: "BLOCKED" }));
        return;
      }
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
    // Outro socket vivo do mesmo jogador (ex.: takeover por reconexão) → o assento segue ocupado.
    if (playersIn(slot).includes(playerId)) return;

    if (m.status !== "ENDED") {
      // Partida em andamento: GUARDA o assento p/ reconexão (refresh/queda) durante a graça.
      m.disconnected.set(playerId, Date.now());
      if (m.host === playerId) {
        const liveHost = playersIn(slot)[0]; // host passa a alguém VIVO, se houver
        if (liveHost) m.host = liveHost;
      }
      console.log(`gateway: ${playerId} caiu na sala ${slot} — assento guardado por reconexão`);
      broadcastToRoom(slot, roomStateMsg(slot));
      void broadcastPlayersPanel(slot);
      return;
    }
    // Partida encerrada: comportamento antigo (libera sala vazia / reatribui host).
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
