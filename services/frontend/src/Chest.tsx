// Baú do leilão desenhado em SVG, com paleta por nível (raridade crescente:
// Madeira < Ferro < Real < Cofre). Substitui as medalhas. `open` anima a tampa
// (usado na abertura animada do baú). Também centraliza rótulo e cor de raridade.
import { motion } from "framer-motion";

export interface TierStyle {
  label: string;
  body: string;
  bodyLight: string;
  band: string;
  trim: string;
  light: string; // cor da "raridade": joia do baú + holofote do palco
}

export const TIERS: Record<string, TierStyle> = {
  WOODEN: { label: "Baú de Madeira", body: "#6b4a2b", bodyLight: "#835c36", band: "#3b332b", trim: "#b8893a", light: "#e0a23c" },
  IRON: { label: "Baú de Ferro", body: "#474d56", bodyLight: "#5b626d", band: "#272b31", trim: "#aab3bd", light: "#9fb4cc" },
  ROYAL: { label: "Baú Real", body: "#7a2230", bodyLight: "#97283b", band: "#511620", trim: "#e8b923", light: "#b06bf0" },
  VAULT: { label: "Cofre", body: "#1d2a33", bodyLight: "#284551", band: "#0e171d", trim: "#5eead4", light: "#34d6ee" },
  // Cofre Premiado — baú RARO (apex): ouro maciço com joia radiante (alto risco/recompensa).
  JACKPOT: { label: "Cofre Premiado", body: "#a9791b", bodyLight: "#e6b531", band: "#5e4108", trim: "#fff0b0", light: "#ffd24a" },
  // Caixa Surpresa — odds OCULTAS: roxo enigmático com joia violeta (aposta no escuro).
  MYSTERY: { label: "Caixa Surpresa", body: "#3b2a5e", bodyLight: "#5a3f8c", band: "#241a3a", trim: "#c4b5fd", light: "#a78bfa" },
};

export const tierOf = (t: string): TierStyle => TIERS[t] ?? TIERS.WOODEN;
export const tierLabel = (t: string): string => tierOf(t).label;
export const tierLight = (t: string): string => tierOf(t).light;

export function Chest({ tier, size = 132, open = false }: { tier: string; size?: number; open?: boolean }) {
  const c = tierOf(tier);
  const g = tier;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" style={{ overflow: "visible", display: "block" }}>
      <defs>
        <linearGradient id={`chest-body-${g}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.bodyLight} />
          <stop offset="1" stopColor={c.body} />
        </linearGradient>
        <radialGradient id={`chest-gem-${g}`}>
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.45" stopColor={c.light} />
          <stop offset="1" stopColor={c.band} />
        </radialGradient>
        <radialGradient id={`chest-inner-${g}`}>
          <stop offset="0" stopColor="#fff7d6" />
          <stop offset="0.55" stopColor={c.light} />
          <stop offset="1" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
      </defs>

      {/* sombra no chão */}
      <ellipse cx="50" cy="92" rx="33" ry="4.5" fill="rgba(0,0,0,0.45)" />

      {/* luz interior (surge ao abrir) */}
      <motion.ellipse
        cx="50"
        cy="52"
        rx="26"
        ry="16"
        fill={`url(#chest-inner-${g})`}
        initial={false}
        animate={{ opacity: open ? 1 : 0, scale: open ? 1.15 : 0.5 }}
        transition={{ duration: 0.3 }}
        style={{ transformBox: "fill-box", transformOrigin: "center" }}
      />

      {/* corpo */}
      <rect x="18" y="54" width="64" height="32" rx="5" fill={`url(#chest-body-${g})`} stroke={c.band} strokeWidth="2.5" />
      <rect x="30" y="54" width="5" height="32" fill={c.band} opacity="0.8" />
      <rect x="65" y="54" width="5" height="32" fill={c.band} opacity="0.8" />
      {/* fechadura */}
      <rect x="44.5" y="62" width="11" height="13" rx="2" fill={c.trim} stroke={c.band} strokeWidth="1" />
      <circle cx="50" cy="67" r="2.1" fill={c.band} />
      <rect x="49" y="67.5" width="2" height="4.5" fill={c.band} />

      {/* tampa — levanta ao abrir */}
      <motion.g
        initial={false}
        animate={{ y: open ? -22 : 0, opacity: open ? 0.92 : 1 }}
        transition={{ type: "spring", stiffness: 220, damping: 12 }}
      >
        <path d="M18 54 Q18 36 50 36 Q82 36 82 54 Z" fill={`url(#chest-body-${g})`} stroke={c.band} strokeWidth="2.5" />
        <rect x="30" y="40" width="5" height="14" fill={c.band} opacity="0.8" />
        <rect x="65" y="40" width="5" height="14" fill={c.band} opacity="0.8" />
        {/* joia (cor da raridade) */}
        <circle cx="50" cy="46" r="5.6" fill={`url(#chest-gem-${g})`} stroke={c.trim} strokeWidth="1.2" />
      </motion.g>
    </svg>
  );
}
