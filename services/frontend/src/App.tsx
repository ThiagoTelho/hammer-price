// Mesa de leilão do Hammer Price.
// Fluxo: menu (criar/entrar) → lobby → partida (rodadas + HUD) → ranking final.
import { useEffect, useRef, useState, useCallback } from "react";

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

export function App() {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [phase, setPhase] = useState<Phase>("menu");
  const [playerId, setPlayerId] = useState("");
  const [code, setCode] = useState("");
  const [isHost, setIsHost] = useState(false);
  const [lobby, setLobby] = useState<{ status: string; host: string; players: string[] }>({ status: "WAITING", host: "", players: [] });
  const [matchEndsAt, setMatchEndsAt] = useState(0);
  const [ranking, setRanking] = useState<RankRow[]>([]);

  const [round, setRound] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [wonBoxes, setWonBoxes] = useState<{ boxId: string; boxType: string }[]>([]);
  const [log, setLog] = useState<string[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef("");
  const pendingRef = useRef<{ kind: "create" } | { kind: "join"; code: string } | null>(null);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${line}`, ...prev].slice(0, 30));
  }, []);

  const send = (o: unknown) => wsRef.current?.send(JSON.stringify(o));

  const connect = useCallback(
    (action: { kind: "create" } | { kind: "join"; code: string }) => {
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
            if (pendingRef.current?.kind === "create") send({ type: "CREATE_ROOM" });
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
            break;
          case "MATCH_STARTED":
            setMatchEndsAt(msg.endsAt ?? 0);
            setPhase("playing");
            addLog("🚀 Partida iniciada!");
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
            addLog(`🆕 Rodada ${msg.round}: caixa ${msg.box?.boxType ?? "?"} em leilão`);
            break;
          case "ROUND_ENDED":
            if (!msg.winner) addLog(`⌛ Rodada ${msg.round} encerrada sem lances`);
            break;
          case "BID_PLACED":
            addLog(`🔨 ${msg.leader} deu lance de ${msg.amount} em ${msg.boxId}`);
            setBox((prev) =>
              prev && prev.boxId === msg.boxId
                ? { ...prev, currentBid: msg.amount, leader: msg.leader, timerMs: msg.timerMs, deadlineAt: Date.now() + msg.timerMs }
                : prev,
            );
            break;
          case "BOX_SOLD":
            addLog(`🏆 ${msg.boxId} arrematada por ${msg.winner} (${msg.price})`);
            if (msg.winner === playerIdRef.current) {
              setWonBoxes((prev) => (prev.some((b) => b.boxId === msg.boxId) ? prev : [...prev, { boxId: msg.boxId, boxType: msg.boxType }]));
            }
            break;
          case "OPEN_RESULT":
            if (msg.ok) {
              addLog(`🎁 Você abriu ${msg.boxId}: ${msg.item}${msg.isMimic ? " 💀 (Mímico!)" : ""}`);
              setWonBoxes((prev) => prev.filter((b) => b.boxId !== msg.boxId));
            } else addLog(`⚠️ Não foi possível abrir ${msg.boxId}: ${msg.reason}`);
            break;
          case "BOX_OPENED":
            if (msg.player !== playerIdRef.current) addLog(`📦 ${msg.player} abriu ${msg.boxId}: ${msg.item}${msg.isMimic ? " 💀" : ""}`);
            break;
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
            addLog(msg.ok ? `💸 Vendeu ${msg.itemType} por ${msg.price}` : `⚠️ Venda falhou: ${msg.reason}`);
            break;
          case "BURN_RESULT":
            addLog(msg.ok ? `🔥 Queimou ${msg.itemType} → afinidade +${msg.affinity}` : `⚠️ Queima falhou: ${msg.reason}`);
            break;
          case "FORM_RESULT":
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

  // Pulso de re-render para os cronômetros (caixa e partida).
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const boxCountdown = (b: Box): string => {
    if (!b.leader || !b.deadlineAt) return "—";
    return `${Math.max(0, Math.ceil((b.deadlineAt - Date.now()) / 1000))}s`;
  };
  const matchClock = (): string => {
    const s = Math.max(0, Math.ceil((matchEndsAt - Date.now()) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const sendBid = (boxId: string, currentBid: number) =>
    send({ type: "PLACE_BID", boxId, amount: currentBid + Math.max(5, Math.floor(currentBid * 0.05)) });
  const sendOpen = (boxId: string) => send({ type: "OPEN_BOX", boxId });
  const sell = (itemId: string) => send({ type: "SELL_ITEM", itemId });
  const burn = (itemId: string) => send({ type: "BURN_ITEM", itemId });
  const form = (kind: string) => send({ type: "FORM_COLLECTION", kind });

  const freeCount = (type: string): number => wallet?.inventory.filter((i) => i.type === type && i.state === "FREE").length ?? 0;
  const canForm = (requires: Record<string, number>): boolean => Object.entries(requires).every(([t, n]) => freeCount(t) >= n);
  const invCounts = (inv: { type: string }[]): string => {
    const counts: Record<string, number> = {};
    for (const it of inv) counts[it.type] = (counts[it.type] ?? 0) + 1;
    const parts = ITEM_ORDER.filter((t) => counts[t]).map((t) => `${ITEM_EMOJI[t]}×${counts[t]}`);
    return parts.length ? parts.join("  ") : "vazio";
  };

  return (
    <div style={S.page}>
      <h1 style={{ margin: 0 }}>🔨 Hammer Price</h1>
      <p style={{ color: "#888", marginTop: 4 }}>Leilão de caixas misteriosas em tempo real</p>

      {/* ---------- MENU ---------- */}
      {phase === "menu" && (
        <div style={S.menu}>
          <input style={S.input} placeholder="Seu nome (ex.: ana)" value={name} onChange={(e) => setName(e.target.value)} />
          <div style={{ display: "flex", gap: 8, margin: "8px 0" }}>
            <button style={S.btn} onClick={() => connect({ kind: "create" })}>
              Criar sala
            </button>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...S.input, textTransform: "uppercase" }}
              placeholder="Código da sala"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            />
            <button style={S.btn} disabled={!joinCode.trim()} onClick={() => connect({ kind: "join", code: joinCode.trim() })}>
              Entrar por código
            </button>
          </div>
        </div>
      )}

      {/* ---------- LOBBY ---------- */}
      {phase === "lobby" && (
        <div style={S.lobby}>
          <div style={{ fontSize: 18 }}>
            Sala <b style={{ fontSize: 24, letterSpacing: 2 }}>{code}</b> {isHost && "(você é o host)"}
          </div>
          <p style={{ color: "#888" }}>Compartilhe o código. A partida exige no mínimo 2 jogadores.</p>
          <div>
            <b>Jogadores ({lobby.players.length})</b>
            <ul>
              {lobby.players.map((p) => (
                <li key={p}>
                  {p} {p === lobby.host && "👑"} {p === playerId && "(você)"}
                </li>
              ))}
            </ul>
          </div>
          {isHost ? (
            <button style={S.btn} disabled={lobby.players.length < 2} onClick={() => send({ type: "START_MATCH" })}>
              {lobby.players.length < 2 ? "Aguardando jogadores…" : "Iniciar partida"}
            </button>
          ) : (
            <p>Aguardando o host iniciar…</p>
          )}
        </div>
      )}

      {/* ---------- PARTIDA ---------- */}
      {phase === "playing" && (
        <>
          <div style={S.matchBar}>
            <span>
              <b>{playerId}</b> · Sala {code} · Rodada {round || "—"}
            </span>
            <span style={{ marginLeft: "auto", fontWeight: 700 }}>⏳ {matchClock()}</span>
            {isHost && (
              <button style={S.smallBtn} onClick={() => send({ type: "END_MATCH" })}>
                Encerrar
              </button>
            )}
          </div>

          {wallet && (
            <div style={S.hud}>
              <span>💰 Saldo <b>{wallet.balance}</b></span>
              <span>🔒 Reservado <b>{wallet.reserved}</b></span>
              <span>🟢 Gastável <b>{wallet.balance - wallet.reserved}</b></span>
              <span style={{ marginLeft: "auto" }}>🎒 {invCounts(wallet.inventory)}</span>
            </div>
          )}

          {prices && Object.keys(prices).length > 0 && (
            <div style={S.market}>
              <b>📈 Mercado:</b> {ITEM_ORDER.filter((k) => prices[k] != null).map((k) => `${ITEM_EMOJI[k]} ${prices[k]}`).join(" ")}
            </div>
          )}

          <div style={S.stage}>
            {box ? (
              <div style={S.card}>
                <div style={{ fontSize: 48 }}>{BOX_EMOJI[box.boxType] ?? "📦"}</div>
                <div style={{ fontWeight: 700, fontSize: 18 }}>Caixa {box.boxType}</div>
                <div style={{ fontSize: 12, color: "#888" }}>{box.boxId}</div>
                <div style={S.odds}>{ITEM_ORDER.filter((k) => box.odds?.[k] != null).map((k) => `${ITEM_EMOJI[k]} ${box.odds[k]}%`).join("   ")}</div>
                <div style={S.bid}>{box.currentBid > 0 ? `💰 ${box.currentBid}` : "sem lances"}</div>
                <div style={{ fontSize: 13 }}>líder: <b>{box.leader || "—"}</b></div>
                <div style={{ fontSize: 14, color: "#c0392b" }}>⏱ {boxCountdown(box)}</div>
                <button style={S.btn} onClick={() => sendBid(box.boxId, box.currentBid)}>
                  Dar lance
                </button>
              </div>
            ) : (
              <div style={S.intermission}>⏳ Aguardando a próxima rodada…</div>
            )}
          </div>

          {wonBoxes.length > 0 && (
            <div style={S.won}>
              <b>🎉 Você arrematou! Abra:</b>{" "}
              {wonBoxes.map((b) => (
                <button key={b.boxId} style={S.openBtn} onClick={() => sendOpen(b.boxId)}>
                  Abrir {BOX_EMOJI[b.boxType] ?? "📦"} {b.boxId}
                </button>
              ))}
            </div>
          )}

          {wallet && wallet.inventory.length > 0 && (
            <div style={S.inv}>
              {ITEM_ORDER.filter((t) => wallet.inventory.some((i) => i.type === t)).map((t) => {
                const count = wallet.inventory.filter((i) => i.type === t).length;
                const locked = wallet.inventory.filter((i) => i.type === t && i.state !== "FREE").length;
                const firstFree = wallet.inventory.find((i) => i.type === t && i.state === "FREE");
                return (
                  <div key={t} style={S.invRow}>
                    <span style={{ minWidth: 120 }}>
                      {ITEM_EMOJI[t]} {t} ×{count}
                      {locked > 0 ? ` (${locked}🔒)` : ""}
                    </span>
                    <span style={{ fontSize: 12, color: "#888", minWidth: 64 }}>{prices[t] != null ? `mkt ${prices[t]}` : ""}</span>
                    <button style={S.smallBtn} disabled={!firstFree} onClick={() => firstFree && sell(firstFree.id)}>
                      vender
                    </button>
                    <button style={S.smallBtn} disabled={!firstFree} onClick={() => firstFree && burn(firstFree.id)}>
                      queimar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
          {wallet && wallet.affinities.length > 0 && (
            <div style={S.affinity}>
              ✨ Afinidade: {wallet.affinities.map((a) => `${ITEM_EMOJI[a.type]} +${a.points}`).join("   ")}
            </div>
          )}

          {wallet && (
            <div style={S.coll}>
              <b>🏅 Coleções</b>
              {COLLECTIONS.map((c) => {
                const formed = wallet.collections.filter((f) => f.kind === c.kind).length;
                const reqStr = Object.entries(c.requires).map(([t, n]) => `${ITEM_EMOJI[t]}×${n}`).join(" ");
                return (
                  <div key={c.kind} style={S.collRow}>
                    <span style={{ minWidth: 130 }}>{c.label}</span>
                    <span style={{ fontSize: 12, color: "#888", minWidth: 130 }}>{reqStr}</span>
                    <span style={{ fontSize: 12, minWidth: 56 }}>+{c.bonus}</span>
                    {formed > 0 && <span style={{ fontSize: 12, color: "#16a34a" }}>✓×{formed}</span>}
                    <button style={S.smallBtn} disabled={!canForm(c.requires)} onClick={() => form(c.kind)}>
                      formar
                    </button>
                  </div>
                );
              })}
              {wallet.collections.length > 0 && (
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  Bônus total: <b>{wallet.collections.reduce((s, f) => s + f.bonus, 0)}</b>
                </div>
              )}
            </div>
          )}

          <h3>Eventos</h3>
          <div style={S.log}>
            {log.map((l, i) => (
              <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #eee" }}>
                {l}
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------- RANKING ---------- */}
      {phase === "ended" && (
        <div style={S.ended}>
          <h2>🏁 Fim da partida — Ranking</h2>
          <table style={S.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Jogador</th>
                <th>💰 Dinheiro</th>
                <th>🎒 Itens</th>
                <th>🏅 Bônus</th>
                <th>Patrimônio</th>
              </tr>
            </thead>
            <tbody>
              {ranking.map((r, i) => (
                <tr key={r.playerId} style={{ fontWeight: r.playerId === playerId ? 700 : 400 }}>
                  <td>{i === 0 ? "🥇" : i + 1}</td>
                  <td>{r.playerId} {r.playerId === playerId && "(você)"}</td>
                  <td>{r.money}</td>
                  <td>{r.items}</td>
                  <td>{r.bonus}</td>
                  <td><b>{r.net}</b></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button style={S.btn} onClick={() => window.location.reload()}>
            Voltar ao menu
          </button>
        </div>
      )}
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "0 auto", padding: 24 },
  menu: { display: "flex", flexDirection: "column", gap: 4, margin: "16px 0", maxWidth: 420 },
  lobby: { margin: "16px 0" },
  input: { padding: "8px 10px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6, flex: 1 },
  btn: { padding: "8px 14px", fontSize: 14, border: "none", borderRadius: 6, background: "#5b3df5", color: "#fff", cursor: "pointer" },
  matchBar: {
    display: "flex",
    gap: 12,
    alignItems: "center",
    background: "#1e1b4b",
    color: "#fff",
    borderRadius: 8,
    padding: "8px 12px",
    margin: "8px 0",
    fontSize: 14,
  },
  hud: { display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 8, padding: "8px 12px", fontSize: 14, margin: "6px 0" },
  market: { background: "#eef6ff", border: "1px solid #cfe3ff", borderRadius: 8, padding: "6px 12px", fontSize: 14, margin: "6px 0" },
  stage: { display: "flex", justifyContent: "center", margin: "16px 0" },
  card: { border: "1px solid #e3e3e3", borderRadius: 12, padding: 20, textAlign: "center", display: "flex", flexDirection: "column", gap: 8, alignItems: "center", minWidth: 240, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" },
  odds: { fontSize: 13, color: "#444" },
  bid: { fontSize: 20, fontWeight: 700, color: "#5b3df5" },
  intermission: { fontSize: 16, color: "#888", padding: 32 },
  inv: { border: "1px solid #eee", borderRadius: 8, padding: "8px 12px", margin: "6px 0", display: "flex", flexDirection: "column", gap: 6 },
  invRow: { display: "flex", gap: 10, alignItems: "center", fontSize: 14 },
  smallBtn: { padding: "4px 10px", fontSize: 13, border: "none", borderRadius: 6, background: "#5b3df5", color: "#fff", cursor: "pointer" },
  affinity: { fontSize: 13, color: "#16a34a", margin: "4px 0" },
  coll: { border: "1px solid #fde68a", background: "#fffbeb", borderRadius: 8, padding: "8px 12px", margin: "6px 0", display: "flex", flexDirection: "column", gap: 5 },
  collRow: { display: "flex", gap: 10, alignItems: "center", fontSize: 14 },
  log: { fontSize: 13, fontFamily: "ui-monospace, monospace", maxHeight: 200, overflowY: "auto" },
  won: { background: "#fff8e1", border: "1px solid #ffe082", borderRadius: 8, padding: "10px 12px", margin: "8px 0", display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" },
  openBtn: { padding: "6px 12px", fontSize: 14, border: "none", borderRadius: 6, background: "#e67e22", color: "#fff", cursor: "pointer" },
  ended: { margin: "16px 0" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 14 },
};
