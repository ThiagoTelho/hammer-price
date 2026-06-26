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
  const [connected, setConnected] = useState(false);
  const [playerId, setPlayerId] = useState("");
  const [round, setRound] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [wonBoxes, setWonBoxes] = useState<{ boxId: string; boxType: string }[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
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
          setRound(msg.round ?? 0);
          setBox(withDeadline(msg.box ?? null));
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
        case "MARKET_UPDATED":
          setPrices(msg.prices ?? {});
          break;
        case "ERROR":
          addLog(`⚠️ ${msg.reason}`);
          break;
      }
    };
  }, [name, addLog]);

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

  const oddsLine = (odds: Record<string, number>): string =>
    ITEM_ORDER.filter((k) => odds?.[k] != null)
      .map((k) => `${ITEM_EMOJI[k]} ${odds[k]}%`)
      .join("   ");

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
          <button style={S.btn} onClick={connect}>
            Entrar na sala
          </button>
        </div>
      ) : (
        <p>
          Jogando como <b>{playerId}</b> · <b>Rodada {round || "—"}</b>
        </p>
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
  btn: {
    padding: "8px 14px",
    fontSize: 14,
    border: "none",
    borderRadius: 6,
    background: "#5b3df5",
    color: "#fff",
    cursor: "pointer",
  },
  market: {
    background: "#eef6ff",
    border: "1px solid #cfe3ff",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 14,
    margin: "6px 0",
  },
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
