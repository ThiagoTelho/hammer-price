// Mesa de leilão do Hammer Price — tema "casa de leilão" (escuro + dourado, Tailwind).
// Fluxo: menu (criar/entrar) → lobby → partida (rodadas + HUD) → ranking final.
import { useEffect, useRef, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import * as sfx from "./sound";

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
  affinities: { type: string; points: number }[];
  collections: { kind: string; bonus: number }[];
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

const BOX_EMOJI: Record<string, string> = { BRONZE: "🥉", SILVER: "🥈", GOLD: "🥇", VAULT: "💎" };
const ITEM_ORDER = ["COPPER", "SILVER", "GOLD", "DIAMOND", "MIMIC"];
const ITEM_EMOJI: Record<string, string> = { COPPER: "🪙", SILVER: "🥈", GOLD: "🥇", DIAMOND: "💎", MIMIC: "💀" };

const COLLECTIONS: { kind: string; label: string; requires: Record<string, number>; bonus: number }[] = [
  { kind: "COMMON_ALLOY", label: "Liga Comum", requires: { COPPER: 5 }, bonus: 150 },
  { kind: "NOBLE_PAIR", label: "Dupla Nobre", requires: { GOLD: 3 }, bonus: 400 },
  { kind: "RAINBOW", label: "Arco-íris", requires: { COPPER: 1, SILVER: 1, GOLD: 1, DIAMOND: 1 }, bonus: 900 },
  { kind: "ROYAL_TRIO", label: "Trinca Real", requires: { DIAMOND: 3 }, bonus: 3000 },
  { kind: "LEGENDARY_VAULT", label: "Cofre Lendário", requires: { DIAMOND: 5 }, bonus: 8000 },
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
  const [roundsToCreate, setRoundsToCreate] = useState(8);
  const [matchRounds, setMatchRounds] = useState({ played: 0, total: 0 });
  const [intermission, setIntermission] = useState<{ endsAt: number } | null>(null);
  const [readyState, setReadyState] = useState({ ready: 0, total: 0 });
  const [iAmReady, setIAmReady] = useState(false);

  const [round, setRound] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wonBoxes, setWonBoxes] = useState<{ boxId: string; boxType: string }[]>([]);
  const [players, setPlayers] = useState<{ id: string; money: number; reserved: number; itemCount: number; net: number }[]>([]);
  const [lastBids, setLastBids] = useState<Record<string, number>>({});
  const [log, setLog] = useState<string[]>([]);
  const [bidAmount, setBidAmount] = useState("");
  const [flash, setFlash] = useState<{ kind: "win" | "open" | "mimic"; emoji: string; title: string; sub: string } | null>(null);
  const [muted, setMutedState] = useState(false);

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
            }
            break;
          case "MATCH_STARTED":
            setMatchRounds({ played: msg.roundsPlayed ?? 0, total: msg.totalRounds ?? 0 });
            setIntermission(null);
            setPlayers([]);
            setLastBids({});
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
            sfx.whoosh();
            addLog(`🆕 Nova rodada: caixa ${msg.box?.boxType ?? "?"} em leilão`);
            break;
          case "ROUND_ENDED":
            if (!msg.winner) addLog(`⌛ Rodada encerrada sem lances`);
            break;
          case "ROUND_INTERMISSION":
            setBox(null);
            setIntermission({ endsAt: msg.endsAt ?? 0 });
            setMatchRounds({ played: msg.roundsPlayed ?? 0, total: msg.totalRounds ?? 0 });
            setIAmReady(false);
            break;
          case "READY_STATE":
            setReadyState({ ready: msg.ready ?? 0, total: msg.total ?? 0 });
            break;
          case "PLAYERS_PANEL":
            setPlayers(msg.players ?? []);
            break;
          case "BID_PLACED":
            addLog(`🔨 ${msg.leader} deu lance de ${msg.amount} em ${msg.boxId}`);
            sfx.gavel();
            setLastBids((prev) => ({ ...prev, [msg.leader]: msg.amount }));
            setBox((prev) =>
              prev && prev.boxId === msg.boxId
                ? { ...prev, currentBid: msg.amount, leader: msg.leader, timerMs: msg.timerMs, deadlineAt: Date.now() + msg.timerMs }
                : prev,
            );
            break;
          case "BOX_SOLD": {
            addLog(`🏆 ${msg.boxId} arrematada por ${msg.winner} (${msg.price})`);
            sfx.gavel();
            const mine = msg.winner === playerIdRef.current;
            if (mine) {
              setWonBoxes((prev) => (prev.some((b) => b.boxId === msg.boxId) ? prev : [...prev, { boxId: msg.boxId, boxType: msg.boxType }]));
            }
            setFlash({ kind: "win", emoji: "🏆", title: mine ? "Você arrematou!" : `${msg.winner} arrematou`, sub: `${BOX_EMOJI[msg.boxType] ?? "📦"} ${msg.boxType} por ${msg.price}` });
            break;
          }
          case "OPEN_RESULT":
            if (msg.ok) {
              setWonBoxes((prev) => prev.filter((b) => b.boxId !== msg.boxId));
              if (!msg.isMimic) {
                addLog(`🎁 Você abriu: ${msg.item}`); // mímico é narrado pelo BOX_OPENED
                sfx.fanfare();
                setFlash({ kind: "open", emoji: ITEM_EMOJI[msg.item] ?? "🎁", title: `Você abriu: ${msg.item}`, sub: "Item creditado ao inventário" });
              }
            } else addLog(`⚠️ Não foi possível abrir ${msg.boxId}: ${msg.reason}`);
            break;
          case "BOX_OPENED": {
            const who = msg.player === playerIdRef.current ? "Você" : msg.player;
            if (msg.isMimic) {
              addLog(`💀 ${who} abriu um MÍMICO — perdeu ${msg.penaltyDetail || "—"}`);
              sfx.thud();
              setFlash({ kind: "mimic", emoji: "💀", title: `${who} pegou um MÍMICO!`, sub: `Perdeu ${msg.penaltyDetail || "—"}` });
            } else if (msg.player !== playerIdRef.current) addLog(`📦 ${msg.player} abriu: ${msg.item}`);
            break;
          }
          case "BID_ACCEPTED":
            addLog(`✅ Seu lance em ${msg.boxId} foi aceito (atual: ${msg.currentBid})`);
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
              affinities: msg.affinities ?? [],
              collections: msg.collections ?? [],
            });
            break;
          case "SELL_RESULT":
            if (msg.ok) sfx.coin();
            addLog(msg.ok ? `💸 Vendeu ${msg.itemType} por ${msg.price}` : `⚠️ Venda falhou: ${msg.reason}`);
            break;
          case "BURN_RESULT":
            addLog(msg.ok ? `🔥 Queimou ${msg.itemType} → afinidade +${msg.affinity}` : `⚠️ Queima falhou: ${msg.reason}`);
            break;
          case "FORM_RESULT":
            if (msg.ok) sfx.fanfare();
            addLog(msg.ok ? `🏅 Coleção ${msg.kind} formada! +${msg.bonus}` : `⚠️ Não deu para formar ${msg.kind}: ${msg.reason}`);
            break;
          case "ERROR":
            addLog(`⚠️ ${msg.reason}`);
            break;
        }
      };
    },
    [name, addLog],
  );

  useEffect(() => () => wsRef.current?.close(), []);

  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  // Overlay de destaque (vitória / abertura / mímico): some sozinho após alguns segundos.
  useEffect(() => {
    if (!flash) return;
    const id = setTimeout(() => setFlash(null), flash.kind === "mimic" ? 2600 : 2200);
    return () => clearTimeout(id);
  }, [flash]);

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

  const placeBid = (boxId: string, amount: number) => send({ type: "PLACE_BID", boxId, amount });
  const sendOpen = (boxId: string) => send({ type: "OPEN_BOX", boxId });
  const sell = (itemId: string) => send({ type: "SELL_ITEM", itemId });
  const burn = (itemId: string) => send({ type: "BURN_ITEM", itemId });
  const form = (kind: string) => send({ type: "FORM_COLLECTION", kind });

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

      {/* ---------- MENU ---------- */}
      {phase === "menu" && (
        <div className={`${C.card} p-6 mt-8 max-w-md mx-auto flex flex-col gap-4`}>
          <div>
            <label className="text-xs uppercase tracking-wide text-muted">Seu nome</label>
            <input className={`${C.input} mt-1`} placeholder="ex.: ana" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {!name.trim() && <p className="text-xs text-muted -mt-2">Digite um nome para jogar.</p>}
          <div>
            <label className="text-xs uppercase tracking-wide text-muted">Rodadas (ao criar)</label>
            <select className={`${C.input} mt-1`} value={roundsToCreate} onChange={(e) => setRoundsToCreate(Number(e.target.value))}>
              {[5, 8, 10, 15].map((n) => (
                <option key={n} value={n}>{n} rodadas</option>
              ))}
            </select>
          </div>
          <button className={C.btnGold} disabled={!name.trim()} onClick={() => connect({ kind: "create", rounds: roundsToCreate })}>
            Criar sala
          </button>
          <div className="flex items-center gap-3 text-muted text-xs">
            <span className="h-px flex-1 bg-line" /> ou <span className="h-px flex-1 bg-line" />
          </div>
          <div className="flex gap-2">
            <input
              className={`${C.input} uppercase tracking-widest`}
              placeholder="CÓDIGO"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button
              className={C.btnSmall}
              disabled={!name.trim() || !joinCode.trim()}
              onClick={() => connect({ kind: "join", code: joinCode.trim() })}
            >
              Entrar
            </button>
          </div>
        </div>
      )}

      {/* ---------- LOBBY ---------- */}
      {phase === "lobby" && (
        <div className={`${C.card} p-6 mt-8 max-w-md mx-auto text-center`}>
          <p className="text-xs uppercase tracking-wide text-muted">Código da sala</p>
          <div className="font-display text-5xl text-gold tracking-[0.25em] my-2">{code}</div>
          <p className="text-muted text-sm mb-5">Compartilhe o código. A partida exige ao menos 2 jogadores.</p>
          <div className="text-left bg-surface-2 border border-line rounded-xl p-4 mb-5">
            <div className="text-sm text-muted mb-2">Jogadores ({lobby.players.length})</div>
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
                  <div className="flex justify-between"><span className="text-muted">💰 Saldo</span><b className="text-gold">{wallet.balance}</b></div>
                  <div className="flex justify-between"><span className="text-muted">🔒 Reservado</span><span>{wallet.reserved}</span></div>
                  <div className="flex justify-between"><span className="text-muted">🟢 Gastável</span><b className="text-emerald-400">{wallet.balance - wallet.reserved}</b></div>
                </div>
                {wallet.affinities.length > 0 && (
                  <div className="text-xs text-emerald-400 pt-2">✨ {wallet.affinities.map((a) => `${ITEM_EMOJI[a.type]} +${a.points}`).join("  ")}</div>
                )}
                {isHost && (
                  <button className={`${C.btnSmall} w-full mt-3`} onClick={() => send({ type: "END_MATCH" })}>Encerrar partida</button>
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
                      <span className={`flex-1 truncate ${p.id === playerId ? "text-gold font-semibold" : ""}`}>{p.id}{p.id === playerId ? " (você)" : ""}</span>
                      <span className="whitespace-nowrap">💰 <b className="text-gold">{p.money}</b></span>
                      <span className="whitespace-nowrap text-muted">🎒 {p.itemCount}</span>
                      <span className="whitespace-nowrap text-xs text-stone-400 w-14 text-right">{lastBids[p.id] ? `🔨 ${lastBids[p.id]}` : "—"}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* ----- CENTRO: palco da casa de leilão ----- */}
          <main className="order-1 lg:order-2 flex flex-col gap-3">
            <div className="stage min-h-[360px] flex items-center justify-center px-[16%] py-8">
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
                    className="relative z-[4] w-full max-w-[300px] text-center flex flex-col items-center gap-2"
                  >
                    <motion.div
                      className="text-7xl drop-shadow-[0_6px_22px_rgba(232,185,35,0.4)]"
                      animate={{ y: [0, -7, 0] }}
                      transition={{ repeat: Infinity, duration: 2.4, ease: "easeInOut" }}
                    >
                      {BOX_EMOJI[box.boxType] ?? "📦"}
                    </motion.div>
                    <div className="pedestal" />
                    <div className="font-display text-xl text-gold">Caixa {box.boxType}</div>
                    <div className="text-[11px] text-stone-400">
                      {ITEM_ORDER.filter((k) => box.odds?.[k] != null).map((k) => `${ITEM_EMOJI[k]} ${box.odds[k]}%`).join("  ")}
                    </div>
                    <motion.div key={box.currentBid} initial={{ scale: 1.35 }} animate={{ scale: 1 }} className="text-2xl font-bold text-gold mt-1">
                      {box.currentBid > 0 ? `💰 ${box.currentBid}` : "sem lances"}
                    </motion.div>
                    <div className="text-sm">líder: <b className={box.leader === playerId ? "text-gold" : ""}>{box.leader || "—"}</b></div>
                    <div className="text-sm text-red-400 tabular-nums">⏱ {boxCountdown(box)}</div>
                    {(() => {
                      const minInc = Math.max(5, Math.floor(box.currentBid * 0.05));
                      const minNext = box.currentBid + minInc;
                      const customVal = Number(bidAmount);
                      const customOk = bidAmount === "" || customVal >= minNext;
                      const bidValue = bidAmount === "" ? minNext : customVal;
                      return (
                        <div className="w-full flex flex-col gap-2 mt-1">
                          <div className="text-xs text-muted">lance mínimo: <b className="text-gold">{minNext}</b></div>
                          <div className="flex gap-1.5 justify-center">
                            <button className={C.btnSmall} onClick={() => placeBid(box.boxId, minNext)}>Mín</button>
                            {[10, 50, 100].map((n) => (
                              <button key={n} className={C.btnSmall} disabled={box.currentBid + n < minNext} onClick={() => placeBid(box.boxId, box.currentBid + n)}>+{n}</button>
                            ))}
                          </div>
                          <div className="flex gap-1.5">
                            <input className={`${C.input} text-center`} type="number" placeholder={`${minNext}`} value={bidAmount} onChange={(e) => setBidAmount(e.target.value)} />
                            <button className={C.btnGold} disabled={!customOk} onClick={() => placeBid(box.boxId, bidValue)}>Dar lance</button>
                          </div>
                        </div>
                      );
                    })()}
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

            {wonBoxes.length > 0 && (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-gold/10 border border-gold-dim rounded-xl px-4 py-3 flex flex-wrap items-center gap-2 justify-center">
                <b className="text-gold">🎉 Você arrematou! Abra:</b>
                {wonBoxes.map((b) => (
                  <button key={b.boxId} className={C.btnGold} onClick={() => sendOpen(b.boxId)}>Abrir {BOX_EMOJI[b.boxType] ?? "📦"}</button>
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
                  {ITEM_ORDER.filter((k) => prices[k] != null).map((k) => (<span key={k}>{ITEM_EMOJI[k]} {prices[k]}</span>))}
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
                      <button className={C.btnSmall} disabled={!firstFree} onClick={() => firstFree && sell(firstFree.id)}>vender</button>
                      <button className={C.btnSmall} disabled={!firstFree} onClick={() => firstFree && burn(firstFree.id)}>queimar</button>
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
                      <span className="text-gold">+{c.bonus}</span>
                      {formed > 0 && <span className="text-emerald-400">✓×{formed}</span>}
                      <button className={C.btnSmall} disabled={!canForm(c.requires)} onClick={() => form(c.kind)}>formar</button>
                    </div>
                  );
                })}
                {wallet.collections.length > 0 && (
                  <div className="text-sm pt-1">Bônus total: <b className="text-gold">{wallet.collections.reduce((s, f) => s + f.bonus, 0)}</b></div>
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
                    <td className="px-3 py-2 text-right tabular-nums">{r.money}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.items}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.bonus}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-bold text-gold">{r.net}</td>
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
    </div>
  );
}
