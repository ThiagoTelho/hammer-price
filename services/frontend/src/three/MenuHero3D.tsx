// Herói 3D da landing: um baú arcade flutuando e BALANÇANDO de lado a lado (sem girar 360°,
// nunca de costas), com luz de raridade e partículas.
// Default export → carregado via React.lazy (three.js só baixa quando este componente monta).
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sparkles } from "@react-three/drei";
import { useEffect, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { CrateModel } from "./CrateModel";
import { tierOf } from "../Chest";

// Balança ~±30° (total ~60°) em vez de girar — o baú nunca fica de costas.
function Sway({ children, speed = 0.5, amp = Math.PI / 6 }: { children: ReactNode; speed?: number; amp?: number }) {
  const ref = useRef<Group>(null);
  useFrame((state) => {
    if (ref.current) ref.current.rotation.y = Math.sin(state.clock.elapsedTime * speed) * amp;
  });
  return <group ref={ref}>{children}</group>;
}

export default function MenuHero3D({ boxType = "JACKPOT" }: { boxType?: string }) {
  const tier = tierOf(boxType);
  // Mesmo fix de medição do R3F no mount (ver Stage3D).
  useEffect(() => {
    const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60);
    return () => clearTimeout(t);
  }, []);
  return (
    <Canvas camera={{ position: [0, 0.5, 4.2], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }} resize={{ offsetSize: true }} style={{ width: "100%", height: "100%" }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <pointLight position={[0, 0.8, 5]} intensity={9} color="#fff3df" distance={16} />
      <pointLight position={[-3, 1.5, 2]} intensity={28} color={tier.light} distance={12} />
      <pointLight position={[3, -1, 3]} intensity={18} color="#7c5cff" distance={12} />
      <Float speed={2} rotationIntensity={0.4} floatIntensity={0.9}>
        <Sway>
          <group rotation={[0.12, 0.16, 0]} scale={1.15}>
            <CrateModel body={tier.body} metal={tier.trim} />
          </group>
        </Sway>
      </Float>
      <Sparkles count={36} position={[0, 0.4, 0]} scale={[6, 3.2, 6]} size={3.5} speed={0.35} color={tier.light} opacity={0.7} />
      {/* Sem ContactShadows: a sombra de contato (recalculada por frame sobre o canvas
          transparente) cintilava. O baú flutua e é "aterrado" por um glow em CSS (App.tsx). */}
    </Canvas>
  );
}
