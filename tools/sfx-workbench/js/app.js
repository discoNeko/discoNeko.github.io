// アプリ本体: 状態管理・レンダリングのスケジュール・履歴・スロット・プリセット・書き出し
(function (SFX) {
  'use strict';
  const { engine, viz, dsp } = SFX;
  const { controls } = SFX.ui;
  const $ = (id) => document.getElementById(id);

  // localStorage は使えない環境(プライベートウィンドウ等)でも動くよう握りつぶす
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : d;
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) { /* 保存できなくても動作は継続 */ }
    },
  };

  const SLOT_NAMES = ['A', 'B', 'C', 'D'];

  const state = {
    recipe: null,
    groups: null,
    params: null,
    seed: 12345,
    solo: new Set(),
    locks: new Set(['master']),
    result: null,
    history: [],
    future: [],
    committed: null,
    slots: [],
    activeSlot: -1,
  };
  const player = new SFX.Player();
  let panels = null;

  const skey = (s) => `sfxwb.${state.recipe.id}.${s}`;
  const snapshot = () => JSON.stringify({ params: state.params, seed: state.seed });

  // ---- レンダリング ----
  // 連続で変更が来ても、最新の状態だけを描き直す(描画中に来た変更は次の 1 回にまとめる)

  let rendering = false;
  let pending = false;
  let playAfter = false;
  // 溜まった要求がすべてドラッグ中のものなら軽量プレビューで描く
  let draftOnly = true;

  function requestRender(opts = {}) {
    if (opts.play) playAfter = true;
    if (!opts.draft) draftOnly = false;
    pending = true;
    if (!rendering) renderLoop();
  }

  async function renderLoop() {
    rendering = true;
    while (pending) {
      pending = false;
      const play = playAfter;
      const draft = draftOnly && !play;
      playAfter = false;
      draftOnly = true;
      try {
        const result = await engine.render(state.recipe, state.params, {
          seed: state.seed,
          sampleRate: +$('srSelect').value,
          solo: state.solo,
          draft,
        });
        state.result = result;
        viz.draw(result, state.groups, state.params, state.solo);
        showInfo(result);
        if (play) startPlayback(0);
      } catch (e) {
        console.error(e);
        $('info').textContent = 'レンダリングに失敗しました: ' + e.message;
      }
    }
    rendering = false;
  }

  function showInfo(r) {
    const parts = [
      `長さ ${r.duration.toFixed(2)}s`,
      `ピーク ${dsp.gainToDb(r.peak).toFixed(1)} dBFS`,
      r.draft ? 'プレビュー品質' : `${r.sampleRate / 1000}kHz`,
      `生成 ${Math.round(r.renderMs)}ms`,
    ];
    if (state.solo.size) parts.push('ソロ中');
    const clip = r.peak > 1;
    $('info').innerHTML = parts.join(' · ') + (clip ? ' · <b class="warn">クリップしています</b>' : '');
  }

  // ---- 再生 ----

  let raf = 0;
  function startPlayback(offset) {
    if (!state.result) return;
    player.play(state.result, offset);
    cancelAnimationFrame(raf);
    const tick = () => {
      const t = player.position();
      viz.playhead(t);
      if (player.playing) raf = requestAnimationFrame(tick);
      else viz.playhead(null);
    };
    raf = requestAnimationFrame(tick);
  }

  function play() {
    if (rendering || pending || !state.result || state.result.draft) requestRender({ play: true });
    else startPlayback(0);
  }

  // ---- 状態変更と履歴 ----

  const autoPlay = () => $('autoPlay').checked;

  function commit() {
    const snap = snapshot();
    if (snap !== state.committed) {
      state.history.push(state.committed);
      if (state.history.length > 200) state.history.shift();
      state.future = [];
      state.committed = snap;
      store.set(skey('state'), JSON.parse(snap));
      state.activeSlot = -1;
      renderSlots();
      requestRender({ play: autoPlay() });
    }
    updateUndo();
  }

  function restore(snap) {
    const s = JSON.parse(snap);
    state.params = engine.merge(state.recipe, s.params);
    state.seed = s.seed;
    state.committed = snapshot();
    store.set(skey('state'), JSON.parse(state.committed));
    refreshAll();
    requestRender({ play: autoPlay() });
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(state.committed);
    restore(state.history.pop());
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(state.committed);
    restore(state.future.pop());
  }

  function updateUndo() {
    $('undoBtn').disabled = !state.history.length;
    $('redoBtn').disabled = !state.future.length;
  }

  function refreshAll() {
    panels.update(state.params, state.solo, state.locks);
    $('seedInput').value = state.seed;
    updateUndo();
  }

  const handlers = {
    set(g, k, v, doCommit) {
      state.params[g][k] = v;
      if (k === 'enabled') panels.update(state.params, state.solo, state.locks);
      else panels.setControl(g, k, v);
      if (doCommit) commit();
      else requestRender({ draft: true });
    },
    commit,
    solo(g, additive) {
      if (state.solo.has(g)) state.solo.delete(g);
      else {
        if (!additive) state.solo.clear();
        state.solo.add(g);
      }
      panels.update(state.params, state.solo, state.locks);
      requestRender({ play: autoPlay() });
    },
    lock(g) {
      if (state.locks.has(g)) state.locks.delete(g);
      else state.locks.add(g);
      store.set(skey('locks'), [...state.locks]);
      panels.update(state.params, state.solo, state.locks);
    },
    reset(g) {
      const d = engine.defaults(state.recipe)[g];
      state.params[g] = d;
      refreshAll();
      commit();
    },
  };

  // ---- ランダム探索 ----
  // スライダー位置(0..1)の空間で動かすので、対数スケールのパラメータも自然にばらける

  function randomize(mode) {
    const amount = +$('randAmount').value;
    const defs = engine.defaults(state.recipe);
    for (const g of state.groups) {
      if (state.locks.has(g.key)) continue;
      for (const s of g.params) {
        if (s.type === 'toggle' || s.key === 'gain') continue;
        const base = mode === 'mutate' ? state.params[g.key][s.key] : defs[g.key][s.key];
        const pos = controls.toPos(s, base) + (Math.random() * 2 - 1) * amount;
        state.params[g.key][s.key] = controls.fromPos(s, Math.min(1, Math.max(0, pos)));
      }
    }
    refreshAll();
    commit();
  }

  function newTake() {
    state.seed = Math.floor(Math.random() * 1e6);
    refreshAll();
    commit();
  }

  // ---- スロット(A/B 比較) ----

  function renderSlots() {
    const root = $('slots');
    root.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'field';
    label.textContent = '比較スロット';
    root.append(label);
    SLOT_NAMES.forEach((name, i) => {
      const b = document.createElement('button');
      b.className = 'slot' + (state.slots[i] ? ' filled' : '') + (state.activeSlot === i ? ' active' : '');
      b.textContent = name;
      b.title = state.slots[i]
        ? 'クリックで呼び出し / Shift+クリックで上書き / 右クリックで消去'
        : 'クリックで現在の音を保存';
      b.addEventListener('click', (e) => {
        if (!state.slots[i] || e.shiftKey) {
          state.slots[i] = snapshot();
          state.activeSlot = i;
          store.set(skey('slots'), state.slots);
          renderSlots();
        } else {
          state.history.push(state.committed);
          state.future = [];
          restore(state.slots[i]);
          state.activeSlot = i;
          renderSlots();
        }
      });
      b.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        state.slots[i] = null;
        if (state.activeSlot === i) state.activeSlot = -1;
        store.set(skey('slots'), state.slots);
        renderSlots();
      });
      root.append(b);
    });
  }

  // ---- プリセット ----

  function userPresets() {
    return store.get(skey('presets'), []);
  }

  function buildPresetSelect(selected) {
    const sel = $('presetSelect');
    sel.innerHTML = '<option value="">— 選択 —</option>';
    const og1 = document.createElement('optgroup');
    og1.label = '組み込み';
    state.recipe.presets.forEach((p, i) => og1.append(new Option(p.name, 'b:' + i)));
    sel.append(og1);
    const ups = userPresets();
    if (ups.length) {
      const og2 = document.createElement('optgroup');
      og2.label = 'ユーザー';
      ups.forEach((p, i) => og2.append(new Option(p.name, 'u:' + i)));
      sel.append(og2);
    }
    sel.value = selected || '';
    $('deletePresetBtn').disabled = !sel.value.startsWith('u:');
  }

  function applyPreset(value) {
    if (!value) return;
    const [kind, idx] = value.split(':');
    if (kind === 'b') {
      state.params = engine.merge(state.recipe, state.recipe.presets[+idx].params);
    } else {
      const p = userPresets()[+idx];
      state.params = engine.merge(state.recipe, p.params);
      if (typeof p.seed === 'number') state.seed = p.seed;
    }
    refreshAll();
    commit();
  }

  function savePreset() {
    const name = prompt('プリセット名', '');
    if (!name) return;
    const ups = userPresets();
    const existing = ups.findIndex((p) => p.name === name);
    const entry = { name, params: state.params, seed: state.seed };
    if (existing >= 0) ups[existing] = entry;
    else ups.push(entry);
    store.set(skey('presets'), ups);
    buildPresetSelect('u:' + (existing >= 0 ? existing : ups.length - 1));
  }

  function deletePreset() {
    const v = $('presetSelect').value;
    if (!v.startsWith('u:')) return;
    const ups = userPresets();
    const p = ups[+v.slice(2)];
    if (!p || !confirm(`ユーザープリセット「${p.name}」を削除しますか?`)) return;
    ups.splice(+v.slice(2), 1);
    store.set(skey('presets'), ups);
    buildPresetSelect();
  }

  // ---- 書き出し ----

  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function wavBlob(result) {
    const ch = $('chSelect').value === 'mono' ? engine.toMono(result.channels) : result.channels;
    return engine.encodeWav(ch, result.sampleRate, +$('bitsSelect').value);
  }

  const baseName = () => $('fileName').value.trim() || state.recipe.id;

  async function exportWav() {
    // 表示中の結果がプレビュー品質や設定変更前のものでも、書き出しは常に現在の設定で描き直す
    const r = await engine.render(state.recipe, state.params, {
      seed: state.seed, sampleRate: +$('srSelect').value, solo: state.solo,
    });
    download(wavBlob(r), `${baseName()}_s${state.seed}.wav`);
  }

  async function exportVariations() {
    const count = Math.max(2, Math.min(20, +$('varCount').value || 5));
    const btn = $('downloadVarsBtn');
    btn.disabled = true;
    try {
      for (let i = 0; i < count; i++) {
        const seed = state.seed + i;
        btn.textContent = `書き出し中 ${i + 1}/${count}`;
        const r = await engine.render(state.recipe, state.params, {
          seed, sampleRate: +$('srSelect').value, solo: state.solo,
        });
        download(wavBlob(r), `${baseName()}_s${seed}.wav`);
        await new Promise((res) => setTimeout(res, 300));
      }
    } finally {
      btn.disabled = false;
      btn.textContent = '⬇ 一括書き出し';
    }
  }

  function exportJson() {
    const data = { recipe: state.recipe.id, seed: state.seed, params: state.params };
    download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${baseName()}_s${state.seed}.json`);
  }

  async function importJson(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.recipe && data.recipe !== state.recipe.id) {
        if (!SFX.getRecipe(data.recipe)) throw new Error(`未知のレシピ: ${data.recipe}`);
        loadRecipe(data.recipe);
      }
      state.params = engine.merge(state.recipe, data.params);
      if (typeof data.seed === 'number') state.seed = data.seed;
      refreshAll();
      commit();
    } catch (e) {
      alert('JSON の読み込みに失敗しました: ' + e.message);
    }
  }

  // ---- 初期化 ----

  function loadRecipe(id) {
    state.recipe = SFX.getRecipe(id) || SFX.recipes[0];
    state.groups = engine.groupsOf(state.recipe);
    const saved = store.get(skey('state'), null);
    state.params = engine.merge(state.recipe, saved && saved.params);
    state.seed = saved && typeof saved.seed === 'number' ? saved.seed : 12345;
    state.slots = store.get(skey('slots'), [null, null, null, null]);
    state.locks = new Set(store.get(skey('locks'), ['master']));
    state.solo = new Set();
    state.history = [];
    state.future = [];
    state.activeSlot = -1;
    state.committed = snapshot();
    store.set('sfxwb.recipe', state.recipe.id);
    $('recipeSelect').value = state.recipe.id;
    $('fileName').value = state.recipe.id.replace(/-/g, '_');
    panels = controls.buildPanels($('panels'), state.groups, handlers);
    refreshAll();
    buildPresetSelect();
    renderSlots();
    requestRender();
  }

  function init() {
    const rs = $('recipeSelect');
    SFX.recipes.forEach((r) => rs.append(new Option(r.name, r.id)));
    rs.addEventListener('change', () => loadRecipe(rs.value));

    viz.init(
      {
        stack: $('vizStack'),
        timeline: $('timelineCanvas'),
        wave: $('waveCanvas'),
        spec: $('specCanvas'),
        overlay: $('overlayCanvas'),
      },
      (t) => startPlayback(t),
    );

    $('playBtn').addEventListener('click', play);
    $('stopBtn').addEventListener('click', () => player.stop());
    $('newTakeBtn').addEventListener('click', newTake);
    $('seedInput').addEventListener('change', () => {
      const v = parseInt($('seedInput').value, 10);
      if (!isNaN(v) && v >= 0) {
        state.seed = v;
        commit();
      }
    });
    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);
    $('mutateBtn').addEventListener('click', () => randomize('mutate'));
    $('randomBtn').addEventListener('click', () => randomize('random'));
    const ra = $('randAmount');
    const showRa = () => ($('randAmountVal').textContent = Math.round(ra.value * 100) + '%');
    ra.addEventListener('input', showRa);
    showRa();

    $('presetSelect').addEventListener('change', (e) => {
      $('deletePresetBtn').disabled = !e.target.value.startsWith('u:');
      applyPreset(e.target.value);
    });
    $('savePresetBtn').addEventListener('click', savePreset);
    $('deletePresetBtn').addEventListener('click', deletePreset);
    $('exportJsonBtn').addEventListener('click', exportJson);
    $('importJsonInput').addEventListener('change', (e) => {
      if (e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    });
    $('downloadBtn').addEventListener('click', exportWav);
    $('downloadVarsBtn').addEventListener('click', exportVariations);
    $('srSelect').addEventListener('change', () => requestRender());

    document.addEventListener('keydown', (e) => {
      const tag = e.target.tagName;
      const typing = (tag === 'INPUT' && !['range', 'checkbox'].includes(e.target.type)) || tag === 'SELECT' || tag === 'TEXTAREA';
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        if (typing) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === 'Space') {
        e.preventDefault();
        play();
      } else if (e.key === 'n') {
        newTake();
      } else if (e.key === 'Escape') {
        player.stop();
      }
    });

    loadRecipe(store.get('sfxwb.recipe', SFX.recipes[0].id));
  }

  // デバッグ・検証用に公開
  SFX.app = { state, requestRender, player };

  init();
})(window.SFX);
