// Mesa de leilão do Hammer Price — tema "casa de leilão" (escuro + dourado, Tailwind).
// Fluxo: menu (criar/entrar) → lobby → partida (rodadas + HUD) → ranking final.
import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as sfx from "./sound";
import { Chest, tierLabel, tierLight } from "./Chest";
import { Card, cardOf } from "./Card";

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

function withDeadline(box: Box | null): Box | null {
  if (!box) return null;
  return { ...box, deadlineAt: box.timerMs > 0 ? Date.now() + box.timerMs : 0 };
}

const CHEST_GLYPH = "🧰";
const BID_TIMER_MS = 20000; // espelha match.box_timer_seconds (escala do anel de contagem)
const money = (n: number): string => `$${Math.round(n).toLocaleString("pt-BR")}`;
const ITEM_ORDER = ["COPPER", "SILVER", "GOLD", "DIAMOND", "MIMIC"];
const ITEM_EMOJI: Record<string, string> = { COPPER: "🪙", SILVER: "🥈", GOLD: "🥇", DIAMOND: "💎", MIMIC: "💀" };

const COLLECTIONS: { kind: string; label: string; requires: Record<string, number>; bonus: number }[] = [
  { kind: "COPPER_TRIO", label: "Trinca de Cobre", requires: { COPPER: 3 }, bonus: 70 },
  { kind: "SILVER_SET", label: "Trio de Prata", requires: { SILVER: 3 }, bonus: 230 },
  { kind: "ALLOY", label: "Liga Metálica", requires: { COPPER: 2, SILVER: 2 }, bonus: 220 },
  { kind: "SILVER_GOLD", label: "Prata & Ouro", requires: { SILVER: 2, GOLD: 1 }, bonus: 400 },
  { kind: "GOLD_TRIO", label: "Trinca de Ouro", requires: { GOLD: 3 }, bonus: 720 },
  { kind: "RAINBOW", label: "Arco-íris", requires: { COPPER: 1, SILVER: 1, GOLD: 1, DIAMOND: 1 }, bonus: 1100 },
  { kind: "DIAMOND_PAIR", label: "Par de Diamantes", requires: { DIAMOND: 2 }, bonus: 1500 },
  { kind: "ROYAL_FLUSH", label: "Realeza", requires: { SILVER: 1, GOLD: 1, DIAMOND: 2 }, bonus: 2000 },
  { kind: "LEGENDARY_VAULT", label: "Cofre Lendário", requires: { DIAMOND: 5 }, bonus: 5000 },
];

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
  const [joinCode, setJoinCode] = useState("");
  const [phase, setPhase] = useState<Phase>("menu");
  const [playerId, setPlayerId] = useState("");
  const [code, setCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [lobby, setLobby] = useState<{ status: string; host: string; players: string[] }>({ status: "WAITING", host: "", players: [] });
  const [ranking, setRanking] = useState<RankRow[]>([]);
  const [roundsToCreate, setRoundsToCreate] = useState(16);
  const [matchRounds, setMatchRounds] = useState({ played: 0, total: 0 });
  const [intermission, setIntermission] = useState<{ endsAt: number } | null>(null);
  const [readyState, setReadyState] = useState({ ready: 0, total: 0 });
  const [iAmReady, setIAmReady] = useState(false);
  const [folded, setFolded] = useState(false); // passei a vez nesta rodada
  const [foldState, setFoldState] = useState({ folded: 0, total: 0 });
  const [spectating, setSpectating] = useState(false); // desisti e só assisto
  const [chat, setChat] = useState<{ player: string; text: string; ts: number }[]>([]);
  const [nextCardPrice, setNextCardPrice] = useState(0);
  const [cardEffects, setCardEffects] = useState<{ blocked: string[]; doubleLoot: string[]; insured: string[] }>({ blocked: [], doubleLoot: [], insured: [] });
  const [targeting, setTargeting] = useState<string | null>(null); // cartType aguardando escolha de alvo

  const [round, setRound] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wonBoxes, setWonBoxes] = useState<{ boxId: string; boxType: string }[]>([]);
  const [players, setPlayers] = useState<{ id: string; money: number; reserved: number; itemCount: number; net: number; spectating?: boolean }[]>([]);
  const [lastBids, setLastBids] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);
  const [bidAmount, setBidAmount] = useState("");
  const [flash, setFlash] = useState<{ kind: "win" | "open" | "mimic"; emoji: string; title: string; sub: string } | null>(null);
  const [muted, setMutedState] = useState(false);
  const [sold, setSold] = useState<string | null>(null); // baú arrematado → carimbo no palco
  const [opening, setOpening] = useState<{ tier: string; item: string; qty: number; isMimic: boolean; sub: string } | null>(null);
  const [confettiKey, setConfettiKey] = useState(0); // bump → dispara uma rajada de confete
  const fireConfetti = () => setConfettiKey((k) => k + 1);
  const wonBoxesRef = useRef<{ boxId: string; boxType: string }[]>([]);
  const lastTickRef = useRef(-1);

  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef("");
  const pendingRef = useRef<{ kind: "create"; rounds: number } | { kind: "join"; code: string } | null>(null);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${line}`, ...prev].slice(0, 30));
  }, []);

  const send = (o: unknown) => wsRef.current?.send(JSON.stringify(o));

  const connect = useCallback(
    (action: { kind: "create"; rounds: number } | { kind: "join"; code: string }) => {
      const player = name.trim() || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
      pendingRef.current = action;
      const ws = new WebSocket(`${GATEWAY_URL}?player=${encodeURIComponent(player)}`);
      wsRef.current = ws;
      ws.onclose = () => addLog("Desconectado");
      ws.onerror = () => addLog("Erro de conexão com o gateway");
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        switch (msg.type) {
          case "HELLO":
            setPlayerId(msg.playerId);
            playerIdRef.current = msg.playerId;
            if (pendingRef.current?.kind === "create") send({ type: "CREATE_ROOM", rounds: pendingRef.current.rounds });
            else if (pendingRef.current?.kind === "join") send({ type: "JOIN_ROOM", code: pendingRef.current.code });
            break;
          case "ROOM_JOINED":
            setCode(msg.code);
            setIsHost(!!msg.host);
            setPhase("lobby");
            break;
          case "ROOM_STATE":
            setLobby({ status: msg.status, host: msg.host, players: msg.players ?? [] });
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
            setMatchRounds({ played: msg.roundsPlayed ?? 0, total: msg.totalRounds ?? 0 });
            setIntermission(null);
            setPlayers([]);
            setLastBids({});
            setFolded(false);
            setFoldState({ folded: 0, total: 0 });
            setSpectating(false);
            setCardEffects({ blocked: [], doubleLoot: [], insured: [] });
            setTargeting(null);
            setPhase("playing");
            addLog(`🚀 Partida iniciada! ${msg.totalRounds} rodadas.`);
            break;
          case "MATCH_ENDED":
            setRanking(msg.ranking ?? []);
            setPhase("ended");
            break;
          case "WELCOME":
            setRound(msg.round ?? 0);
            setBox(withDeadline(msg.box ?? null));
            if (msg.market) setPrices(msg.market);
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
            addLog(`🆕 Nova rodada: ${tierLabel(msg.box?.boxType ?? "WOODEN")} em leilão`);
            break;
          case "ROUND_ENDED":
            if (!msg.winner) addLog(`⌛ Rodada encerrada sem lances`);
            break;
          case "ROUND_INTERMISSION":
            setBox(null);
            setSold(null);
            setIntermission({ endsAt: msg.endsAt ?? 0 });
            setMatchRounds({ played: msg.roundsPlayed ?? 0, total: msg.totalRounds ?? 0 });
            setIAmReady(false);
            setCardEffects({ blocked: [], doubleLoot: [], insured: [] });
            setTargeting(null);
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
            setChat((prev) => [...prev, { player: msg.player, text: msg.text, ts: msg.ts }].slice(-80));
            break;
          case "SPECTATING":
            setSpectating(true);
            addLog("👀 Você desistiu — agora está assistindo.");
            break;
          case "BID_PLACED":
            addLog(`🔨 ${msg.leader} deu lance de ${money(msg.amount)} em ${msg.boxId}`);
            sfx.gavel();
            setLastBids((prev) => ({ ...prev, [msg.leader]: msg.amount }));
            setBox((prev) =>
              prev && prev.boxId === msg.boxId
                ? { ...prev, currentBid: msg.amount, leader: msg.leader, timerMs: msg.timerMs, deadlineAt: Date.now() + msg.timerMs }
                : prev,
            );
            break;
          case "BOX_SOLD": {
            addLog(`🏆 ${msg.boxId} arrematada por ${msg.winner} (${money(msg.price)})`);
            sfx.gavel();
            const mine = msg.winner === playerIdRef.current;
            if (mine) {
              setWonBoxes((prev) => (prev.some((b) => b.boxId === msg.boxId) ? prev : [...prev, { boxId: msg.boxId, boxType: msg.boxType }]));
              fireConfetti();
            }
            setSold(msg.boxId); // carimbo ARREMATADO no baú do palco
            setFlash({ kind: "win", emoji: "🏆", title: mine ? "Você arrematou!" : `${msg.winner} arrematou`, sub: `${tierLabel(msg.boxType)} por ${money(msg.price)}` });
            break;
          }
          case "OPEN_RESULT":
            if (msg.ok) {
              const tier = wonBoxesRef.current.find((b) => b.boxId === msg.boxId)?.boxType ?? "WOODEN";
              setWonBoxes((prev) => prev.filter((b) => b.boxId !== msg.boxId));
              const qty = msg.quantity ?? 1;
              // Abertura animada do baú (substitui o flash "open").
              setOpening({ tier, item: msg.item, qty, isMimic: msg.isMimic, sub: msg.isMimic ? "Cuidado…" : `${qty}× para o inventário` });
              sfx.creak();
              if (msg.isMimic) sfx.thud();
              else {
                addLog(`🎁 Você abriu: ${qty}× ${msg.item}`); // mímico é narrado pelo BOX_OPENED
                sfx.fanfare();
                fireConfetti();
              }
            } else addLog(`⚠️ Não foi possível abrir ${msg.boxId}: ${msg.reason}`);
            break;
          case "BOX_OPENED": {
            const mine = msg.player === playerIdRef.current;
            if (msg.isMimic) {
              const insured = msg.penaltyKind === "INSURED";
              addLog(`💀 ${mine ? "Você" : msg.player} abriu um MÍMICO — ${insured ? "Seguro evitou a penalidade 🛡️" : `perdeu ${msg.penaltyDetail || "—"}`}`);
              if (mine) setOpening((o) => (o ? { ...o, sub: insured ? "Seguro evitou! 🛡️" : `Perdeu ${msg.penaltyDetail || "—"}` } : o));
              else if (!insured) {
                sfx.thud();
                setFlash({ kind: "mimic", emoji: "💀", title: `${msg.player} pegou um MÍMICO!`, sub: `Perdeu ${msg.penaltyDetail || "—"}` });
              }
            } else if (!mine) addLog(`📦 ${msg.player} abriu: ${msg.quantity ?? 1}× ${msg.item}`);
            break;
          }
          case "BID_ACCEPTED":
            addLog(`✅ Seu lance em ${msg.boxId} foi aceito (atual: ${money(msg.currentBid)})`);
            setBox((prev) =>
              prev && prev.boxId === msg.boxId
                ? { ...prev, currentBid: msg.currentBid, leader: msg.leader, timerMs: msg.timerMs, deadlineAt: Date.now() + msg.timerMs }
                : prev,
            );
            break;
          case "BID_REJECTED":
            addLog(`❌ Lance rejeitado em ${msg.boxId}: ${msg.reason}`);
            break;
          case "MARKET_UPDATED":
            setPrices(msg.prices ?? {});
            break;
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
            } else addLog(msg.reason === "INSUFFICIENT" ? "⚠️ Dinheiro insuficiente para a carta." : "⚠️ Mão cheia.");
            break;
          case "CARD_NOTICE":
            if (msg.player !== playerIdRef.current) addLog(`🃏 ${msg.player} comprou uma carta`);
            break;
          case "CARD_PLAYED": {
            const who = msg.source === playerIdRef.current ? "Você" : msg.source;
            const d = cardOf(msg.cardType);
            addLog(`${d.emoji} ${who} usou ${d.label}${msg.target ? ` em ${msg.target}` : ""}`);
            setFlash({ kind: "win", emoji: d.emoji, title: `${d.label}!`, sub: `${who}${msg.target ? ` → ${msg.target}` : ""}` });
            break;
          }
          case "CARD_EFFECTS":
            setCardEffects({ blocked: msg.blocked ?? [], doubleLoot: msg.doubleLoot ?? [], insured: msg.insured ?? [] });
            break;
          case "SELL_RESULT":
            if (msg.ok) sfx.coin();
            addLog(msg.ok ? `💸 Vendeu ${msg.itemType} por ${money(msg.price)}` : `⚠️ Venda falhou: ${msg.reason}`);
            break;
          case "FORM_RESULT":
            if (msg.ok) {
              sfx.fanfare();
              fireConfetti();
            }
            addLog(msg.ok ? `🏅 Coleção ${msg.kind} formada! +${money(msg.bonus)}` : `⚠️ Não deu para formar ${msg.kind}: ${msg.reason}`);
            break;
          case "ERROR": {
            const errors: Record<string, string> = {
              ROOM_FULL: "Sala cheia (máx. 15 jogadores).",
              ROOM_NOT_FOUND: "Sala não encontrada — confira o código.",
              MATCH_ALREADY_STARTED: "A partida já começou.",
              NEED_2_PLAYERS: "São necessários ao menos 2 jogadores.",
              NO_ROOMS_AVAILABLE: "Não há salas livres no momento.",
            };
            addLog(`⚠️ ${errors[msg.reason] ?? msg.reason}`);
            break;
          }
        }
      };
    },
    [name, addLog],
  );

  useEffect(() => () => wsRef.current?.close(), []);

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

  // Overlay de destaque (vitória): some sozinho após alguns segundos.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), flash.kind === "mimic" ? 2600 : 2200);
    return () => clearTimeout(id);
  }, [flash]);

  // Abertura animada do baú: some após a animação.
  useEffect(() => {
    if (!opening) return;
    const id = setTimeout(() => setOpening(null), 2800);
    return () => clearTimeout(id);
  }, [opening]);

  useEffect(() => {
    wonBoxesRef.current = wonBoxes; // p/ resgatar o tier do baú aberto na abertura
  }, [wonBoxes]);

  const toggleMute = () => {
    const m = !muted;
    setMutedState(m);
    sfx.setMuted(m);
  };

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

  const placeBid = (boxId: string, amount: number) => send({ type: "PLACE_BID", boxId, amount });
  const sendOpen = (boxId: string) => send({ type: "OPEN_BOX", boxId });
  const sell = (itemId: string) => send({ type: "SELL_ITEM", itemId });
  const form = (kind: string) => send({ type: "FORM_COLLECTION", kind });
  const buyCardAction = () => send({ type: "BUY_CARD" });
  const playCard = (cardType: string, target?: string) => {
    send({ type: "PLAY_CARD", cardType, target });
    setTargeting(null);
  };

  const freeCount = (type: string): number => wallet?.inventory.filter((i) => i.type === type && i.state === "FREE").length ?? 0;
  const canForm = (requires: Record<string, number>): boolean => Object.entries(requires).every(([t, n]) => freeCount(t) >= n);

  return (
    <div className="max-w-6xl mx-auto px-5 py-7">
      <header className="flex items-end justify-between gap-3 border-b border-line pb-4">
        <div>
          <h1 className="font-display text-4xl font-bold text-gold leading-none">🔨 Hammer Price</h1>
          <p className="text-muted text-sm mt-1">Leilão de caixas misteriosas em tempo real</p>
        </div>
        <div className="flex items-end gap-3">
          {phase === "playing" && (
            <div className="text-right">
              <div className="text-2xl font-bold text-gold tabular-nums">
                Rodada {Math.min(matchRounds.played + 1, matchRounds.total)}/{matchRounds.total}
              </div>
              <div className="text-xs text-muted">Sala {code}</div>
            </div>
          )}
          <button className={C.btnSmall} onClick={toggleMute} title={muted ? "Ativar som" : "Silenciar"}>
            {muted ? "🔇" : "🔊"}
          </button>
        </div>
      </header>

      {/* ---------- MENU / BOAS-VINDAS ---------- */}
      {phase === "menu" && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-6 grid lg:grid-cols-[1.1fr_minmax(0,400px)] gap-8 lg:gap-12 items-start"
        >
          {/* ----- Hero + como jogar ----- */}
          <div className="order-2 lg:order-1">
            <h2 className="font-display text-4xl sm:text-5xl text-gold leading-tight">Arremate. Abra. Enriqueça.</h2>
            <p className="text-stone-300 mt-3 text-base sm:text-lg max-w-xl">
              Um <b className="text-gold-soft">leilão de baús misteriosos em tempo real</b>. Dispute cada lote com os outros
              jogadores, abra o que arrematar e termine com o maior patrimônio da mesa.
            </p>

            {/* fileira de baús (níveis) */}
            <div className="flex flex-wrap gap-5 my-7 justify-center lg:justify-start">
              {["WOODEN", "IRON", "ROYAL", "VAULT"].map((t) => (
                <div key={t} className="flex flex-col items-center gap-1">
                  <Chest tier={t} size={66} />
                  <span className="text-[11px] text-muted">{tierLabel(t)}</span>
                </div>
              ))}
            </div>

            {/* como jogar */}
            <h3 className="text-gold font-semibold uppercase tracking-wider text-xs mb-3">Como jogar</h3>
            <ol className="flex flex-col gap-3">
              {[
                { icon: "🎲", title: "Um baú por rodada", text: "A cada rodada sobe um baú aleatório — com as probabilidades de prêmio à vista." },
                { icon: "🔨", title: "Dispute no lance", text: "O cronômetro só começa após o 1º lance; quem liderar quando ele zerar arremata. Sem interesse? É só passar." },
                { icon: "🎁", title: "Abra o que ganhar", text: "Pode sair Cobre, Prata, Ouro ou Diamante… ou um 💀 Mímico, que aplica uma penalidade." },
                { icon: "💰", title: "Faça seu patrimônio", text: "Venda itens no mercado ou junte coleções para multiplicar o valor dos seus itens." },
                { icon: "🏆", title: "Maior patrimônio vence", text: "No fim das rodadas, ganha quem tiver mais dinheiro + itens + bônus de coleções." },
              ].map((s, i) => (
                <li key={i} className="flex gap-3 items-start">
                  <span className="text-2xl leading-none mt-0.5 w-7 text-center shrink-0">{s.icon}</span>
                  <div>
                    <div className="text-stone-100 font-semibold text-sm">{s.title}</div>
                    <div className="text-muted text-sm">{s.text}</div>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* ----- Card de entrar / criar ----- */}
          <div className={`${C.card} box-glow p-6 flex flex-col gap-4 order-1 lg:order-2 lg:sticky lg:top-6`}>
            <div className="text-center">
              <div className="font-display text-xl text-gold">Entre na mesa</div>
              <p className="text-xs text-muted mt-0.5">Crie uma sala e convide, ou entre com um código.</p>
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted">Seu nome</label>
              <input className={`${C.input} mt-1`} placeholder="ex.: ana" value={name} onChange={(e) => setName(e.target.value)} />
              {!name.trim() && <p className="text-xs text-muted mt-1">Digite um nome para jogar.</p>}
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-muted">Rodadas (ao criar)</label>
              <select className={`${C.input} mt-1`} value={roundsToCreate} onChange={(e) => setRoundsToCreate(Number(e.target.value))}>
                {[8, 12, 16, 20, 24, 32].map((n) => (
                  <option key={n} value={n}>{n} rodadas</option>
                ))}
              </select>
            </div>
            <button className={`${C.btnGold} text-base py-2.5`} disabled={!name.trim()} onClick={() => connect({ kind: "create", rounds: roundsToCreate })}>
              🔨 Criar sala
            </button>
            <div className="flex items-center gap-3 text-muted text-xs">
              <span className="h-px flex-1 bg-line" /> ou entre numa sala <span className="h-px flex-1 bg-line" />
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
            <p className="text-[11px] text-muted text-center">2 a 15 jogadores · partida começa quando o anfitrião iniciar.</p>
          </div>
        </motion.div>
      )}

      {/* ---------- LOBBY ---------- */}
      {phase === "lobby" && (
        <div className="max-w-md mx-auto mt-8 flex flex-col gap-4">
          <div className={`${C.card} p-6 text-center`}>
          <p className="text-xs uppercase tracking-wide text-muted">Código da sala</p>
          <div className="font-display text-5xl text-gold tracking-[0.25em] my-2">{code}</div>
          <p className="text-muted text-sm mb-5">Compartilhe o código. A partida exige ao menos 2 jogadores.</p>
          <div className="text-left bg-surface-2 border border-line rounded-xl p-4 mb-5">
            <div className="text-sm text-muted mb-2">Jogadores ({lobby.players.length}/15)</div>
            <ul className="flex flex-col gap-1">
              {lobby.players.map((p) => (
                <li key={p} className="flex items-center gap-2">
                  <span className={p === playerId ? "text-gold font-semibold" : ""}>{p}</span>
                  {p === lobby.host && <span title="host">👑</span>}
                  {p === playerId && <span className="text-xs text-muted">(você)</span>}
                </li>
              ))}
            </ul>
          </div>
          {isHost ? (
            <button className={`${C.btnGold} w-full`} disabled={lobby.players.length < 2} onClick={() => send({ type: "START_MATCH" })}>
              {lobby.players.length < 2 ? "Aguardando jogadores…" : "Iniciar partida"}
            </button>
          ) : (
            <p className="text-muted">Aguardando o host iniciar…</p>
          )}
          </div>
          <ChatPanel messages={chat} me={playerId} onSend={(t) => send({ type: "CHAT_SEND", text: t })} />
        </div>
      )}

      {/* ---------- PARTIDA ---------- */}
      {phase === "playing" && (
        <div className="mt-5 grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)_300px]">
          {/* ----- ESQUERDA: você + mesa ----- */}
          <aside className="order-2 lg:order-1 flex flex-col gap-4">
            {wallet && (
              <div className={`${C.card} p-4`}>
                <div className="text-sm text-muted mb-2">💼 Você</div>
                <div className="flex flex-col gap-1.5 text-sm">
                  <div className="flex justify-between"><span className="text-muted">💰 Saldo</span><b className="text-gold">{money(wallet.balance)}</b></div>
                  <div className="flex justify-between"><span className="text-muted">🔒 Reservado</span><span>{money(wallet.reserved)}</span></div>
                  <div className="flex justify-between"><span className="text-muted">🟢 Gastável</span><b className="text-emerald-400">{money(wallet.balance - wallet.reserved)}</b></div>
                </div>
                {spectating ? (
                  <div className="mt-3 text-center text-xs text-sky-300 bg-sky-500/10 border border-sky-500/30 rounded-lg py-1.5">👀 Assistindo</div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {isHost && (
                      <button className={`${C.btnSmall} w-full`} onClick={() => send({ type: "END_MATCH" })}>Encerrar partida</button>
                    )}
                    <button
                      className={`${C.btnSmall} w-full`}
                      onClick={() => { if (confirm("Desistir da partida e só assistir? Você não poderá mais dar lances.")) send({ type: "GIVE_UP" }); }}
                    >
                      Desistir (assistir)
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Cartas de habilidade */}
            {wallet && (
              <div className={`${C.card} p-4 flex flex-col gap-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted">🃏 Cartas</span>
                  {!spectating && (
                    <button className={C.btnSmall} disabled={wallet.balance - wallet.reserved < nextCardPrice} onClick={buyCardAction}>
                      Comprar ({money(nextCardPrice)})
                    </button>
                  )}
                </div>

                {(cardEffects.blocked.includes(playerId) || cardEffects.doubleLoot.includes(playerId) || cardEffects.insured.includes(playerId)) && (
                  <div className="flex flex-wrap gap-1 text-[11px]">
                    {cardEffects.blocked.includes(playerId) && <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">🚫 Bloqueado</span>}
                    {cardEffects.doubleLoot.includes(playerId) && <span className="px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">✖️2 Dobro</span>}
                    {cardEffects.insured.includes(playerId) && <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">🛡️ Seguro</span>}
                  </div>
                )}

                {wallet.cards.length === 0 ? (
                  <div className="text-xs text-muted">Sem cartas. Compre uma — o efeito vale para a próxima rodada.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {wallet.cards.map((card, i) => (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <Card type={card} size={54} dim={spectating} />
                        {!spectating && (
                          <button
                            className={`${C.btnSmall} text-[11px] px-2 py-0.5`}
                            disabled={!intermission}
                            title={intermission ? "" : "jogue no intervalo"}
                            onClick={() => (cardOf(card).targeted ? setTargeting(card) : playCard(card))}
                          >
                            Usar
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {!intermission && wallet.cards.length > 0 && !spectating && (
                  <div className="text-[11px] text-muted">Jogue no intervalo (vale p/ a próxima rodada).</div>
                )}

                {targeting && (
                  <div className="bg-surface-2 border border-line rounded-lg p-2 flex flex-col gap-1">
                    <div className="text-xs text-muted">{cardOf(targeting).label} — escolha o alvo:</div>
                    <div className="flex flex-wrap gap-1">
                      {players.filter((p) => p.id !== playerId && !p.spectating).map((p) => (
                        <button key={p.id} className={`${C.btnSmall} text-xs`} onClick={() => playCard(targeting, p.id)}>{p.id}</button>
                      ))}
                      <button className={`${C.btnSmall} text-xs`} onClick={() => setTargeting(null)}>cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Mesa — leitura dos rivais (dinheiro, itens livres, último lance) */}
            {players.length > 0 && (
              <div className={`${C.card} p-4`}>
                <div className="text-sm text-muted mb-2">🃏 Mesa</div>
                <div className="flex flex-col gap-1">
                  {[...players].sort((a, b) => b.net - a.net).map((p) => (
                    <div key={p.id} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${p.id === playerId ? "bg-gold/10" : ""}`}>
                      <span className={`flex-1 truncate ${p.id === playerId ? "text-gold font-semibold" : ""} ${p.spectating ? "opacity-50" : ""}`}>{p.id}{p.id === playerId ? " (você)" : ""}{p.spectating ? " 👀" : ""}</span>
                      <span className="whitespace-nowrap">💰 <b className="text-gold">{money(p.money)}</b></span>
                      <span className="whitespace-nowrap text-muted">🎒 {p.itemCount}</span>
                      <span className="whitespace-nowrap text-xs text-stone-400 w-16 text-right">{lastBids[p.id] ? `🔨 ${money(lastBids[p.id])}` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* ----- CENTRO: palco da casa de leilão ----- */}
          <main className="order-1 lg:order-2 flex flex-col gap-3">
            <div
              className="stage min-h-[360px] flex items-center justify-center px-[15%] py-8"
              style={{ ["--rarity" as string]: tierLight(box?.boxType ?? "WOODEN") }}
            >
              <div className="curtain curtain-l" />
              <div className="curtain curtain-r" />
              <div className="curtain-top" />
              <div className="stage-spot" />
              <div className="stage-floor" />
              <AnimatePresence mode="wait">
                {box ? (
                  <motion.div
                    key={box.boxId}
                    initial={{ scale: 0.6, opacity: 0, y: 14 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 0.6, opacity: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20 }}
                    className="relative z-[4] w-full max-w-[300px] text-center flex flex-col items-center gap-1.5"
                  >
                    {/* baú flutuando + anel de contagem + carimbo ARREMATADO */}
                    <div className="relative w-[150px] h-[150px] flex items-center justify-center">
                      <motion.div animate={{ y: [0, -7, 0] }} transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}>
                        <Chest tier={box.boxType} size={138} />
                      </motion.div>
                      {box.leader && box.deadlineAt
                        ? (() => {
                            const rem = Math.max(0, box.deadlineAt - Date.now());
                            const frac = Math.min(1, rem / BID_TIMER_MS);
                            const R = 68;
                            const circ = 2 * Math.PI * R;
                            const danger = rem <= 5000;
                            return (
                              <svg className="absolute inset-0 -rotate-90" width="150" height="150" viewBox="0 0 150 150">
                                <circle cx="75" cy="75" r={R} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
                                <circle
                                  cx="75"
                                  cy="75"
                                  r={R}
                                  fill="none"
                                  stroke={danger ? "#ef4444" : "var(--rarity)"}
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
                          transition={{ type: "spring", stiffness: 300, damping: 11 }}
                          className="absolute inset-0 flex items-center justify-center pointer-events-none"
                        >
                          <span className="stamp">ARREMATADO</span>
                        </motion.div>
                      )}
                    </div>
                    <div className="font-display text-xl text-gold">{tierLabel(box.boxType)}</div>
                    <div className="text-[11px] text-stone-400">
                      {ITEM_ORDER.filter((k) => box.odds?.[k] != null).map((k) => `${ITEM_EMOJI[k]} ${box.odds[k]}%`).join("  ")}
                    </div>
                    <motion.div key={box.currentBid} initial={{ scale: 1.35 }} animate={{ scale: 1 }} className="text-2xl font-bold text-gold mt-0.5">
                      {box.currentBid > 0 ? `💰 ${money(box.currentBid)}` : "sem lances"}
                    </motion.div>
                    <div className="text-sm">líder: <b className={box.leader === playerId ? "text-gold" : ""}>{box.leader || "—"}</b></div>
                    {foldState.folded > 0 && <div className="text-xs text-stone-400">🙅 {foldState.folded}/{foldState.total} passaram</div>}
                    <div className="h-6 flex items-center">
                      {(() => {
                        const call = goingCall(box);
                        if (call) return <motion.div key={call} initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-red-400 font-display font-bold">{call}</motion.div>;
                        return <div className="text-sm text-muted tabular-nums">{box.leader ? `⏱ ${boxCountdown(box)}` : "aguardando o 1º lance…"}</div>;
                      })()}
                    </div>
                  </motion.div>
                ) : (
                  <motion.div
                    key="intermission"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="relative z-[4] w-full max-w-[300px] text-center flex flex-col items-center gap-3"
                  >
                    <div className="text-muted">⏳ Intervalo — venda, queime ou forme coleções</div>
                    <div className="text-5xl font-bold text-gold tabular-nums">{intermission ? intermissionCountdown(intermission.endsAt) : "—"}</div>
                    <div className="text-sm text-muted">{readyState.ready}/{readyState.total} prontos</div>
                    <button className={`${C.btnGold} w-full`} disabled={iAmReady || !intermission} onClick={() => { send({ type: "READY" }); setIAmReady(true); }}>
                      {iAmReady ? "Pronto ✓" : "Estou pronto"}
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Controles de lance / passar — abaixo do palco. Espectador não vê. */}
            {box && !spectating && (folded ? (
              <div className={`${C.card} p-3 text-center text-sm text-muted`}>
                🙅 Você passou nesta rodada · <b className="text-stone-300">{foldState.folded}/{foldState.total || "?"}</b> passaram
              </div>
            ) : (() => {
              const minInc = Math.max(5, Math.floor(box.currentBid * 0.05));
              const minNext = box.currentBid + minInc;
              const customVal = Number(bidAmount);
              const customOk = bidAmount === "" || customVal >= minNext;
              const bidValue = bidAmount === "" ? minNext : customVal;
              const iAmLeader = box.leader === playerId;
              return (
                <div className={`${C.card} p-3 flex flex-col gap-2`}>
                  <div className="text-xs text-muted text-center">lance mínimo: <b className="text-gold">{money(minNext)}</b></div>
                  <div className="grid grid-cols-4 gap-2">
                    <button className={C.btnSmall} onClick={() => placeBid(box.boxId, minNext)}>Mín</button>
                    {[10, 50, 100].map((n) => (
                      <button key={n} className={C.btnSmall} disabled={box.currentBid + n < minNext} onClick={() => placeBid(box.boxId, box.currentBid + n)}>+{n}</button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input className={`${C.input} text-center`} type="number" placeholder={`${minNext}`} value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} />
                    <button className={`${C.btnGold} whitespace-nowrap`} disabled={!customOk} onClick={() => placeBid(box.boxId, bidValue)}>Dar lance</button>
                  </div>
                  {!iAmLeader && (
                    <button className={`${C.btnSmall} w-full`} onClick={() => { setFolded(true); send({ type: "FOLD" }); }}>
                      Passar {foldState.folded > 0 ? `· ${foldState.folded}/${foldState.total} passaram` : ""}
                    </button>
                  )}
                </div>
              );
            })())}

            {wonBoxes.length > 0 && (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-gold/10 border border-gold-dim rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 justify-center">
                <b className="text-gold">🎉 Você arrematou! Abra:</b>
                {wonBoxes.map((b) => (
                  <button key={b.boxId} className={C.btnGold} disabled={spectating} onClick={() => sendOpen(b.boxId)}>Abrir {CHEST_GLYPH} {tierLabel(b.boxType)}</button>
                ))}
              </motion.div>
            )}
          </main>

          {/* ----- DIREITA: mercado + inventário + coleções + eventos ----- */}
          <aside className="order-3 flex flex-col gap-4">
            {Object.keys(prices).length > 0 && (
              <div className="bg-surface-2 border border-line rounded-xl px-4 py-2 text-sm">
                <span className="text-muted">📈 Mercado</span>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                  {ITEM_ORDER.filter((k) => prices[k] != null).map((k) => (<span key={k}>{ITEM_EMOJI[k]} {money(prices[k])}</span>))}
                </div>
              </div>
            )}

            {/* Inventário */}
            {wallet && wallet.inventory.length > 0 && (
              <div className={`${C.card} p-4 flex flex-col gap-2`}>
                <div className="text-sm text-muted">🎒 Inventário</div>
                {ITEM_ORDER.filter((t) => wallet.inventory.some((i) => i.type === t)).map((t) => {
                  const count = wallet.inventory.filter((i) => i.type === t).length;
                  const locked = wallet.inventory.filter((i) => i.type === t && i.state !== "FREE").length;
                  const firstFree = wallet.inventory.find((i) => i.type === t && i.state === "FREE");
                  return (
                    <div key={t} className="flex items-center gap-2 text-sm">
                      <span className="flex-1">{ITEM_EMOJI[t]} {t} ×{count}{locked > 0 ? <span className="text-muted"> ({locked}🔒)</span> : ""}</span>
                      <button className={C.btnSmall} disabled={!firstFree || spectating} onClick={() => firstFree && sell(firstFree.id)}>vender</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Coleções */}
            {wallet && (
              <div className="bg-surface border border-gold-dim rounded-2xl p-4 flex flex-col gap-1.5">
                <div className="text-gold font-semibold text-sm">🏅 Coleções</div>
                {COLLECTIONS.map((c) => {
                  const formed = wallet.collections.filter((f) => f.kind === c.kind).length;
                  const reqStr = Object.entries(c.requires).map(([t, n]) => `${ITEM_EMOJI[t]}×${n}`).join(" ");
                  return (
                    <div key={c.kind} className="flex items-center gap-2 text-xs">
                      <span className="flex-1">{c.label} <span className="text-muted">{reqStr}</span></span>
                      <span className="text-gold">+{money(c.bonus)}</span>
                      {formed > 0 && <span className="text-emerald-400">✓×{formed}</span>}
                      <button className={C.btnSmall} disabled={!canForm(c.requires) || spectating} onClick={() => form(c.kind)}>formar</button>
                    </div>
                  );
                })}
                {wallet.collections.length > 0 && (
                  <div className="text-sm pt-1">Bônus total: <b className="text-gold">{money(wallet.collections.reduce((s, f) => s + f.bonus, 0))}</b></div>
                )}
              </div>
            )}

            {/* Eventos */}
            <div>
              <div className="text-sm text-muted mb-1">Eventos</div>
              <div className="font-mono text-xs max-h-56 overflow-y-auto bg-surface-2 border border-line rounded-xl p-3">
                {log.map((l, i) => (<div key={i} className="py-0.5 border-b border-line/60 last:border-0">{l}</div>))}
              </div>
            </div>

            {/* Chat da sala */}
            <ChatPanel messages={chat} me={playerId} onSend={(t) => send({ type: "CHAT_SEND", text: t })} />
          </aside>
        </div>
      )}

      {/* ---------- RANKING ---------- */}
      {phase === "ended" && (
        <div className="mt-8 max-w-xl mx-auto">
          <h2 className="font-display text-3xl text-gold text-center mb-5">🏁 Fim da partida</h2>
          <div className={`${C.card} overflow-hidden`}>
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-muted">
                <tr>
                  <th className="text-left px-3 py-2">#</th>
                  <th className="text-left px-3 py-2">Jogador</th>
                  <th className="text-right px-3 py-2">💰</th>
                  <th className="text-right px-3 py-2">🎒</th>
                  <th className="text-right px-3 py-2">🏅</th>
                  <th className="text-right px-3 py-2">Patrimônio</th>
                </tr>
              </thead>
              <tbody>
                {ranking.map((r, i) => (
                  <tr key={r.playerId} className={`border-t border-line ${i === 0 ? "bg-gold/10" : ""}`}>
                    <td className="px-3 py-2">{i === 0 ? "🥇" : i + 1}</td>
                    <td className={`px-3 py-2 ${r.playerId === playerId ? "text-gold font-semibold" : ""}`}>
                      {r.playerId} {r.playerId === playerId && <span className="text-xs text-muted">(você)</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.money)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.items)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.bonus)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-gold">{money(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-center mt-5 flex gap-3 justify-center">
            {isHost && (
              <button className={C.btnGold} onClick={() => send({ type: "PLAY_AGAIN" })}>
                Jogar novamente
              </button>
            )}
            <button className={C.btnSmall} onClick={() => window.location.reload()}>Voltar ao menu</button>
          </div>
          <ChatPanel messages={chat} me={playerId} onSend={(t) => send({ type: "CHAT_SEND", text: t })} className="mt-5" />
        </div>
      )}

      {/* ---------- Destaque (vitória / abertura / mímico) ---------- */}
      <AnimatePresence>
        {flash && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className={`px-8 py-6 rounded-2xl text-center border ${
                flash.kind === "mimic" ? "bg-red-950/90 border-red-700 shake" : "bg-surface/95 border-gold-dim box-glow"
              }`}
              initial={{ scale: 0.4, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
            >
              <div className="text-7xl">{flash.emoji}</div>
              <div className={`font-display text-2xl mt-2 ${flash.kind === "mimic" ? "text-red-300" : "text-gold"}`}>{flash.title}</div>
              <div className="text-muted text-sm mt-1">{flash.sub}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Abertura animada do baú ---------- */}
      <AnimatePresence>
        {opening && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className={`relative px-10 py-7 rounded-2xl text-center border overflow-hidden ${opening.isMimic ? "bg-red-950/90 border-red-700 shake" : "bg-surface/95 border-gold-dim box-glow"}`}>
              {!opening.isMimic && <div className="rays" />}
              <div className="relative flex flex-col items-center">
                <Chest tier={opening.tier} size={150} open />
                <motion.div
                  className="absolute top-0 text-6xl flex gap-1"
                  initial={{ y: 30, scale: 0.2, opacity: 0 }}
                  animate={{ y: -42, scale: 1, opacity: 1 }}
                  transition={{ delay: 0.22, type: "spring", stiffness: 200, damping: 13 }}
                >
                  {opening.isMimic
                    ? "💀"
                    : Array.from({ length: Math.min(opening.qty, 4) }).map((_, i) => <span key={i}>{ITEM_EMOJI[opening.item] ?? "🎁"}</span>)}
                </motion.div>
                <div className={`font-display text-2xl mt-1 ${opening.isMimic ? "text-red-300" : "text-gold"}`}>
                  {opening.isMimic ? "MÍMICO!" : `${opening.qty}× ${opening.item}`}
                </div>
                <div className="text-muted text-sm mt-1">{opening.sub}</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ---------- Confete (vitória / coleção) ---------- */}
      {confettiKey > 0 && <Confetti key={confettiKey} />}
    </div>
  );
}

// Rajada de confete (Framer Motion, sem dependência extra). Remonta a cada `key`.
function Confetti() {
  const N = 24;
  const colors = ["#e8b923", "#f5d77a", "#22d3ee", "#b06bf0", "#ef4444", "#34d399"];
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none flex items-center justify-center overflow-hidden">
      {Array.from({ length: N }).map((_, i) => {
        const angle = (i / N) * Math.PI * 2 + Math.random() * 0.5;
        const dist = 140 + Math.random() * 200;
        return (
          <motion.div
            key={i}
            className="absolute w-2 h-3 rounded-sm"
            style={{ background: colors[i % colors.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(angle) * dist, y: Math.sin(angle) * dist - 50, opacity: 0, rotate: Math.random() * 720 - 360 }}
            transition={{ duration: 1.1 + Math.random() * 0.5, ease: "easeOut" }}
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
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1 text-sm pr-1" style={{ maxHeight: 240, minHeight: 120 }}>
        {messages.length === 0 && <div className="text-xs text-muted">Sem mensagens ainda. Diga oi! 👋</div>}
        {messages.map((m, i) => (
          <div key={i} className="leading-snug">
            <span className={`font-semibold ${m.player === me ? "text-gold" : "text-stone-300"}`}>{m.player === me ? "Você" : m.player}:</span>{" "}
            <span className="text-stone-200 break-words">{m.text}</span>
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
