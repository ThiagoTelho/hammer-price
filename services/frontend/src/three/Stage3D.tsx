// Palco 3D da partida: o MESMO baú de tesouro girando sobre o palco, reagindo ao estado:
//  idle (esperando) → tension (alguém deu lance: gira/pulsa mais) → open (arrematado: tampa
//  estoura) → mimic (vermelho + tremor). Default export → lazy (three.js sob demanda).
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sparkles } from "@react-three/drei";
import { useRef } from "react";
import type { Group } from "three";
import { CrateModel } from "./CrateModel";
import { boxRarity } from "../rarity";

export type StageMode = "idle" | "tension" | "open" | "mimic";

function Rig({ color, mode }: { color: string; mode: StageMode }) {
  const ref = useRef<Group>(null);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    g.rotation.y += dt * (mode === "tension" ? 0.85 : 0.32); // gira mais rápido na tensão
    g.position.x = mode === "mimic" ? Math.sin(t * 46) * 0.05 : 0; // tremor do Mímico
    const pulse = mode === "tension" ? 1 + Math.sin(t * 9) * 0.04 : 1; // pulso na tensão
    g.scale.setScalar(pulse);
  });
  return (
    <group ref={ref}>
      {/* abaixa um pouco o baú p/ enquadrar corpo + tampa no canvas pequeno do palco */}
      <group position={[0, -0.35, 0]} rotation={[0.12, 0.5, 0]} scale={0.92}>
        <CrateModel color={mode === "mimic" ? "#ef4444" : color} open={mode === "open" ? 1 : 0} />
      </group>
    </group>
  );
}

export default function Stage3D({ boxType, mode = "idle" }: { boxType: string; mode?: StageMode }) {
  const r = boxRarity(boxType);
  const glow = mode === "mimic" ? "#ef4444" : r.glow;
  return (
    <Canvas camera={{ position: [0, 0.3, 4.3], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ width: "100%", height: "100%" }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <pointLight position={[0, 0.8, 5]} intensity={10} color="#fff3df" distance={16} /> {/* fill frontal p/ destacar do palco escuro */}
      <pointLight position={[-3, 1.5, 2]} intensity={26} color={glow} distance={12} />
      <pointLight position={[3, -1, 3]} intensity={14} color="#7c5cff" distance={12} />
      <Float speed={mode === "tension" ? 3 : 1.6} rotationIntensity={0.25} floatIntensity={0.7}>
        <Rig color={r.color} mode={mode} />
      </Float>
      {(mode === "open" || mode === "tension") && (
        <Sparkles count={mode === "open" ? 44 : 14} position={[0, 0.4, 0]} scale={[3.6, 2.6, 3.6]} size={4} speed={0.6} color={glow} opacity={0.85} />
      )}
    </Canvas>
  );
}
