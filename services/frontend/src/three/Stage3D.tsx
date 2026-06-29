// Palco 3D da partida: o MESMO baú de tesouro reagindo ao estado:
//  idle → tension (lance: gira um pouco mais + sparkles) → open (arrematado: tampa estoura)
//  → mimic (vermelho + tremor). Cores POR TIER (corpo + ferragens) vêm do palette TIERS.
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sparkles } from "@react-three/drei";
import { useEffect, useRef } from "react";
import type { Group } from "three";
import { CrateModel } from "./CrateModel";
import { tierOf } from "../Chest";

export type StageMode = "idle" | "tension" | "open" | "mimic";

function Rig({ body, metal, mode, spin }: { body: string; metal: string; mode: StageMode; spin: boolean }) {
  const ref = useRef<Group>(null);
  useFrame((state, dt) => {
    const g = ref.current;
    if (!g) return;
    const t = state.clock.elapsedTime;
    if (spin) g.rotation.y += dt * (mode === "tension" ? 0.55 : 0.32); // gira (sem PULSAR — pulso removido)
    g.position.x = mode === "mimic" ? Math.sin(t * 46) * 0.05 : 0; // tremor do Mímico
  });
  // No overlay de abertura (spin=false) o baú fica quase de frente p/ a tampa estourar visível.
  const baseRot: [number, number, number] = spin ? [0.12, 0.5, 0] : [0.05, 0.12, 0];
  return (
    <group ref={ref}>
      <group position={[0, -0.22, 0]} rotation={baseRot} scale={0.98}>
        <CrateModel
          body={mode === "mimic" ? "#3a1414" : body}
          metal={mode === "mimic" ? "#ef4444" : metal}
          open={mode === "open" ? 1 : 0}
        />
      </group>
    </group>
  );
}

export default function Stage3D({ boxType, mode = "idle", spin = true }: { boxType: string; mode?: StageMode; spin?: boolean }) {
  const tier = tierOf(boxType);
  const glow = mode === "mimic" ? "#ef4444" : tier.light;
  // FIX de alinhamento: o R3F às vezes mede o canvas errado no mount (corrige só num resize).
  // Um "resize" forçado logo após montar faz o renderer re-medir e enquadrar certo.
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <Canvas camera={{ position: [0, 0.12, 4.2], fov: 40 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }} resize={{ offsetSize: true }} style={{ width: "100%", height: "100%" }}>
      <ambientLight intensity={0.8} />
      <directionalLight position={[3, 5, 4]} intensity={1.5} />
      <pointLight position={[0, 0.8, 5]} intensity={10} color="#fff3df" distance={16} />
      <pointLight position={[-3, 1.5, 2]} intensity={26} color={glow} distance={12} />
      <pointLight position={[3, -1, 3]} intensity={14} color="#7c5cff" distance={12} />
      <Float speed={mode === "tension" ? 2.4 : 1.6} rotationIntensity={0.22} floatIntensity={0.6}>
        <Rig body={tier.body} metal={tier.trim} mode={mode} spin={spin} />
      </Float>
      {(mode === "open" || mode === "tension") && (
        <Sparkles count={mode === "open" ? 48 : 14} position={[0, 0.4, 0]} scale={[3.6, 2.6, 3.6]} size={4} speed={0.6} color={glow} opacity={0.85} />
      )}
    </Canvas>
  );
}
