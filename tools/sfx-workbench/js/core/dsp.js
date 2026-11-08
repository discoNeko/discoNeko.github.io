// 音源生成・信号処理のユーティリティ。
// サンプル単位で作る素材(ノイズ・粒)は JS で生成し、
// フィルタ・エンベロープ・歪み・残響は Web Audio のノードで行う。
(function (SFX) {
  'use strict';

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const dbToGain = (db) => Math.pow(10, db / 20);
  const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));

  function noise(n, rng, color = 'white') {
    const out = new Float32Array(n);
    if (color === 'pink') {
      // Paul Kellet の簡易ピンクノイズ
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < n; i++) {
        const w = rng.bipolar();
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        out[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
      }
    } else if (color === 'brown') {
      let last = 0;
      for (let i = 0; i < n; i++) {
        last = (last + 0.02 * rng.bipolar()) / 1.02;
        out[i] = last * 3.5;
      }
    } else {
      for (let i = 0; i < n; i++) out[i] = rng.bipolar();
    }
    return out;
  }

  // 粒ごとに周波数を変えたいとき用の JS 版 biquad (RBJ Audio EQ Cookbook)
  class Biquad {
    constructor() {
      this.reset();
    }
    reset() {
      this.x1 = this.x2 = this.y1 = this.y2 = 0;
      return this;
    }
    set(type, freq, q, sr) {
      const f = clamp(freq, 10, sr * 0.49);
      const w0 = (2 * Math.PI * f) / sr;
      const cs = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * q);
      const a0 = 1 + alpha;
      let b0, b1, b2;
      if (type === 'bandpass') {
        b0 = alpha; b1 = 0; b2 = -alpha;
      } else if (type === 'lowpass') {
        b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0;
      } else {
        b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0;
      }
      this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0;
      this.a1 = (-2 * cs) / a0; this.a2 = (1 - alpha) / a0;
      return this;
    }
    process(x) {
      const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
      this.x2 = this.x1; this.x1 = x;
      this.y2 = this.y1; this.y1 = y;
      return y;
    }
  }

  // ホワイトノイズを帯域通過させたとき、出力 RMS が入力とほぼ揃うようにする補正係数
  function bandpassMakeup(freq, q, sr) {
    const bw = Math.max(freq / q, 1);
    return Math.min(40, Math.sqrt(sr / (Math.PI * bw)));
  }

  // ---- Web Audio ヘルパー ----

  function clampFreq(ctx, f) {
    return clamp(f, 10, ctx.sampleRate * 0.48);
  }

  function bufferSource(ctx, data, when) {
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.copyToChannel(data, 0);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.start(Math.max(0, when));
    return src;
  }

  function filter(ctx, type, freq, q = 0.707) {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = clampFreq(ctx, freq);
    f.Q.value = q;
    return f;
  }

  function sweep(ctx, param, from, to, t0, t1) {
    param.setValueAtTime(clampFreq(ctx, from), t0);
    param.exponentialRampToValueAtTime(clampFreq(ctx, to), Math.max(t1, t0 + 0.001));
  }

  function gain(ctx, value) {
    const g = ctx.createGain();
    g.gain.value = value;
    return g;
  }

  // tanh サチュレーション。入力 ±1 が出力 ±1 になるよう正規化
  function driveCurve(amount) {
    const k = 1 + amount * 12;
    const n = 2048;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    return curve;
  }

  function shaper(ctx, amount) {
    const ws = ctx.createWaveShaper();
    ws.curve = driveCurve(amount);
    ws.oversample = '4x';
    return ws;
  }

  // 減衰ノイズで作る人工残響。時間とともに高域が落ちていく
  function impulse(ctx, seconds, tone, width, rng) {
    const sr = ctx.sampleRate;
    const n = Math.max(2, Math.ceil(seconds * sr));
    const buf = ctx.createBuffer(2, n, sr);
    const a = noise(n, rng);
    const b = noise(n, rng);
    const theta = (width * Math.PI) / 2;
    const ca = Math.cos(theta), sb = Math.sin(theta);
    const fadeIn = Math.round(0.002 * sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      let g = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        if ((i & 31) === 0) {
          const fc = clamp(tone * Math.pow(0.25, t / seconds), 40, sr * 0.45);
          g = 1 - Math.exp((-2 * Math.PI * fc) / sr);
        }
        const w = ch === 0 ? a[i] : a[i] * ca + b[i] * sb;
        lp += g * (w - lp);
        const env = Math.exp((-6.9 * t) / seconds) * (i < fadeIn ? i / fadeIn : 1);
        d[i] = lp * env;
      }
    }
    return buf;
  }

  // ---- 解析 ----

  function fft(re, im) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const ang = (-2 * Math.PI) / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < half; k++) {
          const p = i + k, q = p + half;
          const xr = re[q] * cr - im[q] * ci;
          const xi = re[q] * ci + im[q] * cr;
          re[q] = re[p] - xr; im[q] = im[p] - xi;
          re[p] += xr; im[p] += xi;
          const ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  function peakOf(channels) {
    let peak = 0;
    for (const c of channels) for (let i = 0; i < c.length; i++) {
      const a = Math.abs(c[i]);
      if (a > peak) peak = a;
    }
    return peak;
  }

  SFX.dsp = {
    clamp, dbToGain, gainToDb, noise, Biquad, bandpassMakeup,
    clampFreq, bufferSource, filter, sweep, gain, driveCurve, shaper, impulse,
    fft, peakOf,
  };
})(window.SFX);
