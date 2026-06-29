// Mesa de leilão do Hammer Price — tema "casa de leilão" (escuro + dourado, Tailwind).
// Fluxo: menu (criar/entrar) → lobby → partida (rodadas + HUD) → ranking final.
import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as sfx from "./sound";
import { Chest, tierLabel, tierLight } from "./Chest";
import { Card, cardOf, CARDS } from "./Card";
import { Gavel } from "./Gavel";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "ws://localhost:8080";

interface Box {
  boxId: string;
  boxType: string;
  currentBid: number;
  leader: string;
  timerMs: number;
  odds: Record<string, number>;
  deadlineAt?: number;
}
interface Wallet {
  balance: number;
  reserved: number;
  inventory: { id: string; type: string; state: string }[];
  collections: { kind: string; bonus: number }[];
  cards: string[];
}
interface RankRow {
  playerId: string;
  money: number;
  items: number;
  bonus: number;
  net: number;
}
type Phase = "menu" | "lobby" | "playing" | "ended";
// Item da fila de overlays (destaques): flash (vitória/carta/mímico) ou abertura animada do baú.
type OverlayItem =
  | {
      id: number;
      kind: "flash";
      flashKind: "win" | "mimic";
      emoji: string;
      title: string;
      sub: string;
      durationMs: number;
    }
  | {
      id: number;
      kind: "open";
      tier: string;
      item: string;
      qty: number;
      isMimic: boolean;
      sub: string;
      durationMs: number;
    };
// Omit distributivo: preserva os campos de CADA membro do union (Omit normal colapsaria nos comuns).
type DistributiveOmit<T, K extends keyof any> = T extends unknown
  ? Omit<T, K>
  : never;
type OverlayInput = DistributiveOmit<OverlayItem, "id">;

function withDeadline(box: Box | null): Box | null {
  if (!box) return null;
  return { ...box, deadlineAt: box.timerMs > 0 ? Date.now() + box.timerMs : 0 };
}

const CHEST_GLYPH = "🧰";
// O playerId do backend é `nome#sufixo` (único por sessão). Para exibir, mostramos só o nome.
const nm = (id: string): string =>
  id && id.includes("#") ? id.slice(0, id.indexOf("#")) : id;

// Cor estável por jogador (chat): hash do playerId → uma das 9 cores. Independe da ordem de entrada.
const CHAT_COLORS = [
  "#f5d77a",
  "#7dd3fc",
  "#86efac",
  "#fca5a5",
  "#c4b5fd",
  "#fcd34d",
  "#f9a8d4",
  "#5eead4",
  "#fdba74",
];
const colorOf = (id: string): string => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return CHAT_COLORS[Math.abs(h) % CHAT_COLORS.length];
};

// Sessão persistida (reconexão): volta à sala após um refresh, enquanto ela estiver aberta.
// Usa sessionStorage (NÃO localStorage): sobrevive ao reload, mas é POR ABA — assim duas abas
// no mesmo navegador (cada jogador na sua) não compartilham a mesma sessão.
const SESSION_KEY = "hammerprice.session";
type Session = { playerId: string; room: string; code: string; name: string };
const loadSession = (): Session | null => {
  try {
    const r = sessionStorage.getItem(SESSION_KEY);
    return r ? (JSON.parse(r) as Session) : null;
  } catch {
    return null;
  }
};
const saveSession = (s: Session) => {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    /* storage indisponível */
  }
};
const clearSession = () => {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignora */
  }
};

// Homepage: dica qualitativa de prêmio por baú (não numérica, p/ não divergir do balance.yaml).
const TIER_HINT: Record<string, string> = {
  WOODEN: "Quase sempre Cobre — barato e seguro",
  IRON: "Prata, com algum Ouro",
  ROYAL: "Boas chances de Ouro",
  VAULT: "Mais Diamante — e mais risco de Mímico",
  JACKPOT: "Raro: muito Diamante — mas pode morder",
  MYSTERY: "Odds ocultas — pura sorte 🎲",
};
const HOW_TO_PLAY = [
  {
    icon: "🔨",
    title: "Dispute o lote",
    text: "O cronômetro só começa após o 1º lance; quem liderar quando ele zerar arremata. Sem interesse? Passe.",
  },
  {
    icon: "🎁",
    title: "Abra o baú",
    text: "Rende de 1 a 4 itens — de Cobre a Diamante — ou um 💀 Mímico, que aplica uma penalidade.",
  },
  {
    icon: "🃏",
    title: "Vire o jogo",
    text: "Compre cartas e forme coleções para multiplicar seus itens e atrapalhar os rivais.",
  },
  {
    icon: "🏆",
    title: "Maior patrimônio",
    text: "No fim das rodadas vence quem tiver mais dinheiro + itens + bônus de coleções.",
  },
];

const BID_TIMER_MS = 20000; // fallback p/ a escala do anel se box.timerMs vier 0
// Log de "Eventos": escondido por padrão (entrega informação ao jogador). Abra com ?logs=1
// para a gravação da demo. Lido 1× no carregamento.
const SHOW_LOGS = new URLSearchParams(window.location.search).has("logs");
// Link de convite: `?join=CODE` (ou `?code=`) pré-aplica o código da sala — o convidado só
// digita o nome. Lido 1× no carregamento.
const INVITE_PARAM = (() => {
  const q = new URLSearchParams(window.location.search);
  return (q.get("join") || q.get("code") || "").toUpperCase().trim();
})();
// URL de convite a partir de um código (usa o origin atual → funciona em qualquer deploy).
const inviteUrl = (c: string) =>
  `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(c)}`;
const HAND_MAX = 4; // espelha cards.hand_max no balance.yaml (teto da mão; o servidor é a verdade)
const BANKRUPTCY_THRESHOLD = 200; // espelha cards.bankruptcy_threshold (Falência só com saldo <= isto)
const EMOTE_LIST = ["👍", "🔥", "😂", "😱", "🤡", "💰", "🧂", "👀"]; // espelha a whitelist do gateway
const money = (n: number): string =>
  `$${Math.round(n).toLocaleString("pt-BR")}`;
const ITEM_ORDER = ["COPPER", "SILVER", "GOLD", "DIAMOND", "MIMIC"];
const ITEM_EMOJI: Record<string, string> = {
  COPPER: "🪙",
  SILVER: "🥈",
  GOLD: "🥇",
  DIAMOND: "💎",
  MIMIC: "💀",
};
const ITEM_NAME: Record<string, string> = {
  COPPER: "Cobre",
  SILVER: "Prata",
  GOLD: "Ouro",
  DIAMOND: "Diamante",
  MIMIC: "Mímico",
};
const PRICED = ["COPPER", "SILVER", "GOLD", "DIAMOND"]; // itens com cotação (Mímico não tem preço)
const MAX_HIST = 24; // pontos do mini-gráfico do mercado
// Acrescenta o snapshot atual ao histórico de cada item (mantém os últimos MAX_HIST).
const pushHist = (
  hist: Record<string, number[]>,
  prices: Record<string, number>,
): Record<string, number[]> => {
  const next: Record<string, number[]> = { ...hist };
  for (const k of PRICED) {
    if (typeof prices[k] === "number")
      next[k] = [...(hist[k] ?? []), prices[k]].slice(-MAX_HIST);
  }
  return next;
};

const COLLECTIONS: {
  kind: string;
  label: string;
  requires: Record<string, number>;
  bonus: number;
}[] = [
  {
    kind: "COPPER_TRIO",
    label: "Trinca de Cobre",
    requires: { COPPER: 3 },
    bonus: 70,
  },
  {
    kind: "SILVER_SET",
    label: "Trio de Prata",
    requires: { SILVER: 3 },
    bonus: 230,
  },
  {
    kind: "ALLOY",
    label: "Liga Metálica",
    requires: { COPPER: 2, SILVER: 2 },
    bonus: 220,
  },
  {
    kind: "SILVER_GOLD",
    label: "Prata & Ouro",
    requires: { SILVER: 2, GOLD: 1 },
    bonus: 400,
  },
  {
    kind: "GOLD_TRIO",
    label: "Trinca de Ouro",
    requires: { GOLD: 3 },
    bonus: 720,
  },
  {
    kind: "RAINBOW",
    label: "Arco-íris",
    requires: { COPPER: 1, SILVER: 1, GOLD: 1, DIAMOND: 1 },
    bonus: 1100,
  },
  {
    kind: "DIAMOND_PAIR",
    label: "Par de Diamantes",
    requires: { DIAMOND: 2 },
    bonus: 1500,
  },
  {
    kind: "ROYAL_FLUSH",
    label: "Realeza",
    requires: { SILVER: 1, GOLD: 1, DIAMOND: 2 },
    bonus: 2000,
  },
  {
    kind: "LEGENDARY_VAULT",
    label: "Cofre Lendário",
    requires: { DIAMOND: 5 },
    bonus: 5000,
  },
];
// Rótulo PT de uma coleção pelo seu kind interno (ex.: GOLD_TRIO -> "Trinca de Ouro").
const collLabel = (kind: string): string =>
  COLLECTIONS.find((c) => c.kind === kind)?.label ?? kind;
// Texto PT da penalidade do Mímico, montado no CLIENTE (fonte única de rótulos PT). O servidor
// manda só kind + token (tipo de item / kind de coleção) + value — aqui vira texto legível.
function penaltyText(kind: string, token: string, value: number): string {
  switch (kind) {
    case "MONEY":
      return `${money(value)} de dinheiro`;
    case "ITEM":
      return `1 ${ITEM_NAME[token] ?? token}`;
    case "COLLECTION":
      return `a coleção ${collLabel(token)} (−${money(value)})`;
    default:
      return token || "—";
  }
}

// Classes reutilizáveis do tema.
const C = {
  card: "bg-surface border border-line rounded-2xl",
  btnGold:
    "bg-gold text-ink font-semibold rounded-lg px-4 py-2 hover:bg-gold-soft active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed transition",
  btnSmall:
    "bg-surface-2 border border-line text-stone-200 rounded-md px-2.5 py-1 text-sm hover:border-gold disabled:opacity-30 disabled:cursor-not-allowed transition",
  input:
    "bg-surface-2 border border-line rounded-lg px-3 py-2 text-stone-100 placeholder:text-stone-500 outline-none focus:border-gold w-full",
  chip: "px-3 py-1.5 rounded-lg bg-surface-2 border border-line text-sm whitespace-nowrap",
};

export function App() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState(INVITE_PARAM); // pré-aplicado se veio por link de convite
  const [phase, setPhase] = useState<Phase>("menu");
  const [playerId, setPlayerId] = useState("");
  const [code, setCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [reconnecting, setReconnecting] = useState(false); // tentando voltar à sala salva
  const [playedCard, setPlayedCard] = useState(false); // já joguei 1 carta NESTE intervalo (1 por intervalo)
  const [logsOpen, setLogsOpen] = useState(true); // painel de Eventos recolhível
  const [copiedCode, setCopiedCode] = useState(false); // feedback do botão "copiar código"
  const [copiedInvite, setCopiedInvite] = useState(false); // feedback do botão "copiar convite"
  // Confirmação no estilo do jogo (substitui o confirm() nativo). null = fechado.
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    body: string;
    yes: string;
    onYes: () => void;
  } | null>(null);
  const [lobby, setLobby] = useState<{
    status: string;
    host: string;
    players: string[];
  }>({ status: "WAITING", host: "", players: [] });
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [awards, setAwards] = useState<{ key: string; label: string; emoji: string; playerId: string; value: number }[]>([]);
  const [roundsToCreate, setRoundsToCreate] = useState(16);
  const [matchRounds, setMatchRounds] = useState({ played: 0, total: 0 });
  const [intermission, setIntermission] = useState<{ endsAt: number } | null>(
    null,
  );
  const [readyState, setReadyState] = useState({ ready: 0, total: 0 });
  const [iAmReady, setIAmReady] = useState(false);
  const [folded, setFolded] = useState(false); // passei a vez nesta rodada
  const [foldState, setFoldState] = useState({ folded: 0, total: 0 });
  const [spectating, setSpectating] = useState(false); // desisti e só assisto
  const [chat, setChat] = useState<
    { player: string; text: string; ts: number }[]
  >([]);
  const [floatingEmotes, setFloatingEmotes] = useState<{ id: number; player: string; emoji: string }[]>([]);
  const emoteIdRef = useRef(0);
  const [nextCardPrice, setNextCardPrice] = useState(0);
  const [cardEffects, setCardEffects] = useState<{
    blocked: string[];
    doubleLoot: string[];
    insured: string[];
    cursed: string[];
    shielded: string[];
    gavel: string[];
  }>({
    blocked: [],
    doubleLoot: [],
    insured: [],
    cursed: [],
    shielded: [],
    gavel: [],
  });
  const [insight, setInsight] = useState<{
    item: string;
    quantity: number;
  } | null>(null); // Visão: drop revelado
  const [targeting, setTargeting] = useState<string | null>(null); // cartType aguardando escolha de alvo
  const [showCheats, setShowCheats] = useState(false); // overlay com todas as cartas

  const [round, setRound] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [priceHist, setPriceHist] = useState<Record<string, number[]>>({}); // histórico p/ tendência + sparkline
  const [marketEvent, setMarketEvent] = useState<{ kind: string; label: string; emoji: string; desc: string; endsAt: number } | null>(null);
  const lastEventKindRef = useRef<string>(""); // p/ disparar o banner só quando um evento NOVO começa
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wonBoxes, setWonBoxes] = useState<
    { boxId: string; boxType: string }[]
  >([]);
  const [players, setPlayers] = useState<
    {
      id: string;
      money: number;
      reserved: number;
      itemCount: number;
      net: number;
      spectating?: boolean;
    }[]
  >([]);
  const [lastBids, setLastBids] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);
  const [bidAmount, setBidAmount] = useState("");
  // Fila de overlays: mostra UM destaque por vez, em ordem (sem sobreposição visual).
  const [overlayQueue, setOverlayQueue] = useState<OverlayItem[]>([]);
  const overlayIdRef = useRef(0);
  const [muted, setMutedState] = useState(false);
  const [sold, setSold] = useState<string | null>(null); // baú arrematado → carimbo no palco
  const [confettiKey, setConfettiKey] = useState(0); // bump → dispara uma rajada de confete
  const fireConfetti = () => setConfettiKey((k) => k + 1);
  const wonBoxesRef = useRef<{ boxId: string; boxType: string }[]>([]);
  const lastTickRef = useRef(-1);
  const openCursedRef = useRef(false); // a abertura atual veio de uma Maldição? (revela ao vencedor)

  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef("");
  const pendingRef = useRef<
    { kind: "create"; rounds: number } | { kind: "join"; code: string } | null
  >(null);

  const addLog = useCallback((line: string) => {
    setLog((prev) =>
      [`${new Date().toLocaleTimeString()} — ${line}`, ...prev].slice(0, 30),
    );
  }, []);

  const send = (o: unknown) => wsRef.current?.send(JSON.stringify(o));

  const connect = useCallback(
    (
      action:
        | { kind: "create"; rounds: number }
        | { kind: "join"; code: string }
        | { kind: "resume"; session: Session },
    ) => {
      try {
        wsRef.current?.close();
      } catch {
        /* nada a fechar */
      }
      let url: string;
      if (action.kind === "resume") {
        // Reconexão: reapresenta playerId + sala; o gateway religa o assento e envia RESUMED.
        const s = action.session;
        setName(s.name);
        pendingRef.current = null;
        url = `${GATEWAY_URL}?player=${encodeURIComponent(s.name)}&resume=${encodeURIComponent(s.playerId)}&room=${encodeURIComponent(s.room)}`;
      } else {
        const player =
          name.trim() || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
        pendingRef.current = action;
        url = `${GATEWAY_URL}?player=${encodeURIComponent(player)}`;
      }
      const ws = new WebSocket(url);
      wsRef.current = ws;
      ws.onclose = () => addLog("Desconectado");
      ws.onerror = () => addLog("Erro de conexão com o gateway");
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "HELLO":
            setPlayerId(msg.playerId);
            playerIdRef.current = msg.playerId;
            if (pendingRef.current?.kind === "create")
              send({ type: "CREATE_ROOM", rounds: pendingRef.current.rounds });
            else if (pendingRef.current?.kind === "join")
              send({ type: "JOIN_ROOM", code: pendingRef.current.code });
            break;
          case "ROOM_JOINED":
            setCode(msg.code);
            setIsHost(!!msg.host);
            setPhase("lobby");
            // Guarda a sessão p/ reconectar após refresh/queda enquanto a sala estiver aberta.
            saveSession({
              playerId: playerIdRef.current,
              room: msg.room,
              code: msg.code,
              name: name.trim() || nm(playerIdRef.current),
            });
            break;
          case "RESUMED":
            setReconnecting(false);
            setCode(msg.code);
            setIsHost(!!msg.host);
            setSpectating(!!msg.spectator);
            setFolded(!!msg.folded);
            setMatchRounds({
              played: msg.roundsPlayed ?? 0,
              total: msg.totalRounds ?? 0,
            });
            setPhase(msg.status === "RUNNING" ? "playing" : "lobby");
            saveSession({
              playerId: playerIdRef.current,
              room: msg.room,
              code: msg.code,
              name: name.trim() || nm(playerIdRef.current),
            });
            addLog("🔄 Reconectado à sua sala.");
            break;
          case "RESUME_FAILED":
            setReconnecting(false);
            clearSession();
            setPhase("menu");
            addLog("Sua sessão anterior expirou — comece uma nova.");
            break;
          case "ROOM_STATE":
            setLobby({
              status: msg.status,
              host: msg.host,
              players: msg.players ?? [],
            });
            if (msg.code) setCode(msg.code);
            if (msg.status === "WAITING") {
              // (re)entrou no lobby — inclui "jogar novamente": limpa o estado da partida.
              setPhase("lobby");
              setBox(null);
              setWonBoxes([]);
              setIntermission(null);
              setRanking([]);
              setPlayers([]);
              setLastBids({});
              setSpectating(false);
              setFolded(false);
            }
            break;
          case "MATCH_STARTED":
            setMatchRounds({
              played: msg.roundsPlayed ?? 0,
              total: msg.totalRounds ?? 0,
            });
            setIntermission(null);
            setPlayers([]);
            setLastBids({});
            setFolded(false);
            setFoldState({ folded: 0, total: 0 });
            setSpectating(false);
            setCardEffects({
              blocked: [],
              doubleLoot: [],
              insured: [],
              cursed: [],
              shielded: [],
              gavel: [],
            });
            setInsight(null);
            setTargeting(null);
            setPlayedCard(false);
            setPhase("playing");
            addLog(`🚀 Partida iniciada! ${msg.totalRounds} rodadas.`);
            break;
          case "MATCH_ENDED":
            setRanking(msg.ranking ?? []);
            setAwards(msg.awards ?? []);
            setPhase("ended");
            break;
          case "WELCOME":
            setRound(msg.round ?? 0);
            setBox(withDeadline(msg.box ?? null));
            if (msg.market) {
              setPrices(msg.market);
              setPriceHist((h) => pushHist(h, msg.market));
            }
            break;
          case "ROUND_STARTED":
            setRound(msg.round ?? 0);
            setBox(withDeadline(msg.box ?? null));
            setIntermission(null);
            setIAmReady(false);
            setSold(null);
            setFolded(false);
            setFoldState((s) => ({ folded: 0, total: s.total }));
            sfx.whoosh();
            addLog(
              `🆕 Nova rodada: ${tierLabel(msg.box?.boxType ?? "WOODEN")} em leilão`,
            );
            break;
          case "ROUND_ENDED":
            if (!msg.winner) addLog(`⌛ Rodada encerrada sem lances`);
            break;
          case "ROUND_INTERMISSION":
            setBox(null);
            setSold(null);
            setIntermission({ endsAt: msg.endsAt ?? 0 });
            setMatchRounds({
              played: msg.roundsPlayed ?? 0,
              total: msg.totalRounds ?? 0,
            });
            setIAmReady(false);
            setCardEffects({
              blocked: [],
              doubleLoot: [],
              insured: [],
              cursed: [],
              shielded: [],
              gavel: [],
            });
            setInsight(null);
            setTargeting(null);
            setPlayedCard(false); // novo intervalo → posso jogar 1 carta de novo
            break;
          case "READY_STATE":
            setReadyState({ ready: msg.ready ?? 0, total: msg.total ?? 0 });
            break;
          case "PLAYERS_PANEL":
            setPlayers(msg.players ?? []);
            break;
          case "FOLD_STATE":
            setFoldState({ folded: msg.folded ?? 0, total: msg.total ?? 0 });
            break;
          case "CHAT":
            setChat((prev) =>
              [
                ...prev,
                { player: msg.player, text: msg.text, ts: msg.ts },
              ].slice(-80),
            );
            break;
          case "EMOTE": {
            // Reação rápida: flutua um emoji que sobe e some, com o nome/cor do remetente.
            const id = ++emoteIdRef.current;
            setFloatingEmotes((prev) => [...prev, { id, player: msg.player, emoji: msg.emoji }].slice(-12));
            setTimeout(() => setFloatingEmotes((prev) => prev.filter((e) => e.id !== id)), 2600);
            break;
          }
          case "SPECTATING":
            setSpectating(true);
            addLog("👀 Você desistiu — agora está assistindo.");
            break;
          case "LEFT_ROOM":
            clearSession();
            setSpectating(false);
            setBox(null);
            setIntermission(null);
            setReconnecting(false);
            setPhase("menu");
            addLog("🚪 Você saiu da sala.");
            break;
          case "BID_PLACED":
            addLog(
              `🔨 ${nm(msg.leader)} deu lance de ${money(msg.amount)} em ${msg.boxId}`,
            );
            sfx.gavel();
            setLastBids((prev) => ({ ...prev, [msg.leader]: msg.amount }));
            setBox((prev) =>
              prev && prev.boxId === msg.boxId
                ? {
                    ...prev,
                    currentBid: msg.amount,
                    leader: msg.leader,
                    timerMs: msg.timerMs,
                    deadlineAt: Date.now() + msg.timerMs,
                  }
                : prev,
            );
            break;
          case "BOX_SOLD": {
            addLog(
              `🏆 ${msg.boxId} arrematada por ${nm(msg.winner)} (${money(msg.price)})`,
            );
            sfx.gavel();
            const mine = msg.winner === playerIdRef.current;
            if (mine) {
              setWonBoxes((prev) =>
                prev.some((b) => b.boxId === msg.boxId)
                  ? prev
                  : [...prev, { boxId: msg.boxId, boxType: msg.boxType }],
              );
              fireConfetti();
            }
            setSold(msg.boxId); // carimbo ARREMATADO no baú do palco
            // Troféu só p/ quem venceu; aos demais, o martelo da casa (quem arrematou + preço), sem troféu.
            enqueueOverlay({
              kind: "flash",
              flashKind: "win",
              emoji: mine ? "🏆" : "🔨",
              title: mine ? "Você arrematou!" : `${nm(msg.winner)} arrematou`,
              sub: `${tierLabel(msg.boxType)} por ${money(msg.price)}`,
              durationMs: 2200,
            });
            break;
          }
          case "OPEN_RESULT":
            if (msg.ok) {
              const tier =
                wonBoxesRef.current.find((b) => b.boxId === msg.boxId)
                  ?.boxType ?? "WOODEN";
              setWonBoxes((prev) => prev.filter((b) => b.boxId !== msg.boxId));
              const qty = msg.quantity ?? 1;
              const cursedMimic = !!(msg.isMimic && msg.cursed); // Mímico forçado por Maldição
              openCursedRef.current = cursedMimic;
              // Abertura animada do baú — entra na fila de overlays.
              enqueueOverlay({
                kind: "open",
                tier,
                item: msg.item,
                qty,
                isMimic: msg.isMimic,
                sub: msg.isMimic
                  ? cursedMimic
                    ? "🪤 Você foi amaldiçoado!"
                    : "Cuidado…"
                  : `${qty}× para o inventário`,
                durationMs: 2800,
              });
              sfx.creak();
              if (msg.isMimic) sfx.thud();
              else {
                addLog(
                  `🎁 Você abriu: ${qty}× ${ITEM_NAME[msg.item] ?? msg.item}`,
                ); // mímico é narrado pelo BOX_OPENED
                sfx.fanfare();
                fireConfetti();
              }
              // Prêmio extra: a caixa também trouxe uma carta (vai p/ a mão; entra na fila após a abertura).
              if (msg.card) {
                const c = cardOf(msg.card);
                addLog(`🃏 A caixa também trouxe uma carta: ${c.label}!`);
                enqueueOverlay({
                  kind: "flash",
                  flashKind: "win",
                  emoji: c.emoji,
                  title: "Carta bônus! 🃏",
                  sub: c.label,
                  durationMs: 2400,
                });
                sfx.coin();
              }
            } else
              addLog(`⚠️ Não foi possível abrir ${msg.boxId}: ${msg.reason}`);
            break;
          case "BOX_OPENED": {
            const mine = msg.player === playerIdRef.current;
            if (msg.isMimic) {
              const insured = msg.penaltyKind === "INSURED";
              const curse = mine && openCursedRef.current; // só o alvo sabe que foi maldição
              const pen = penaltyText(
                msg.penaltyKind,
                msg.penaltyDetail,
                msg.penaltyValue ?? 0,
              ); // texto PT
              addLog(
                `💀 ${mine ? "Você" : nm(msg.player)} abriu um MÍMICO${curse ? " 🪤 (Maldição)" : ""} — ${insured ? "Seguro evitou a penalidade 🛡️" : `perdeu ${pen}`}`,
              );
              if (mine)
                patchOpenSub(
                  insured
                    ? "Seguro evitou! 🛡️"
                    : `${curse ? "🪤 Maldição! " : ""}Perdeu ${pen}`,
                );
              else if (!insured) {
                sfx.thud();
                enqueueOverlay({
                  kind: "flash",
                  flashKind: "mimic",
                  emoji: "💀",
                  title: `${nm(msg.player)} pegou um MÍMICO!`,
                  sub: `Perdeu ${pen}`,
                  durationMs: 2600,
                });
              }
            } else if (!mine)
              addLog(
                `📦 ${nm(msg.player)} abriu: ${msg.quantity ?? 1}× ${ITEM_NAME[msg.item] ?? msg.item}`,
              );
            break;
          }
          case "BID_ACCEPTED":
            addLog(
              `✅ Seu lance em ${msg.boxId} foi aceito (atual: ${money(msg.currentBid)})`,
            );
            setBox((prev) =>
              prev && prev.boxId === msg.boxId
                ? {
                    ...prev,
                    currentBid: msg.currentBid,
                    leader: msg.leader,
                    timerMs: msg.timerMs,
                    deadlineAt: Date.now() + msg.timerMs,
                  }
                : prev,
            );
            break;
          case "BID_REJECTED":
            addLog(`❌ Lance rejeitado em ${msg.boxId}: ${msg.reason}`);
            break;
          case "MARKET_UPDATED": {
            setPrices(msg.prices ?? {});
            setPriceHist((h) => pushHist(h, msg.prices ?? {}));
            const ev = msg.event ?? null;
            setMarketEvent(ev);
            const kind = ev?.kind ?? "";
            if (kind && kind !== lastEventKindRef.current) {
              // Evento de mercado NOVO → banner + som (vermelho se for queda/Crash).
              const down = kind === "CRASH";
              enqueueOverlay({ kind: "flash", flashKind: down ? "mimic" : "win", emoji: ev.emoji, title: `${ev.label}!`, sub: ev.desc, durationMs: 2400 });
              if (down) sfx.thud();
              else sfx.coin();
              addLog(`${ev.emoji} Evento de mercado: ${ev.label} — ${ev.desc}`);
            }
            lastEventKindRef.current = kind;
            break;
          }
          case "WALLET_UPDATED":
            setWallet({
              balance: msg.balance ?? 0,
              reserved: msg.reserved ?? 0,
              inventory: msg.inventory ?? [],
              collections: msg.collections ?? [],
              cards: msg.cards ?? [],
            });
            setNextCardPrice(msg.nextCardPrice ?? 0);
            break;
          case "CARD_BOUGHT":
            if (msg.ok) {
              sfx.coin();
              addLog(`🃏 Você comprou: ${cardOf(msg.card).label}`);
            } else
              addLog(
                msg.reason === "INSUFFICIENT"
                  ? "⚠️ Dinheiro insuficiente para a carta."
                  : "⚠️ Mão cheia.",
              );
            break;
          case "CARD_NOTICE":
            if (msg.player !== playerIdRef.current)
              addLog(`🃏 ${nm(msg.player)} comprou uma carta`);
            break;
          case "CARD_PLAYED": {
            const who =
              msg.source === playerIdRef.current ? "Você" : nm(msg.source);
            const d = cardOf(msg.cardType);
            if (msg.source === playerIdRef.current) setPlayedCard(true); // 1 carta por intervalo
            const tgt = msg.target
              ? msg.target === playerIdRef.current
                ? "você"
                : nm(msg.target)
              : "";
            addLog(
              `${d.emoji} ${who} usou ${d.label}${tgt ? ` em ${tgt}` : ""}`,
            );
            enqueueOverlay({
              kind: "flash",
              flashKind: "win",
              emoji: d.emoji,
              title: `${d.label}!`,
              sub: `${who}${tgt ? ` → ${tgt}` : ""}`,
              durationMs: 2200,
            });
            break;
          }
          case "CARD_EFFECTS":
            setCardEffects({
              blocked: msg.blocked ?? [],
              doubleLoot: msg.doubleLoot ?? [],
              insured: msg.insured ?? [],
              cursed: msg.cursed ?? [],
              shielded: msg.shielded ?? [],
              gavel: msg.gavel ?? [],
            });
            break;
          case "INSIGHT": // Visão: o servidor revelou o item que a caixa vai dar
            setInsight({ item: msg.item, quantity: msg.quantity });
            sfx.whoosh();
            addLog(
              `👁️ Visão: a caixa desta rodada vai dar ${msg.item === "MIMIC" ? "um MÍMICO 💀" : `${msg.quantity}× ${ITEM_NAME[msg.item] ?? msg.item}`}`,
            );
            break;
          case "SELL_RESULT":
            if (msg.ok) sfx.coin();
            addLog(
              msg.ok
                ? `💸 Vendeu ${ITEM_NAME[msg.itemType] ?? msg.itemType} por ${money(msg.price)}`
                : `⚠️ Venda falhou: ${msg.reason}`,
            );
            break;
          case "FORM_RESULT":
            if (msg.ok) {
              sfx.fanfare();
              fireConfetti();
            }
            addLog(
              msg.ok
                ? `🏅 Coleção ${collLabel(msg.kind)} formada! +${money(msg.bonus)} no saldo`
                : `⚠️ Não deu para formar ${collLabel(msg.kind)}: ${msg.reason}`,
            );
            break;
          case "ROOM_CLOSED":
            clearSession();
            addLog(
              `⚠️ Sala encerrada${msg.reason === "IDLE" ? " por inatividade" : ""}. Voltando ao menu…`,
            );
            setTimeout(() => window.location.reload(), 1800);
            break;
          case "ERROR": {
            const errors: Record<string, string> = {
              ROOM_FULL: "Sala cheia (máx. 15 jogadores).",
              ROOM_NOT_FOUND: "Sala não encontrada — confira o código.",
              MATCH_ALREADY_STARTED: "A partida já começou.",
              NEED_2_PLAYERS: "São necessários ao menos 2 jogadores.",
              NO_ROOMS_AVAILABLE: "Não há salas livres no momento.",
              ALREADY_PLAYED_CARD: "Você só pode jogar 1 carta por intervalo.",
              MONEY_TOO_HIGH: "Falência: só com saldo ≤ $200.",
              NO_CARD: "Você não tem essa carta.",
            };
            addLog(`⚠️ ${errors[msg.reason] ?? msg.reason}`);
            break;
          }
        }
      };
    },
    [name, addLog],
  );

  // NÃO fechar o socket no cleanup de desmontagem: em DEV o StrictMode monta→desmonta→remonta,
  // e fechar aqui mataria o socket de reconexão recém-criado pelo efeito abaixo (ficava preso no
  // "Reconectando…"). O navegador já fecha o socket ao descarregar a página.

  // Ao abrir o app: se há uma sessão salva, tenta voltar à sala (refresh/queda). Falha → menu.
  const autoResumed = useRef(false);
  useEffect(() => {
    if (autoResumed.current) return;
    autoResumed.current = true;
    const s = loadSession();
    if (s?.playerId && s.room) {
      setReconnecting(true);
      connect({ kind: "resume", session: s });
    }
  }, [connect]);

  // Rede de segurança: se a reconexão não concluir em alguns segundos (mensagem perdida,
  // gateway indisponível, etc.), desiste sozinha — nunca trava no "Reconectando…" eterno.
  useEffect(() => {
    if (!reconnecting) return;
    const t = setTimeout(() => {
      clearSession();
      setReconnecting(false);
      setPhase("menu");
      addLog("Não foi possível reconectar — comece uma nova sala.");
    }, 8000);
    return () => clearTimeout(t);
  }, [reconnecting, addLog]);

  const [, setTick] = useState(0);
  const boxRef = useRef<Box | null>(null);
  boxRef.current = box; // espelho do box p/ o intervalo (tique nos segundos finais)
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      const b = boxRef.current;
      if (b?.leader && b.deadlineAt) {
        const rem = b.deadlineAt - Date.now();
        const sec = Math.ceil(rem / 1000);
        if (rem > 0 && rem <= 5000 && sec !== lastTickRef.current) {
          lastTickRef.current = sec;
          sfx.tick();
        }
      } else {
        lastTickRef.current = -1;
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  // Enfileira um overlay (descarta excesso para um surto não prender a tela).
  const enqueueOverlay = useCallback((item: OverlayInput) => {
    setOverlayQueue((q) =>
      q.length >= 6
        ? q
        : [...q, { ...item, id: ++overlayIdRef.current } as OverlayItem],
    );
  }, []);
  // Atualiza o subtítulo da abertura já enfileirada (ex.: penalidade do Mímico chega depois).
  const patchOpenSub = useCallback((sub: string) => {
    setOverlayQueue((q) =>
      q.map((it) => (it.kind === "open" ? { ...it, sub } : it)),
    );
  }, []);
  // Driver da fila: mostra a CABEÇA pelo seu tempo e então avança. Reinicia só quando a cabeça muda
  // (enfileirar atrás não reinicia o timer do item atual).
  const overlayHead = overlayQueue[0];
  const headId = overlayHead?.id;
  useEffect(() => {
    if (!overlayHead) return;
    const t = setTimeout(
      () => setOverlayQueue((q) => (q[0]?.id === headId ? q.slice(1) : q)),
      overlayHead.durationMs,
    );
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headId]);

  useEffect(() => {
    wonBoxesRef.current = wonBoxes; // p/ resgatar o tier do baú aberto na abertura
  }, [wonBoxes]);

  const toggleMute = () => {
    const m = !muted;
    setMutedState(m);
    sfx.setMuted(m);
  };
  const copyCode = () => {
    navigator.clipboard
      ?.writeText(code)
      .then(() => {
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 1500);
      })
      .catch(() =>
        addLog("Não foi possível copiar — copie o código manualmente."),
      );
  };
  // Copia um LINK de convite (código embutido): o convidado abre e só digita o nome.
  const copyInvite = () => {
    navigator.clipboard
      ?.writeText(inviteUrl(code))
      .then(() => {
        setCopiedInvite(true);
        setTimeout(() => setCopiedInvite(false), 1500);
      })
      .catch(() =>
        addLog("Não foi possível copiar — copie o link manualmente."),
      );
  };
  // Aborta a reconexão e volta ao menu (limpa a sessão salva e fecha o socket).
  const cancelReconnect = () => {
    try {
      wsRef.current?.close();
    } catch {
      /* nada a fechar */
    }
    clearSession();
    setReconnecting(false);
    setPhase("menu");
  };
  // Sai da sala de vez e volta ao menu (o servidor responde LEFT_ROOM).
  const leaveRoom = () => {
    setConfirmDialog({
      title: "Sair da sala?",
      body: "Você volta ao menu e sai do ranking desta partida.",
      yes: "Sair",
      onYes: () => {
        send({ type: "LEAVE_ROOM" });
        clearSession();
      },
    });
  };
  const giveUp = () => {
    setConfirmDialog({
      title: "Desistir da partida?",
      body: "Você passa a só assistir e não poderá mais dar lances (continua no ranking).",
      yes: "Desistir",
      onYes: () => send({ type: "GIVE_UP" }),
    });
  };
  // Botões de controle da partida — reusados: no desktop ficam no card "Você"; no mobile vão
  // para o rodapé da página (evita toque acidental). Espectador só tem "Sair da sala".
  const matchControlButtons = spectating ? (
    <button className={`${C.btnSmall} w-full`} onClick={leaveRoom}>
      🚪 Sair da sala
    </button>
  ) : (
    <>
      {isHost && (
        <button
          className={`${C.btnSmall} w-full`}
          onClick={() => send({ type: "END_MATCH" })}
        >
          Encerrar partida
        </button>
      )}
      <button className={`${C.btnSmall} w-full`} onClick={giveUp}>
        Desistir (assistir)
      </button>
    </>
  );

  const boxCountdown = (b: Box): string => {
    if (!b.leader || !b.deadlineAt) return "—";
    return `${Math.max(0, Math.ceil((b.deadlineAt - Date.now()) / 1000))}s`;
  };
  const intermissionCountdown = (endsAt: number): string => {
    const s = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };
  // Pregão "dou-lhe uma, dou-lhe duas…" nos segundos finais (só com líder).
  const goingCall = (b: Box): string | null => {
    if (!b.leader || !b.deadlineAt) return null;
    const rem = b.deadlineAt - Date.now();
    if (rem <= 0) return null;
    if (rem <= 2000) return "Dou-lhe três!";
    if (rem <= 4000) return "Dou-lhe duas…";
    if (rem <= 6500) return "Dou-lhe uma…";
    return null;
  };

  const placeBid = (boxId: string, amount: number) =>
    send({ type: "PLACE_BID", boxId, amount });
  const sendOpen = (boxId: string) => send({ type: "OPEN_BOX", boxId });
  const sell = (itemId: string) => send({ type: "SELL_ITEM", itemId });
  const form = (kind: string) => send({ type: "FORM_COLLECTION", kind });
  const buyCardAction = () => send({ type: "BUY_CARD" });
  const sendEmote = (emoji: string) => send({ type: "EMOTE", emoji });
  const playCard = (cardType: string, target?: string) => {
    // Falência só vale com saldo baixo — avisa na hora (o servidor é a verdade e também recusa).
    if (
      cardType === "FALENCIA" &&
      (wallet?.balance ?? 0) > BANKRUPTCY_THRESHOLD
    ) {
      addLog(`⚠️ Falência: só com saldo ≤ ${money(BANKRUPTCY_THRESHOLD)}.`);
      return;
    }
    send({ type: "PLAY_CARD", cardType, target });
    setTargeting(null);
  };

  const freeCount = (type: string): number =>
    wallet?.inventory.filter((i) => i.type === type && i.state === "FREE")
      .length ?? 0;
  const canForm = (requires: Record<string, number>): boolean =>
    Object.entries(requires).every(([t, n]) => freeCount(t) >= n);

  return (
    <div className="max-w-6xl mx-auto px-3 sm:px-5 py-4 sm:py-7">
      <header className="flex items-center sm:items-end justify-between gap-2 sm:gap-3 border-b border-line pb-3 sm:pb-4">
        <div className="min-w-0">
          <h1 className="font-display text-2xl sm:text-4xl font-bold text-gold leading-none flex items-center gap-1.5 sm:gap-2">
            <Gavel size={40} className="shrink-0 w-7 h-7 sm:w-10 sm:h-10" />{" "}
            <span className="truncate">Hammer Price</span>
          </h1>
          <p className="text-muted text-sm mt-1 hidden sm:block">
            Leilão de caixas misteriosas em tempo real
          </p>
        </div>
        <div className="flex items-center sm:items-end gap-2 sm:gap-3 shrink-0">
          {phase === "playing" && (
            <div className="text-right">
              <div className="text-base sm:text-2xl font-bold text-gold tabular-nums whitespace-nowrap">
                <span className="hidden sm:inline">Rodada </span>
                {Math.min(matchRounds.played + 1, matchRounds.total)}/
                {matchRounds.total}
              </div>
              <div className="text-xs text-muted hidden sm:block">
                Sala {code}
              </div>
            </div>
          )}
          <button
            className={C.btnSmall}
            onClick={() => setShowCheats(true)}
            title="Cartas (referência)"
          >
            🃏<span className="hidden sm:inline"> Cartas</span>
          </button>
          <button
            className={C.btnSmall}
            onClick={toggleMute}
            title={muted ? "Ativar som" : "Silenciar"}
          >
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      {/* ---------- MENU / BOAS-VINDAS ---------- */}
      {reconnecting && (
        <div className="fixed inset-0 z-70 flex items-center justify-center bg-ink/92 px-4">
          <div className="text-center">
            <motion.div
              className="text-5xl"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1.4, ease: "linear" }}
            >
              🔄
            </motion.div>
            <div className="text-gold font-display text-2xl mt-4">
              Reconectando à sua sala…
            </div>
            <div className="text-muted text-sm mt-1">
              Voltando de onde você parou.
            </div>
            <button className={`${C.btnSmall} mt-6`} onClick={cancelReconnect}>
              Cancelar e começar de novo
            </button>
          </div>
        </div>
      )}

      {phase === "menu" && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="mt-8 sm:mt-12 flex flex-col items-center gap-12 sm:gap-16 pb-16"
        >
          {/* ----- HERO ----- */}
          <div className="text-center max-w-2xl order-1">
            <motion.h2
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{
                delay: 0.05,
                type: "spring",
                stiffness: 120,
                damping: 16,
              }}
              className="font-display text-4xl sm:text-6xl text-gold leading-tight"
            >
              Arremate. Abra. Enriqueça.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
              className="text-stone-300 mt-4 text-base sm:text-lg"
            >
              Um{" "}
              <b className="text-gold-soft">
                leilão de baús misteriosos em tempo real
              </b>
              . Dispute cada lote, abra o que arrematar, jogue cartas para virar
              o jogo — e termine com o maior patrimônio da mesa.
            </motion.p>
          </div>

          {/* ----- BAÚS (com dica de prêmio) ----- */}
          <section className="w-full max-w-3xl order-3">
            <h3 className="text-center text-gold/80 font-semibold uppercase tracking-[0.2em] text-xs mb-5">
              Os baús
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {["WOODEN", "IRON", "ROYAL", "VAULT", "JACKPOT", "MYSTERY"].map((t, i) => (
                <motion.div
                  key={t}
                  initial={{ y: 18, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.1 + i * 0.07 }}
                  className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-surface/60 p-4"
                  style={{ ["--rarity" as string]: tierLight(t) }}
                >
                  <motion.div
                    animate={{ y: [0, -5, 0] }}
                    transition={{
                      repeat: Infinity,
                      duration: 2.6 + i * 0.2,
                      ease: "easeInOut",
                    }}
                  >
                    <Chest tier={t} size={64} />
                  </motion.div>
                  <div className="font-semibold text-sm text-stone-100">
                    {tierLabel(t)}
                  </div>
                  <div className="text-[11px] text-muted text-center leading-snug">
                    {TIER_HINT[t]}
                  </div>
                </motion.div>
              ))}
            </div>
            <p className="text-center text-[11px] text-muted mt-3">
              Cada baú mostra as probabilidades reais de prêmio antes do lance.
            </p>
          </section>

          {/* ----- COMO JOGAR (4 passos) ----- */}
          <section className="w-full max-w-4xl order-4">
            <h3 className="text-center text-gold/80 font-semibold uppercase tracking-[0.2em] text-xs mb-5">
              Como jogar
            </h3>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {HOW_TO_PLAY.map((s, i) => (
                <motion.div
                  key={i}
                  initial={{ y: 18, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  transition={{ delay: 0.12 + i * 0.07 }}
                  className="rounded-2xl border border-line bg-surface/60 p-4 text-center"
                >
                  <div className="text-3xl">{s.icon}</div>
                  <div className="font-semibold text-sm text-stone-100 mt-2">
                    {s.title}
                  </div>
                  <div className="text-xs text-muted mt-1 leading-snug">
                    {s.text}
                  </div>
                </motion.div>
              ))}
            </div>
          </section>

          {/* ----- VITRINE DAS CARTAS ----- */}
          <section className="w-full max-w-4xl order-5">
            <h3 className="text-center text-gold/80 font-semibold uppercase tracking-[0.2em] text-xs mb-1">
              Cartas de habilidade
            </h3>
            <p className="text-center text-xs text-muted mb-5">
              Compradas com dinheiro e guardadas na mão. Jogue{" "}
              <b className="text-stone-200">1 por intervalo</b> para virar a
              próxima rodada.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {Object.keys(CARDS).map((c, i) => (
                <motion.div
                  key={c}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1 + i * 0.04 }}
                >
                  <Card type={c} size={52} />
                </motion.div>
              ))}
            </div>
          </section>

          {/* ----- CTA: entrar / criar (logo após o hero, visível ao abrir) ----- */}
          <section
            className={`${C.card} box-glow p-6 w-full max-w-md flex flex-col gap-4 order-2`}
          >
            <div className="text-center">
              <div className="font-display text-2xl text-gold">
                Entre na mesa
              </div>
              <p className="text-xs text-muted mt-0.5">
                Crie uma sala e convide, ou entre com um código. 2 a 15
                jogadores.
              </p>
            </div>
            {INVITE_PARAM && (
              <div className="bg-gold/10 border border-gold-dim rounded-lg px-3 py-2 text-center text-sm">
                Você foi convidado para a sala{" "}
                <b className="text-gold tracking-widest">{INVITE_PARAM}</b> —
                digite seu nome e entre.
              </div>
            )}
            <div>
              <label className="text-xs uppercase tracking-wide text-muted">
                Seu nome
              </label>
              <input
                className={`${C.input} mt-1`}
                placeholder="ex.: ana"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus={!!INVITE_PARAM}
              />
              {!name.trim() && (
                <p className="text-xs text-muted mt-1">
                  Digite um nome para jogar.
                </p>
              )}
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted">
                Rodadas (ao criar)
              </label>
              <select
                className={`${C.input} mt-1`}
                value={roundsToCreate}
                onChange={(e) => setRoundsToCreate(Number(e.target.value))}
              >
                {[8, 12, 16, 20, 24, 32].map((n) => (
                  <option key={n} value={n}>
                    {n} rodadas
                  </option>
                ))}
              </select>
            </div>
            <button
              className={`${C.btnGold} text-base py-2.5`}
              disabled={!name.trim()}
              onClick={() =>
                connect({ kind: "create", rounds: roundsToCreate })
              }
            >
              🔨 Criar sala
            </button>
            <div className="flex items-center gap-3 text-muted text-xs">
              <span className="h-px flex-1 bg-line" /> ou entre numa sala{" "}
              <span className="h-px flex-1 bg-line" />
            </div>
            <div className="flex gap-2">
              <input
                className={`${C.input} uppercase tracking-widest text-center`}
                placeholder="CÓDIGO"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              />
              <button
                className={`${C.btnSmall} whitespace-nowrap`}
                disabled={!name.trim() || !joinCode.trim()}
                onClick={() => connect({ kind: "join", code: joinCode.trim() })}
              >
                Entrar
              </button>
            </div>
            <p className="text-[11px] text-muted text-center">
              A partida começa quando o anfitrião iniciar.
            </p>
          </section>
        </motion.div>
      )}

      {/* ---------- LOBBY ---------- */}
      {phase === "lobby" && (
        <div className="max-w-md mx-auto mt-8 flex flex-col gap-4">
          <div className={`${C.card} p-6 text-center`}>
            <p className="text-xs uppercase tracking-wide text-muted">
              Código da sala
            </p>
            <div className="flex items-center gap-2 my-2">
              <div className="font-display text-4xl sm:text-5xl text-gold tracking-[0.15em] sm:tracking-[0.25em]">
                {code}
              </div>
              <div className="flex flex-col items-stretch gap-2 w-44">
                <button
                  className={`${C.btnSmall} text-xs`}
                  onClick={copyCode}
                  title="Copiar o código"
                >
                  {copiedCode ? "✓ copiado" : "📋 copiar código"}
                </button>
                <button
                  className={`${C.btnSmall} text-xs`}
                  onClick={copyInvite}
                  title="Copiar link de convite (código embutido)"
                >
                  {copiedInvite ? "✓ link copiado" : "🔗 copiar convite"}
                </button>
              </div>
            </div>
            <p className="text-muted text-sm mb-5">
              Compartilhe o código ou o link de convite. A partida exige ao
              menos 2 jogadores.
            </p>
            <div className="text-left bg-surface-2 border border-line rounded-xl p-4 mb-5">
              <div className="text-sm text-muted mb-2">
                Jogadores ({lobby.players.length}/15)
              </div>
              <ul className="flex flex-col gap-1">
                {lobby.players.map((p) => (
                  <li key={p} className="flex items-center gap-2">
                    <span
                      className={
                        p === playerId ? "text-gold font-semibold" : ""
                      }
                    >
                      {nm(p)}
                    </span>
                    {p === lobby.host && <span title="host">👑</span>}
                    {p === playerId && (
                      <span className="text-xs text-muted">(você)</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            {isHost ? (
              <div className="flex flex-col gap-2">
                <button
                  className={`${C.btnGold} w-full`}
                  disabled={lobby.players.length < 2}
                  onClick={() => send({ type: "START_MATCH" })}
                >
                  {lobby.players.length < 2
                    ? "Aguardando jogadores…"
                    : "Iniciar partida"}
                </button>
                <button
                  className={`${C.btnSmall} w-full text-red-300 border-red-500/40 hover:border-red-400`}
                  onClick={() => send({ type: "CLOSE_ROOM" })}
                >
                  Encerrar sala
                </button>
              </div>
            ) : (
              <p className="text-muted">Aguardando o host iniciar…</p>
            )}
          </div>
          <ChatPanel
            messages={chat}
            me={playerId}
            onSend={(t) => send({ type: "CHAT_SEND", text: t })}
          />
        </div>
      )}

      {/* ---------- PARTIDA ---------- */}
      {phase === "playing" && (
        <>
          <div className="mt-5 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
            {/* ----- ESQUERDA: você + mesa ----- */}
            <aside className="order-2 lg:order-1 flex flex-col gap-4">
              {wallet && (
                <div className={`${C.card} p-4`}>
                  <div className="text-sm text-muted mb-2">💼 Você</div>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted">💰 Saldo</span>
                      <b className="text-gold">{money(wallet.balance)}</b>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">🔒 Reservado</span>
                      <span>{money(wallet.reserved)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">🟢 Gastável</span>
                      <b className="text-emerald-400">
                        {money(wallet.balance - wallet.reserved)}
                      </b>
                    </div>
                  </div>
                  {spectating && (
                    <div className="mt-3 text-center text-xs text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg py-1.5">
                      👀 Assistindo
                    </div>
                  )}
                  {/* Botões: no desktop ficam aqui; no mobile vão p/ o rodapé (ver abaixo). */}
                  <div className="mt-3 hidden sm:flex flex-col gap-2">
                    {matchControlButtons}
                  </div>
                </div>
              )}

              {/* Cartas de habilidade */}
              {wallet && (
                <div className={`${C.card} p-4 flex flex-col gap-2`}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted">🃏 Cartas</span>
                    {!spectating &&
                      (() => {
                        const handFull = wallet.cards.length >= HAND_MAX;
                        const tooPoor =
                          wallet.balance - wallet.reserved < nextCardPrice;
                        return (
                          <button
                            className={C.btnSmall}
                            disabled={handFull || tooPoor}
                            title={
                              handFull
                                ? `Mão cheia (máx. ${HAND_MAX})`
                                : tooPoor
                                  ? "Saldo insuficiente"
                                  : ""
                            }
                            onClick={buyCardAction}
                          >
                            {handFull
                              ? `Mão cheia (${wallet.cards.length}/${HAND_MAX})`
                              : `Comprar (${money(nextCardPrice)})`}
                          </button>
                        );
                      })()}
                  </div>

                  {(cardEffects.blocked.includes(playerId) ||
                    cardEffects.doubleLoot.includes(playerId) ||
                    cardEffects.insured.includes(playerId) ||
                    cardEffects.shielded.includes(playerId) ||
                    cardEffects.gavel.length > 0) && (
                    <div className="flex flex-wrap gap-1 text-[11px]">
                      {cardEffects.blocked.includes(playerId) && (
                        <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">
                          🚫 Bloqueado
                        </span>
                      )}
                      {cardEffects.doubleLoot.includes(playerId) && (
                        <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                          ✖️2 Dobro
                        </span>
                      )}
                      {cardEffects.insured.includes(playerId) && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                          🛡️ Seguro
                        </span>
                      )}
                      {cardEffects.shielded.includes(playerId) && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          ⛓️ Escudo
                        </span>
                      )}
                      {cardEffects.gavel.includes(playerId) && (
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          🔨 Martelo
                        </span>
                      )}
                      {cardEffects.gavel.length > 0 &&
                        !cardEffects.gavel.includes(playerId) && (
                          <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-200/80 border border-amber-500/20">
                            🔨 incremento 2×
                          </span>
                        )}
                    </div>
                  )}

                  {wallet.cards.length === 0 ? (
                    <div className="text-xs text-muted">
                      Sem cartas. Compre uma — o efeito vale para a próxima
                      rodada.
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {wallet.cards.map((card, i) => (
                        <div
                          key={i}
                          className="flex flex-col items-center gap-1"
                        >
                          <Card type={card} size={54} dim={spectating} />
                          {!spectating && (
                            <button
                              className={`${C.btnSmall} text-[11px] px-2 py-0.5`}
                              disabled={!intermission || playedCard}
                              title={
                                !intermission
                                  ? "jogue no intervalo"
                                  : playedCard
                                    ? "1 carta por intervalo"
                                    : ""
                              }
                              onClick={() =>
                                cardOf(card).targeted
                                  ? setTargeting(card)
                                  : playCard(card)
                              }
                            >
                              Usar
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {intermission && playedCard && !spectating && (
                    <div className="text-[11px] text-amber-300/90">
                      ✓ Carta jogada — só 1 por intervalo.
                    </div>
                  )}
                  {!intermission && wallet.cards.length > 0 && !spectating && (
                    <div className="text-[11px] text-muted">
                      Jogue no intervalo (vale p/ a próxima rodada).
                    </div>
                  )}
                </div>
              )}

              {/* Mesa — só nome + dinheiro de cada jogador (sem revelar itens/lances) */}
              {players.length > 0 && (
                <div className={`${C.card} p-4`}>
                  <div className="text-sm text-muted mb-2">🃏 Mesa</div>
                  <div className="flex flex-col gap-1">
                    {[...players]
                      .sort((a, b) => b.money - a.money)
                      .map((p) => (
                        <div
                          key={p.id}
                          className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${p.id === playerId ? "bg-gold/10" : ""}`}
                        >
                          <span
                            className={`flex-1 truncate ${p.id === playerId ? "text-gold font-semibold" : ""} ${p.spectating ? "opacity-50" : ""}`}
                          >
                            {nm(p.id)}
                            {p.id === playerId ? " (você)" : ""}
                            {p.spectating ? " 👀" : ""}
                          </span>
                          <span className="whitespace-nowrap">
                            💰 <b className="text-gold">{money(p.money)}</b>
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </aside>

            {/* ----- CENTRO: palco da casa de leilão ----- */}
            <main className="order-1 lg:order-2 flex flex-col gap-3">
              <div
                className="stage min-h-90 flex items-center justify-center px-[15%] py-8"
                style={{
                  ["--rarity" as string]: tierLight(box?.boxType ?? "WOODEN"),
                }}
              >
                <div className="curtain curtain-l" />
                <div className="curtain curtain-r" />
                <div className="curtain-top" />
                <div className="stage-spot" />
                <div className="stage-floor" />
                {box &&
                  !spectating &&
                  cardEffects.blocked.includes(playerId) && (
                    <div className="absolute inset-0 z-6 flex items-start justify-center pt-3 bg-red-950/45 pointer-events-none">
                      <span className="px-3 py-1 rounded-full bg-red-900/85 border border-red-600 text-red-100 text-xs font-semibold">
                        🚫 Bloqueado nesta rodada
                      </span>
                    </div>
                  )}
                <AnimatePresence mode="wait">
                  {box ? (
                    <motion.div
                      key={box.boxId}
                      initial={{ scale: 0.6, opacity: 0, y: 14 }}
                      animate={{ scale: 1, opacity: 1, y: 0 }}
                      exit={{ scale: 0.6, opacity: 0 }}
                      transition={{
                        type: "spring",
                        stiffness: 260,
                        damping: 20,
                      }}
                      className="relative z-4 w-full max-w-75 text-center flex flex-col items-center gap-1.5"
                    >
                      {/* baú flutuando + anel de contagem + carimbo ARREMATADO */}
                      <div className="relative w-37.5 h-37.5 flex items-center justify-center">
                        <motion.div
                          animate={{ y: [0, -7, 0] }}
                          transition={{
                            repeat: Infinity,
                            duration: 2.4,
                            ease: "easeInOut",
                          }}
                        >
                          <Chest tier={box.boxType} size={138} />
                        </motion.div>
                        {box.leader && box.deadlineAt
                          ? (() => {
                              const rem = Math.max(
                                0,
                                box.deadlineAt - Date.now(),
                              );
                              // Denominador = duração REAL do ciclo atual (box.timerMs, já com extensões
                              // de anti-sniping) → o anel começa CHEIO e esvazia certo. (Antes usava um
                              // BID_TIMER_MS fixo de 20s com timer real de 12s → começava ~60%.)
                              const full =
                                box.timerMs > 0 ? box.timerMs : BID_TIMER_MS;
                              const frac = Math.min(1, rem / full);
                              const R = 68;
                              const circ = 2 * Math.PI * R;
                              const danger = rem <= 5000;
                              return (
                                <svg
                                  className="absolute inset-0 -rotate-90"
                                  width="150"
                                  height="150"
                                  viewBox="0 0 150 150"
                                >
                                  <circle
                                    cx="75"
                                    cy="75"
                                    r={R}
                                    fill="none"
                                    stroke="rgba(255,255,255,0.07)"
                                    strokeWidth="3"
                                  />
                                  <circle
                                    cx="75"
                                    cy="75"
                                    r={R}
                                    fill="none"
                                    stroke={
                                      danger ? "#ef4444" : "var(--rarity)"
                                    }
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    strokeDasharray={circ}
                                    strokeDashoffset={circ * (1 - frac)}
                                  />
                                </svg>
                              );
                            })()
                          : null}
                        {sold === box.boxId && (
                          <motion.div
                            initial={{ scale: 2.2, rotate: -28, opacity: 0 }}
                            animate={{ scale: 1, rotate: -13, opacity: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 300,
                              damping: 11,
                            }}
                            className="absolute inset-0 flex items-center justify-center pointer-events-none"
                          >
                            <span className="stamp">ARREMATADO</span>
                          </motion.div>
                        )}
                      </div>
                      <div className="font-display text-xl text-gold">
                        {tierLabel(box.boxType)}
                      </div>
                      <div className="text-[11px] text-stone-400">
                        {box.boxType === "MYSTERY"
                          ? "🎲 Odds ocultas — pura sorte"
                          : ITEM_ORDER.filter((k) => (box.odds?.[k] ?? 0) > 0)
                              .map((k) => `${ITEM_EMOJI[k]} ${box.odds[k]}%`)
                              .join("  ")}
                      </div>
                      <motion.div
                        key={box.currentBid}
                        initial={{ scale: 1.35 }}
                        animate={{ scale: 1 }}
                        className="text-2xl font-bold text-gold mt-0.5"
                      >
                        {box.currentBid > 0
                          ? `💰 ${money(box.currentBid)}`
                          : "sem lances"}
                      </motion.div>
                      <div className="text-sm">
                        líder:{" "}
                        <b
                          className={box.leader === playerId ? "text-gold" : ""}
                        >
                          {box.leader ? nm(box.leader) : "—"}
                        </b>
                      </div>
                      {foldState.folded > 0 && (
                        <div className="text-xs text-stone-400">
                          🙅 {foldState.folded}/{foldState.total} passaram
                        </div>
                      )}
                      <div className="h-6 flex items-center">
                        {(() => {
                          const call = goingCall(box);
                          if (call)
                            return (
                              <motion.div
                                key={call}
                                initial={{ scale: 0.6, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                className="text-red-400 font-display font-bold"
                              >
                                {call}
                              </motion.div>
                            );
                          return (
                            <div className="text-sm text-muted tabular-nums">
                              {box.leader
                                ? `⏱ ${boxCountdown(box)}`
                                : "aguardando o 1º lance…"}
                            </div>
                          );
                        })()}
                      </div>
                    </motion.div>
                  ) : (
                    <motion.div
                      key="intermission"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="relative z-4 w-full max-w-75 text-center flex flex-col items-center gap-3"
                    >
                      <div className="text-muted">
                        ⏳ Intervalo — venda, forme coleções, jogue cartas
                      </div>
                      <div className="text-5xl font-bold text-gold tabular-nums">
                        {intermission
                          ? intermissionCountdown(intermission.endsAt)
                          : "—"}
                      </div>
                      <div className="text-sm text-muted">
                        {readyState.ready}/{readyState.total} prontos
                      </div>
                      <button
                        className={`${C.btnGold} w-full`}
                        disabled={iAmReady || !intermission}
                        onClick={() => {
                          send({ type: "READY" });
                          setIAmReady(true);
                        }}
                      >
                        {iAmReady ? "Pronto ✓" : "Estou pronto"}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Carta Visão: o item pré-sorteado da caixa desta rodada (só o portador recebe). */}
              {box && insight && !spectating && (
                <div className="rounded-lg border border-fuchsia-500/40 bg-fuchsia-500/10 px-3 py-2 text-center text-sm text-fuchsia-200">
                  👁️ Visão: esta caixa vai dar{" "}
                  {insight.item === "MIMIC" ? (
                    <b className="text-red-300">um MÍMICO 💀</b>
                  ) : (
                    <b className="text-fuchsia-100">
                      {insight.quantity}×{" "}
                      {ITEM_NAME[insight.item] ?? insight.item}
                    </b>
                  )}
                </div>
              )}

              {/* Controles de lance / passar — abaixo do palco. Espectador não vê. */}
              {box &&
                !spectating &&
                (cardEffects.blocked.includes(playerId) ? (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="rounded-2xl border-2 border-red-700/70 bg-red-950/70 p-4 text-center shake"
                  >
                    <div className="text-4xl">🚫</div>
                    <div className="font-display text-xl text-red-300 mt-1">
                      Você está BLOQUEADO
                    </div>
                    <div className="text-sm text-red-200/80 mt-0.5">
                      Um rival jogou Bloqueio — você não pode dar lances nesta
                      rodada.
                    </div>
                  </motion.div>
                ) : folded ? (
                  <div
                    className={`${C.card} p-3 text-center text-sm text-muted`}
                  >
                    🙅 Você passou nesta rodada ·{" "}
                    <b className="text-stone-300">
                      {foldState.folded}/{foldState.total || "?"}
                    </b>{" "}
                    passaram
                  </div>
                ) : (
                  (() => {
                    // Carta Martelo: se o Martelo está ativo e eu NÃO o joguei, meu incremento dobra.
                    const gavelOnMe =
                      cardEffects.gavel.length > 0 &&
                      !cardEffects.gavel.includes(playerId);
                    const minInc =
                      Math.max(5, Math.floor(box.currentBid * 0.05)) *
                      (gavelOnMe ? 2 : 1);
                    const minNext = box.currentBid + minInc;
                    const customVal = Number(bidAmount);
                    const customOk = bidAmount === "" || customVal >= minNext;
                    const bidValue = bidAmount === "" ? minNext : customVal;
                    const iAmLeader = box.leader === playerId;
                    return (
                      <div className={`${C.card} p-3 flex flex-col gap-2`}>
                        <div className="text-xs text-muted text-center">
                          lance mínimo:{" "}
                          <b className="text-gold">{money(minNext)}</b>
                          {gavelOnMe && (
                            <span className="text-amber-300"> 🔨 (2×)</span>
                          )}
                        </div>
                        <div className="grid grid-cols-4 gap-2">
                          <button
                            className={C.btnSmall}
                            onClick={() => placeBid(box.boxId, minNext)}
                          >
                            Mín
                          </button>
                          {[10, 50, 100].map((n) => (
                            <button
                              key={n}
                              className={C.btnSmall}
                              disabled={box.currentBid + n < minNext}
                              onClick={() =>
                                placeBid(box.boxId, box.currentBid + n)
                              }
                            >
                              +{n}
                            </button>
                          ))}
                        </div>
                        <div className="flex gap-2">
                          <input
                            className={`${C.input} text-center`}
                            type="number"
                            placeholder={`${minNext}`}
                            value={bidAmount}
                            onChange={(e) => setBidAmount(e.target.value)}
                          />
                          <button
                            className={`${C.btnGold} whitespace-nowrap`}
                            disabled={!customOk}
                            onClick={() => placeBid(box.boxId, bidValue)}
                          >
                            Dar lance
                          </button>
                        </div>
                        {!iAmLeader && (
                          <button
                            className={`${C.btnSmall} w-full`}
                            onClick={() => {
                              setFolded(true);
                              send({ type: "FOLD" });
                            }}
                          >
                            Passar{" "}
                            {foldState.folded > 0
                              ? `· ${foldState.folded}/${foldState.total} passaram`
                              : ""}
                          </button>
                        )}
                      </div>
                    );
                  })()
                ))}

              {wonBoxes.length > 0 && (
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="bg-gold/10 border border-gold-dim rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 justify-center"
                >
                  <b className="text-gold">🎉 Você arrematou! Abra:</b>
                  {wonBoxes.map((b) => (
                    <button
                      key={b.boxId}
                      className={C.btnGold}
                      disabled={spectating}
                      onClick={() => sendOpen(b.boxId)}
                    >
                      Abrir {CHEST_GLYPH} {tierLabel(b.boxType)}
                    </button>
                  ))}
                </motion.div>
              )}
            </main>

            {/* ----- DIREITA: mercado + inventário + coleções + eventos ----- */}
            <aside className="order-3 flex flex-col gap-4">
              {PRICED.some((k) => prices[k] != null) && (
                <div className={`${C.card} p-4`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-muted">📈 Mercado</span>
                    <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />{" "}
                      ao vivo
                    </span>
                  </div>
                  {marketEvent && (
                    <div
                      className={`mb-2 text-center text-[11px] rounded-md px-2 py-1 border ${marketEvent.kind === "CRASH" ? "bg-red-500/15 border-red-500/40 text-red-300" : "bg-amber-500/15 border-amber-500/40 text-amber-300"}`}
                    >
                      {marketEvent.emoji} <b>{marketEvent.label}</b> — {marketEvent.desc}
                    </div>
                  )}
                  <div className="flex flex-col gap-1.5">
                    {PRICED.filter((k) => prices[k] != null).map((k) => {
                      const hist = priceHist[k] ?? [prices[k]];
                      const prev =
                        hist.length > 1 ? hist[hist.length - 2] : prices[k];
                      const delta = prices[k] - prev;
                      const col =
                        delta > 0
                          ? "#34d399"
                          : delta < 0
                            ? "#f87171"
                            : "#a8a29e"; // verde sobe, vermelho cai
                      return (
                        <div
                          key={k}
                          className="flex items-center gap-2 text-sm"
                        >
                          <span className="w-5 text-center shrink-0">
                            {ITEM_EMOJI[k]}
                          </span>
                          <span className="text-muted">{ITEM_NAME[k]}</span>
                          <div className="ml-auto">
                            <Sparkline values={hist} color={col} />
                          </div>
                          <motion.span
                            key={prices[k]}
                            initial={{ scale: 1.3 }}
                            animate={{ scale: 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 400,
                              damping: 14,
                            }}
                            className="tabular-nums font-semibold w-12 text-right"
                            style={{ color: col }}
                          >
                            {money(prices[k])}
                          </motion.span>
                          <span
                            className="w-12 text-right text-xs tabular-nums shrink-0"
                            style={{ color: col }}
                          >
                            {delta > 0 ? "▲" : delta < 0 ? "▼" : "–"}
                            {delta !== 0
                              ? ` ${delta > 0 ? "+" : ""}${delta}`
                              : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Inventário */}
              {wallet && wallet.inventory.length > 0 && (
                <div className={`${C.card} p-4 flex flex-col gap-2`}>
                  <div className="text-sm text-muted">🎒 Inventário</div>
                  {ITEM_ORDER.filter((t) =>
                    wallet.inventory.some((i) => i.type === t),
                  ).map((t) => {
                    const count = wallet.inventory.filter(
                      (i) => i.type === t,
                    ).length;
                    const locked = wallet.inventory.filter(
                      (i) => i.type === t && i.state !== "FREE",
                    ).length;
                    const firstFree = wallet.inventory.find(
                      (i) => i.type === t && i.state === "FREE",
                    );
                    return (
                      <div key={t} className="flex items-center gap-2 text-sm">
                        <span className="flex-1">
                          {ITEM_EMOJI[t]} {t} ×{count}
                          {locked > 0 ? (
                            <span className="text-muted"> ({locked}🔒)</span>
                          ) : (
                            ""
                          )}
                        </span>
                        <button
                          className={C.btnSmall}
                          disabled={!firstFree || spectating}
                          onClick={() => firstFree && sell(firstFree.id)}
                        >
                          vender
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Coleções */}
              {wallet && (
                <div className="bg-surface border border-gold-dim rounded-2xl p-4 flex flex-col gap-1.5">
                  <div className="text-gold font-semibold text-sm">
                    🏅 Coleções
                  </div>
                  {COLLECTIONS.map((c) => {
                    const formed = wallet.collections.filter(
                      (f) => f.kind === c.kind,
                    ).length;
                    const reqStr = Object.entries(c.requires)
                      .map(([t, n]) => `${ITEM_EMOJI[t]}×${n}`)
                      .join(" ");
                    return (
                      <div
                        key={c.kind}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span className="flex-1">
                          {c.label} <span className="text-muted">{reqStr}</span>
                        </span>
                        <span className="text-gold">+{money(c.bonus)}</span>
                        {formed > 0 && (
                          <span className="text-emerald-400">✓×{formed}</span>
                        )}
                        <button
                          className={C.btnSmall}
                          disabled={!canForm(c.requires) || spectating}
                          onClick={() => form(c.kind)}
                        >
                          formar
                        </button>
                      </div>
                    );
                  })}
                  {wallet.collections.length > 0 && (
                    <div className="text-sm pt-1">
                      Bônus total:{" "}
                      <b className="text-gold">
                        {money(
                          wallet.collections.reduce((s, f) => s + f.bonus, 0),
                        )}
                      </b>
                    </div>
                  )}
                </div>
              )}

              {/* Eventos (recolhível) — só com ?logs=1 (recurso de demo; escondido p/ jogadores). */}
              {SHOW_LOGS && (
                <div>
                  <button
                    className="w-full flex items-center justify-between text-sm text-muted mb-1 hover:text-stone-200 transition"
                    onClick={() => setLogsOpen((o) => !o)}
                  >
                    <span>
                      Eventos{log.length > 0 ? ` (${log.length})` : ""}
                    </span>
                    <span className="text-xs">
                      {logsOpen ? "▾ ocultar" : "▸ mostrar"}
                    </span>
                  </button>
                  {logsOpen && (
                    <div className="font-mono text-xs max-h-56 overflow-y-auto bg-surface-2 border border-line rounded-xl p-3">
                      {log.length === 0 ? (
                        <div className="text-muted">Sem eventos ainda.</div>
                      ) : (
                        log.map((l, i) => (
                          <div
                            key={i}
                            className="py-0.5 border-b border-line/60 last:border-0"
                          >
                            {l}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Reações rápidas (emotes) — difundidas a todos da sala */}
              <div className={`${C.card} p-3`}>
                <div className="text-xs text-muted mb-2">Reações</div>
                <div className="flex flex-wrap gap-1.5">
                  {EMOTE_LIST.map((e) => (
                    <button
                      key={e}
                      onClick={() => sendEmote(e)}
                      className="text-xl leading-none rounded-lg border border-line bg-surface-2 px-2 py-1 hover:border-gold active:scale-90 transition"
                      title="Enviar reação"
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </div>

              {/* Chat da sala */}
              <ChatPanel
                messages={chat}
                me={playerId}
                onSend={(t) => send({ type: "CHAT_SEND", text: t })}
              />
            </aside>
          </div>
          {/* Rodapé MOBILE: controles da partida no FIM da página (evita toque acidental no topo). */}
          {wallet && (
            <div className="sm:hidden mt-4 flex flex-col gap-2">
              {matchControlButtons}
            </div>
          )}
        </>
      )}

      {/* ---------- RANKING ---------- */}
      {phase === "ended" && (
        <div className="mt-8 max-w-xl mx-auto">
          <h2 className="font-display text-3xl text-gold text-center mb-5">
            🏁 Fim da partida
          </h2>
          <div className={`${C.card} overflow-x-auto`}>
            <table className="w-full text-sm min-w-110">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="text-left px-3 py-2">#</th>
                  <th className="text-left px-3 py-2">Jogador</th>
                  <th className="text-right px-3 py-2">💰</th>
                  <th className="text-right px-3 py-2">🎒</th>
                  <th className="text-right px-3 py-2">Patrimônio</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr
                    key={r.playerId}
                    className={`border-t border-line ${i === 0 ? "bg-gold/10" : ""}`}
                  >
                    <td className="px-3 py-2">{i === 0 ? "🥇" : i + 1}</td>
                    <td
                      className={`px-3 py-2 ${r.playerId === playerId ? "text-gold font-semibold" : ""}`}
                    >
                      {nm(r.playerId)}{" "}
                      {r.playerId === playerId && (
                        <span className="text-xs text-muted">(você)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.money)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {money(r.items)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-gold">
                      {money(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {awards.length > 0 && (
            <div className={`${C.card} mt-4 p-4`}>
              <div className="text-gold font-semibold text-sm mb-2 text-center">✨ Destaques</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {awards.map((a) => (
                  <div key={a.key} className="flex items-center gap-2 text-sm rounded-lg bg-surface-2 border border-line px-3 py-2">
                    <span className="text-xl">{a.emoji}</span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-muted">{a.label}</div>
                      <div className={`truncate ${a.playerId === playerId ? "text-gold font-semibold" : ""}`}>{nm(a.playerId)}</div>
                    </div>
                    <span className="text-xs text-muted tabular-nums">{a.key === "soldValue" ? money(a.value) : `×${a.value}`}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="text-center mt-5 flex gap-3 justify-center">
            {isHost && (
              <button
                className={C.btnGold}
                onClick={() => send({ type: "PLAY_AGAIN" })}
              >
                Jogar novamente
              </button>
            )}
            <button
              className={C.btnSmall}
              onClick={() => window.location.reload()}
            >
              Voltar ao menu
            </button>
          </div>
          <ChatPanel
            messages={chat}
            me={playerId}
            onSend={(t) => send({ type: "CHAT_SEND", text: t })}
            className="mt-5"
          />
        </div>
      )}

      {/* ---------- Reações rápidas flutuantes (emotes) ---------- */}
      {floatingEmotes.length > 0 && (
        <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center pointer-events-none">
          <div className="relative w-0">
            {floatingEmotes.map((e) => (
              <motion.div
                key={e.id}
                initial={{ y: 0, opacity: 0, scale: 0.5 }}
                animate={{ y: -140, opacity: [0, 1, 1, 0], scale: 1 }}
                transition={{ duration: 2.6, ease: "easeOut" }}
                className="absolute bottom-0 flex flex-col items-center"
                style={{ left: ((e.id * 53) % 220) - 110 }}
              >
                <span className="text-4xl drop-shadow">{e.emoji}</span>
                <span className="text-[10px] font-semibold whitespace-nowrap" style={{ color: colorOf(e.player) }}>
                  {nm(e.player)}
                </span>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* ---------- Destaques (fila: 1 por vez, em ordem) ---------- */}
      <AnimatePresence mode="wait">
        {overlayHead && (
          <motion.div
            key={overlayHead.id}
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {overlayHead.kind === "flash" ? (
              <motion.div
                className={`px-8 py-6 rounded-2xl text-center border ${
                  overlayHead.flashKind === "mimic"
                    ? "bg-red-950/90 border-red-700 shake"
                    : "bg-surface/95 border-gold-dim box-glow"
                }`}
                initial={{ scale: 0.4, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.6, opacity: 0 }}
                transition={{ type: "spring", stiffness: 320, damping: 18 }}
              >
                <div className="text-7xl">{overlayHead.emoji}</div>
                <div
                  className={`font-display text-2xl mt-2 ${overlayHead.flashKind === "mimic" ? "text-red-300" : "text-gold"}`}
                >
                  {overlayHead.title}
                </div>
                <div className="text-muted text-sm mt-1">{overlayHead.sub}</div>
              </motion.div>
            ) : (
              <div
                className={`relative px-10 pt-20 pb-7 rounded-2xl text-center border ${overlayHead.isMimic ? "bg-red-950/90 border-red-700 shake" : "bg-surface/95 border-gold-dim box-glow"}`}
              >
                {/* raios clipados ao card; o card em si NÃO corta (os itens sobem livres) */}
                {!overlayHead.isMimic && (
                  <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
                    <div className="rays" />
                  </div>
                )}
                <div className="relative flex flex-col items-center">
                  <Chest tier={overlayHead.tier} size={150} open />
                  <motion.div
                    className="absolute top-0 text-6xl flex gap-1 flex-wrap justify-center w-65"
                    initial={{ y: 20, scale: 0.2, opacity: 0 }}
                    animate={{ y: -64, scale: 1, opacity: 1 }}
                    transition={{
                      delay: 0.22,
                      type: "spring",
                      stiffness: 200,
                      damping: 13,
                    }}
                  >
                    {overlayHead.isMimic
                      ? "💀"
                      : Array.from({
                          length: Math.min(overlayHead.qty, 8),
                        }).map((_, i) => (
                          <span key={i}>
                            {ITEM_EMOJI[overlayHead.item] ?? "🎁"}
                          </span>
                        ))}
                  </motion.div>
                  <div
                    className={`font-display text-2xl mt-1 ${overlayHead.isMimic ? "text-red-300" : "text-gold"}`}
                  >
                    {overlayHead.isMimic
                      ? "MÍMICO!"
                      : `${overlayHead.qty}× ${ITEM_NAME[overlayHead.item] ?? overlayHead.item}`}
                  </div>
                  <div className="text-muted text-sm mt-1">
                    {overlayHead.sub}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Confete (vitória / coleção) ---------- */}
      {confettiKey > 0 && <Confetti key={confettiKey} />}

      {/* ---------- Seleção de alvo (carta ofensiva) ---------- */}
      <AnimatePresence>
        {targeting && (
          <motion.div
            className="fixed inset-0 z-55 flex items-center justify-center bg-black/60 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setTargeting(null)}
          >
            <motion.div
              className={`${C.card} p-5 w-full max-w-md`}
              initial={{ scale: 0.9, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-3">
                <Card type={targeting} size={50} />
                <div>
                  <div className="font-display text-lg text-gold">
                    {cardOf(targeting).label}
                  </div>
                  <div className="text-xs text-muted">
                    {cardOf(targeting).desc}
                  </div>
                </div>
              </div>
              <div className="text-sm text-muted mb-2">Escolha o alvo:</div>
              {players.filter((p) => p.id !== playerId && !p.spectating)
                .length === 0 ? (
                <div className="text-xs text-muted">Sem alvos disponíveis.</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {players
                    .filter((p) => p.id !== playerId && !p.spectating)
                    .map((p) => (
                      <button
                        key={p.id}
                        className="bg-surface-2 border border-line rounded-lg px-3 py-2 flex items-center justify-between hover:border-gold transition"
                        onClick={() => playCard(targeting, p.id)}
                      >
                        <span className="font-semibold truncate">
                          {nm(p.id)}
                        </span>
                        <span className="text-xs text-gold">
                          {money(p.money)}
                        </span>
                      </button>
                    ))}
                </div>
              )}
              <button
                className={`${C.btnSmall} w-full mt-3`}
                onClick={() => setTargeting(null)}
              >
                Cancelar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Cheat sheet: todas as cartas ---------- */}
      <AnimatePresence>
        {showCheats && (
          <motion.div
            className="fixed inset-0 z-55 flex items-center justify-center bg-black/70 px-4 py-8 overflow-y-auto"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setShowCheats(false)}
          >
            <motion.div
              className={`${C.card} p-5 w-full max-w-2xl my-auto`}
              initial={{ scale: 0.95, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display text-xl text-gold">
                  🃏 Cartas de habilidade
                </h3>
                <button
                  className={C.btnSmall}
                  onClick={() => setShowCheats(false)}
                >
                  Fechar
                </button>
              </div>
              <p className="text-xs text-muted mb-4">
                Compre cartas (preço sobe a cada uma na mão) e jogue no
                intervalo — o efeito vale para a próxima rodada.
              </p>
              <div className="grid sm:grid-cols-2 gap-3">
                {Object.keys(CARDS).map((t) => (
                  <div key={t} className="flex gap-3 items-center">
                    <Card type={t} size={50} />
                    <div className="min-w-0">
                      <div
                        className="font-semibold text-sm"
                        style={{ color: cardOf(t).color }}
                      >
                        {cardOf(t).label}
                      </div>
                      <div className="text-xs text-muted">{cardOf(t).desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Confirmação (no estilo do jogo, no lugar do confirm() nativo) ---------- */}
      {confirmDialog && (
        <div
          className="fixed inset-0 z-65 flex items-center justify-center bg-black/70 px-4"
          onClick={() => setConfirmDialog(null)}
        >
          <motion.div
            className={`${C.card} p-5 w-full max-w-sm text-center`}
            initial={{ scale: 0.92, y: 12, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="font-display text-xl text-gold">
              {confirmDialog.title}
            </div>
            <p className="text-sm text-muted mt-2">{confirmDialog.body}</p>
            <div className="flex gap-2 mt-5">
              <button
                className={`${C.btnSmall} flex-1`}
                onClick={() => setConfirmDialog(null)}
              >
                Cancelar
              </button>
              <button
                className={`${C.btnGold} flex-1`}
                onClick={() => {
                  const fn = confirmDialog.onYes;
                  setConfirmDialog(null);
                  fn();
                }}
              >
                {confirmDialog.yes}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// Mini-gráfico (sparkline) da cotação recente de um item — mostra que o preço se move.
function Sparkline({ values, color }: { values: number[]; color: string }) {
  const w = 46;
  const h = 16;
  if (values.length < 2)
    return <div style={{ width: w, height: h }} className="shrink-0" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - min) / range) * (h - 2)).toFixed(1)}`,
    )
    .join(" ");
  return (
    <svg width={w} height={h} className="shrink-0">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Rajada de confete (Framer Motion, sem dependência extra). Remonta a cada `key`.
function Confetti() {
  const N = 24;
  const colors = [
    "#e8b923",
    "#f5d77a",
    "#22d3ee",
    "#b06bf0",
    "#ef4444",
    "#34d399",
  ];
  return (
    <div className="fixed inset-0 z-60 pointer-events-none flex items-center justify-center overflow-hidden">
      {Array.from({ length: N }).map((_, i) => {
        const angle = (i / N) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 140 + Math.random() * 200;
        return (
          <motion.div
            key={i}
            className="absolute w-2 h-3 rounded-sm"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{
              x: Math.cos(angle) * dist,
              y: Math.sin(angle) * dist - 50,
              opacity: 0,
              rotate: Math.random() * 720 - 360,
            }}
            transition={{
              duration: 1.1 + Math.random() * 0.5,
              ease: "easeOut",
            }}
          />
        );
      })}
    </div>
  );
}

// Chat da sala — lista de mensagens (auto-rola) + caixa de envio. Cada instância gerencia
// seu próprio input; o estado das mensagens vive no App (compartilhado entre as fases).
function ChatPanel({
  messages,
  me,
  onSend,
  className = "",
}: {
  messages: { player: string; text: string; ts: number }[];
  me: string;
  onSend: (t: string) => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);
  const submit = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <div className={`${C.card} p-3 flex flex-col ${className}`}>
      <div className="text-sm text-muted mb-2">💬 Chat da sala</div>
      <div
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 text-sm pr-1"
        style={{ maxHeight: 240, minHeight: 120 }}
      >
        {messages.length === 0 && (
          <div className="text-xs text-muted">
            Sem mensagens ainda. Diga oi! 👋
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className="leading-snug">
            <span
              className="font-semibold"
              style={{ color: colorOf(m.player) }}
            >
              {m.player === me ? "Você" : nm(m.player)}:
            </span>{" "}
            <span className="text-stone-200 wrap-break-word">{m.text}</span>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="flex gap-2 mt-2">
        <input
          className={`${C.input} text-sm`}
          placeholder="Mensagem…"
          maxLength={300}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button className={`${C.btnSmall} whitespace-nowrap`} onClick={submit}>
          Enviar
        </button>
      </div>
    </div>
  );
}
