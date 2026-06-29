// Baú de TESOURO arcade procedural (sem assets): corpo de MADEIRA + TAMPA ABAULADA (barril),
// com ferragens (bandas, cantoneiras, fechadura) na COR DA RARIDADE — assim todo baú lê como
// "baú de tesouro" e a raridade aparece no metal (JACKPOT=ouro, VAULT=turquesa, MYSTERY=violeta…).
// `open` (0..1) gira a tampa na dobradiça traseira; gema interna brilha ao abrir.
import { RoundedBox } from "@react-three/drei";
import { DoubleSide } from "three";

const D = 1.2; // profundidade
const R = D / 2; // raio da tampa abaulada
const W = 1.9; // largura
const HB = 1.0; // altura do corpo (mais alto → proporção de baú, não de caixa)
const TOP = HB / 2;
const WOOD = "#6a4423"; // madeira (constante p/ todos os tiers)
const WOOD_DK = "#4a2f17";

export function CrateModel({ color, open = 0 }: { color: string; trim?: string; open?: number }) {
  const lidAngle = -open * 1.95; // 0 = fechado, ~-112° = aberto
  const wood = (dk = false) => <meshStandardMaterial color={dk ? WOOD_DK : WOOD} metalness={0.15} roughness={0.7} side={DoubleSide} />;
  const metal = () => <meshStandardMaterial color={color} metalness={0.92} roughness={0.24} />;

  return (
    <group>
      {/* ---------- CORPO (madeira) ---------- */}
      <RoundedBox args={[W, HB, D]} radius={0.08} smoothness={4} position={[0, 0, 0]}>
        {wood()}
      </RoundedBox>
      {/* ripas verticais (sulcos escuros) na frente — claramente salientes p/ não brigar com a face */}
      {[-0.55, -0.18, 0.18, 0.55].map((x) => (
        <mesh key={x} position={[x, -0.05, R + 0.02]}>
          <boxGeometry args={[0.025, HB - 0.16, 0.02]} />
          {wood(true)}
        </mesh>
      ))}

      {/* bandas horizontais de metal (envolvem o baú) */}
      {[-0.26, 0.24].map((y) => (
        <RoundedBox key={y} args={[W + 0.06, 0.15, D + 0.06]} radius={0.04} smoothness={3} position={[0, y, 0]}>
          {metal()}
        </RoundedBox>
      ))}
      {/* aro do topo (a tampa encosta aqui) */}
      <RoundedBox args={[W + 0.09, 0.12, D + 0.09]} radius={0.04} smoothness={3} position={[0, TOP - 0.04, 0]}>
        {metal()}
      </RoundedBox>

      {/* cantoneiras verticais frontais */}
      {[-(W / 2 - 0.07), W / 2 - 0.07].map((x) => (
        <RoundedBox key={x} args={[0.13, HB, 0.13]} radius={0.03} smoothness={3} position={[x, 0, R - 0.03]}>
          {metal()}
        </RoundedBox>
      ))}

      {/* fechadura saliente + argola */}
      <RoundedBox args={[0.32, 0.4, 0.09]} radius={0.06} smoothness={3} position={[0, 0.0, R + 0.02]}>
        {metal()}
      </RoundedBox>
      <mesh position={[0, -0.04, R + 0.08]}>
        <torusGeometry args={[0.08, 0.025, 10, 20]} />
        {metal()}
      </mesh>

      {/* gema/núcleo que brilha (aparece ao abrir) */}
      <mesh position={[0, 0.2, 0]}>
        <icosahedronGeometry args={[0.26, 0]} />
        <meshStandardMaterial color="#fff6da" emissive={color} emissiveIntensity={0.2 + 1.6 * open} metalness={0.2} roughness={0.15} />
      </mesh>

      {/* ---------- TAMPA ABAULADA (barril), na dobradiça traseira ----------
          A tampa desce 0.06 DENTRO do corpo (sobreposição) p/ a base do barril não ficar
          COPLANAR com o topo do corpo — coplanaridade causa z-fighting (cintilação) ao girar. */}
      <group position={[0, TOP - 0.06, -R]} rotation={[lidAngle, 0, 0]}>
        <group position={[0, 0, R]}>
          {/* meia-cilindro dome-para-cima ao longo de X (madeira); rz=90 já deixa o domo p/ cima */}
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <cylinderGeometry args={[R, R, W, 40, 1, false, 0, Math.PI]} />
            {wood()}
          </mesh>
          {/* bandas curvas de metal na tampa (meia-cilindro um pouco maior, finas no eixo X) */}
          {[-0.62, -0.21, 0.21, 0.62].map((x) => (
            <mesh key={x} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
              <cylinderGeometry args={[R + 0.025, R + 0.025, 0.1, 28, 1, false, 0, Math.PI]} />
              {metal()}
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}
