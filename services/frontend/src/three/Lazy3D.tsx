// Porta de entrada de TODO o 3D: detecta WebGL e isola falhas. O conteúdo 3D deve ser um
// `React.lazy(() => import(...))` do Canvas — assim o three.js só baixa quando ele monta
// (telas sem 3D não pagam o bundle). Sem WebGL, ou em erro/carregamento, mostra o fallback 2D.
import { Component, Suspense, type ReactNode } from "react";

let cached: boolean | null = null;
export function webglAvailable(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement("canvas");
    cached = !!(window.WebGLRenderingContext && (c.getContext("webgl") || c.getContext("experimental-webgl")));
  } catch {
    cached = false;
  }
  return cached;
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// `fallback` aparece SEM WebGL e em erro (o baú 2D). `loading` é o que aparece enquanto o
// chunk do three.js baixa — onde NÃO queremos o baú 2D piscando antes do 3D (ex.: herói do
// menu): passe um placeholder neutro. Sem `loading`, usa o próprio `fallback`.
// `enabled=false` (ex.: mobile/telas pequenas) curto-circuita p/ o fallback 2D e NUNCA
// importa o three.js — o chunk só baixa quando o 3D realmente renderiza.
export function Lazy3D({ children, fallback, loading, enabled = true }: { children: ReactNode; fallback: ReactNode; loading?: ReactNode; enabled?: boolean }) {
  if (!enabled || !webglAvailable()) return <>{fallback}</>;
  return (
    <Boundary fallback={fallback}>
      <Suspense fallback={loading ?? fallback}>{children}</Suspense>
    </Boundary>
  );
}
