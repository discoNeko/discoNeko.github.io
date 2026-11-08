#!/usr/bin/env node
// GitHub プロフィール README(discoNeko/discoNeko)用の素材を games.json から生成する。
//   readme/banner.svg        上部のバナー(最新作のカードを扇状に重ねた絵)
//   readme/thumbs/<slug>.svg 作品ごとのサムネイル(ダッシュボードのプレースホルダーと同じ考え方)
//   readme/profile.md        README に差し込む作品欄(プロフィール側の Actions がこれを取り込む)
// 使い方: node scripts/build-readme.mjs   (pre-commit からも呼ばれる)
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const SITE = "https://disconeko.github.io/";
const OUT = join(root, "readme");
const { items } = JSON.parse(readFileSync(join(root, "games.json"), "utf8"));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hue = (slug) => { let h = 0; for (const ch of slug) h = (h * 31 + ch.codePointAt(0)) >>> 0; return h % 360; };
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 8);
// 画像として表示される SVG では Web フォントを読み込めないので、端末のフォントに任せる
const JP = "'Hiragino Sans','Hiragino Kaku Gothic ProN','Noto Sans JP','Yu Gothic',sans-serif";
const EN = "'Space Grotesk',Verdana,sans-serif";
const CAT = {
  game: { label: "GAME", color: "#ffcf5c", emoji: "🎮" },
  tool: { label: "TOOL", color: "#7cc7ff", emoji: "🛠️" },
  talk: { label: "TALK", color: "#ff9ac1", emoji: "💬" },
};
const STATUS = { playable: "🟢 稼働中", wip: "🟠 開発中", prototype: "🟣 試作", archived: "⚪ 昔の作品" };

// ダッシュボードと同じ並び: featured → 通常 → 昔の作品、それぞれ更新が新しい順
const sorted = [...items].sort((a, b) =>
  Boolean(b.featured) - Boolean(a.featured) ||
  (a.status === "archived") - (b.status === "archived") ||
  b.updated.localeCompare(a.updated) || a.title.localeCompare(b.title, "ja"));

// ---- サムネイル ----
function placeholder(g, { w, h, glyphX = w / 2, glyphSize, id }) {
  const hh = hue(g.slug);
  return `<defs>
    <radialGradient id="${id}g" cx="20%" cy="10%" r="120%"><stop offset="0" stop-color="hsl(${hh},70%,34%)"/><stop offset="1" stop-color="hsl(${(hh + 40) % 360},55%,17%)"/></radialGradient>
    <pattern id="${id}s" width="15" height="15" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="1" height="15" fill="hsl(${hh},60%,60%)" opacity=".12"/></pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#${id}g)"/><rect width="${w}" height="${h}" fill="url(#${id}s)"/>
  <text x="${glyphX}" y="${h / 2 + glyphSize * 0.36}" text-anchor="middle" font-family="${JP}" font-size="${glyphSize}" font-weight="800"
    fill="hsl(${hh},80%,92%)" fill-opacity="${g.access === "private" ? ".35" : ".92"}">${esc([...g.title][0])}</text>`;
}

function thumbSVG(g) {
  const { label, color } = CAT[g.category];
  const lock = g.access === "private"
    ? `<rect width="320" height="180" fill="#08080e" opacity=".55"/>
  <g transform="translate(160 78)" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><rect x="-17" y="-2" width="34" height="26" rx="5"/><path d="M-10 -2v-9a10 10 0 0 1 20 0v9"/></g>
  <text x="160" y="132" text-anchor="middle" font-family="${EN}" font-size="13" font-weight="700" letter-spacing="5" fill="#fff">PRIVATE</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs><clipPath id="c"><rect width="320" height="180" rx="14"/></clipPath></defs>
  <g clip-path="url(#c)">
  ${placeholder(g, { w: 320, h: 180, glyphSize: 76, id: "t" })}
  ${lock}
  <rect x="12" y="12" width="${label.length * 9 + 18}" height="22" rx="6" fill="#0a0a10" fill-opacity=".72"/>
  <text x="21" y="27.5" font-family="${EN}" font-size="11" font-weight="700" letter-spacing="1.5" fill="${color}">${label}</text>
  </g>
</svg>
`;
}

// ---- バナー: 最新作のカードを扇状に重ねる ----
function bannerSVG() {
  const n = (c) => items.filter((g) => g.category === c).length;
  const stat = (x, k, v, color) => `
    <text x="${x}" y="196" font-family="${EN}" font-size="12" font-weight="700" letter-spacing="2" fill="#9a9cb2">${k}</text>
    <text x="${x}" y="236" font-family="${EN}" font-size="38" font-weight="700" fill="${color}">${v}</text>`;
  const W = 210, H = 118;
  // 先頭が featured。非公開はバナーに出さない
  const cards = sorted.filter((g) => g.access !== "private").slice(0, 3);
  const mime = (p) => (p.endsWith(".png") ? "image/png" : "image/jpeg");
  const card = (g, i, rot, dx, dy) => {
    // 実画像があれば埋め込む(画像として表示される SVG は外部の画像を読み込めないため)
    const img = g.thumb && existsSync(join(root, g.thumb))
      ? `<image href="data:${mime(g.thumb)};base64,${readFileSync(join(root, g.thumb)).toString("base64")}" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`
      // 後ろのカードは右側が隠れるので、頭文字を左寄りに置く
      : placeholder(g, { w: W, h: H, glyphX: W * 0.27, glyphSize: 50, id: `p${i}` });
    return `
    <g transform="translate(${735 + dx} ${112 + dy}) rotate(${rot}) translate(${-W / 2} ${-H / 2})" filter="url(#shadow)">
      <defs><clipPath id="cc${i}"><rect width="${W}" height="${H}" rx="12"/></clipPath></defs>
      <g clip-path="url(#cc${i})">${img}</g>
      <rect width="${W}" height="${H}" rx="12" fill="none" stroke="#ecebf3" stroke-opacity=".22"/>
      ${g.featured ? `<rect x="10" y="10" width="94" height="20" rx="5" fill="#ffcf5c"/><text x="57" y="24" text-anchor="middle" font-family="${EN}" font-size="10" font-weight="700" letter-spacing="1.2" fill="#1a1400">★ FEATURED</text>` : ""}
    </g>`;
  };
  const layout = [[8, 42, 4], [-3, -18, -6], [-13, -70, 6]]; // 手前 → 奥
  const drawn = cards.map((g, i) => card(g, i, ...layout[i])).reverse().join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="270" viewBox="0 0 900 270">
  <defs>
    <radialGradient id="bgA" cx="85%" cy="0%" r="80%"><stop offset="0" stop-color="#3a2a55"/><stop offset="1" stop-color="#0e0f17" stop-opacity="0"/></radialGradient>
    <radialGradient id="bgB" cx="0%" cy="100%" r="70%"><stop offset="0" stop-color="#14444a"/><stop offset="1" stop-color="#0e0f17" stop-opacity="0"/></radialGradient>
    <clipPath id="frame"><rect width="900" height="270" rx="20"/></clipPath>
    <filter id="shadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity=".55"/></filter>
  </defs>
  <g clip-path="url(#frame)">
    <rect width="900" height="270" fill="#0e0f17"/><rect width="900" height="270" fill="url(#bgA)"/><rect width="900" height="270" fill="url(#bgB)"/>
    ${drawn}
    <text x="48" y="96" font-family="${EN}" font-size="54" font-weight="700" letter-spacing="-1.5" fill="#ecebf3">discoNeko <tspan fill="#ffcf5c">works</tspan></text>
    <text x="50" y="134" font-family="${JP}" font-size="17" fill="#9a9cb2">作ったゲームとツール、AI との対話で生まれた議論の置き場</text>
    ${stat(50, "GAMES", n("game"), CAT.game.color)}${stat(190, "TOOLS", n("tool"), CAT.tool.color)}${stat(330, "TALKS", n("talk"), CAT.talk.color)}
    ${stat(470, "PRIVATE", items.filter((g) => g.access === "private").length, "#ecebf3")}
    <!-- バナー全体がダッシュボードへのリンクなので、押せることが分かる表示を置く -->
    <rect x="652" y="214" width="220" height="32" rx="16" fill="#ecebf3" fill-opacity=".08" stroke="#ecebf3" stroke-opacity=".25"/>
    <text x="762" y="235" text-anchor="middle" font-family="${EN}" font-size="13" font-weight="700" letter-spacing=".5" fill="#ecebf3">disconeko.github.io ↗</text>
  </g>
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
const banner = bannerSVG();
writeFileSync(join(OUT, "banner.svg"), banner);

const link = (g) => (g.access === "private" ? null : g.url.startsWith("http") ? g.url : SITE + g.url);
const thumb = (g) => (g.thumb ? `${SITE}${g.thumb}` : `${SITE}readme/thumbs/${g.slug}.svg?v=${ver[g.slug]}`);
const title = (g) => (link(g) ? `<a href="${link(g)}"><b>${esc(g.title)}</b></a>` : `<b>${esc(g.title)}</b> 🔒`);
const meta = (g) => `${CAT[g.category].emoji} ${CAT[g.category].label} ・ ${STATUS[g.status]}`;
const action = (g) => {
  if (g.access === "private") return "🔒 非公開";
  if (g.access === "repo") return `<a href="${link(g)}">📦 リポジトリ</a>`;
  return `<a href="${link(g)}">${g.category === "talk" ? "📖 読む" : g.category === "game" ? "▶ 遊ぶ" : "▶ 開く"}</a>`;
};

const featured = sorted.filter((g) => g.featured);
const recent = sorted.filter((g) => !g.featured).slice(0, 3);
const rest = sorted.filter((g) => !featured.includes(g) && !recent.includes(g));

const md = `<!-- このブロックは discoNeko.github.io の scripts/build-readme.mjs が games.json から生成しています。直接編集しないでください -->
<p align="center">
<a href="${SITE}"><img src="${SITE}readme/banner.svg?v=${hash(banner)}" width="100%" alt="discoNeko works — ダッシュボードを開く"></a>
</p>
${featured.length ? `
### Featured

${featured.map((g) => `<table><tr>
<td width="55%"><a href="${link(g) ?? SITE}"><img src="${thumb(g)}" width="100%" alt="${esc(g.title)}"></a></td>
<td valign="top">
<sub>${meta(g)}</sub>
<h3>${esc(g.title)}</h3>
<p>${esc(g.summary)}</p>
<p><b>${action(g)}</b></p>
</td>
</tr></table>`).join("\n")}
` : ""}
### Recent

<table><tr>
${recent.map((g) => `<td width="33%" valign="top">
<a href="${link(g) ?? SITE}"><img src="${thumb(g)}" width="100%" alt="${esc(g.title)}"></a>
<br>${title(g)}
<br><sub>${meta(g)}</sub>
<br><sub>${esc(g.summary)}</sub>
</td>`).join("\n")}
</tr></table>

<p align="center"><a href="${SITE}"><b>すべての作品を見る(あと ${rest.length} 件)</b></a></p>
`;
writeFileSync(join(OUT, "profile.md"), md);
console.log(`readme/: banner + ${items.length} thumbs, profile.md (featured ${featured.length} / recent ${recent.length} / rest ${rest.length})`);
