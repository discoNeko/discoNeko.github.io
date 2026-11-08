// パラメータ定義からスライダー群を自動生成する。レシピを足しても UI のコードは触らなくてよい。
(function (SFX) {
  'use strict';

  const decimals = (step) => (step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3);

  function quantize(s, v) {
    const st = s.step || 0.01;
    v = Math.min(s.max, Math.max(s.min, v));
    v = Math.round(v / st) * st;
    return +v.toFixed(decimals(st));
  }

  // スライダー位置(0..1) ⇔ 値。周波数や時間は対数スケールの方が耳の感覚に合う
  function toPos(s, v) {
    const t = s.scale === 'log'
      ? Math.log(v / s.min) / Math.log(s.max / s.min)
      : (v - s.min) / (s.max - s.min);
    return Math.min(1, Math.max(0, t));
  }

  function fromPos(s, t) {
    const v = s.scale === 'log' ? s.min * Math.pow(s.max / s.min, t) : s.min + (s.max - s.min) * t;
    return quantize(s, v);
  }

  function format(s, v) {
    return v.toFixed(decimals(s.step || 0.01));
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /**
   * @param {HTMLElement} root
   * @param {object[]} groups engine.groupsOf(recipe)
   * @param {{set(g,k,v,commit), commit(), solo(g), lock(g), reset(g)}} h
   */
  function buildPanels(root, groups, h) {
    root.innerHTML = '';
    const ctrls = {};
    const cards = {};

    for (const g of groups) {
      const card = el('section', 'card');
      card.style.setProperty('--c', g.color);
      const head = el('header', 'card-head');

      let enable = null;
      if (g.layer) {
        enable = el('input');
        enable.type = 'checkbox';
        enable.title = 'このレイヤーを有効にする';
        enable.addEventListener('change', () => h.set(g.key, 'enabled', enable.checked, true));
        head.append(enable);
      }
      const title = el('h2', null, g.label);
      if (g.desc) title.title = g.desc;
      head.append(title);

      let solo = null;
      if (g.layer) {
        solo = el('button', 'solo', 'S');
        solo.title = 'ソロ(このレイヤーだけ聴く)。Shift+クリックで複数選択';
        solo.addEventListener('click', (e) => h.solo(g.key, e.shiftKey));
        head.append(solo);
      }
      const lock = el('button', 'lock', '🔒');
      lock.title = 'ロック中は「ゆらす」「ランダム」で変更されない';
      lock.addEventListener('click', () => h.lock(g.key));
      const reset = el('button', null, '↺');
      reset.title = 'このグループを初期値に戻す';
      reset.addEventListener('click', () => h.reset(g.key));
      head.append(lock, reset);
      card.append(head);

      if (g.desc) card.append(el('p', 'card-desc', g.desc));

      for (const s of g.params) {
        const row = el('div', 'row');
        const label = el('label', 'row-label', s.label);
        label.title = (s.desc ? s.desc + '\n' : '') + 'ダブルクリックで初期値に戻す';
        label.addEventListener('dblclick', () => h.set(g.key, s.key, s.def, true));
        row.append(label);
        const c = { spec: s };

        if (s.type === 'toggle') {
          const cb = el('input');
          cb.type = 'checkbox';
          cb.addEventListener('change', () => h.set(g.key, s.key, cb.checked, true));
          const wrap = el('div', 'toggle-wrap');
          wrap.append(cb);
          row.append(wrap);
          row.classList.add('row-toggle');
          c.check = cb;
        } else {
          const range = el('input');
          range.type = 'range';
          range.min = 0;
          range.max = 1000;
          range.step = 1;
          range.addEventListener('input', () => h.set(g.key, s.key, fromPos(s, range.value / 1000), false));
          range.addEventListener('change', () => h.commit());
          const num = el('input');
          num.type = 'number';
          num.step = s.step || 0.01;
          num.min = s.min;
          num.max = s.max;
          num.addEventListener('change', () => {
            const v = parseFloat(num.value);
            if (!isNaN(v)) h.set(g.key, s.key, quantize(s, v), true);
          });
          row.append(range, num, el('span', 'unit', s.unit || ''));
          c.range = range;
          c.num = num;
        }
        ctrls[`${g.key}.${s.key}`] = c;
        card.append(row);
      }
      cards[g.key] = { card, enable, solo, lock };
      root.append(card);
    }

    function setControl(gk, k, v) {
      const c = ctrls[`${gk}.${k}`];
      if (!c) return;
      if (c.check) {
        c.check.checked = !!v;
        return;
      }
      const pos = Math.round(toPos(c.spec, v) * 1000);
      if (+c.range.value !== pos) c.range.value = pos;
      if (document.activeElement !== c.num) c.num.value = format(c.spec, v);
    }

    function update(params, solo, locks) {
      for (const g of groups) {
        const p = params[g.key];
        for (const s of g.params) setControl(g.key, s.key, p[s.key]);
        const ui = cards[g.key];
        if (ui.enable) ui.enable.checked = p.enabled;
        ui.card.classList.toggle('off', g.layer && !p.enabled);
        ui.card.classList.toggle('muted', g.layer && solo.size > 0 && !solo.has(g.key));
        if (ui.solo) ui.solo.classList.toggle('on', solo.has(g.key));
        ui.lock.classList.toggle('on', locks.has(g.key));
      }
    }

    return { update, setControl };
  }

  SFX.ui.controls = { buildPanels, toPos, fromPos, quantize };
})(window.SFX);
