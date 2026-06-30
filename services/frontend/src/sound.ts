// Efeitos sonoros sintetizados via Web Audio API — sem arquivos (gerados on-the-fly, então
// royalty-free por definição). O AudioContext só "acorda" após um gesto do usuário (clique),
// então os primeiros sons saem a partir da primeira interação (criar sala / dar lance).
//
// Estilo: SUAVE e ARREDONDADO (nada de ondas square/sawtooth ásperas). Tudo passa por um
// barramento mestre com lowpass (tira o "agudo áspero") + compressor (cola e evita estouro),
// e os timbres usam sine/triangle com ataque exponencial (sem clique). Oitavas mais graves.

let ctx: AudioContext | null = null;
let chain: { lp: BiquadFilterNode } | null = null; // barramento mestre (entrada = lowpass)
let noiseBuf: AudioBuffer | null = null;
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

// Barramento mestre: lowpass suave → compressor → master gain → saída. Criado uma vez.
function bus(): { c: AudioContext; dest: AudioNode } | null {
  const c = ac();
  if (!c || muted) return null;
  if (!chain) {
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 2600; // corta os agudos ásperos — deixa o som "fofo"
    lp.Q.value = 0.5;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 26;
    comp.ratio.value = 3;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;
    const master = c.createGain();
    master.gain.value = 0.8;
    lp.connect(comp);
    comp.connect(master);
    master.connect(c.destination);
    chain = { lp };
  }
  return { c, dest: chain.lp };
}

export function setMuted(m: boolean): void {
  muted = m;
}
export function isMuted(): boolean {
  return muted;
}

// Tom suave: sine/triangle com ataque exponencial (sem clique) e decaimento exponencial.
// `glideTo` desliza a frequência ao longo da duração (para varreduras gentis).
function tone(
  freq: number,
  dur: number,
  opts: { type?: OscillatorType; vol?: number; when?: number; glideTo?: number; attack?: number } = {},
): void {
  const b = bus();
  if (!b) return;
  const { c, dest } = b;
  const { type = "sine", vol = 0.2, when = 0, glideTo, attack = 0.012 } = opts;
  const t0 = c.currentTime + when;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + attack); // ataque macio
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(dest);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

// Ruído filtrado (para "whoosh" arejado) — buffer reaproveitado.
function noiseSweep(from: number, to: number, dur: number, vol: number): void {
  const b = bus();
  if (!b) return;
  const { c, dest } = b;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, Math.floor(c.sampleRate * 0.6), c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t0 = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = 0.8;
  bp.frequency.setValueAtTime(from, t0);
  bp.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.06);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(bp).connect(g).connect(dest);
  src.start(t0);
  src.stop(t0 + dur + 0.04);
}

/** Batida de martelo (lance / arremate) — "tok" de madeira, grave e macio. */
export function gavel(): void {
  tone(150, 0.13, { type: "triangle", vol: 0.22, attack: 0.004 });
  tone(94, 0.2, { type: "sine", vol: 0.2, when: 0.05 });
}
/** Tilintar de moeda (venda) — dois toques agradáveis (quinta), arredondados. */
export function coin(): void {
  tone(880, 0.16, { type: "triangle", vol: 0.15, attack: 0.003 });
  tone(1320, 0.2, { type: "sine", vol: 0.12, when: 0.07 });
}
/** Fanfarra curta (vitória / item bom) — arpejo maior quente, oitava mais grave. */
export function fanfare(): void {
  [392, 523, 659, 784].forEach((f, i) =>
    tone(f, 0.34, { type: "triangle", vol: 0.15, when: i * 0.09, attack: 0.016 }),
  );
  tone(1046, 0.5, { type: "sine", vol: 0.09, when: 0.28 }); // brilho suave no fim
}
/** Baque grave (Mímico) — "boom" de seno com queda de tom, sem zumbido. */
export function thud(): void {
  tone(96, 0.5, { type: "sine", vol: 0.3, glideTo: 48, attack: 0.006 });
  tone(150, 0.32, { type: "triangle", vol: 0.1, when: 0.01 });
}
/** Tique suave (urgência do cronômetro) — seno baixinho, nada de clique. */
export function tick(): void {
  tone(660, 0.055, { type: "sine", vol: 0.06, attack: 0.002 });
}
/** Tampa do baú abrindo — leve subida de tom + corpo grave (neutro: vem antes de fanfarra/baque). */
export function creak(): void {
  tone(300, 0.36, { type: "triangle", vol: 0.1, glideTo: 380, attack: 0.02 });
  tone(120, 0.34, { type: "sine", vol: 0.12, attack: 0.02 });
}
/** Início da rodada — "whoosh" arejado: ruído filtrado varrendo grave → médio. */
export function whoosh(): void {
  noiseSweep(280, 1500, 0.42, 0.12);
  tone(200, 0.4, { type: "triangle", vol: 0.07, glideTo: 460, attack: 0.05 });
}
