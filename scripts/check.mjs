#!/usr/bin/env node
// games.json の整合性チェックと、公開してはまずい文字列の簡易スキャン。
// 使い方: node scripts/check.mjs   (pre-commit からも呼ばれる)
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const errors = [];
const warnings = [];

// ---- games.json ----
const CATEGORIES = ["game", "tool"];
const ACCESS = ["hub", "pages", "repo", "private"];
const STATUS = ["playable", "wip", "prototype", "archived"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

let data;
try {
  data = JSON.parse(readFileSync(join(root, "games.json"), "utf8"));
} catch (e) {
  console.error(`games.json を読めません: ${e.message}`);
  process.exit(1);
}

const seen = new Set();
for (const [i, g] of (data.items ?? []).entries()) {
  const at = `games.json items[${i}] (${g.slug ?? "?"})`;
  for (const k of ["slug", "title", "category", "access", "status", "summary"]) {
    if (!g[k]) errors.push(`${at}: "${k}" がありません`);
  }
  if (g.slug && !/^[A-Za-z0-9_-]+$/.test(g.slug)) errors.push(`${at}: slug は英数字・-・_ のみ`);
  if (seen.has(g.slug)) errors.push(`${at}: slug が重複しています`);
  seen.add(g.slug);
  if (g.category && !CATEGORIES.includes(g.category)) errors.push(`${at}: category は ${CATEGORIES.join("/")}`);
  if (g.access && !ACCESS.includes(g.access)) errors.push(`${at}: access は ${ACCESS.join("/")}`);
  if (g.status && !STATUS.includes(g.status)) errors.push(`${at}: status は ${STATUS.join("/")}`);
  for (const k of ["created", "updated"]) {
    if (g[k] && !DATE.test(g[k])) errors.push(`${at}: ${k} は YYYY-MM-DD`);
  }
  if (g.access === "private") {
    if (g.url) errors.push(`${at}: private の項目に url は書かない(遷移させない)`);
    if (g.repo) errors.push(`${at}: private の項目に repo は書かない`);
    if (g.notes) errors.push(`${at}: private 作品のメモは公開されないので notes は付けない`);
  } else if (!g.url) {
    errors.push(`${at}: url がありません`);
  }
  if (g.access === "hub" && g.url) {
    const dir = g.category === "tool" ? "tools" : "games";
    if (g.url !== `${dir}/${g.slug}/`) errors.push(`${at}: 同居作品の url は "${dir}/${g.slug}/" にする`);
    if (!existsSync(join(root, g.url, "index.html"))) errors.push(`${at}: ${g.url}index.html がありません`);
  }
  if (g.thumb && !existsSync(join(root, g.thumb))) errors.push(`${at}: thumb ${g.thumb} がありません`);
  // メモは作品本体と同じリポジトリの notes/README.md。存在を確かめられるのは同居作品だけ
  if (g.access === "hub" && g.url) {
    const noteRel = `${g.url}notes/README.md`;
    const hasNote = existsSync(join(root, noteRel));
    if (g.notes && !hasNote) errors.push(`${at}: notes: true だが ${noteRel} がありません`);
    if (!g.notes && hasNote) warnings.push(`${at}: ${noteRel} があるが notes: true が付いていません`);
  }
  if ((g.access === "pages" || g.access === "repo") && g.notes && !g.repo) {
    errors.push(`${at}: notes: true には repo("owner/name")が必要(メモはそのリポジトリの notes/README.md から読む)`);
  }
  if (g.repo && !/^[\w.-]+\/[\w.-]+$/.test(g.repo)) errors.push(`${at}: repo は "owner/name" の形式`);
  for (const k of ["featured", "notes"]) {
    if (k in g && typeof g[k] !== "boolean") errors.push(`${at}: ${k} は true / false`);
  }
}

// ---- 公開NGっぽい文字列のスキャン(games/ tools/ 配下は notes/ だけが対象。作品本体は対象外) ----
const privateSlugs = (data.items ?? []).filter((g) => g.access === "private").map((g) => g.slug);
const patterns = [
  [/\/Users\/\w|\/home\/\w|C:\\Users\\\w/i, "ローカルのパス"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "秘密鍵"],
  [/\b(password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]/i, "秘密情報らしき代入"],
  [/\.keystore\b|\.jks\b/i, "keystore"],
  [/\b(ghp|gho|github_pat)_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}/, "トークン"],
  ...privateSlugs.map((s) => [new RegExp(`github\\.com/[^/\\s]+/${s}(?![\\w.-])`, "i"), `非公開リポジトリ ${s} へのリンク`]),
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(md|json|html|js|css|txt)$/i.test(name)) out.push(p);
  }
  return out;
}
const hubNoteDirs = ["games", "tools"].flatMap((d) => {
  const base = join(root, d);
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((name) => join(base, name, "notes"))
    .filter((p) => existsSync(p) && statSync(p).isDirectory());
});
const targets = [
  join(root, "games.json"),
  join(root, "index.html"),
  ...walk(join(root, "assets")),
  ...hubNoteDirs.flatMap((d) => walk(d)),
];
for (const file of targets) {
  if (!existsSync(file)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, n) => {
    for (const [re, label] of patterns) {
      if (re.test(line)) errors.push(`${relative(root, file)}:${n + 1}: ${label}が含まれていそうです → ${line.trim().slice(0, 80)}`);
    }
  });
}

if (existsSync(join(root, "notes"))) {
  errors.push("ルートの notes/ は廃止しました。メモは作品本体と同じリポジトリの notes/README.md に置いてください");
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
if (errors.length) {
  console.error(`\n${errors.length} 件の問題があります。`);
  process.exit(1);
}
console.log(`OK: ${data.items.length} 件`);
