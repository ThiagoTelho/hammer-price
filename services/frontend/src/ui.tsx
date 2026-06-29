// Primitivos de UI arcade reutilizáveis (botões chunky, painéis, badges de raridade, glow).
// Substituem aos poucos as classes inline espalhadas em App.tsx.
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";
import { boxRarity, itemRarity } from "./rarity";

type Variant = "primary" | "accent" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const BASE =
  "font-display font-bold rounded-xl inline-flex items-center justify-center gap-2 select-none " +
  "transition active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none";
const VARIANT: Record<Variant, string> = {
  primary: "bg-gold text-ink hover:bg-gold-soft chunky chunky-press",
  accent: "bg-accent text-white hover:bg-accent-soft chunky chunky-press",
  ghost: "bg-surface-2 border border-line text-stone-100 hover:border-gold",
  danger: "bg-red-500/15 text-red-300 border border-red-500/40 hover:border-red-400",
};
const SIZE: Record<Size, string> = {
  sm: "text-sm px-3 py-1.5",
  md: "text-base px-4 py-2.5",
  lg: "text-lg px-6 py-3",
};

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: { variant?: Variant; size?: Size } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${BASE} ${VARIANT[variant]} ${SIZE[size]} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// Painel/card arcade. `glow` aplica a aura de raridade (cor via prop).
export function Panel({
  children,
  className = "",
  glow,
  style,
}: { children: ReactNode; className?: string; glow?: string; style?: CSSProperties }) {
  return (
    <div
      className={`rounded-2xl border border-line bg-surface/85 backdrop-blur-sm ${glow ? "glow" : ""} ${className}`}
      style={glow ? ({ ["--glow" as string]: glow, ...style }) : style}
    >
      {children}
    </div>
  );
}

// Pílula de raridade (cor + rótulo) — aceita um tipo de baú ou de item.
export function RarityBadge({ type, kind = "box", className = "" }: { type: string; kind?: "box" | "item"; className?: string }) {
  const r = kind === "box" ? boxRarity(type) : itemRarity(type);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}
      style={{ color: r.color, background: `color-mix(in srgb, ${r.color} 16%, transparent)`, border: `1px solid color-mix(in srgb, ${r.color} 45%, transparent)` }}
    >
      {r.label}
    </span>
  );
}

// Helper de estilo para aplicar o glow de raridade inline (ex.: <div className="glow" style={glowStyle(color)}>).
export const glowStyle = (color: string): CSSProperties => ({ ["--glow" as string]: color });
