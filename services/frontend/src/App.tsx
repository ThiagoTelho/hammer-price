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
  deadlineAt?: number; // instante absoluto (ms) em que o cronômetro zera, p/ contagem local
}

// Converte o timerMs (relativo, do servidor) em um instante absoluto local, para
// a contagem regressiva andar suavemente entre as atualizações de STATE.
function withDeadlines(boxes: Box[]): Box[] {
  const now = Date.now();
  return boxes.map((b) => ({ ...b, deadlineAt: b.timerMs > 0 ? now + b.timerMs : 0 }));
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
  const [wonBoxes, setWonBoxes] = useState<{ boxId: string; boxType: string }[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  // playerId via ref: o handler de mensagens é criado uma vez e precisa do id atual.
  const playerIdRef = useRef("");

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
          playerIdRef.current = msg.playerId;
          setBoxes(withDeadlines(msg.boxes ?? []));
          break;
        case "STATE":
          setBoxes(withDeadlines(msg.boxes ?? []));
          break;
        case "BID_PLACED":
          addLog(`🔨 ${msg.leader} deu lance de ${msg.amount} em ${msg.boxId}`);
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

  // Pulso de re-render p/ a contagem regressiva andar entre atualizações de STATE.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 250);
    return () => clearInterval(id);
  }, []);

  const countdown = (b: Box): string => {
    if (!b.leader || !b.deadlineAt) return "—";
    return `${Math.max(0, Math.ceil((b.deadlineAt - Date.now()) / 1000))}s`;
  };

  const sendBid = (boxId: string, currentBid: number) => {
    const amount = currentBid + Math.max(5, Math.floor(currentBid * 0.05));
    wsRef.current?.send(JSON.stringify({ type: "PLACE_BID", boxId, amount }));
  };

  const sendOpen = (boxId: string) => {
    wsRef.current?.send(JSON.stringify({ type: "OPEN_BOX", boxId }));
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
            <div style={{ fontSize: 12, color: countdown(b) !== "—" ? "#c0392b" : "#888" }}>
              ⏱ {countdown(b)}
            </div>
            <button style={S.btn} disabled={!connected} onClick={() => sendBid(b.boxId, b.currentBid)}>
              Dar lance
            </button>
          </div>
        ))}
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
