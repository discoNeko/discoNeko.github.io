#!/usr/bin/env node
// HTML で遊べる・読める作品のタイトル画面をヘッドレス Chrome で撮り、サムネイルにする。
//   対象: access が hub / pages の作品のうち、thumb が未設定か thumbs/auto/ を指しているもの
//         (手で置いた thumbs/<slug>.jpg などは上書きしない)
//   出力: thumbs/auto/<slug>.jpg(640x360)。games.json の thumb もこのパスに書き換える
// 使い方:
//   node scripts/capture-thumbs.mjs            対象をすべて撮り直す
//   node scripts/capture-thumbs.mjs nekovoid   指定した slug だけ撮り直す
// 前提: Google Chrome。別の Chrome を使うときは CHROME=<パス>
//
// Chrome の --screenshot オプションは描画フレームをほとんど進めないので、requestAnimationFrame で
// 動くタイトル画面が途中のまま写る。DevTools Protocol で普通にページを動かし、実時間で待ってから撮る。
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { createServer } from "node:http";
import { join, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const LEDGER = join(root, "games.json");
const AUTO = "thumbs/auto";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
// 撮影時の画面サイズ。カードの 16:9 に合わせ、保存時に半分(640x360)に縮める
const VIEW = { w: 1280, h: 720, scale: 0.5 };
// 読み込み完了から撮影までの待ち時間(ms)。フォントや初期描画が落ち着くまで
const SETTLE = 2000;
// 開くとアニメーションが入る作品は、終わるまで長めに待つ
const WAIT = {
  Coup: 6000,
};
// 対話(talk)は共通ヘッダー(.talkbar)と図解版の左メニュー(.sidebar)を消し、本文だけを撮る
const TALK_CSS = `
  .talkbar, .sidebar { display: none !important; }
  :root { --tb-h: 0px !important; --aside: 0px !important; }
  body { padding-top: 0 !important; }
`;

if (!existsSync(CHROME)) {
  console.error(`Chrome が見つかりません: ${CHROME}\nCHROME=<実行ファイルのパス> で指定してください`);
  process.exit(1);
}

const data = JSON.parse(readFileSync(LEDGER, "utf8"));
const only = new Set(process.argv.slice(2));
const isAuto = (g) => !g.thumb || g.thumb.startsWith(`${AUTO}/`);
const targets = data.items.filter(
  (g) => (g.access === "hub" || g.access === "pages") && g.url && isAuto(g) && (only.size === 0 || only.has(g.slug)),
);
for (const s of only) if (!data.items.some((g) => g.slug === s)) console.warn(`! ${s}: games.json にありません`);
if (targets.length === 0) {
  console.log("撮影対象がありません");
  process.exit(0);
}

// 同居作品は fetch などが file:// で動かないことがあるので、リポジトリを簡易サーバーで配信して撮る
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg", ".woff2": "font/woff2", ".md": "text/markdown; charset=utf-8",
};
const server = createServer((req, res) => {
  let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (path.endsWith("/")) path += "index.html";
  const file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  try {
    res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;

// ---- Chrome を起動して DevTools Protocol でつなぐ ----
const tmp = join(tmpdir(), `capture-thumbs-${process.pid}`);
const profile = join(tmp, "profile");
mkdirSync(profile, { recursive: true });
const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--no-first-run",
  "--no-default-browser-check", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
  `--window-size=${VIEW.w},${VIEW.h}`, "about:blank",
], { stdio: "ignore" });

async function devtoolsURL() {
  const file = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 100; i++) {
    if (existsSync(file)) {
      const [port, path] = readFileSync(file, "utf8").trim().split("\n");
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    }
    await sleep(100);
  }
  throw new Error("Chrome の DevTools に接続できませんでした");
}

const ws = new WebSocket(await devtoolsURL());
await new Promise((ok, ng) => {
  ws.addEventListener("open", ok, { once: true });
  ws.addEventListener("error", () => ng(new Error("DevTools への接続に失敗しました")), { once: true });
});
let seq = 0;
const pending = new Map();
const listeners = new Set();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) {
    const { ok, ng } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? ng(new Error(msg.error.message)) : ok(msg.result);
  } else if (msg.method) {
    for (const fn of listeners) fn(msg);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((ok, ng) => {
    const id = ++seq;
    pending.set(id, { ok, ng });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
const waitEvent = (method, sessionId, ms) =>
  new Promise((ok) => {
    const fn = (msg) => {
      if (msg.method === method && msg.sessionId === sessionId) done();
    };
    const timer = setTimeout(done, ms); // 読み込みが終わらないページでも、時間が来たら撮る
    function done() {
      clearTimeout(timer);
      listeners.delete(fn);
      ok();
    }
    listeners.add(fn);
  });

async function capture(url, wait, css) {
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
  try {
    await send("Emulation.setDeviceMetricsOverride", { width: VIEW.w, height: VIEW.h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send("Page.enable", {}, sessionId);
    const loaded = waitEvent("Page.loadEventFired", sessionId, 20_000);
    await send("Page.navigate", { url }, sessionId);
    await loaded;
    if (css) {
      const expression = `document.head.appendChild(Object.assign(document.createElement("style"), { textContent: ${JSON.stringify(css)} })), dispatchEvent(new Event("resize"))`;
      await send("Runtime.evaluate", { expression }, sessionId);
    }
    await sleep(wait);
    const { data } = await send("Page.captureScreenshot", {
      format: "jpeg", quality: 82, clip: { x: 0, y: 0, width: VIEW.w, height: VIEW.h, scale: VIEW.scale },
    }, sessionId);
    return Buffer.from(data, "base64");
  } finally {
    await send("Target.closeTarget", { targetId }).catch(() => {});
  }
}

// 撮るページ。対話(talk)は図解版があればそちらの方が絵になるので、図解版の冒頭を撮る
function shotURL(g) {
  if (g.access !== "hub") return g.url;
  const visual = g.category === "talk" && (g.variants ?? []).find((v) => v.label.includes("図解"));
  return base + g.url + (visual ? visual.file : "");
}

mkdirSync(join(root, AUTO), { recursive: true });
let ok = 0;
try {
  for (const g of targets) {
    const url = shotURL(g);
    const rel = `${AUTO}/${g.slug}.jpg`;
    try {
      writeFileSync(join(root, rel), await capture(url, WAIT[g.slug] ?? SETTLE, g.category === "talk" ? TALK_CSS : ""));
      g.thumb = rel;
      ok++;
      console.log(`✓ ${g.slug} ← ${url}`);
    } catch (err) {
      console.warn(`✗ ${g.slug}: ${err.message.split("\n")[0]}`);
    }
  }
} finally {
  ws.close();
  chrome.kill();
  server.close();
  await sleep(300); // Chrome がプロファイルを手放すのを待ってから消す
  rmSync(tmp, { recursive: true, force: true });
}
writeFileSync(LEDGER, `${JSON.stringify(data, null, 2)}\n`);
console.log(`${ok} / ${targets.length} 件を ${AUTO}/ に保存し、games.json の thumb を更新しました`);
