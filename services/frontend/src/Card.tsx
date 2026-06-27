// Cartas de habilidade — "arte" por tipo (cor + ícone + moldura). Visual distinto por carta,
// no estilo do Chest.tsx. As 10 cartas estão ativas (Bloqueio…Visão).

export interface CardDef {
  label: string;
  emoji: string;
  color: string; // cor da moldura/realce
  desc: string;
  targeted?: boolean; // mira um jogador (a UI pede o alvo)
}

export const CARDS: Record<string, CardDef> = {
  BLOCK: { label: "Bloqueio", emoji: "🚫", color: "#ef4444", desc: "O alvo não dá lance na próxima rodada.", targeted: true },
  DOUBLE: { label: "Dobro", emoji: "✖️", color: "#22d3ee", desc: "Sua abertura rende o DOBRO de itens." },
  TAX: { label: "Imposto", emoji: "💰", color: "#e8b923", desc: "Cada rival te paga no início da rodada." },
  INSURANCE: { label: "Seguro", emoji: "🛡️", color: "#34d399", desc: "Sem penalidade se você abrir um Mímico." },
  DISCOUNT: { label: "Desconto", emoji: "🏷️", color: "#a3e635", desc: "Pague menos se você vencer." },
  CURSE: { label: "Maldição", emoji: "🪤", color: "#a855f7", desc: "Se o alvo vencer, a caixa abre como Mímico.", targeted: true },
  UPGRADE: { label: "Reforço", emoji: "⬆️", color: "#f59e0b", desc: "A próxima caixa sobe um nível." },
  SHIELD: { label: "Escudo", emoji: "⛓️", color: "#60a5fa", desc: "Imune a Bloqueio/Maldição/Imposto." },
  GAVEL: { label: "Martelo", emoji: "🔨", color: "#fb923c", desc: "Incremento mínimo dobrado p/ rivais." },
  INSIGHT: { label: "Visão", emoji: "👁️", color: "#c084fc", desc: "Veja o item que a caixa vai dar." },
};

export const cardOf = (t: string): CardDef => CARDS[t] ?? { label: t, emoji: "🃏", color: "#a8a29e", desc: "" };

export function Card({ type, size = 64, dim = false }: { type: string; size?: number; dim?: boolean }) {
  const c = cardOf(type);
  return (
    <div
      title={`${c.label} — ${c.desc}`}
      className="rounded-lg border-2 flex flex-col items-center justify-center gap-0.5 shrink-0"
      style={{
        width: size,
        height: Math.round(size * 1.4),
        borderColor: c.color,
        background: `linear-gradient(160deg, ${c.color}26, #1c1917 60%)`,
        boxShadow: dim ? "none" : `0 0 0 1px ${c.color}44, 0 6px 16px -8px ${c.color}88`,
        opacity: dim ? 0.5 : 1,
      }}
    >
      <div style={{ fontSize: size * 0.4 }}>{c.emoji}</div>
      <div className="text-[10px] font-semibold leading-none px-1 text-center" style={{ color: c.color }}>
        {c.label}
      </div>
    </div>
  );
}
