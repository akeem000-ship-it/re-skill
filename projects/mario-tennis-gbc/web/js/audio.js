// WebAudio glue for sound.js: the sequencer and APU run inside an AudioWorklet (one driver tick per
// 1/60 s of audio). The main thread sends play/sfx/stop messages. Everything is read from the ROM
// bytes handed over at start (no audio assets).
export class GameAudio {
  constructor() { this.ctx = null; this.node = null; this.ready = false; this.muted = false; this.onEnded = null; }
  async init(romBytes) {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    const src = `
      ${await (await fetch(new URL("./sound.js", import.meta.url))).text()}
      class P extends AudioWorkletProcessor {
        constructor() { super(); this.seq = null; this.wasPlaying = false; this.apu = new Apu(sampleRate); this.buf = new Float32Array(2 * 1024); this.left = 0; this.pos = 0; this.muted = false;
          this.port.onmessage = e => { const m = e.data;
            if (m.type === "rom") this.seq = new Sequencer(m.rom);
            else if (m.type === "play" && this.seq) this.seq.start(m.id);
            else if (m.type === "stop" && this.seq) this.seq.stopAll();
            else if (m.type === "mute") this.muted = m.on; }; }
        process(inputs, outputs) {
          const out = outputs[0], L = out[0], R = out[1] || out[0], n = L.length;
          if (!this.seq) return true;
          const perTick = Math.round(sampleRate / 60);
          for (let i = 0; i < n; i++) {
            if (this.left === 0) { this.seq.step(); this.apu.render(this.seq, this.buf, perTick); this.left = perTick; this.pos = 0;
              const playing = this.seq.musicPlaying(); if (this.wasPlaying && !playing) this.port.postMessage({ type: "ended" }); this.wasPlaying = playing; }
            L[i] = this.muted ? 0 : this.buf[2 * this.pos]; R[i] = this.muted ? 0 : this.buf[2 * this.pos + 1]; this.pos++; this.left--;
          }
          return true;
        }
      }
      registerProcessor("mt-sound", P);`;
    const url = URL.createObjectURL(new Blob([src.replace(/^\s*export /gm, "")], { type: "application/javascript" }));
    await this.ctx.audioWorklet.addModule(url);
    this.node = new AudioWorkletNode(this.ctx, "mt-sound", { outputChannelCount: [2] });
    this.node.connect(this.ctx.destination);
    this.node.port.onmessage = e => { if (e.data.type === "ended" && this.onEnded) this.onEnded(); };
    this.node.port.postMessage({ type: "rom", rom: romBytes });
    this.ready = true;
  }
  resume() { if (this.ctx && this.ctx.state !== "running") this.ctx.resume(); }
  play(id) { if (this.ready) this.node.port.postMessage({ type: "play", id }); }
  sfx(id) { this.play(id); }
  stop() { if (this.ready) this.node.port.postMessage({ type: "stop" }); }
  mute(on) { this.muted = on; if (this.ready) this.node.port.postMessage({ type: "mute", on }); }
}
