"use strict";

const LABEL = {
  category: { game: "ゲーム", tool: "ツール", talk: "対話" },
  categoryShort: { game: "GAME", tool: "TOOL", talk: "TALK" },
  access: { hub: "ここで遊べる", pages: "公開ページ", repo: "ソースのみ", private: "非公開" },
  status: { playable: "稼働中", wip: "開発中", prototype: "試作", archived: "昔の作品" },
};

// 公開状態の表示名。同居している対話(talk)は「遊べる」ではなく「読める」
const accessLabel = (g) => (g.access === "hub" && g.category === "talk" ? "ここで読める" : LABEL.access[g.access]);

const state = { items: [], q: "", category: "all", access: "all", status: "all", tag: null, sort: "updated", expanded: false };

// 折りたたみ時に 2 行目をどれだけ見せるか(px)
const PEEK = 130;
const $ = (id) => document.getElementById(id);

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function hue(slug) {
  let h = 0;
  for (const ch of slug) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return h % 360;
}

const ICON = {
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
  read: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5a2 2 0 0 1 2-2h5v17H6a2 2 0 0 0-2 2zM20 5a2 2 0 0 0-2-2h-5v17h5a2 2 0 0 1 2 2z"/></svg>',
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-5 4 5 4M16 8l5 4-5 4"/></svg>',
  note: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h5"/></svg>',
};

function thumbHTML(g) {
  const lock = g.access === "private" ? `<span class="lock">${ICON.lock}<b>PRIVATE</b></span>` : "";
  if (g.thumb) {
    return `<img src="${esc(g.thumb)}" alt="" loading="lazy">${lock}`;
  }
  const glyph = [...g.title][0] ?? "?";
  return `<span class="ph" style="--h:${hue(g.slug)}"><span class="glyph">${esc(glyph)}</span></span>${lock}`;
}

function primaryAction(g, cls = "btn") {
  if (g.access === "private") return `<span class="${cls} locked">${ICON.lock}非公開</span>`;
  const external = g.access !== "hub";
  const target = external ? ' target="_blank" rel="noopener"' : "";
  let label, icon;
  if (g.access === "repo") [label, icon] = ["リポジトリ", ICON.code];
  else if (g.category === "game") [label, icon] = ["遊ぶ", ICON.play];
  else if (g.category === "talk") [label, icon] = ["読む", ICON.read];
  else [label, icon] = ["開く", ICON.play];
  return `<a class="${cls} primary" href="${esc(g.url)}"${target}>${icon}${label}${external ? `<span class="ext">${ICON.ext}</span>` : ""}</a>`;
}

const month = (d) => (d ? d.slice(0, 7).replace("-", ".") : "");

function cardHTML(g) {
  const tags = (g.tags ?? [])
    .map((t) => `<li><button type="button" class="tag${state.tag === t ? " on" : ""}" data-tag="${esc(t)}">#${esc(t)}</button></li>`)
    .join("");
  return `
  <article class="card a-${g.access} c-${g.category}${g.featured ? " featured" : ""}" data-slug="${esc(g.slug)}">
    <button type="button" class="thumb" data-open="${esc(g.slug)}" aria-label="${esc(g.title)} の詳細">${thumbHTML(g)}
      <span class="access-badge">${esc(accessLabel(g))}</span>
      ${g.featured ? '<span class="feature-badge">FEATURED</span>' : ""}
    </button>
    <div class="body">
      <div class="meta-row">
        <span class="status s-${g.status}">${esc(LABEL.status[g.status])}</span>
        <span class="cat">${esc(LABEL.categoryShort[g.category] ?? g.category)}</span>
        <time datetime="${esc(g.updated)}" title="最終更新">${esc(month(g.updated))}</time>
      </div>
      <h2><button type="button" data-open="${esc(g.slug)}">${esc(g.title)}</button></h2>
      <p class="summary">${esc(g.summary)}</p>
      <ul class="tags">${tags}</ul>
    </div>
    <div class="actions">
      ${primaryAction(g)}
      <button type="button" class="btn ghost" data-open="${esc(g.slug)}">${g.notes && g.access !== "private" ? `${ICON.note}メモ・詳細` : "詳細"}</button>
    </div>
  </article>`;
}

function matches(g) {
  if (state.category !== "all" && g.category !== state.category) return false;
  if (state.access === "public" && g.access === "private") return false;
  if (state.access === "private" && g.access !== "private") return false;
  if (state.status !== "all" && g.status !== state.status) return false;
  if (state.tag && !(g.tags ?? []).includes(state.tag)) return false;
  if (state.q) {
    const hay = [g.title, g.slug, g.summary, ...(g.tags ?? [])].join(" ").toLowerCase();
    if (!state.q.split(/\s+/).every((w) => hay.includes(w))) return false;
  }
  return true;
}

function sorted(list) {
  const by = state.sort;
  return [...list].sort((a, b) => {
    // featured はどの並び順でも常に先頭
    const feat = Boolean(b.featured) - Boolean(a.featured);
    if (feat) return feat;
    if (by === "title") return a.title.localeCompare(b.title, "ja");
    // 日付順のときは「昔の作品」を後ろにまとめる
    const old = (a.status === "archived") - (b.status === "archived");
    return old || (b[by] ?? "").localeCompare(a[by] ?? "") || a.title.localeCompare(b.title, "ja");
  });
}

function chips(el, key, options) {
  el.innerHTML = options
    .map(([value, label, n]) => {
      const on = state[key] === value;
      return `<button type="button" class="chip${on ? " on" : ""}" aria-pressed="${on}" data-key="${key}" data-value="${esc(value)}">${esc(label)}${n != null ? `<span class="n">${n}</span>` : ""}</button>`;
    })
    .join("");
}

function renderFilters() {
  const all = state.items;
  const count = (fn) => all.filter(fn).length;
  chips($("f-category"), "category", [
    ["all", "すべて", all.length],
    ["game", "ゲーム", count((g) => g.category === "game")],
    ["tool", "ツール", count((g) => g.category === "tool")],
    ["talk", "対話", count((g) => g.category === "talk")],
  ].filter(([value, , n]) => value === "all" || n > 0 || state.category === value)); // 0 件のカテゴリは出さない
  chips($("f-access"), "access", [
    ["all", "公開・非公開"],
    ["public", "公開", count((g) => g.access !== "private")],
    ["private", "非公開", count((g) => g.access === "private")],
  ]);
  chips($("f-status"), "status", [
    ["all", "全状態"],
    ...Object.entries(LABEL.status).map(([k, v]) => [k, v, count((g) => g.status === k)]),
  ]);
  const tagCount = new Map();
  for (const g of all) for (const t of g.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  $("f-tag").innerHTML = tags
    .map(([t, n]) => `<button type="button" class="tag${state.tag === t ? " on" : ""}" aria-pressed="${state.tag === t}" data-tag="${esc(t)}">#${esc(t)}<span class="n">${n}</span></button>`)
    .join("");
}

function renderStats() {
  const all = state.items;
  const stats = [
    ["作品", all.length],
    ["ゲーム", all.filter((g) => g.category === "game").length],
    ["ツール", all.filter((g) => g.category === "tool").length],
    ["対話", all.filter((g) => g.category === "talk").length],
    ["開発中", all.filter((g) => g.status === "wip").length],
    ["非公開", all.filter((g) => g.access === "private").length],
  ].filter(([k, v]) => k === "作品" || v > 0); // 0 件の集計は出さない
  $("stats").innerHTML = stats.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

function render() {
  renderFilters();
  const list = sorted(state.items.filter(matches));
  $("grid").innerHTML = list.map(cardHTML).join("");
  $("empty").hidden = list.length > 0;
  $("count").textContent = `${list.length} / ${state.items.length} 件`;
  layoutFold();
}

// 1 行目は全部、2 行目は PEEK px だけ見せて残りを隠す。1 行に収まるときは何もしない。
function layoutFold() {
  const wrap = $("grid-wrap");
  const more = $("more");
  const btn = $("more-btn");
  const cards = [...$("grid").children];
  const firstTop = cards[0]?.offsetTop;
  const firstRow = cards.filter((c) => c.offsetTop === firstTop).length;
  const rest = cards.length - firstRow;
  if (rest <= 0) {
    wrap.classList.remove("folded");
    wrap.style.maxHeight = "";
    more.hidden = true;
    return;
  }
  more.hidden = false;
  btn.setAttribute("aria-expanded", String(state.expanded));
  if (state.expanded) {
    wrap.classList.remove("folded");
    wrap.style.maxHeight = "";
    cards.forEach((c) => (c.inert = false));
    btn.textContent = "折りたたむ";
    return;
  }
  // .grid-wrap は position: relative なので、カードの offsetTop はラッパー基準
  const secondTop = cards[firstRow].offsetTop;
  wrap.style.maxHeight = `${secondTop + PEEK}px`;
  wrap.classList.add("folded");
  cards.forEach((c, i) => (c.inert = i >= firstRow));
  btn.textContent = `続きを見る(あと ${rest} 件)`;
}

function toggleFold() {
  const wasExpanded = state.expanded;
  state.expanded = !state.expanded;
  layoutFold();
  // 折りたたんだときは一覧の先頭に戻す(ボタンが遠くに行かないように)
  if (wasExpanded) $("count").scrollIntoView({ block: "start", behavior: "smooth" });
}

// ---- 詳細パネル ----
const noteCache = new Map();

// メモは作品本体と同じリポジトリの notes/README.md に置く。
// 同居作品はこのリポジトリ内、外部公開(pages / repo)は各リポジトリの既定ブランチから読む。
function notePath(g) {
  if (g.access === "hub") return `${g.url}notes/README.md`;
  return `https://raw.githubusercontent.com/${g.repo}/HEAD/notes/README.md`;
}

// 詳細な仕様書は作品と同じリポジトリの notes/spec.md。Markdown が整形される GitHub の画面を開く
function specURL(g) {
  if (!g.spec || g.access === "private") return null;
  if (g.access === "hub") return `https://github.com/discoNeko/discoNeko.github.io/blob/main/${g.url}notes/spec.md`;
  return g.repo ? `https://github.com/${g.repo}/blob/HEAD/notes/spec.md` : null;
}

async function loadNote(g) {
  const slug = g.slug;
  if (noteCache.has(slug)) return noteCache.get(slug);
  const res = await fetch(notePath(g), { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status);
  const text = await res.text();
  noteCache.set(slug, text);
  return text;
}

function renderMarkdown(text) {
  if (window.marked) return window.marked.parse(text);
  return `<pre>${esc(text)}</pre>`;
}

async function openDetail(slug, { push = true } = {}) {
  const g = state.items.find((x) => x.slug === slug);
  if (!g) return;
  const dlg = $("detail");
  dlg.className = `a-${g.access}`;
  $("d-thumb").innerHTML = thumbHTML(g);
  $("d-title").textContent = g.title;
  $("d-summary").textContent = g.summary;
  const repoLink =
    g.repo && g.access !== "private"
      ? `<a class="btn ghost" href="https://github.com/${esc(g.repo)}" target="_blank" rel="noopener">${ICON.code}ソース<span class="ext">${ICON.ext}</span></a>`
      : "";
  // 詳細な仕様書(notes/spec.md)はパネルに表示せず、GitHub のファイル表示画面へのリンクだけ置く
  const spec = specURL(g);
  const specLink = spec
    ? `<a class="btn ghost" href="${esc(spec)}" target="_blank" rel="noopener">${ICON.note}詳細な仕様書<span class="ext">${ICON.ext}</span></a>`
    : "";
  // 同じ作品の別バージョン(例: 対話の図解版)。同居作品のフォルダ内のファイルを開く
  const variantLinks = g.access === "hub"
    ? (g.variants ?? []).map((v) => `<a class="btn ghost" href="${esc(g.url + v.file)}">${ICON.read}${esc(v.label)}</a>`).join("")
    : "";
  $("d-actions").innerHTML = primaryAction(g) + variantLinks + repoLink + specLink;
  const meta = [
    ["カテゴリ", LABEL.category[g.category]],
    ["公開状態", accessLabel(g)],
    ["状態", `<span class="status s-${g.status}">${esc(LABEL.status[g.status])}</span>`, true],
    ["作成", g.created],
    ["更新", g.updated],
    ["タグ", (g.tags ?? []).map((t) => `#${esc(t)}`).join(" "), true],
  ];
  $("d-meta").innerHTML = meta
    .filter(([, v]) => v)
    .map(([k, v, raw]) => `<div><dt>${k}</dt><dd>${raw ? v : esc(v)}</dd></div>`)
    .join("");

  const notes = $("d-notes");
  const body = $("d-notes-body");
  // private 作品のメモは各 private リポジトリにあり、読めないので表示しない
  const showNotes = Boolean(g.notes) && g.access !== "private" && (g.access === "hub" || Boolean(g.repo));
  notes.hidden = !showNotes;
  if (showNotes) {
    body.innerHTML = '<p class="muted">読み込み中…</p>';
    loadNote(g)
      .then((t) => {
        if (dlg.dataset.slug === slug) body.innerHTML = renderMarkdown(t);
      })
      .catch(() => {
        if (dlg.dataset.slug === slug) body.innerHTML = '<p class="muted">メモを読み込めませんでした。</p>';
      });
  }
  dlg.dataset.slug = slug;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector(".d-inner").scrollTop = 0;
  if (push) history.replaceState(null, "", `#${encodeURIComponent(slug)}`);
}

function closeDetail() {
  const dlg = $("detail");
  if (dlg.open) dlg.close();
}

// ---- イベント ----
function bind() {
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) return openDetail(open.dataset.open);
    const chip = e.target.closest(".chip[data-key]");
    if (chip) {
      state[chip.dataset.key] = chip.dataset.value;
      return render();
    }
    const tag = e.target.closest("[data-tag]");
    if (tag) {
      state.tag = state.tag === tag.dataset.tag ? null : tag.dataset.tag;
      closeDetail();
      return render();
    }
  });
  $("q").addEventListener("input", (e) => {
    state.q = e.target.value.trim().toLowerCase();
    render();
  });
  $("sort").addEventListener("change", (e) => {
    state.sort = e.target.value;
    render();
  });
  const dlg = $("detail");
  $("d-close").addEventListener("click", closeDetail);
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) closeDetail();
  });
  dlg.addEventListener("close", () => {
    history.replaceState(null, "", location.pathname + location.search);
  });
  window.addEventListener("hashchange", openFromHash);
  $("more-btn").addEventListener("click", toggleFold);
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(layoutFold, 120);
  });
  // Web フォントの読み込みでカードの高さが変わるので、読み込み後に測り直す
  document.fonts?.ready.then(layoutFold);
}

function openFromHash() {
  const slug = decodeURIComponent(location.hash.slice(1));
  if (slug) openDetail(slug, { push: false });
}

async function main() {
  bind();
  try {
    const res = await fetch("games.json", { cache: "no-cache" });
    const data = await res.json();
    state.items = data.items ?? [];
  } catch (err) {
    $("grid").innerHTML = `<p class="empty">games.json を読み込めませんでした(${esc(err.message)})。ローカルで見る場合は http サーバー経由で開いてください。</p>`;
    return;
  }
  renderStats();
  render();
  openFromHash();
}

main();
