// Cartas de habilidade — visual de "carta" (moldura colorida + ícone em selo + nome), com
// ÍCONES (lucide) no lugar de emojis. As 11 cartas estão ativas (Bloqueio…Falência).
import {
  Ban, Copy, Coins, ShieldCheck, Percent, Ghost, ChevronsUp, Shield, Gavel, Eye, LifeBuoy,
  HelpCircle, type LucideIcon,
} from "lucide-react";

export interface CardDef {
  label: string;
  icon: LucideIcon;
  color: string; // cor da moldura/realce
  desc: string;
  targeted?: boolean; // mira um jogador (a UI pede o alvo)
}

export const CARDS: Record<string, CardDef> = {
  BLOCK: { label: "Bloqueio", icon: Ban, color: "#ef4444", desc: "O alvo não dá lance na próxima rodada.", targeted: true },
  DOUBLE: { label: "Dobro", icon: Copy, color: "#22d3ee", desc: "Sua abertura rende o DOBRO de itens." },
  TAX: { label: "Imposto", icon: Coins, color: "#e8b923", desc: "Cada rival te paga no início da rodada." },
  INSURANCE: { label: "Seguro", icon: ShieldCheck, color: "#34d399", desc: "Sem penalidade se você abrir um Mímico." },
  DISCOUNT: { label: "Desconto", icon: Percent, color: "#a3e635", desc: "Pague menos se você vencer." },
  CURSE: { label: "Maldição", icon: Ghost, color: "#a855f7", desc: "Se o alvo vencer, a caixa abre como Mímico.", targeted: true },
  UPGRADE: { label: "Reforço", icon: ChevronsUp, color: "#f59e0b", desc: "A próxima caixa sobe um nível." },
  SHIELD: { label: "Escudo", icon: Shield, color: "#60a5fa", desc: "Imune a Bloqueio/Maldição/Imposto." },
  GAVEL: { label: "Martelo", icon: Gavel, color: "#fb923c", desc: "Incremento mínimo dobrado p/ rivais." },
  INSIGHT: { label: "Visão", icon: Eye, color: "#c084fc", desc: "Veja o item que a caixa vai dar." },
  FALENCIA: { label: "Falência", icon: LifeBuoy, color: "#f43f5e", desc: "Com saldo ≤ $200, ganhe +$300 na hora." },
};

export const cardOf = (t: string): CardDef => CARDS[t] ?? { label: t, icon: HelpCircle, color: "#a8a29e", desc: "" };

export function Card({ type, size = 64, dim = false }: { type: string; size?: number; dim?: boolean }) {
  const c = cardOf(type);
  const Icon = c.icon;
  const w = Math.round(size * 1.2);
  const h = Math.round(size * 1.5);
  return (
    <div
      title={`${c.label} — ${c.desc}`}
      className="rounded-xl border-2 flex flex-col items-stretch shrink-0 overflow-hidden relative"
      style={{
        width: w,
        height: h,
        borderColor: c.color,
        background: `radial-gradient(120% 80% at 50% 0%, ${c.color}33, transparent 60%), linear-gradient(180deg, #1a1633, #120f24)`,
        boxShadow: dim ? "none" : `0 5px 16px -7px ${c.color}cc, inset 0 1px 0 rgba(255,255,255,0.07)`,
        opacity: dim ? 0.5 : 1,
      }}
    >
      {/* selo do ícone */}
      <div className="flex-1 flex items-center justify-center pt-1.5">
        <div
          className="rounded-full flex items-center justify-center"
          style={{
            width: Math.round(size * 0.72),
            height: Math.round(size * 0.72),
            background: `${c.color}26`,
            color: c.color,
            boxShadow: `inset 0 0 0 1px ${c.color}55, 0 0 14px -4px ${c.color}`,
          }}
        >
          <Icon size={Math.round(size * 0.42)} strokeWidth={2.2} />
        </div>
      </div>
      {/* faixa do nome */}
      <div
        className="text-center font-bold leading-none py-1 px-1 whitespace-nowrap"
        style={{ fontSize: Math.max(9, Math.round(size * 0.16)), background: `${c.color}1f`, color: c.color, borderTop: `1px solid ${c.color}44` }}
      >
        {c.label}
      </div>
    </div>
  );
}
