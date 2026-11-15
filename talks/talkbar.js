// talks 共通ヘッダーのプログレスバー
(() => {
  const bar = document.querySelector(".talkbar-progress");
  if (!bar) return;
  const update = () => {
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.width = (max > 0 ? Math.min(100, (scrollY / max) * 100) : 0) + "%";
  };
  addEventListener("scroll", update, { passive: true });
  addEventListener("resize", update);
  update();
})();

// 共有ボタン(X でポスト / リンクをコピー)。各ページの HTML は触らず、ここでヘッダーの右端に差し込む
(() => {
  const talkbar = document.querySelector(".talkbar");
  if (!talkbar) return;

  // 狭い画面では戻るリンクの「works」を隠して、共有ボタンのぶんの幅を空ける
  const back = talkbar.querySelector(".talkbar-back");
  if (back && back.textContent.trim() === "← discoNeko works") {
    back.innerHTML = '← discoNeko<span class="talkbar-sm-hide"> works</span>';
  }

  const meta = (p) => document.querySelector(`meta[property="${p}"]`)?.content;
  // 節へのリンク(#…)やクエリは外し、ページそのものの URL を共有する
  const url = meta("og:url") || location.origin + location.pathname;
  const title = meta("og:title") || document.title;
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;

  const ICON = {
    share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3M7 8l5-5 5 5"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3.2-3.2a4.5 4.5 0 0 0-6.4-6.4L12 5.6"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3.2 3.2a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  };

  const wrap = document.createElement("div");
  wrap.className = "talkbar-share";
  wrap.innerHTML = `
    <button type="button" class="talkbar-share-btn" aria-haspopup="true" aria-expanded="false" aria-label="共有" title="共有">${ICON.share}</button>
    <div class="talkbar-share-menu" hidden>
      <a href="${intent}" target="_blank" rel="noopener">${ICON.x}<span>X でポスト</span></a>
      <button type="button" data-act="copy">${ICON.link}<span>リンクをコピー</span></button>
      <button type="button" data-act="native" hidden>${ICON.more}<span>その他のアプリ</span></button>
    </div>`;
  talkbar.insertBefore(wrap, talkbar.querySelector(".talkbar-progress"));

  const btn = wrap.querySelector(".talkbar-share-btn");
  const menu = wrap.querySelector(".talkbar-share-menu");
  // OS の共有シート(LINE などに送れる)は、スマホ・タブレットで使えるときだけ出す。
  // パソコンの共有シートは X とコピーで足りるうえ、ブラウザによって中身がまちまちなので出さない
  const canNativeShare = () => typeof navigator.share === "function" && matchMedia("(hover: none) and (pointer: coarse)").matches;
  const toggle = (open = menu.hidden) => {
    if (open) menu.querySelector('[data-act="native"]').hidden = !canNativeShare();
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", () => toggle());
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) toggle(false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !menu.hidden) { toggle(false); btn.focus(); }
  });
  menu.querySelector("a").addEventListener("click", () => toggle(false));

  // Clipboard API が使えない・拒否されたときは、textarea を選択してコピーする古い方法に切り替える
  async function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { return await navigator.clipboard.writeText(text); } catch {}
    }
    const t = Object.assign(document.createElement("textarea"), { value: text });
    t.style.cssText = "position:fixed;left:-9999px";
    document.body.appendChild(t);
    t.select();
    const ok = document.execCommand("copy");
    t.remove();
    if (!ok) throw new Error("copy");
  }

  menu.addEventListener("click", async (e) => {
    const item = e.target.closest("button[data-act]");
    if (!item) return;
    if (item.dataset.act === "native") {
      toggle(false);
      navigator.share({ title, url }).catch(() => {});
      return;
    }
    const label = item.querySelector("span");
    try {
      await copy(url);
      label.textContent = "コピーしました";
    } catch {
      label.textContent = "コピーできませんでした";
    }
    setTimeout(() => { toggle(false); label.textContent = "リンクをコピー"; }, 1200);
  });
})();

// 関連する作品。ページの最後(元のフッターの下)に差し込む。
// games.json を読み、ダッシュボードの「関連する作品」(assets/app.js の related)と同じ選び方で 4 件まで出す
(async () => {
  const back = document.querySelector(".talkbar-back");
  const slug = location.pathname.match(/\/talks\/([^/]+)\//)?.[1];
  if (!back || !slug) return;
  const root = new URL(back.getAttribute("href"), location.href); // サイトのトップ
  let items;
  try {
    const res = await fetch(new URL("games.json", root), { cache: "no-cache" });
    items = (await res.json()).items ?? [];
  } catch {
    return; // 読めなければ何も出さない
  }
  const self = items.find((x) => x.slug === slug);
  if (!self) return;

  const tags = new Set(self.tags ?? []);
  const list = items
    .filter((x) => x !== self && x.access !== "private")
    .map((x) => [x, (x.tags ?? []).filter((t) => tags.has(t)).length * 2 + (x.category === self.category ? 1 : 0)])
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || (b[0].updated ?? "").localeCompare(a[0].updated ?? ""))
    .slice(0, 4)
    .map(([x]) => x);
  if (!list.length) return;

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const CATEGORY = { game: "ゲーム", tool: "ツール", talk: "対話" };
  // いま図解版を見ているか。variants のファイルか、読み物版を持たない対話("reading": false)の index.html なら図解版
  const file = location.pathname.split("/").pop() || "index.html";
  const visual = self.reading === false || (self.variants ?? []).some((v) => v.file === file);
  // 同居している対話は作品ページへ直接。図解版からは相手の図解版(複数あれば最初の 1 つ)、読み物版からは相手の読み物版へ。
  // 相手にその版がなければ index.html(読み物版、または読み物版を持たない対話の図解版)へ。
  // 対話以外はダッシュボードの詳細(#slug)へ
  const href = (g) => {
    if (g.category !== "talk" || g.access !== "hub") return new URL(`#${encodeURIComponent(g.slug)}`, root).href;
    const v = visual ? g.variants?.[0] : null;
    return new URL(g.url + (v ? v.file : ""), root).href;
  };
  const thumb = (g) =>
    g.thumb ? `<img src="${esc(new URL(g.thumb, root).href)}" alt="" loading="lazy">` : `<span class="talkrel-ph">${esc(g.title)}</span>`;

  const sec = document.createElement("section");
  sec.className = "talkrel";
  sec.setAttribute("aria-labelledby", "talkrel-h");
  sec.innerHTML = `
    <div class="talkrel-in">
      <div class="talkrel-head">
        <h2 id="talkrel-h">関連する作品</h2>
        <a href="${esc(root.href)}">すべての作品 →</a>
      </div>
      <div class="talkrel-grid">
        ${list
          .map(
            (g) => `
        <a class="talkrel-card" href="${esc(href(g))}">
          <span class="talkrel-thumb">${thumb(g)}</span>
          <span class="talkrel-title">${esc(g.title)}</span>
          <span class="talkrel-meta">${esc(CATEGORY[g.category] ?? "")}</span>
        </a>`,
          )
          .join("")}
      </div>
    </div>`;
  document.body.appendChild(sec);
})();
