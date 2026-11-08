// レイヤーのタイムライン・波形・スペクトログラムの描画
(function (SFX) {
  'use strict';
  const { dsp } = SFX;

  const ROW_H = 14;
  let els = null;
  let last = null;

  // magma 風のカラーマップ
  const COLORMAP = (() => {
    const stops = [
      [0, [0, 0, 4]], [0.2, [40, 11, 84]], [0.4, [101, 21, 110]],
      [0.6, [159, 42, 99]], [0.8, [237, 105, 37]], [1, [252, 255, 164]],
    ];
    const lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      let j = 0;
      while (j < stops.length - 2 && t > stops[j + 1][0]) j++;
      const [t0, c0] = stops[j];
      const [t1, c1] = stops[j + 1];
      const u = (t - t0) / (t1 - t0);
      for (let k = 0; k < 3; k++) lut[i * 3 + k] = c0[k] + (c1[k] - c0[k]) * u;
    }
    return lut;
  })();

  function fit(canvas, dprOverride) {
    const dpr = dprOverride || window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  }

  function tickStep(duration) {
    const steps = [0.05, 0.1, 0.25, 0.5, 1, 2];
    return steps.find((s) => duration / s <= 12) || 2;
  }

  function drawTimeline(result, groups) {
    const layers = groups.filter((g) => g.layer);
    const canvas = els.timeline;
    canvas.style.height = layers.length * ROW_H + 6 + 'px';
    const { ctx, w, h } = fit(canvas);
    ctx.clearRect(0, 0, w, h);
    const { plan, duration } = result;
    const x = (t) => (t / duration) * w;
    ctx.font = '10px -apple-system, "Hiragino Sans", sans-serif';
    ctx.textBaseline = 'middle';
    layers.forEach((g, i) => {
      const span = plan.spans.find((s) => s.key === g.key);
      const p = last.params[g.key];
      const y = 3 + i * ROW_H;
      if (!span || !p.enabled || span.end <= span.start) return;
      const audible = !last.solo.size || last.solo.has(g.key);
      ctx.globalAlpha = audible ? 0.85 : 0.25;
      ctx.fillStyle = g.color;
      const x0 = x(Math.max(0, span.start));
      const x1 = Math.max(x0 + 2, x(span.end));
      ctx.fillRect(x0, y + 1, x1 - x0, ROW_H - 3);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#111';
      if (x1 - x0 > 40) ctx.fillText(g.label, x0 + 4, y + ROW_H / 2);
    });
    drawMarkers(ctx, plan, duration, w, h, false);
  }

  function drawMarkers(ctx, plan, duration, w, h, withLabel) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.setLineDash([3, 3]);
    for (const m of plan.markers) {
      const x = (m.t / duration) * w;
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
      if (withLabel) {
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.font = '10px -apple-system, "Hiragino Sans", sans-serif';
        ctx.fillText(m.label, x + 4, 11);
      }
    }
    ctx.restore();
  }

  function drawWave(result) {
    const { ctx, w, h } = fit(els.wave);
    const { channels, duration } = result;
    ctx.clearRect(0, 0, w, h);
    const mono = channels.length > 1 ? SFX.engine.toMono(channels)[0] : channels[0];
    const n = mono.length;
    const mid = h / 2;

    // 時間目盛り
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.font = '10px -apple-system, sans-serif';
    const step = tickStep(duration);
    for (let t = 0; t <= duration; t += step) {
      const x = Math.round((t / duration) * w) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
      ctx.fillText(t.toFixed(step < 0.1 ? 2 : step < 1 ? 2 : 0) + 's', x + 3, h - 4);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.moveTo(0, mid + 0.5);
    ctx.lineTo(w, mid + 0.5);
    ctx.stroke();

    ctx.fillStyle = '#ff9e64';
    const per = n / w;
    for (let x = 0; x < w; x++) {
      const a = Math.floor(x * per);
      const b = Math.min(n, Math.floor((x + 1) * per) + 1);
      let lo = 1, hi = -1;
      for (let i = a; i < b; i++) {
        const v = mono[i];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi < lo) continue;
      const y0 = mid - hi * mid * 0.95;
      const y1 = mid - lo * mid * 0.95;
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
    drawMarkers(ctx, result.plan, duration, w, h, true);
  }

  function drawSpectrogram(result) {
    const canvas = els.spec;
    const { ctx, w, h } = fit(canvas, 1);
    const { channels, sampleRate } = result;
    const mono = channels.length > 1 ? SFX.engine.toMono(channels)[0] : channels[0];
    const N = 1024;
    const re = new Float32Array(N);
    const im = new Float32Array(N);
    const win = new Float32Array(N);
    for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    // 縦軸は対数周波数。プレビュー品質(低サンプルレート)でも軸が動かないよう上限は固定
    const fMin = 40;
    const fMax = 20000;
    const rowLo = new Int32Array(h);
    const rowHi = new Int32Array(h);
    for (let y = 0; y < h; y++) {
      const fa = fMin * Math.pow(fMax / fMin, 1 - (y + 1) / h);
      const fb = fMin * Math.pow(fMax / fMin, 1 - y / h);
      if (fa >= sampleRate / 2) {
        rowLo[y] = 1;
        rowHi[y] = 0; // ナイキスト超え: 空行
        continue;
      }
      rowLo[y] = Math.max(1, Math.floor((fa / sampleRate) * N));
      rowHi[y] = Math.min(N / 2 - 1, Math.max(rowLo[y], Math.floor((fb / sampleRate) * N)));
    }
    const img = ctx.createImageData(w, h);
    const mags = new Float32Array(N / 2);
    const hop = (mono.length - N) / Math.max(1, w - 1);
    // 全体ゲインで基準を揃える(ノーマライズ OFF でも見やすいよう最大値基準)
    const ref = Math.max(1e-6, dsp.peakOf([mono])) * N * 0.25;
    for (let x = 0; x < w; x++) {
      const off = Math.round(x * hop) - N / 2;
      for (let i = 0; i < N; i++) {
        const j = off + i;
        re[i] = j >= 0 && j < mono.length ? mono[j] * win[i] : 0;
        im[i] = 0;
      }
      dsp.fft(re, im);
      for (let k = 0; k < N / 2; k++) mags[k] = Math.hypot(re[k], im[k]);
      for (let y = 0; y < h; y++) {
        let m = 0;
        for (let k = rowLo[y]; k <= rowHi[y]; k++) if (mags[k] > m) m = mags[k];
        const db = 20 * Math.log10(m / ref + 1e-9);
        const v = Math.max(0, Math.min(255, Math.round(((db + 90) / 90) * 255)));
        const o = (y * w + x) * 4;
        img.data[o] = COLORMAP[v * 3];
        img.data[o + 1] = COLORMAP[v * 3 + 1];
        img.data[o + 2] = COLORMAP[v * 3 + 2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // 周波数目盛り
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '10px -apple-system, sans-serif';
    for (const f of [100, 1000, 5000, 10000]) {
      if (f >= fMax) continue;
      const y = h * (1 - Math.log(f / fMin) / Math.log(fMax / fMin));
      ctx.fillRect(0, Math.round(y), 6, 1);
      ctx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), 8, y + 3);
    }
  }

  const viz = {
    init(elements, onSeek) {
      els = elements;
      els.stack.addEventListener('click', (e) => {
        if (!last) return;
        const r = els.stack.getBoundingClientRect();
        onSeek(((e.clientX - r.left) / r.width) * last.result.duration);
      });
      let timer = 0;
      window.addEventListener('resize', () => {
        clearTimeout(timer);
        timer = setTimeout(() => last && viz.draw(last.result, last.groups, last.params, last.solo), 100);
      });
    },
    draw(result, groups, params, solo) {
      last = { result, groups, params, solo };
      drawTimeline(result, groups);
      drawWave(result);
      drawSpectrogram(result);
      viz.playhead(null);
    },
    playhead(t) {
      const { ctx, w, h } = fit(els.overlay);
      ctx.clearRect(0, 0, w, h);
      if (t == null || !last) return;
      const x = (t / last.result.duration) * w;
      ctx.fillStyle = '#fff';
      ctx.fillRect(Math.round(x), 0, 1.5, h);
    },
  };

  SFX.viz = viz;
})(window.SFX);
