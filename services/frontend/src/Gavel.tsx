// Martelo de leilão (gavel) — ícone da marca. Cabeça cilíndrica com bandas + cabo, sobre o
// bloco de som. Dourado do tema. Usado no cabeçalho; mesma arte no favicon/OG.
export function Gavel({ size = 40, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="gavelGold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5d77a" />
          <stop offset="1" stopColor="#e8b923" />
        </linearGradient>
      </defs>
      {/* bloco de som (base) */}
      <rect x="11" y="50" width="36" height="8.5" rx="4.25" fill="url(#gavelGold)" />
      <rect x="11" y="50" width="36" height="3" rx="1.5" fill="#fff" opacity="0.22" />
      {/* martelo (cabeça + cabo), inclinado */}
      <g transform="rotate(-38 37 24)" fill="url(#gavelGold)">
        <rect x="34.5" y="22" width="5.5" height="30" rx="2.75" />
        <rect x="23" y="13" width="28" height="18" rx="5.5" />
        <rect x="28" y="13" width="3" height="18" fill="#8a6a1f" opacity="0.5" />
        <rect x="43" y="13" width="3" height="18" fill="#8a6a1f" opacity="0.5" />
      </g>
    </svg>
  );
}
