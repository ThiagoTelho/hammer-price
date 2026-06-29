// Mapa ÚNICO de raridade (loot tiers) — centraliza cor/glow/rótulo por TIPO de baú e de item.
// Usado pela arte 3D (cor do material), pelos glows do palco e pelos badges da UI.
export interface Rarity {
  label: string; // rótulo de raridade em PT
  rank: number; // 0 (maldito) .. 5 (lendário) — intensidade do brilho/destaque
  color: string; // cor primária (tint/aura/badge)
  glow: string; // cor do brilho (geralmente = color)
}

// Baús: a cor acompanha a "luz" dos TIERS do Chest (mantém coerência com a arte 2D).
const BOX_RARITY: Record<string, Rarity> = {
  WOODEN: { label: "Comum", rank: 1, color: "#e0a23c", glow: "#e0a23c" },
  IRON: { label: "Incomum", rank: 2, color: "#9fb4cc", glow: "#9fb4cc" },
  ROYAL: { label: "Raro", rank: 3, color: "#b06bf0", glow: "#b06bf0" },
  VAULT: { label: "Épico", rank: 4, color: "#34d6ee", glow: "#34d6ee" },
  JACKPOT: { label: "Lendário", rank: 5, color: "#ffd24a", glow: "#ffd24a" },
  MYSTERY: { label: "Surpresa", rank: 3, color: "#a78bfa", glow: "#a78bfa" },
};

// Itens: cores "materiais" (batem com os emojis 🪙🥈🥇💎💀); Mímico é perigo (vermelho).
const ITEM_RARITY: Record<string, Rarity> = {
  COPPER: { label: "Comum", rank: 1, color: "#c87f4a", glow: "#c87f4a" },
  SILVER: { label: "Incomum", rank: 2, color: "#c0c8d4", glow: "#c0c8d4" },
  GOLD: { label: "Raro", rank: 3, color: "#ffcb2e", glow: "#ffcb2e" },
  DIAMOND: { label: "Épico", rank: 4, color: "#5fe0ff", glow: "#5fe0ff" },
  MIMIC: { label: "Maldito", rank: 0, color: "#ef4444", glow: "#ef4444" },
};

const FALLBACK: Rarity = { label: "Comum", rank: 1, color: "#8aa0b6", glow: "#8aa0b6" };

export const boxRarity = (boxType: string): Rarity => BOX_RARITY[boxType] ?? FALLBACK;
export const itemRarity = (itemType: string): Rarity => ITEM_RARITY[itemType] ?? FALLBACK;
