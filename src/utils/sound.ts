class SoundSynthesizer {
  private ctx: AudioContext | null = null;
  private pumpOsc: OscillatorNode | null = null;
  private pumpGain: GainNode | null = null;
  private isMuted: boolean = false;

  private initCtx() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public setMuted(muted: boolean) {
    this.isMuted = muted;
    if (muted && this.pumpGain) {
      this.stopPumpSound();
    }
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  public playClick() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, this.ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(200, this.ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.12, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + 0.04);

      osc.connect(gain);
      gain.connect(this.ctx.destination);

      osc.start();
      osc.stop(this.ctx.currentTime + 0.04);
    } catch {
      // AudioContext blocked or not supported
    }
  }

  public startPumpSound() {
    if (this.isMuted || this.pumpOsc) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      // Realistic 60Hz mechanical vibration with 120Hz harmonic
      this.pumpOsc = this.ctx.createOscillator();
      this.pumpGain = this.ctx.createGain();

      this.pumpOsc.type = 'sawtooth';
      this.pumpOsc.frequency.setValueAtTime(58, this.ctx.currentTime);

      // Low pass filter to soften mechanical vibration
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(220, this.ctx.currentTime);

      this.pumpGain.gain.setValueAtTime(0.001, this.ctx.currentTime);
      this.pumpGain.gain.linearRampToValueAtTime(0.08, this.ctx.currentTime + 0.1);

      this.pumpOsc.connect(filter);
      filter.connect(this.pumpGain);
      this.pumpGain.connect(this.ctx.destination);

      this.pumpOsc.start();
    } catch {
      // AudioContext error
    }
  }

  public stopPumpSound() {
    try {
      if (this.pumpGain && this.ctx) {
        this.pumpGain.gain.linearRampToValueAtTime(0.001, this.ctx.currentTime + 0.08);
      }
      setTimeout(() => {
        if (this.pumpOsc) {
          try {
            this.pumpOsc.stop();
            this.pumpOsc.disconnect();
          } catch {}
          this.pumpOsc = null;
        }
        this.pumpGain = null;
      }, 100);
    } catch {
      this.pumpOsc = null;
      this.pumpGain = null;
    }
  }

  public playSuccessChime() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6

      notes.forEach((freq, i) => {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + i * 0.08);

        gain.gain.setValueAtTime(0, now + i * 0.08);
        gain.gain.linearRampToValueAtTime(0.12, now + i * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.08 + 0.28);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + i * 0.08);
        osc.stop(now + i * 0.08 + 0.3);
      });
    } catch {}
  }

  public playEStopAlarm() {
    if (this.isMuted) return;
    try {
      this.initCtx();
      if (!this.ctx) return;

      const now = this.ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(880, now + i * 0.15);

        gain.gain.setValueAtTime(0.15, now + i * 0.15);
        gain.gain.setValueAtTime(0.001, now + i * 0.15 + 0.1);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now + i * 0.15);
        osc.stop(now + i * 0.15 + 0.12);
      }
    } catch {}
  }
}

export const sound = new SoundSynthesizer();
