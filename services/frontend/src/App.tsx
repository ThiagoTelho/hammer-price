// Mesa de leilão do Hammer Price (fatia vertical).
// Conecta ao gateway por WebSocket, mostra as caixas e permite dar lances.
import { useEffect, useRef, useState, useCallback } from "react";

const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL ?? "ws://localhost:8080";

interface Box {
  boxId: string;
  boxType: string;
  currentBid: number;
  leader: string;
  timerMs: number;
}

const BOX_EMOJI: Record<string, string> = {
  BRONZE: "🥉",
  SILVER: "🥈",
  GOLD: "🥇",
  VAULT: "💎",
};

export function App() {
  const [name, setName] = useState("");
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const addLog = useCallback((line: string) => {
    setLog((prev) => [`${new Date().toLocaleTimeString()} — ${line}`, ...prev].slice(0, 30));
  }, []);

  const connect = useCallback(() => {
    const player = name.trim() || `player-${Math.floor(Math.random() * 9000 + 1000)}`;
    const ws = new WebSocket(`${GATEWAY_URL}?player=${encodeURIComponent(player)}`);
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
          setBoxes(msg.boxes ?? []);
          break;
        case "STATE":
          setBoxes(msg.boxes ?? []);
          break;
        case "BID_PLACED":
          addLog(`🔨 ${msg.leader} deu lance de ${msg.amount} em ${msg.boxId}`);
          break;
        case "BID_ACCEPTED":
          addLog(`✅ Seu lance em ${msg.boxId} foi aceito (atual: ${msg.currentBid})`);
          break;
        case "BID_REJECTED":
          addLog(`❌ Lance rejeitado em ${msg.boxId}: ${msg.reason}`);
          break;
        case "ERROR":
          addLog(`⚠️ ${msg.reason}`);
          break;
      }
    };
  }, [name, addLog]);

  useEffect(() => () => wsRef.current?.close(), []);

  const sendBid = (boxId: string, currentBid: number) => {
    const amount = currentBid + Math.max(5, Math.floor(currentBid * 0.05));
    wsRef.current?.send(JSON.stringify({ type: "PLACE_BID", boxId, amount }));
  };

  return (
    <div style={S.page}>
      <h1 style={{ margin: 0 }}>🔨 Hammer Price</h1>
      <p style={{ color: "#888", marginTop: 4 }}>Leilão de caixas misteriosas — fatia vertical</p>

      {!connected ? (
        <div style={S.connectBox}>
          <input
            style={S.input}
            placeholder="Seu nome (ex.: ana)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && connect()}
          />
          <button style={S.btn} onClick={connect}>
            Entrar na sala
          </button>
        </div>
      ) : (
        <p>
          Jogando como <b>{playerId}</b>
        </p>
      )}

      <div style={S.grid}>
        {boxes.map((b) => (
          <div key={b.boxId} style={S.card}>
            <div style={{ fontSize: 40 }}>{BOX_EMOJI[b.boxType] ?? "📦"}</div>
            <div style={{ fontWeight: 700 }}>{b.boxType}</div>
            <div style={{ fontSize: 12, color: "#888" }}>{b.boxId}</div>
            <div style={S.bid}>{b.currentBid > 0 ? `💰 ${b.currentBid}` : "sem lances"}</div>
            <div style={{ fontSize: 12 }}>
              líder: <b>{b.leader || "—"}</b>
            </div>
            <button style={S.btn} disabled={!connected} onClick={() => sendBid(b.boxId, b.currentBid)}>
              Dar lance
            </button>
          </div>
        ))}
      </div>

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
  btn: {
    padding: "8px 14px",
    fontSize: 14,
    border: "none",
    borderRadius: 6,
    background: "#5b3df5",
    color: "#fff",
    cursor: "pointer",
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, margin: "16px 0" },
  card: {
    border: "1px solid #e3e3e3",
    borderRadius: 10,
    padding: 14,
    textAlign: "center",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "center",
  },
  bid: { fontSize: 18, fontWeight: 700, color: "#5b3df5" },
  log: { fontSize: 13, fontFamily: "ui-monospace, monospace", maxHeight: 220, overflowY: "auto" },
};
