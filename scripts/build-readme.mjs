#!/usr/bin/env node
// GitHub プロフィール README(discoNeko/discoNeko)用の素材を games.json から生成する。
// 見た目はダッシュボードと同じ「コンテンツ台帳」の考え方(白・黒・グレーだけ、飾りなし、作品のサムネが主役)。
//   readme/banner.svg        上部のバナー(ライト用)。チャンネルヘッダーのように、名前・作品数・入口だけを置く
//   readme/banner-dark.svg   同じバナーのダーク用。<picture> で GitHub のテーマに合わせて出し分ける
//   readme/thumbs/<slug>.svg 作品ごとのサムネイル(サムネのない作品用。ダッシュボードのプレースホルダーと同じ)
//   readme/profile.md        README に差し込む作品欄(プロフィール側の Actions がこれを取り込む)
// 使い方: node scripts/build-readme.mjs   (pre-commit からも呼ばれる)
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const SITE = "https://disconeko.github.io/";
const OUT = join(root, "readme");
const { items } = JSON.parse(readFileSync(join(root, "games.json"), "utf8"));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);
// 画像として表示される SVG では Web フォントを読み込めないので、端末のフォントに任せる(ダッシュボードも OS 標準のゴシック)
const FONT = "-apple-system,BlinkMacSystemFont,'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic UI','Segoe UI',sans-serif";
// ダッシュボード(assets/style.css)と同じ色。GitHub の背景色に溶けるよう、バナーの地は透明にする
const THEME = {
  light: { txt: "#0f0f0f", txt2: "#606060", line: "#e5e5e5", bg2: "#f2f2f2", inv: "#0f0f0f", invTxt: "#ffffff" },
  dark: { txt: "#f1f1f1", txt2: "#aaaaaa", line: "#30363d", bg2: "#272727", inv: "#f1f1f1", invTxt: "#0f0f0f" },
};
const CAT = { game: "ゲーム", tool: "ツール", talk: "対話" };
const STATUS = { playable: "稼働中", wip: "開発中", prototype: "試作", archived: "昔の作品" };

// 入手性(EC の在庫表示にあたる)。ダッシュボードの availLabel と同じ
function avail(g) {
  if (g.access === "private") return "非公開";
  if (g.access === "repo") return "ソースのみ公開";
  if (g.access === "pages") return "外部サイトで公開";
  return { game: "ブラウザで遊べる", tool: "ブラウザで使える", talk: "ここで読める" }[g.category] ?? "公開中";
}

// ダッシュボードと同じ並び: featured → 通常 → 昔の作品、それぞれ更新が新しい順
const sorted = [...items].sort((a, b) =>
  Boolean(b.featured) - Boolean(a.featured) ||
  (a.status === "archived") - (b.status === "archived") ||
  b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, "ja"));

// ---- サムネイル: 無地にタイトルを組む。非公開は鍵だけ ----
// 画像の中の @media は閲覧者の OS のテーマに従う(GitHub の「システムに合わせる」と同じ)
function thumbSVG(g) {
  const { light: L, dark: D } = THEME;
  const body = g.access === "private"
    ? `<g transform="translate(144 84)" fill="none" class="mute" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="0" y="0" width="22" height="17" rx="3"/><path d="M5 0v-5a6 6 0 0 1 12 0v5"/></g>
  <text x="178" y="98" class="mute-t" font-family="${FONT}" font-size="15" font-weight="600">非公開</text>`
    : `<text x="160" y="${90 + 8}" text-anchor="middle" class="ttl" font-family="${FONT}" font-size="${[...g.title].length > 12 ? 18 : 22}" font-weight="800">${esc(g.title)}</text>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <style>
    .bg{fill:${L.bg2}} .ttl,.mute-t{fill:${L.txt2}} .mute{stroke:${L.txt2}}
    @media (prefers-color-scheme: dark){ .bg{fill:${D.bg2}} .ttl,.mute-t{fill:${D.txt2}} .mute{stroke:${D.txt2}} }
  </style>
  <rect class="bg" width="320" height="180" rx="12"/>
  ${body}
</svg>
`;
}

// ---- バナー: チャンネルヘッダー。名前・作品数・紹介・入口のボタンだけ ----
function bannerSVG(t) {
  const n = (c) => items.filter((g) => g.category === c).length;
  const stats = [`${items.length} 作品`, ...Object.entries(CAT).map(([k, v]) => [v, n(k)]).filter(([, c]) => c > 0).map(([v, c]) => `${v} ${c}`)];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="200" viewBox="0 0 900 200">
  <text x="0" y="62" font-family="${FONT}" font-size="48" font-weight="800" letter-spacing="-1.2" fill="${t.txt}">discoNeko<tspan font-size="22" font-weight="500" letter-spacing="0" fill="${t.txt2}" dx="10">works</tspan></text>
  <text x="2" y="100" font-family="${FONT}" font-size="16" fill="${t.txt2}">@discoNeko  ·  ${esc(stats.join("  ·  "))}</text>
  <text x="2" y="128" font-family="${FONT}" font-size="16" fill="${t.txt2}">作ったゲームとツール、AI との対話で生まれた議論をまとめています。</text>
  <!-- バナー全体がダッシュボードへのリンクなので、押せることが分かるボタンを置く(ダッシュボードの主ボタンと同じ形) -->
  <rect x="0" y="150" width="236" height="44" rx="22" fill="${t.inv}"/>
  <text x="118" y="178" text-anchor="middle" font-family="${FONT}" font-size="16" font-weight="700" fill="${t.invTxt}">すべての作品を見る ↗</text>
</svg>
`;
}

// ---- 書き出し ----
rmSync(join(OUT, "thumbs"), { recursive: true, force: true });
mkdirSync(join(OUT, "thumbs"), { recursive: true });
const ver = {}; // 画像 URL に内容のハッシュを付け、GitHub の画像キャッシュを更新させる
for (const g of items) {
  const svg = thumbSVG(g);
  writeFileSync(join(OUT, "thumbs", `${g.slug}.svg`), svg);
  ver[g.slug] = hash(svg);
}
const banner = bannerSVG(THEME.light);
const bannerDark = bannerSVG(THEME.dark);
writeFileSync(join(OUT, "banner.svg"), banner);
writeFileSync(join(OUT, "banner-dark.svg"), bannerDark);

const link = (g) => (g.access === "private" ? null : g.url.startsWith("http") ? g.url : SITE + g.url);
const thumb = (g) => (g.thumb ? `${SITE}${g.thumb}` : `${SITE}readme/thumbs/${g.slug}.svg?v=${ver[g.slug]}`);
const title = (g) => (link(g) ? `<a href="${link(g)}"><b>${esc(g.title)}</b></a>` : `<b>${esc(g.title)}</b>`);
const day = (d) => d.slice(5).replace("-", "/");
// 稼働中は既定値なので語らない(ダッシュボードの状態バッジと同じ)
const meta = (g) => [avail(g), CAT[g.category], g.status !== "playable" ? STATUS[g.status] : null, `${day(g.updated)} 更新`].filter(Boolean).join(" · ");
const action = (g) => {
  if (g.access === "private") return "非公開";
  if (g.access === "repo") return `<a href="${link(g)}">ソースを見る</a>`;
  return `<a href="${link(g)}">${g.category === "talk" ? "読む" : g.category === "game" ? "▶ 遊ぶ" : "使う"}</a>`;
};

const featured = sorted.filter((g) => g.featured && g.access !== "private");
const recent = sorted.filter((g) => !featured.includes(g)).slice(0, 3);
const rest = sorted.filter((g) => !featured.includes(g) && !recent.includes(g));

const md = `<!-- このブロックは discoNeko.github.io の scripts/build-readme.mjs が games.json から生成しています。直接編集しないでください -->
<p>
<a href="${SITE}"><picture>
<source media="(prefers-color-scheme: dark)" srcset="${SITE}readme/banner-dark.svg?v=${hash(bannerDark)}">
<img src="${SITE}readme/banner.svg?v=${hash(banner)}" width="100%" alt="discoNeko works — すべての作品を見る">
</picture></a>
</p>
${featured.length ? `
### おすすめ

${featured.map((g) => `<table><tr>
<td width="58%"><a href="${link(g)}"><img src="${thumb(g)}" width="100%" alt="${esc(g.title)}"></a></td>
<td valign="top">
<sub>${esc(CAT[g.category])} · ${esc(STATUS[g.status])}</sub>
<h3>${esc(g.title)}</h3>
<p>${esc(g.summary)}</p>
<p><b>${action(g)}</b>　<sub>${esc(avail(g))}</sub></p>
</td>
</tr></table>`).join("\n")}
` : ""}
### 新着

<table><tr>
${recent.map((g) => `<td width="33%" valign="top">
<a href="${link(g) ?? SITE}"><img src="${thumb(g)}" width="100%" alt="${esc(g.title)}"></a>
<br>${title(g)}
<br><sub>${esc(g.summary)}</sub>
<br><sub>${esc(meta(g))}</sub>
</td>`).join("\n")}
</tr></table>

<p align="center"><a href="${SITE}"><b>すべての作品を見る(あと ${rest.length} 件)</b></a></p>
`;
writeFileSync(join(OUT, "profile.md"), md);
console.log(`readme/: banner (light/dark) + ${items.length} thumbs, profile.md (featured ${featured.length} / recent ${recent.length} / rest ${rest.length})`);
