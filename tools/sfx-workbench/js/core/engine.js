// レシピ(音の設計図)を OfflineAudioContext でレンダリングするエンジン。
// レシピはレイヤーを定義するだけで、空間(リバーブ)とマスター処理は全レシピ共通でここが受け持つ。
(function (SFX) {
  'use strict';
  const { dsp } = SFX;

  const MAX_DURATION = 12;

  const layerGainSpec = (def) => ({
    key: 'gain', label: '音量', min: -40, max: 12, step: 0.1, def, unit: 'dB',
    desc: 'このレイヤーの音量',
  });

  const COMMON_GROUPS = [
    {
      key: 'space', label: '空間 (リバーブ)', color: '#7aa2f7',
      desc: '全レイヤー共通の残響',
      params: [
        { key: 'mix', label: 'ウェット量', min: 0, max: 1, step: 0.01, def: 0.15, desc: '残響の混ざる量。0 で無効' },
        { key: 'decay', label: '残響時間', min: 0.1, max: 6, step: 0.01, def: 0.9, unit: 's', scale: 'log' },
        { key: 'predelay', label: 'プリディレイ', min: 0, max: 120, step: 1, def: 12, unit: 'ms', desc: '原音から残響が始まるまでの遅れ。大きいほど広い空間に聞こえる' },
        { key: 'tone', label: '明るさ', min: 800, max: 16000, step: 1, def: 5000, unit: 'Hz', scale: 'log', desc: '残響の高域の残り具合' },
        { key: 'width', label: '広がり', min: 0, max: 1, step: 0.01, def: 0.8, desc: 'ステレオ書き出し時の残響の左右の広がり' },
      ],
    },
    {
      key: 'master', label: 'マスター', color: '#c0caf5',
      desc: '最終段の処理',
      params: [
        { key: 'gain', label: '音量', min: -24, max: 12, step: 0.1, def: 0, unit: 'dB', desc: 'ノーマライズ ON のときはピーク目標が優先される' },
        { key: 'drive', label: 'サチュレーション', min: 0, max: 1, step: 0.01, def: 0.1, desc: '全体を軽く歪ませて密度と存在感を足す' },
        { key: 'hp', label: 'ローカット', min: 20, max: 1000, step: 1, def: 40, unit: 'Hz', scale: 'log' },
        { key: 'lp', label: 'ハイカット', min: 1000, max: 20000, step: 1, def: 18000, unit: 'Hz', scale: 'log' },
        { key: 'pitch', label: 'テープピッチ', min: -12, max: 12, step: 0.1, def: 0, unit: 'st', desc: '再生速度ごと変える。下げると長く重く、上げると短く軽くなる' },
        { key: 'normalize', label: 'ノーマライズ', type: 'toggle', def: true },
        { key: 'peak', label: 'ピーク目標', min: -12, max: 0, step: 0.1, def: -1, unit: 'dBFS' },
        { key: 'trim', label: '末尾の無音を削る', type: 'toggle', def: true },
      ],
    },
  ];

  const groupCache = new WeakMap();

  // UI とエンジンが共有するパラメータ定義(レイヤーには音量を自動で足す)
  function groupsOf(recipe) {
    if (groupCache.has(recipe)) return groupCache.get(recipe);
    const groups = recipe.layers
      .map((l) => ({ ...l, layer: true, params: [layerGainSpec(l.gain ?? 0), ...l.params] }))
      .concat(COMMON_GROUPS);
    groupCache.set(recipe, groups);
    return groups;
  }

  function defaults(recipe) {
    const out = {};
    for (const g of groupsOf(recipe)) {
      const p = {};
      if (g.layer) p.enabled = g.enabled ?? true;
      for (const s of g.params) p[s.key] = s.def;
      out[g.key] = p;
    }
    return out;
  }

  // 部分的なパラメータ(プリセットや保存データ)を既定値に重ねる。未知のキーは捨て、範囲外は丸める
  function merge(recipe, partial) {
    const out = defaults(recipe);
    if (!partial) return out;
    for (const g of groupsOf(recipe)) {
      const src = partial[g.key];
      if (!src || typeof src !== 'object') continue;
      const dst = out[g.key];
      if (g.layer && typeof src.enabled === 'boolean') dst.enabled = src.enabled;
      for (const s of g.params) {
        const v = src[s.key];
        if (typeof v !== typeof dst[s.key]) continue;
        dst[s.key] = typeof v === 'number' ? dsp.clamp(v, s.min, s.max) : v;
      }
    }
    return out;
  }

  /**
   * @param {object} recipe
   * @param {object} params
   * @param {{seed:number, sampleRate?:number, solo?:Set<string>, draft?:boolean}} opts
   *   draft: スライダー操作中の軽量プレビュー。サンプルレートを半分にして畳み込み等のコストを下げる
   * @returns {Promise<{channels:Float32Array[], sampleRate:number, duration:number, peak:number, rawPeak:number, plan:object, renderMs:number, draft:boolean}>}
   */
  async function render(recipe, params, opts) {
    const t0 = performance.now();
    const sampleRate = Math.round((opts.sampleRate || 48000) / (opts.draft ? 2 : 1));
    const seed = opts.seed >>> 0;
    const solo = opts.solo || new Set();
    const m = params.master;
    const sp = params.space;

    // テープピッチ: 低いサンプルレートで描いて高いレートで再生すると、速度ごとピッチが上がる
    const speed = Math.pow(2, m.pitch / 12);
    const renderSr = Math.round(sampleRate / speed);

    const plan = recipe.plan(params);
    const useReverb = sp.mix > 0.001;
    const tail = useReverb ? sp.decay + sp.predelay / 1000 : 0;
    const duration = Math.min(MAX_DURATION, plan.duration + tail + 0.05);
    const ctx = new OfflineAudioContext({
      numberOfChannels: 2,
      length: Math.ceil(duration * renderSr),
      sampleRate: renderSr,
    });

    const bus = ctx.createGain();
    for (const g of groupsOf(recipe)) {
      if (!g.layer) continue;
      const p = params[g.key];
      if (!p.enabled) continue;
      if (solo.size && !solo.has(g.key)) continue;
      const out = dsp.gain(ctx, dsp.dbToGain(p.gain));
      out.connect(bus);
      g.build({
        ctx, p, params, plan, dsp, out,
        rng: SFX.rng.create(SFX.rng.hash(seed, g.key)),
      });
    }

    // マスターチェーン: drive → ローカット → ハイカット → (dry + reverb)
    let node = bus;
    if (m.drive > 0.001) {
      const ws = dsp.shaper(ctx, m.drive);
      node.connect(ws);
      node = ws;
    }
    // フィルタ周波数は出力側の Hz で指定できるようテープ速度で補正する
    const hp = dsp.filter(ctx, 'highpass', m.hp / speed, 0.707);
    const lp = dsp.filter(ctx, 'lowpass', m.lp / speed, 0.707);
    node.connect(hp);
    hp.connect(lp);
    const master = dsp.gain(ctx, dsp.dbToGain(m.gain));
    master.connect(ctx.destination);
    lp.connect(master);

    if (useReverb) {
      const send = dsp.gain(ctx, sp.mix);
      const pre = ctx.createDelay(1);
      pre.delayTime.value = sp.predelay / 1000 / speed;
      const conv = ctx.createConvolver();
      conv.buffer = dsp.impulse(ctx, sp.decay / speed, sp.tone / speed, sp.width, SFX.rng.create(SFX.rng.hash(seed, 'space')));
      lp.connect(send);
      send.connect(pre);
      pre.connect(conv);
      conv.connect(master);
    }

    const rendered = await ctx.startRendering();
    const raw = [rendered.getChannelData(0), rendered.getChannelData(1)];
    const rawPeak = dsp.peakOf(raw);
    const channels = postProcess(raw, sampleRate, m, rawPeak);

    return {
      channels,
      sampleRate,
      duration: channels[0].length / sampleRate,
      peak: dsp.peakOf(channels),
      rawPeak,
      plan: scalePlan(plan, speed),
      renderMs: performance.now() - t0,
      draft: !!opts.draft,
    };
  }

  function postProcess(raw, sr, m, peak) {
    let n = raw[0].length;
    if (m.trim && peak > 0) {
      const thr = peak * dsp.dbToGain(-60);
      let last = 0;
      for (const c of raw) {
        for (let i = c.length - 1; i > last; i--) {
          if (Math.abs(c[i]) > thr) { last = i; break; }
        }
      }
      n = Math.min(n, last + Math.round(0.03 * sr));
    }
    const fade = Math.min(n, Math.round(0.02 * sr));
    const out = raw.map((c) => {
      const d = c.slice(0, n);
      for (let i = 0; i < fade; i++) d[n - 1 - i] *= i / fade;
      return d;
    });
    if (m.normalize) {
      const p = dsp.peakOf(out);
      if (p > 0) {
        const g = dsp.dbToGain(m.peak) / p;
        for (const d of out) for (let i = 0; i < d.length; i++) d[i] *= g;
      }
    }
    return out;
  }

  function scalePlan(plan, speed) {
    return {
      ...plan,
      spans: (plan.spans || []).map((s) => ({ ...s, start: s.start / speed, end: s.end / speed })),
      markers: (plan.markers || []).map((mk) => ({ ...mk, t: mk.t / speed })),
    };
  }

  // ---- 書き出し ----

  function toMono(channels) {
    const n = channels[0].length;
    const out = new Float32Array(n);
    for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length;
    return [out];
  }

  function encodeWav(channels, sampleRate, bitDepth = 16) {
    const nCh = channels.length;
    const n = channels[0].length;
    const isFloat = bitDepth === 32;
    const bps = bitDepth / 8;
    const blockAlign = nCh * bps;
    const dataSize = n * blockAlign;
    const buf = new ArrayBuffer(44 + dataSize);
    const v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    v.setUint32(4, 36 + dataSize, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, isFloat ? 3 : 1, true);
    v.setUint16(22, nCh, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * blockAlign, true);
    v.setUint16(32, blockAlign, true);
    v.setUint16(34, bitDepth, true);
    str(36, 'data');
    v.setUint32(40, dataSize, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < nCh; c++) {
        const s = dsp.clamp(channels[c][i], -1, 1);
        if (bitDepth === 16) {
          v.setInt16(o, Math.round(s * 32767), true);
        } else if (bitDepth === 24) {
          const x = Math.round(s * 8388607);
          v.setUint8(o, x & 0xff);
          v.setUint8(o + 1, (x >> 8) & 0xff);
          v.setUint8(o + 2, (x >> 16) & 0xff);
        } else {
          v.setFloat32(o, s, true);
        }
        o += bps;
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---- 試聴 ----

  class Player {
    constructor() {
      this.ctx = null;
      this.src = null;
      this.startedAt = 0;
      this.duration = 0;
    }
    play(result, offset = 0) {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.stop();
      const { channels, sampleRate } = result;
      const buf = this.ctx.createBuffer(channels.length, channels[0].length, sampleRate);
      channels.forEach((c, i) => buf.copyToChannel(c, i));
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.ctx.destination);
      src.onended = () => { if (this.src === src) this.src = null; };
      offset = dsp.clamp(offset, 0, result.duration);
      src.start(0, offset);
      this.src = src;
      this.startedAt = this.ctx.currentTime - offset;
      this.duration = result.duration;
    }
    stop() {
      if (this.src) {
        try { this.src.stop(); } catch (e) { /* 既に停止済み */ }
        this.src = null;
      }
    }
    get playing() {
      return !!this.src;
    }
    position() {
      return this.src ? this.ctx.currentTime - this.startedAt : null;
    }
  }

  SFX.engine = { groupsOf, defaults, merge, render, encodeWav, toMono };
  SFX.Player = Player;
})(window.SFX);
