// Efeitos sonoros sintetizados via Web Audio API — sem arquivos de áudio (gerados on-the-fly).
// O AudioContext só "acorda" após um gesto do usuário (clique), então os primeiros sons
// saem a partir da primeira interação (criar sala / dar lance).

let ctx: AudioContext | null = null;
let muted = false;

function ac(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") void ctx.resume();
  return ctx;
}

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

// Um "blip": oscilador com envelope de ataque/decaimento.
function blip(freq: number, dur: number, type: OscillatorType, vol = 0.2, when = 0): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

/** Batida de martelo (lance / arremate). */
export function gavel(): void {
  blip(190, 0.07, "square", 0.22);
  blip(110, 0.13, "square", 0.18, 0.05);
}
/** Tilintar de moeda (venda). */
export function coin(): void {
  blip(1250, 0.07, "triangle", 0.16);
  blip(1850, 0.09, "triangle", 0.12, 0.05);
}
/** Fanfarra curta (vitória / item bom). */
export function fanfare(): void {
  [523, 659, 784, 1046].forEach((f, i) => blip(f, 0.17, "triangle", 0.16, i * 0.08));
}
/** Baque grave (Mímico). */
export function thud(): void {
  blip(82, 0.34, "sawtooth", 0.28);
  blip(58, 0.4, "square", 0.18, 0.02);
}
/** Tique suave (urgência do cronômetro). */
export function tick(): void {
  blip(950, 0.035, "square", 0.07);
}
/** Rangido da tampa do baú (abertura). */
export function creak(): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(140, t0);
  osc.frequency.linearRampToValueAtTime(90, t0 + 0.18);
  osc.frequency.linearRampToValueAtTime(165, t0 + 0.3);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.08, t0 + 0.04);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.32);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.34);
}
/** Cortina abrindo (início da rodada): varredura grave → aguda. */
export function whoosh(): void {
  const c = ac();
  if (!c || muted) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(180, t0);
  osc.frequency.exponentialRampToValueAtTime(640, t0 + 0.3);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(0.1, t0 + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35);
  osc.connect(g).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.38);
}
