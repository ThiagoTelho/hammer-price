// Ícones (lucide) no lugar de emojis usados como ícones — visual menos "amador".
// Emojis seguem APENAS no painel de Reações (emotes). Aqui ficam os ícones de item
// (Cobre/Prata/Ouro = moeda; Diamante = gema; Mímico = caveira), coloridos pela raridade.
import { Coins, Gem, Skull } from "lucide-react";
import { itemRarity } from "./rarity";

export function ItemIcon({ type, size = 16, className = "" }: { type: string; size?: number; className?: string }) {
  const c = itemRarity(type).color;
  if (type === "MIMIC") return <Skull size={size} color="#ef4444" className={`inline-block align-[-0.15em] ${className}`} />;
  if (type === "DIAMOND") return <Gem size={size} color={c} className={`inline-block align-[-0.15em] ${className}`} />;
  return <Coins size={size} color={c} className={`inline-block align-[-0.15em] ${className}`} />;
}
