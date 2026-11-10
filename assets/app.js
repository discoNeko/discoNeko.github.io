"use strict";

const LABEL = {
  category: { game: "ゲーム", tool: "ツール", talk: "対話" },
  status: { playable: "稼働中", wip: "開発中", prototype: "試作", archived: "昔の作品" },
};

// 入手性(EC の在庫表示にあたる)
function availLabel(g) {
  if (g.access === "private") return "非公開";
  if (g.access === "repo") return "ソースのみ公開";
  if (g.access === "pages") return "外部サイトで公開";
  return { game: "ブラウザで遊べる", tool: "ブラウザで使える", talk: "ここで読める" }[g.category] ?? "公開中";
}

const state = { items: [], q: "", category: "all", access: "all", status: "all", tag: null, sort: "updated", expanded: false, panel: false };

const PEEK = 140;
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const ICON = {
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  ext: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M8 5v14l11-7z"/></svg>',
};

// 「3 日前」「2 か月前」のような相対表記。古いものは年月で出す
function ago(d) {
  if (!d) return "";
  const days = Math.floor((Date.now() - new Date(`${d}T00:00:00`)) / 86400000);
  if (days < 1) return "今日";
  if (days < 7) return `${days} 日前`;
  if (days < 30) return `${Math.floor(days / 7)} 週間前`;
  if (days < 365) return `${Math.floor(days / 30)} か月前`;
  return `${d.slice(0, 4)}年`;
}

function thumbHTML(g, { badge = true } = {}) {
  let inner;
  if (g.thumb) {
    const shot = g.thumb.startsWith("thumbs/auto/") ? ' class="shot"' : "";
    inner = `<img src="${esc(g.thumb)}"${shot} alt="" loading="lazy">`;
  } else if (g.access === "private") {
    inner = `<span class="ph"></span>`;
  } else {
    inner = `<span class="ph"><span class="ph-title">${esc(g.title)}</span></span>`;
  }
  if (g.access === "private") inner += `<span class="lock-mark">${ICON.lock}非公開</span>`;
  // 稼働中は既定値なので語らない
  else if (badge && g.status !== "playable") inner += `<span class="badge">${esc(LABEL.status[g.status])}</span>`;
  return inner;
}

function cardHTML(g) {
  return `
  <article class="card a-${g.access}">
    <a class="card-link" href="${esc(location.pathname)}#${encodeURIComponent(g.slug)}" data-open="${esc(g.slug)}">
      <div class="thumb">${thumbHTML(g)}</div>
      <div class="card-text">
        <h3 class="card-title">${esc(g.title)}</h3>
        <p class="card-sub">${esc(g.summary)}</p>
        <p class="card-meta"><span class="avail">${esc(availLabel(g))}</span><span class="dot">·</span>${esc(LABEL.category[g.category])}<span class="dot">·</span><time datetime="${esc(g.updated)}">${esc(ago(g.updated))}</time></p>
      </div>
    </a>
  </article>`;
}

function cta(g, cls = "btn primary big") {
  if (g.access === "private") return `<span class="btn big disabled">${ICON.lock}非公開の作品です</span>`;
  const external = g.access !== "hub";
  const target = external ? ' target="_blank" rel="noopener"' : "";
  let label;
  if (g.access === "repo") label = "ソースを見る";
  else if (g.category === "game") label = "遊ぶ";
  else if (g.category === "talk") label = "読む";
  else label = "使う";
  const icon = g.category === "game" && g.access !== "repo" ? ICON.play : "";
  return `<a class="${cls}" href="${esc(g.url)}"${target}>${icon}${label}${external ? `<span class="ext">${ICON.ext}</span>` : ""}</a>`;
}

const filtering = () => state.q || state.category !== "all" || state.access !== "all" || state.status !== "all" || state.tag;

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
    ["all", "すべて"],
    ["game", "ゲーム", count((g) => g.category === "game")],
    ["tool", "ツール", count((g) => g.category === "tool")],
    ["talk", "対話", count((g) => g.category === "talk")],
  ].filter(([value, , n]) => value === "all" || n > 0 || state.category === value));
  chips($("f-status"), "status", [["all", "すべて"], ...Object.entries(LABEL.status).map(([k, v]) => [k, v, count((g) => g.status === k)])]);
  chips($("f-access"), "access", [
    ["all", "すべて"],
    ["public", "公開", count((g) => g.access !== "private")],
    ["private", "非公開", count((g) => g.access === "private")],
  ]);
  const tagCount = new Map();
  for (const g of all) for (const t of g.tags ?? []) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const tags = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ja"));
  $("f-tag").innerHTML = tags
    .map(([t, n]) => `<button type="button" class="chip${state.tag === t ? " on" : ""}" aria-pressed="${state.tag === t}" data-tag="${esc(t)}">${esc(t)}<span class="n">${n}</span></button>`)
    .join("");
  const active = (state.status !== "all") + (state.access !== "all") + Boolean(state.tag);
  $("filter-n").hidden = !active;
  $("filter-n").textContent = active;
}

function renderStats() {
  const all = state.items;
  const parts = [
    "@discoNeko",
    `${all.length} 作品`,
    ...[["game", "ゲーム"], ["tool", "ツール"], ["talk", "対話"]]
      .map(([k, v]) => [v, all.filter((g) => g.category === k).length])
      .filter(([, n]) => n > 0)
      .map(([v, n]) => `${v} ${n}`),
  ];
  $("stats").innerHTML = parts.map((p) => `<span class="nw">${esc(p)}</span>`).join('<span class="dot">·</span>');
}

function renderHero() {
  const hero = $("hero");
  const g = state.items.find((x) => x.featured);
  if (!g || filtering()) {
    hero.hidden = true;
    return null;
  }
  hero.hidden = false;
  hero.innerHTML = `
    <button type="button" class="hero-thumb" data-open="${esc(g.slug)}" aria-label="${esc(g.title)} の詳細">${thumbHTML(g, { badge: false })}</button>
    <div>
      <p class="hero-label">おすすめ</p>
      <h2><button type="button" data-open="${esc(g.slug)}">${esc(g.title)}</button></h2>
      <p class="hero-summary">${esc(g.summary)}</p>
      <p class="hero-meta">${esc(LABEL.category[g.category])} · ${esc(LABEL.status[g.status])} · ${esc(ago(g.updated))}に更新</p>
      <div class="hero-actions">${cta(g, "btn primary")}<button type="button" class="btn" data-open="${esc(g.slug)}">詳細</button></div>
    </div>`;
  return g;
}

function render() {
  renderFilters();
  const featured = renderHero();
  // おすすめを上に大きく出しているときは、一覧からは外す
  const list = sorted(state.items.filter(matches)).filter((g) => g !== featured);
  $("grid").innerHTML = list.map(cardHTML).join("");
  $("empty").hidden = list.length > 0;
  const n = list.length + (featured ? 1 : 0);
  $("count").textContent = filtering() ? `${n} 件の作品` : "";
  $("count").hidden = !filtering();
  layoutFold();
}

function layoutFold() {
  const wrap = $("grid-wrap");
  const more = $("more");
  const btn = $("more-btn");
  const cards = [...$("grid").children];
  // 折りたたむ前に、2 行かつ 6 件以上は見せる(スマホの 1 列でも数件は並ぶように)
  const rows = [...new Set(cards.map((c) => c.offsetTop))];
  let r = 2;
  while (r < rows.length && cards.filter((c) => c.offsetTop < rows[r]).length < 6) r++;
  const cut = rows[r];
  const shown = cut == null ? cards.length : cards.filter((c) => c.offsetTop < cut).length;
  const rest = cards.length - shown;
  if (rest <= 0) {
    wrap.classList.remove("folded");
    wrap.style.maxHeight = "";
    cards.forEach((c) => (c.inert = false));
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
  wrap.style.maxHeight = `${cut + PEEK}px`;
  wrap.classList.add("folded");
  cards.forEach((c, i) => (c.inert = i >= shown));
  btn.textContent = `さらに ${rest} 件を表示`;
}

function toggleFold() {
  const wasExpanded = state.expanded;
  state.expanded = !state.expanded;
  layoutFold();
  if (wasExpanded) $("grid-wrap").scrollIntoView({ block: "start", behavior: "smooth" });
}

function togglePanel(open = !state.panel) {
  state.panel = open;
  $("filter-panel").hidden = !open;
  $("filter-btn").setAttribute("aria-expanded", String(open));
}

// ---- 詳細(商品ページ) ----
const noteCache = new Map();
function notePath(g) {
  if (g.access === "hub") return `${g.url}notes/README.md`;
  return `https://raw.githubusercontent.com/${g.repo}/HEAD/notes/README.md`;
}
function specURL(g) {
  if (!g.spec || g.access === "private") return null;
  if (g.access === "hub") return `https://github.com/discoNeko/discoNeko.github.io/blob/main/${g.url}notes/spec.md`;
  return g.repo ? `https://github.com/${g.repo}/blob/HEAD/notes/spec.md` : null;
}
async function loadNote(g) {
  if (noteCache.has(g.slug)) return noteCache.get(g.slug);
  const res = await fetch(notePath(g), { cache: "no-cache" });
  if (!res.ok) throw new Error(res.status);
  const text = await res.text();
  noteCache.set(g.slug, text);
  return text;
}
const renderMarkdown = (text) => (window.marked ? window.marked.parse(text) : `<pre>${esc(text)}</pre>`);

// 関連する作品: タグの重なりを優先し、同じカテゴリを少し足す
function related(g) {
  const tags = new Set(g.tags ?? []);
  return state.items
    // 見られない非公開はおすすめしない
    .filter((x) => x !== g && x.access !== "private")
    .map((x) => [x, (x.tags ?? []).filter((t) => tags.has(t)).length * 2 + (x.category === g.category ? 1 : 0)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || (b[0].updated ?? "").localeCompare(a[0].updated ?? ""))
    .slice(0, 4)
    .map(([x]) => x);
}

function openDetail(slug, { push = true } = {}) {
  const g = state.items.find((x) => x.slug === slug);
  if (!g) return;
  const dlg = $("detail");
  dlg.className = `a-${g.access}`;
  $("d-thumb").innerHTML = thumbHTML(g, { badge: false });
  $("d-kicker").textContent = `${LABEL.category[g.category]} · ${LABEL.status[g.status]}`;
  $("d-title").textContent = g.title;
  $("d-avail").innerHTML = `<b>${esc(availLabel(g))}</b> · ${esc(ago(g.updated))}に更新`;
  $("d-cta").innerHTML = cta(g);
  const links = [];
  if (g.access === "hub") for (const v of g.variants ?? []) links.push(`<a class="btn" href="${esc(g.url + v.file)}">${esc(v.label)}</a>`);
  if (g.repo && g.access !== "private" && g.access !== "repo") links.push(`<a class="btn" href="https://github.com/${esc(g.repo)}" target="_blank" rel="noopener">ソース<span class="ext">${ICON.ext}</span></a>`);
  const spec = specURL(g);
  if (spec) links.push(`<a class="btn" href="${esc(spec)}" target="_blank" rel="noopener">仕様書<span class="ext">${ICON.ext}</span></a>`);
  $("d-links").innerHTML = links.join("");
  $("d-summary").textContent = g.summary;
  const meta = [
    ["カテゴリ", esc(LABEL.category[g.category])],
    ["状態", esc(LABEL.status[g.status])],
    ["作成", esc(g.created)],
    ["更新", esc(g.updated)],
    ["タグ", (g.tags ?? []).map((t) => `<button type="button" class="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")],
  ];
  $("d-meta").innerHTML = meta.filter(([, v]) => v).map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  const notes = $("d-notes");
  const body = $("d-notes-body");
  const showNotes = Boolean(g.notes) && g.access !== "private" && (g.access === "hub" || Boolean(g.repo));
  notes.hidden = !showNotes;
  if (showNotes) {
    body.innerHTML = '<p class="muted">読み込み中…</p>';
    loadNote(g)
      .then((t) => { if (dlg.dataset.slug === slug) body.innerHTML = renderMarkdown(t); })
      .catch(() => { if (dlg.dataset.slug === slug) body.innerHTML = '<p class="muted">メモを読み込めませんでした。</p>'; });
  }
  const rel = related(g);
  $("d-related").hidden = rel.length === 0;
  $("d-related-grid").innerHTML = rel.map(cardHTML).join("");

  dlg.dataset.slug = slug;
  if (!dlg.open) dlg.showModal();
  dlg.querySelector(".d-inner").scrollTop = 0;
  if (push) history.replaceState(null, "", `${location.pathname}${location.search}#${encodeURIComponent(slug)}`);
}

function closeDetail() {
  const dlg = $("detail");
  if (dlg.open) dlg.close();
}

function bind() {
  document.addEventListener("click", (e) => {
    const open = e.target.closest("[data-open]");
    if (open) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return; // 新しいタブで開くのは邪魔しない
      e.preventDefault();
      return openDetail(open.dataset.open);
    }
    const chip = e.target.closest("button[data-key]");
    if (chip) {
      state[chip.dataset.key] = chip.dataset.value;
      return render();
    }
    const tag = e.target.closest("[data-tag]");
    if (tag) {
      const fromDetail = Boolean(tag.closest("dialog"));
      state.tag = state.tag === tag.dataset.tag && !fromDetail ? null : tag.dataset.tag;
      closeDetail();
      render();
      if (fromDetail) {
        togglePanel(true);
        $("filter-panel").scrollIntoView({ block: "nearest" });
      }
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
  $("filter-btn").addEventListener("click", () => togglePanel());
  $("clear-btn").addEventListener("click", () => {
    Object.assign(state, { status: "all", access: "all", tag: null });
    render();
  });
  const dlg = $("detail");
  $("d-close").addEventListener("click", closeDetail);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) closeDetail(); });
  dlg.addEventListener("close", () => history.replaceState(null, "", location.pathname + location.search));
  window.addEventListener("hashchange", openFromHash);
  $("more-btn").addEventListener("click", toggleFold);
  let t;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(layoutFold, 120); });
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
    state.items = (await res.json()).items ?? [];
  } catch (err) {
    $("grid").innerHTML = `<p class="empty">games.json を読み込めませんでした(${esc(err.message)})。</p>`;
    return;
  }
  renderStats();
  render();
  openFromHash();
}

main();
