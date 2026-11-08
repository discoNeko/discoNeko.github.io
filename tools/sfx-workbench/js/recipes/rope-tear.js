// レシピ: ロープを引きちぎる音
//
// 実際のロープ破断を時間順に 5 つの物理現象へ分解し、それぞれを独立したレイヤーとして合成する。
//   1. きしみ     … 張力がかかった繊維同士の stick-slip 摩擦(周期的なパルス → 共鳴フィルタ)
//   2. 繊維の断裂 … 破断直前に細い繊維が一本ずつ切れるプチプチ音(破断に向かって加速)
//   3. 破断       … メインの「バチッ」。高域のクラック + 胴鳴りノイズ + 低音の衝撃
//   4. ほつれ     … 破断直後に繊維が裂けていくザラザラした音
//   5. 反動       … 切れた端が跳ね返る風切り音と、どこかに当たる音
(function (SFX) {
  'use strict';

  const creak = {
    key: 'creak', label: 'きしみ (張力)', color: '#e0af68', gain: -12,
    desc: '引っ張られた繊維がこすれる「ギギギ…」。周期が速くなるほど音程感のある唸りになる',
    params: [
      { key: 'length', label: '長さ', min: 0.05, max: 3, step: 0.01, def: 0.9, unit: 's', scale: 'log' },
      { key: 'gap', label: '溜め (間)', min: 0, max: 400, step: 1, def: 50, unit: 'ms', desc: 'きしみが止まってから破断するまでの無音。一瞬の間があると破断が際立つ' },
      { key: 'rateStart', label: '周期 開始', min: 3, max: 300, step: 0.1, def: 10, unit: '/s', scale: 'log', desc: '1 秒あたりのこすれ回数。小さいとカチカチ、大きいとギーッという唸り' },
      { key: 'rateEnd', label: '周期 終了', min: 3, max: 600, step: 0.1, def: 90, unit: '/s', scale: 'log' },
      { key: 'curve', label: '加速カーブ', min: 0.3, max: 4, step: 0.01, def: 1.6, desc: '大きいほど終盤で一気に詰まる' },
      { key: 'jitter', label: '不規則さ', min: 0, max: 1, step: 0.01, def: 0.4 },
      { key: 'freq', label: '共鳴周波数', min: 60, max: 3000, step: 1, def: 320, unit: 'Hz', scale: 'log', desc: 'ロープの太さ・素材感。低いほど太く重い' },
      { key: 'rise', label: '共鳴の上昇', min: -12, max: 24, step: 0.1, def: 7, unit: 'st', desc: '張力が増すにつれて音程が上がる量' },
      { key: 'q', label: '共鳴の鋭さ', min: 1, max: 40, step: 0.1, def: 10, scale: 'log', desc: '高いほど鳴きが強く、低いほどガサガサ' },
      { key: 'ratio', label: '第2共鳴の倍率', min: 1.2, max: 5, step: 0.01, def: 2.6 },
      { key: 'friction', label: '摩擦ノイズ', min: 0, max: 1, step: 0.01, def: 0.3, desc: 'こすれのザラつき成分' },
      { key: 'swell', label: 'クレッシェンド', min: 0, max: 1, step: 0.01, def: 0.85, desc: '破断に向けて大きくなる度合い' },
    ],
    build({ ctx, p, rng, out, plan, dsp }) {
      const sr = ctx.sampleRate;
      const len = p.length;
      const start = plan.t.creakStart;
      const n = Math.ceil((len + 0.05) * sr);
      const src = new Float32Array(n);

      // stick-slip: 摩擦が限界を超えるたびに滑る → 短いクリックの連なり
      const tau = 0.00035 * sr;
      const clickLen = Math.ceil(tau * 6);
      const r0 = p.rateStart, r1 = p.rateEnd;
      let t = 0;
      while (t < len) {
        const s = Math.pow(t / len, p.curve);
        const rate = r0 * Math.pow(r1 / r0, s);
        const amp = ((1 - p.swell) + p.swell * s) * (1 - p.jitter * 0.6 * rng.next());
        const i0 = Math.floor(t * sr);
        for (let k = 0; k < clickLen && i0 + k < n; k++) src[i0 + k] += amp * Math.exp(-k / tau);
        t += (1 / rate) * (1 + p.jitter * 0.9 * rng.bipolar());
      }
      if (p.friction > 0) {
        const nz = dsp.noise(n, rng, 'pink');
        const end = Math.floor(len * sr);
        for (let i = 0; i < end; i++) {
          const s = Math.pow(i / end, p.curve);
          src[i] += nz[i] * p.friction * 0.12 * (0.3 + 0.7 * s);
        }
      }

      const f0 = p.freq;
      const f1 = p.freq * Math.pow(2, p.rise / 12);
      // クリックの面積 × 帯域幅 で決まる出力レベルを補正
      const w0 = (2 * Math.PI * Math.sqrt(f0 * f1)) / sr;
      const makeup = Math.min(80, (0.7 * p.q) / (tau * Math.sin(Math.min(w0, Math.PI / 2))));

      const node = dsp.bufferSource(ctx, src, start);
      const bp1 = dsp.filter(ctx, 'bandpass', f0, p.q);
      const bp2 = dsp.filter(ctx, 'bandpass', f0 * p.ratio, p.q * 0.8);
      dsp.sweep(ctx, bp1.frequency, f0, f1, start, start + len);
      dsp.sweep(ctx, bp2.frequency, f0 * p.ratio, f1 * p.ratio, start, start + len);
      const g1 = dsp.gain(ctx, makeup);
      const g2 = dsp.gain(ctx, makeup * 0.5);
      node.connect(bp1); bp1.connect(g1); g1.connect(out);
      node.connect(bp2); bp2.connect(g2); g2.connect(out);
    },
  };

  const pops = {
    key: 'pops', label: '繊維の断裂', color: '#9ece6a', gain: -10,
    desc: '破断の直前に細い繊維が一本ずつ切れる「プチ、プチプチッ」',
    params: [
      { key: 'count', label: '数', min: 0, max: 100, step: 1, def: 16 },
      { key: 'span', label: '期間', min: 0.02, max: 2.5, step: 0.01, def: 0.6, unit: 's', scale: 'log', desc: '破断の何秒前から切れ始めるか' },
      { key: 'accel', label: '集中度', min: 0.3, max: 6, step: 0.01, def: 2.5, desc: '大きいほど破断の直前に集中する(加速感)' },
      { key: 'freq', label: '明るさ', min: 300, max: 12000, step: 1, def: 3000, unit: 'Hz', scale: 'log' },
      { key: 'spread', label: '音程のばらつき', min: 0, max: 2.5, step: 0.01, def: 1, unit: 'oct' },
      { key: 'decay', label: '粒の長さ', min: 0.2, max: 25, step: 0.1, def: 2.5, unit: 'ms', scale: 'log' },
      { key: 'q', label: '鋭さ', min: 0.5, max: 20, step: 0.1, def: 2.5, scale: 'log' },
      { key: 'click', label: 'クリック感', min: 0, max: 1, step: 0.01, def: 0.3, desc: '粒の頭の硬さ' },
      { key: 'dynamics', label: '強弱のばらつき', min: 0, max: 1, step: 0.01, def: 0.6 },
      { key: 'crescendo', label: 'クレッシェンド', min: 0, max: 1, step: 0.01, def: 0.7 },
    ],
    build({ ctx, p, rng, out, plan, dsp }) {
      if (p.count < 1) return;
      const sr = ctx.sampleRate;
      const start = plan.t.snap - p.span;
      const n = Math.ceil((p.span + 0.06) * sr);
      const buf = new Float32Array(n);
      const tau = (p.decay / 1000) * sr;
      const grainLen = Math.ceil(tau * 7) + 8;
      const bq = new dsp.Biquad();
      for (let i = 0; i < p.count; i++) {
        const before = p.span * Math.pow(rng.next(), p.accel);
        let amp = 1 - p.crescendo * (before / p.span);
        amp *= 1 - p.dynamics * rng.next();
        const f = p.freq * Math.pow(2, p.spread * rng.bipolar());
        const mk = dsp.bandpassMakeup(f, p.q, sr) * 0.7;
        bq.reset().set('bandpass', f, p.q, sr);
        const i0 = Math.floor((p.span - before) * sr);
        for (let k = 0; k < grainLen && i0 + k < n; k++) {
          const x = rng.bipolar() * Math.exp(-k / tau);
          let y = bq.process(x) * mk;
          if (k < 3) y += p.click * (1 - k / 3) * (rng.next() < 0.5 ? -1 : 1);
          buf[i0 + k] += y * amp;
        }
      }
      dsp.bufferSource(ctx, buf, start).connect(out);
    },
  };

  const snap = {
    key: 'snap', label: '破断 (メイン)', color: '#f7768e', gain: 0,
    desc: 'ロープが切れる瞬間の「バチッ」。クラック・胴鳴り・低音の衝撃の 3 要素',
    params: [
      { key: 'crack', label: 'クラック', min: 0, max: 1, step: 0.01, def: 0.8, desc: '立ち上がりの鋭い破裂成分' },
      { key: 'crackTone', label: 'クラックの高さ', min: 800, max: 12000, step: 1, def: 3500, unit: 'Hz', scale: 'log' },
      { key: 'body', label: '胴鳴り周波数', min: 200, max: 6000, step: 1, def: 1300, unit: 'Hz', scale: 'log', desc: '破断音の芯の音色。低いと「ボンッ」寄り、高いと「パチッ」寄り' },
      { key: 'bodyQ', label: '胴鳴りの鋭さ', min: 0.3, max: 12, step: 0.01, def: 1.1, scale: 'log' },
      { key: 'decay', label: '減衰', min: 5, max: 500, step: 1, def: 70, unit: 'ms', scale: 'log' },
      { key: 'splits', label: '分裂数', min: 1, max: 6, step: 1, def: 2, desc: '一気に切れず「バチバチッ」と複数回に分かれる' },
      { key: 'splitGap', label: '分裂間隔', min: 2, max: 120, step: 1, def: 12, unit: 'ms', scale: 'log' },
      { key: 'thump', label: '低音の衝撃', min: 0, max: 1, step: 0.01, def: 0.55, desc: '重さ・パワー感' },
      { key: 'thumpFreq', label: '衝撃の高さ', min: 30, max: 300, step: 1, def: 80, unit: 'Hz', scale: 'log' },
      { key: 'thumpDrop', label: 'ピッチ落ち', min: 0, max: 36, step: 0.1, def: 12, unit: 'st' },
      { key: 'thumpDecay', label: '衝撃の減衰', min: 20, max: 800, step: 1, def: 140, unit: 'ms', scale: 'log' },
      { key: 'drive', label: '歪み', min: 0, max: 1, step: 0.01, def: 0.35 },
    ],
    build({ ctx, p, rng, out, plan, dsp }) {
      const sr = ctx.sampleRate;
      const T = plan.t.snap;
      const ws = dsp.shaper(ctx, p.drive);
      const post = dsp.gain(ctx, 0.7);
      ws.connect(post);
      post.connect(out);

      let t = T;
      for (let s = 0; s < p.splits; s++) {
        const amp = s === 0 ? 1 : 0.35 + 0.45 * rng.next();
        const decay = (p.decay / 1000) * (s === 0 ? 1 : 0.6 + 0.4 * rng.next());
        const tau = decay / 6.9;
        const n = Math.ceil((decay + 0.01) * sr);
        const attack = Math.max(1, Math.round(0.0003 * sr));
        const body = dsp.noise(n, rng);
        for (let i = 0; i < n; i++) body[i] *= Math.exp(-i / sr / tau) * (i < attack ? i / attack : 1);
        const fBody = p.body * (s === 0 ? 1 : Math.pow(2, 0.3 * rng.bipolar()));
        const bp = dsp.filter(ctx, 'bandpass', fBody, p.bodyQ);
        const gBody = dsp.gain(ctx, amp * dsp.bandpassMakeup(fBody, p.bodyQ, sr) * 0.35);
        dsp.bufferSource(ctx, body, t).connect(bp);
        bp.connect(gBody); gBody.connect(ws);

        if (p.crack > 0) {
          const nc = Math.ceil(0.005 * sr);
          const ct = 0.0008 * sr;
          const crack = dsp.noise(nc, rng);
          for (let i = 0; i < nc; i++) crack[i] *= Math.exp(-i / ct);
          const hp = dsp.filter(ctx, 'highpass', p.crackTone, 0.7);
          const gCrack = dsp.gain(ctx, amp * p.crack * 0.9);
          dsp.bufferSource(ctx, crack, t).connect(hp);
          hp.connect(gCrack); gCrack.connect(ws);
        }
        t += (p.splitGap / 1000) * (0.6 + 0.8 * rng.next());
      }

      if (p.thump > 0) {
        const d = p.thumpDecay / 1000;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        const fStart = p.thumpFreq * Math.pow(2, p.thumpDrop / 12);
        dsp.sweep(ctx, osc.frequency, fStart, p.thumpFreq, T, T + d * 0.35);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, T);
        g.gain.linearRampToValueAtTime(p.thump * 0.8, T + 0.002);
        g.gain.setTargetAtTime(0, T + 0.002, d / 6.9);
        osc.connect(g); g.connect(ws);
        osc.start(T);
        osc.stop(T + d + 0.05);
      }
    },
  };

  const tear = {
    key: 'tear', label: 'ほつれ (引き裂き)', color: '#bb9af7', gain: -5,
    desc: '破断直後に残りの繊維が裂けていく「ザザッ」「ビリッ」',
    params: [
      { key: 'offset', label: '開始タイミング', min: -50, max: 300, step: 1, def: 3, unit: 'ms', desc: '破断からのズレ。マイナスで破断より先に裂け始める' },
      { key: 'length', label: '長さ', min: 0.02, max: 2.5, step: 0.01, def: 0.35, unit: 's', scale: 'log' },
      { key: 'density', label: '粒の密度', min: 10, max: 4000, step: 1, def: 500, unit: '/s', scale: 'log', desc: '低いとパチパチ、高いとザーッ' },
      { key: 'densityDecay', label: '密度の減り方', min: 0, max: 1, step: 0.01, def: 0.7 },
      { key: 'grainDecay', label: '粒の長さ', min: 0.1, max: 12, step: 0.1, def: 1.2, unit: 'ms', scale: 'log' },
      { key: 'freq', label: '明るさ', min: 200, max: 10000, step: 1, def: 2000, unit: 'Hz', scale: 'log' },
      { key: 'sweep', label: '明るさの変化', min: -24, max: 24, step: 0.1, def: -8, unit: 'st', desc: '鳴っている間に音色が上下する量' },
      { key: 'q', label: '帯域の鋭さ', min: 0.3, max: 10, step: 0.01, def: 0.9, scale: 'log' },
      { key: 'floor', label: 'ノイズ成分', min: 0, max: 1, step: 0.01, def: 0.25, desc: '粒の間を埋める連続的なザー音' },
      { key: 'curve', label: '減衰カーブ', min: 0.3, max: 5, step: 0.01, def: 1.8, desc: '大きいほど頭に集中してすぐ消える' },
      { key: 'roughness', label: '粗さ', min: 0, max: 1, step: 0.01, def: 0.75, desc: '粒ごとの強弱の差' },
    ],
    build({ ctx, p, rng, out, plan, dsp }) {
      const sr = ctx.sampleRate;
      const start = plan.t.snap + p.offset / 1000;
      const len = p.length;
      const n = Math.ceil((len + 0.02) * sr);
      const src = new Float32Array(n);
      const tau = (p.grainDecay / 1000) * sr;
      const gl = Math.ceil(tau * 6) + 4;
      let t = 0;
      while (t < len) {
        const x = t / len;
        const amp = 1 - p.roughness * rng.next();
        const i0 = Math.floor(t * sr);
        for (let k = 0; k < gl && i0 + k < n; k++) src[i0 + k] += rng.bipolar() * Math.exp(-k / tau) * amp;
        t += rng.exp(p.density * (1 - p.densityDecay * x) + 1);
      }
      // 粒が重なるほど振幅が増えるので密度で正規化
      const norm = 1 / Math.sqrt(1 + (p.density * p.grainDecay) / 1000);
      const atk = Math.round(0.002 * sr);
      for (let i = 0; i < n; i++) {
        const x = i / sr / len;
        const env = x < 1 ? Math.pow(1 - x, p.curve) * (i < atk ? i / atk : 1) : 0;
        src[i] = (src[i] * norm + rng.bipolar() * p.floor * 0.5) * env;
      }
      const f1 = p.freq * Math.pow(2, p.sweep / 12);
      const bp = dsp.filter(ctx, 'bandpass', p.freq, p.q);
      dsp.sweep(ctx, bp.frequency, p.freq, f1, start, start + len);
      const g = dsp.gain(ctx, dsp.bandpassMakeup(Math.sqrt(p.freq * f1), p.q, sr) * 0.7);
      dsp.bufferSource(ctx, src, start).connect(bp);
      bp.connect(g); g.connect(out);
    },
  };

  const recoil = {
    key: 'recoil', label: '反動 (跳ね返り)', color: '#7dcfff', gain: -16,
    desc: '切れた端が跳ね返る「ヒュンッ」と、端がどこかに当たる「パタッ」',
    params: [
      { key: 'delay', label: '開始タイミング', min: 0, max: 300, step: 1, def: 15, unit: 'ms' },
      { key: 'length', label: '長さ', min: 0.04, max: 1.5, step: 0.01, def: 0.3, unit: 's', scale: 'log' },
      { key: 'freqStart', label: '開始の高さ', min: 150, max: 10000, step: 1, def: 2600, unit: 'Hz', scale: 'log' },
      { key: 'freqEnd', label: '終了の高さ', min: 60, max: 8000, step: 1, def: 450, unit: 'Hz', scale: 'log' },
      { key: 'q', label: '鋭さ', min: 0.3, max: 12, step: 0.01, def: 1.4, scale: 'log', desc: '高いほど「ヒューッ」と音程感が出る' },
      { key: 'attack', label: 'ピーク位置', min: 0.03, max: 0.9, step: 0.01, def: 0.25, desc: '風切りが最も強くなるタイミング(長さに対する割合)' },
      { key: 'flutter', label: 'はためき', min: 0, max: 1, step: 0.01, def: 0.35, desc: 'ロープがバタつく周期的な揺れ' },
      { key: 'flutterRate', label: 'はためき速度', min: 3, max: 80, step: 0.1, def: 24, unit: 'Hz', scale: 'log' },
      { key: 'slap', label: '着地音', min: 0, max: 1, step: 0.01, def: 0.2, desc: '跳ねた端が何かに当たる音' },
    ],
    build({ ctx, p, rng, out, plan, dsp }) {
      const sr = ctx.sampleRate;
      const start = plan.t.snap + p.delay / 1000;
      const len = p.length;
      const n = Math.ceil(len * sr);
      const bp = dsp.filter(ctx, 'bandpass', p.freqStart, p.q);
      dsp.sweep(ctx, bp.frequency, p.freqStart, p.freqEnd, start, start + len);

      const env = ctx.createGain();
      const pts = 512;
      const curve = new Float32Array(pts);
      const phase = rng.next() * Math.PI * 2;
      for (let i = 0; i < pts; i++) {
        const x = i / (pts - 1);
        const a = p.attack;
        let e = x < a ? Math.pow(x / a, 2) : Math.pow((1 - x) / (1 - a), 1.5);
        // はためきは徐々に遅くなる
        const ph = 2 * Math.PI * p.flutterRate * len * x * (1 - 0.3 * x) + phase;
        e *= 1 - p.flutter * 0.5 * (1 + Math.sin(ph));
        curve[i] = e;
      }
      curve[pts - 1] = 0;
      env.gain.setValueCurveAtTime(curve, start, len);
      const mk = dsp.gain(ctx, dsp.bandpassMakeup(Math.sqrt(p.freqStart * p.freqEnd), p.q, sr) * 0.35);
      dsp.bufferSource(ctx, dsp.noise(n, rng), start).connect(bp);
      bp.connect(env); env.connect(mk); mk.connect(out);

      if (p.slap > 0) {
        const ts = start + len * 0.85;
        const ns = Math.ceil(0.06 * sr);
        const tau = 0.006 * sr;
        const burst = dsp.noise(ns, rng);
        for (let i = 0; i < ns; i++) burst[i] *= Math.exp(-i / tau);
        const sbp = dsp.filter(ctx, 'bandpass', 380, 1.2);
        const sg = dsp.gain(ctx, p.slap * dsp.bandpassMakeup(380, 1.2, sr) * 0.3);
        dsp.bufferSource(ctx, burst, ts).connect(sbp);
        sbp.connect(sg); sg.connect(out);
      }
    },
  };

  // 時間配置: きしみ・断裂を破断時刻から逆算して並べ、破断後のレイヤーは破断時刻から相対配置する
  function plan(P) {
    const c = P.creak, po = P.pops, s = P.snap, te = P.tear, r = P.recoil;
    const pre = Math.max(
      c.enabled ? c.length + c.gap / 1000 : 0,
      po.enabled ? po.span : 0,
    );
    const snapT = 0.06 + pre;
    const snapEnd = (s.decay / 1000) * 1.2 + ((s.splits - 1) * s.splitGap) / 1000 * 1.4;
    const thumpEnd = s.thump > 0 ? s.thumpDecay / 1000 : 0;
    const tails = [
      s.enabled ? Math.max(snapEnd, thumpEnd) : 0,
      te.enabled ? te.offset / 1000 + te.length : 0,
      r.enabled ? r.delay / 1000 + r.length + (r.slap > 0 ? 0.06 : 0) : 0,
    ];
    const creakStart = snapT - c.gap / 1000 - c.length;
    return {
      duration: snapT + Math.max(0.05, ...tails) + 0.1,
      t: { snap: snapT, creakStart },
      spans: [
        { key: 'creak', start: creakStart, end: creakStart + c.length },
        { key: 'pops', start: snapT - po.span, end: snapT },
        { key: 'snap', start: snapT, end: snapT + Math.max(snapEnd, thumpEnd) },
        { key: 'tear', start: snapT + te.offset / 1000, end: snapT + te.offset / 1000 + te.length },
        { key: 'recoil', start: snapT + r.delay / 1000, end: snapT + r.delay / 1000 + r.length },
      ],
      markers: [{ t: snapT, label: '破断' }],
    };
  }

  const presets = [
    { name: '標準 (麻ロープ)', params: {} },
    {
      name: '細い紐',
      params: {
        creak: { length: 0.35, freq: 900, q: 8, rateEnd: 140, gain: -16 },
        pops: { count: 8, span: 0.3, freq: 5500, decay: 1.2 },
        snap: { body: 2800, decay: 35, splits: 1, thump: 0.15, thumpFreq: 140, crack: 0.9, crackTone: 5000 },
        tear: { length: 0.15, freq: 4200, density: 700 },
        recoil: { gain: -20, length: 0.18, freqStart: 4500, freqEnd: 1200, slap: 0 },
        space: { mix: 0.08, decay: 0.5 },
      },
    },
    {
      name: '太い係留ロープ',
      params: {
        creak: { length: 1.6, freq: 160, rise: 5, q: 14, rateStart: 6, rateEnd: 50, gain: -9 },
        pops: { count: 28, span: 1.1, freq: 1800, decay: 4.5 },
        snap: { body: 700, bodyQ: 0.9, decay: 140, splits: 3, splitGap: 22, thump: 0.9, thumpFreq: 55, thumpDecay: 260, drive: 0.5 },
        tear: { length: 0.7, freq: 1200, density: 350, sweep: -10 },
        recoil: { gain: -12, length: 0.5, freqStart: 1500, freqEnd: 220, slap: 0.5 },
        space: { mix: 0.25, decay: 1.6 },
        master: { pitch: -2 },
      },
    },
    {
      name: 'ナイロン (張り詰め)',
      params: {
        creak: { freq: 650, q: 22, rateEnd: 220, friction: 0.1, rise: 10 },
        pops: { count: 6, freq: 6000 },
        snap: { crack: 1, crackTone: 6000, body: 2200, bodyQ: 1.8, decay: 50, splits: 1, thump: 0.35, drive: 0.5 },
        tear: { length: 0.1, gain: -14 },
        recoil: { gain: -8, length: 0.4, freqStart: 5000, freqEnd: 600, q: 2, flutter: 0.6, flutterRate: 30, slap: 0.3 },
      },
    },
    {
      name: 'じわじわ裂ける',
      params: {
        creak: { length: 2.2, rateStart: 5, rateEnd: 60, curve: 2.2 },
        pops: { count: 60, span: 1.8, accel: 1.6 },
        snap: { gain: -6, decay: 50, thump: 0.3, splits: 1 },
        tear: { length: 1.1, density: 900, densityDecay: 0.4, roughness: 0.85, sweep: -4 },
        recoil: { gain: -24 },
      },
    },
    {
      name: '一瞬でブチッ',
      params: {
        creak: { enabled: false },
        pops: { count: 5, span: 0.08, accel: 1 },
        snap: { crack: 1, decay: 80, splits: 2, splitGap: 8, thump: 0.7, drive: 0.5 },
        tear: { length: 0.22 },
        recoil: { delay: 10 },
      },
    },
  ];

  SFX.registerRecipe({
    id: 'rope-tear',
    name: 'ロープを引きちぎる',
    layers: [creak, pops, snap, tear, recoil],
    plan,
    presets,
  });
})(window.SFX);
