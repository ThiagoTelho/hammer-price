// Baú de TESOURO arcade procedural (sem assets): corpo + TAMPA ABAULADA (barril) com ferragens.
// `body` = cor do corpo POR TIER (madeira/aço/carmesim/turquesa/violeta/ouro — cada baú é distinto);
// `metal` = cor das ferragens (banda/cantoneira/fechadura). `open` (0..1) anima a tampa (lerp).
import { RoundedBox } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useRef } from "react";
import { DoubleSide, type Group } from "three";

const D = 1.2; // profundidade
const R = D / 2; // raio da tampa abaulada
const W = 1.9; // largura
const HB = 1.0; // altura do corpo
const TOP = HB / 2;

// Escurece um hex (p/ os sulcos das ripas) — aceita #rgb ou #rrggbb.
function darken(hex: string, f: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgb(${Math.round(((n >> 16) & 255) * f)},${Math.round(((n >> 8) & 255) * f)},${Math.round((n & 255) * f)})`;
}

export function CrateModel({ body = "#6b4a2b", metal = "#f4c95d", open = 0 }: { body?: string; metal?: string; open?: number }) {
  // A tampa é animada por useFrame (lerp até o alvo) → abrir/fechar suave sem re-render.
  const lidRef = useRef<Group>(null);
  useFrame((_, dt) => {
    if (!lidRef.current) return;
    const target = -open * 1.95; // 0 = fechado, ~-112° = aberto
    lidRef.current.rotation.x += (target - lidRef.current.rotation.x) * Math.min(1, dt * 7);
  });
  const bodyDk = darken(body, 0.62);
  const mat = (dk = false) => <meshStandardMaterial color={dk ? bodyDk : body} metalness={0.22} roughness={0.58} side={DoubleSide} />;
  const hw = () => <meshStandardMaterial color={metal} metalness={0.92} roughness={0.24} />;

  return (
    <group>
      {/* ---------- CORPO ---------- */}
      <RoundedBox args={[W, HB, D]} radius={0.08} smoothness={4} position={[0, 0, 0]}>
        {mat()}
      </RoundedBox>
      {/* ripas verticais (sulcos) na frente — claramente salientes p/ não brigar com a face */}
      {[-0.55, -0.18, 0.18, 0.55].map((x) => (
        <mesh key={x} position={[x, -0.05, R + 0.02]}>
          <boxGeometry args={[0.025, HB - 0.16, 0.02]} />
          {mat(true)}
        </mesh>
      ))}

      {/* bandas horizontais de metal (envolvem o baú) */}
      {[-0.26, 0.24].map((y) => (
        <RoundedBox key={y} args={[W + 0.06, 0.15, D + 0.06]} radius={0.04} smoothness={3} position={[0, y, 0]}>
          {hw()}
        </RoundedBox>
      ))}
      {/* aro do topo (a tampa encosta aqui) */}
      <RoundedBox args={[W + 0.09, 0.12, D + 0.09]} radius={0.04} smoothness={3} position={[0, TOP - 0.04, 0]}>
        {hw()}
      </RoundedBox>

      {/* cantoneiras verticais frontais */}
      {[-(W / 2 - 0.07), W / 2 - 0.07].map((x) => (
        <RoundedBox key={x} args={[0.13, HB, 0.13]} radius={0.03} smoothness={3} position={[x, 0, R - 0.03]}>
          {hw()}
        </RoundedBox>
      ))}

      {/* fechadura saliente + argola */}
      <RoundedBox args={[0.32, 0.4, 0.09]} radius={0.06} smoothness={3} position={[0, 0.0, R + 0.02]}>
        {hw()}
      </RoundedBox>
      <mesh position={[0, -0.04, R + 0.08]}>
        <torusGeometry args={[0.08, 0.025, 10, 20]} />
        {hw()}
      </mesh>

      {/* gema/núcleo que brilha (aparece ao abrir) */}
      <mesh position={[0, 0.2, 0]}>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color="#fff6da" emissive={metal} emissiveIntensity={0.2 + 1.6 * open} metalness={0.2} roughness={0.15} />
      </mesh>

      {/* ---------- TAMPA ABAULADA (barril), na dobradiça traseira ----------
          A tampa desce 0.06 DENTRO do corpo (sobreposição) p/ a base do barril não ficar
          COPLANAR com o topo do corpo — coplanaridade causa z-fighting (cintilação) ao girar. */}
      <group ref={lidRef} position={[0, TOP - 0.06, -R]}>
        <group position={[0, 0, R]}>
          {/* meia-cilindro dome-para-cima ao longo de X; rz=90 já deixa o domo p/ cima */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[R, R, W, 40, 1, false, 0, Math.PI]} />
            {mat()}
          </mesh>
          {/* bandas curvas de metal na tampa */}
          {[-0.62, -0.21, 0.21, 0.62].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[R + 0.025, R + 0.025, 0.1, 28, 1, false, 0, Math.PI]} />
              {hw()}
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
