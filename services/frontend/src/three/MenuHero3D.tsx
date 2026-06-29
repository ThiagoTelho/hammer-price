// Herói 3D da landing: um baú arcade flutuando e girando, com luz de raridade e partículas.
// Default export → carregado via React.lazy (three.js só baixa quando este componente monta).
import { Canvas, useFrame } from "@react-three/fiber";
import { Float, Sparkles } from "@react-three/drei";
import { useRef, type ReactNode } from "react";
import type { Group } from "three";
import { CrateModel } from "./CrateModel";
import { tierOf } from "../Chest";

function Spin({ children, speed = 0.35 }: { children: ReactNode; speed?: number }) {
  const ref = useRef<Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * speed;
  });
  return <group ref={ref}>{children}</group>;
}

export default function MenuHero3D({ boxType = "JACKPOT" }: { boxType?: string }) {
  const tier = tierOf(boxType);
  return (
    <Canvas camera={{ position: [0, 0.5, 4.2], fov: 42 }} dpr={[1, 2]} gl={{ alpha: true, antialias: true }} style={{ width: "100%", height: "100%" }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 5, 4]} intensity={1.3} />
      <pointLight position={[0, 0.8, 5]} intensity={9} color="#fff3df" distance={16} />
      <pointLight position={[-3, 1.5, 2]} intensity={28} color={tier.light} distance={12} />
      <pointLight position={[3, -1, 3]} intensity={18} color="#7c5cff" distance={12} />
      <Float speed={2} rotationIntensity={0.4} floatIntensity={0.9}>
        <Spin>
          <group rotation={[0.12, 0.5, 0]} scale={1.15}>
            <CrateModel body={tier.body} metal={tier.trim} />
          </group>
        </Spin>
      </Float>
      <Sparkles count={36} position={[0, 0.4, 0]} scale={[6, 3.2, 6]} size={3.5} speed={0.35} color={tier.light} opacity={0.7} />
      {/* Sem ContactShadows: a sombra de contato (recalculada por frame sobre o canvas
          transparente) cintilava. O baú flutua e é "aterrado" por um glow em CSS (App.tsx). */}
    </Canvas>
  );
}
