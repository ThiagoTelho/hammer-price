// Mesa de leilão do Hammer Price (modelo round-based).
// Conecta ao gateway por WebSocket; a cada RODADA aparece UMA caixa (tipo sorteado),
// com as odds públicas, e os jogadores disputam por lances.
import { useEffect, useRef, useState, useCallback } from "react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "ws://localhost:8080";

interface Box {
  boxId: string;
  boxType: string;
  currentBid: number;
  leader: string;
  timerMs: number;
  odds: Record<string, number>;
  deadlineAt?: number; // instante absoluto (ms) em que o cronômetro zera, p/ contagem local
}

// Converte o timerMs (relativo, do servidor) em um instante absoluto local, para
// a contagem regressiva andar suavemente entre as atualizações de estado.
function withDeadline(box: Box | null): Box | null {
  if (!box) return null;
  return { ...box, deadlineAt: box.timerMs > 0 ? Date.now() + box.timerMs : 0 };
}

const BOX_EMOJI: Record<string, string> = {
  BRONZE: "🥉",
  SILVER: "🥈",
  GOLD: "🥇",
  VAULT: "💎",
};

// Ordem e ícones dos itens, para exibir as odds públicas da caixa.
const ITEM_ORDER = ["COPPER", "SILVER", "GOLD", "DIAMOND", "MIMIC"];
const ITEM_EMOJI: Record<string, string> = {
  COPPER: "🪙",
  SILVER: "🥈",
  GOLD: "🥇",
  DIAMOND: "💎",
  MIMIC: "💀",
};

export function App() {
  const [name, setName] = useState("");
  const [room, setRoom] = useState("room-1");
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [round, setRound] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [wonBoxes, setWonBoxes] = useState<{ boxId: string; boxType: string }[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [wallet, setWallet] = useState<{
    balance: number;
    reserved: number;
    inventory: { id: string; type: string; state: string }[];
    affinities: { type: string; points: number }[];
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  // playerId via ref: o handler de mensagens é criado uma vez e precisa do id atual.
  const playerIdRef = useRef("");

  const addLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${line}`, ...prev].slice(0, 30));
  }, []);

  const connect = useCallback(() => {
    const player = name.trim() || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
    const ws = new WebSocket(
      `${GATEWAY_URL}?player=${encodeURIComponent(player)}&room=${encodeURIComponent(room)}`,
    );
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      addLog(`Conectado como ${player}`);
    };
    ws.onclose = () => {
      setConnected(false);
      addLog("Desconectado");
    };
    ws.onerror = () => addLog("Erro de conexão com o gateway");
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      switch (msg.type) {
        case "WELCOME":
          setPlayerId(msg.playerId);
          playerIdRef.current = msg.playerId;
          setRound(msg.round ?? 0);
          setBox(withDeadline(msg.box ?? null));
          if (msg.market) setPrices(msg.market); // snapshot lido da réplica do Redis
          break;
        case "ROOM_STATE":
          setRound(msg.round ?? 0);
          setBox(withDeadline(msg.box ?? null));
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
          // Atualiza o card da caixa: novo lance atual, líder e cronômetro reiniciado.
          setBox((prev) =>
            prev && prev.boxId === msg.boxId
              ? { ...prev, currentBid: msg.amount, leader: msg.leader, timerMs: msg.timerMs, deadlineAt: Date.now() + msg.timerMs }
              : prev,
          );
          break;
        case "BOX_SOLD":
          addLog(`🏆 ${msg.boxId} arrematada por ${msg.winner} (${msg.price})`);
          if (msg.winner === playerIdRef.current) {
            setWonBoxes((prev) =>
              prev.some((b) => b.boxId === msg.boxId)
                ? prev
                : [...prev, { boxId: msg.boxId, boxType: msg.boxType }],
            );
          }
          break;
        case "OPEN_RESULT":
          if (msg.ok) {
            addLog(`🎁 Você abriu ${msg.boxId}: ${msg.item}${msg.isMimic ? " 💀 (Mímico!)" : ""}`);
            setWonBoxes((prev) => prev.filter((b) => b.boxId !== msg.boxId));
          } else {
            addLog(`⚠️ Não foi possível abrir ${msg.boxId}: ${msg.reason}`);
          }
          break;
        case "BOX_OPENED":
          if (msg.player !== playerIdRef.current) {
            addLog(`📦 ${msg.player} abriu ${msg.boxId}: ${msg.item}${msg.isMimic ? " 💀" : ""}`);
          }
          break;
        case "BID_ACCEPTED":
          addLog(`✅ Seu lance em ${msg.boxId} foi aceito (atual: ${msg.currentBid})`);
          // Feedback imediato no card (antes mesmo do BID_PLACED assíncrono chegar).
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
          });
          break;
        case "SELL_RESULT":
          if (msg.ok) addLog(`💸 Vendeu ${msg.itemType} por ${msg.price}`);
          else addLog(`⚠️ Venda falhou: ${msg.reason}`);
          break;
        case "BURN_RESULT":
          if (msg.ok) addLog(`🔥 Queimou ${msg.itemType} → afinidade ${msg.itemType} agora +${msg.affinity}`);
          else addLog(`⚠️ Queima falhou: ${msg.reason}`);
          break;
        case "ERROR":
          addLog(`⚠️ ${msg.reason}`);
          break;
      }
    };
  }, [name, room, addLog]);

  useEffect(() => () => wsRef.current?.close(), []);

  // Pulso de re-render p/ a contagem regressiva andar entre atualizações de estado.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const countdown = (b: Box): string => {
    if (!b.deadlineAt) return "—";
    return `${Math.max(0, Math.ceil((b.deadlineAt - Date.now()) / 1000))}s`;
  };

  const sendBid = (boxId: string, currentBid: number) => {
    const amount = currentBid + Math.max(5, Math.floor(currentBid * 0.05));
    wsRef.current?.send(JSON.stringify({ type: "PLACE_BID", boxId, amount }));
  };

  const sendOpen = (boxId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "OPEN_BOX", boxId }));
  };

  const sell = (itemId: string) => wsRef.current?.send(JSON.stringify({ type: "SELL_ITEM", itemId }));
  const burn = (itemId: string) => wsRef.current?.send(JSON.stringify({ type: "BURN_ITEM", itemId }));

  const oddsLine = (odds: Record<string, number>): string =>
    ITEM_ORDER.filter((k) => odds?.[k] != null)
      .map((k) => `${ITEM_EMOJI[k]} ${odds[k]}%`)
      .join("   ");

  const invCounts = (inv: { type: string }[]): string => {
    const counts: Record<string, number> = {};
    for (const it of inv) counts[it.type] = (counts[it.type] ?? 0) + 1;
    const parts = ITEM_ORDER.filter((t) => counts[t]).map((t) => `${ITEM_EMOJI[t]}×${counts[t]}`);
    return parts.length ? parts.join("  ") : "vazio";
  };

  return (
    <div style={S.page}>
      <h1 style={{ margin: 0 }}>🔨 Hammer Price</h1>
      <p style={{ color: "#888", marginTop: 4 }}>Leilão de caixas misteriosas — uma caixa por rodada</p>

      {!connected ? (
        <div style={S.connectBox}>
          <input
            style={S.input}
            placeholder="Seu nome (ex.: ana)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
          />
          <select style={S.select} value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="room-1">Sala room-1</option>
            <option value="room-2">Sala room-2</option>
          </select>
          <button style={S.btn} onClick={connect}>
            Entrar na sala
          </button>
        </div>
      ) : (
        <p>
          Jogando como <b>{playerId}</b> · <b>Sala {room}</b> · <b>Rodada {round || "—"}</b>
        </p>
      )}

      {connected && wallet && (
        <div style={S.hud}>
          <span>💰 Saldo <b>{wallet.balance}</b></span>
          <span>🔒 Reservado <b>{wallet.reserved}</b></span>
          <span>🟢 Gastável <b>{wallet.balance - wallet.reserved}</b></span>
          <span style={{ marginLeft: "auto" }}>🎒 {invCounts(wallet.inventory)}</span>
        </div>
      )}

      {connected && wallet && wallet.inventory.length > 0 && (
        <div style={S.inv}>
          {ITEM_ORDER.filter((t) => wallet.inventory.some((i) => i.type === t)).map((t) => {
            const count = wallet.inventory.filter((i) => i.type === t).length;
            const firstFree = wallet.inventory.find((i) => i.type === t && i.state === "FREE");
            return (
              <div key={t} style={S.invRow}>
                <span style={{ minWidth: 110 }}>
                  {ITEM_EMOJI[t]} {t} ×{count}
                </span>
                <span style={{ fontSize: 12, color: "#888", minWidth: 64 }}>
                  {prices[t] != null ? `mkt ${prices[t]}` : ""}
                </span>
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
      {connected && wallet && wallet.affinities.length > 0 && (
        <div style={S.affinity}>
          ✨ Afinidade (chance extra ao abrir):{" "}
          {wallet.affinities.map((a) => `${ITEM_EMOJI[a.type]} +${a.points}`).join("   ")}
        </div>
      )}

      {Object.keys(prices).length > 0 && (
        <div style={S.market}>
          <b>📈 Mercado:</b>{" "}
          {ITEM_ORDER.filter((k) => prices[k] != null)
            .map((k) => `${ITEM_EMOJI[k]} ${prices[k]}`)
            .join(" ")}
        </div>
      )}

      <div style={S.stage}>
        {box ? (
          <div style={S.card}>
            <div style={{ fontSize: 48 }}>{BOX_EMOJI[box.boxType] ?? "📦"}</div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>Caixa {box.boxType}</div>
            <div style={{ fontSize: 12, color: "#888" }}>{box.boxId}</div>
            <div style={S.odds}>{oddsLine(box.odds)}</div>
            <div style={S.bid}>{box.currentBid > 0 ? `💰 ${box.currentBid}` : "sem lances"}</div>
            <div style={{ fontSize: 13 }}>
              líder: <b>{box.leader || "—"}</b>
            </div>
            <div style={{ fontSize: 14, color: "#c0392b" }}>⏱ {countdown(box)}</div>
            <button style={S.btn} disabled={!connected} onClick={() => sendBid(box.boxId, box.currentBid)}>
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

      <h3>Eventos</h3>
      <div style={S.log}>
        {log.map((l, i) => (
          <div key={i} style={{ padding: "2px 0", borderBottom: "1px solid #eee" }}>
            {l}
          </div>
        ))}
      </div>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "system-ui, sans-serif", maxWidth: 760, margin: "0 auto", padding: 24 },
  connectBox: { display: "flex", gap: 8, margin: "12px 0" },
  input: { padding: "8px 10px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6, flex: 1 },
  select: { padding: "8px 10px", fontSize: 14, border: "1px solid #ccc", borderRadius: 6 },
  btn: {
    padding: "8px 14px",
    fontSize: 14,
    border: "none",
    borderRadius: 6,
    background: "#5b3df5",
    color: "#fff",
    cursor: "pointer",
  },
  hud: {
    display: "flex",
    gap: 16,
    alignItems: "center",
    flexWrap: "wrap",
    background: "#f5f3ff",
    border: "1px solid #ddd6fe",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 14,
    margin: "6px 0",
  },
  market: {
    background: "#eef6ff",
    border: "1px solid #cfe3ff",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 14,
    margin: "6px 0",
  },
  inv: {
    border: "1px solid #eee",
    borderRadius: 8,
    padding: "8px 12px",
    margin: "6px 0",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  invRow: { display: "flex", gap: 10, alignItems: "center", fontSize: 14 },
  smallBtn: {
    padding: "4px 10px",
    fontSize: 13,
    border: "none",
    borderRadius: 6,
    background: "#5b3df5",
    color: "#fff",
    cursor: "pointer",
  },
  affinity: { fontSize: 13, color: "#16a34a", margin: "4px 0" },
  stage: { display: "flex", justifyContent: "center", margin: "16px 0" },
  card: {
    border: "1px solid #e3e3e3",
    borderRadius: 12,
    padding: 20,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "center",
    minWidth: 240,
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  },
  odds: { fontSize: 13, color: "#444", letterSpacing: 0.2 },
  bid: { fontSize: 20, fontWeight: 700, color: "#5b3df5" },
  intermission: { fontSize: 16, color: "#888", padding: 32 },
  log: { fontSize: 13, fontFamily: "ui-monospace, monospace", maxHeight: 220, overflowY: "auto" },
  won: {
    background: "#fff8e1",
    border: "1px solid #ffe082",
    borderRadius: 8,
    padding: "10px 12px",
    margin: "8px 0",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    alignItems: "center",
  },
  openBtn: {
    padding: "6px 12px",
    fontSize: 14,
    border: "none",
    borderRadius: 6,
    background: "#e67e22",
    color: "#fff",
    cursor: "pointer",
  },
};
