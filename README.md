# discoNeko.github.io

作ったゲーム・ツールと、AI との対話で生まれた議論をまとめるダッシュボード。https://disconeko.github.io/ で公開しています。

ビルドは不要です。`games.json` を読み込んで `index.html` が一覧を描画します。

## 構成

```
index.html, assets/   ダッシュボード本体
games.json            台帳(全作品のメタ情報)
games/<slug>/         このリポジトリで同居させているゲーム(単体 HTML など)
  notes/README.md     その作品のメモ(公開される)
tools/<slug>/         このリポジトリで同居させているツール
  notes/README.md     その作品のメモ(公開される)
talks/<slug>/         AI との対話で生まれた議論(HTML 作品)
  notes/README.md     その作品のメモ(公開される)
templates/talk/       対話ページのテンプレート
thumbs/               サムネイル(16:9、横 640px 程度の jpg 推奨)
  auto/               capture-thumbs.mjs が撮ったタイトル画面(自動生成)
scripts/capture-thumbs.mjs  HTML 作品のタイトル画面を撮ってサムネイルにする
scripts/check.mjs     台帳の整合性チェック + 公開 NG っぽい文字列の検出
scripts/build-readme.mjs  GitHub プロフィール README 用の素材を readme/ に生成
readme/               プロフィール README 用のバナー・サムネイル・作品欄(自動生成。直接編集しない)
```

## 作品の掲載形態(`access`)

| access | 置き場所 | パネルの挙動 |
|---|---|---|
| `hub` | このリポジトリの `games/<slug>/` / `tools/<slug>/` / `talks/<slug>/` | 「遊ぶ」「使う」「読む」でそのまま開く |
| `pages` | 個別の public リポジトリ + GitHub Pages | 外部リンクで開く |
| `repo` | public リポジトリ(Pages なし) | リポジトリへのリンク |
| `private` | private リポジトリ | パネルのみ。リンクは置かない(遷移できない) |

- 素材のライセンスなどで公開できない作品は、作品ごとに private リポジトリを作って管理し、ここには `private` として存在だけ載せます
- 本体・素材・メモなど、private 作品に関するものはすべて各 private リポジトリ側で管理し、このリポジトリには置きません
- private の項目には `url` / `repo` / `notes` を書きません(`check.mjs` がエラーにします)
- private 作品のサムネを置く場合は、公開してよい素材だけで作った画像にしてください

## ダッシュボードの見た目

YouTube のチャンネルページや、商品数の少ない EC サイトのような「コンテンツ台帳」を目指しています。作品が商品で、サイトは売り場の棚。棚は目立たないほどよい、という考え方です。

- 色は白・黒・グレーだけ。作品のサムネ(タイトル画面)以外に色を置かない。書体は OS 標準のゴシック
- 影・光る枠・グラデーション・角丸カードの浮き上がりなどの飾りは使わない
- カードはサムネ + タイトル + 説明 1 行 + 「入手性 · カテゴリ · 更新」の 1 行だけ。ボタンは置かず、カード全体が詳細への入口
- 状態はサムネ右下の小さなバッジ(動画の再生時間の位置)。稼働中は既定値なので出さない
- 詳細は商品ページの形。大きな主ボタン(遊ぶ / 使う / 読む)、仕様、メモ、関連する作品
- タグ・状態・公開状態の絞り込みは「絞り込み」パネルに畳み、常に見せるのはカテゴリだけ

## 作品を追加する

1. `games.json` の `items` に追記する

   ```json
   {
     "slug": "my-game",
     "title": "My Game",
     "category": "game",
     "access": "hub",
     "status": "wip",
     "summary": "一行説明",
     "tags": ["パズル"],
     "url": "games/my-game/",
     "created": "2026-11-08",
     "updated": "2026-11-08",
     "thumb": "thumbs/my-game.jpg",
     "notes": true
   }
   ```

   - `category`: `game`(ゲーム)/ `tool`(ツール)/ `talk`(対話)
   - `status`: `playable`(稼働中)/ `wip`(開発中)/ `prototype`(試作)/ `archived`(昔の作品)
   - `thumb` と `notes` は任意。`thumb` がなければ無地にタイトルを組んだプレースホルダーを描きます(`private` は鍵アイコンと背景だけ)
   - HTML で開ける作品(`hub` / `pages`)は、`node scripts/capture-thumbs.mjs [slug...]` でタイトル画面を撮って `thumbs/auto/<slug>.jpg` に保存し、`thumb` に設定できます。対話は `variants` に図解版があればそちらを撮ります。手で置いた `thumbs/` 直下の画像は上書きしません(Google Chrome が必要。開くとアニメーションする作品は、スクリプト内の `WAIT` で待ち時間を延ばす)
   - `pages` / `repo` は `repo`(`"discoNeko/<name>"`)も書く。ソースへのリンクとメモの読み込みに使います
   - `featured: true` を付けた作品は、絞り込みをしていないとき一覧の上に「おすすめ」として大きく表示されます。絞り込み中は、どの並び順でも先頭に来ます(任意)
   - `variants`: 同じ作品の別バージョン(例: 対話の図解版)。`[{"label": "図解版", "file": "visual.html"}]` のように書くと、詳細パネルにボタンが出る。同居作品のフォルダ内の HTML だけ指定できる。各ページには互いに行き来する切り替えスイッチを置く
   - それ以外は更新が新しい順で、`archived` は後ろにまとめて表示します
2. `hub` の場合は、カテゴリに対応するフォルダ(ゲーム `games/`、ツール `tools/`、対話 `talks/`)に `<slug>/index.html` を置き、`url` を `<フォルダ>/<slug>/` にする
3. `node scripts/check.mjs` を実行する

## 対話(talk)を追加する

AI との対話で生まれた面白い議論は、HTML 作品として `talks/<slug>/` に置きます。

1. `templates/talk/index.html` を `talks/<slug>/index.html` にコピーして、タイトル・要旨・本文を書き換える
   - `.turn.me` が自分、`.turn.ai` が AI の発言、`.aside` が後から付けた注釈、`.quote` が刺さった一文
   - 生のログを全部貼る必要はありません。面白い所を抜粋・編集して読み物にします
   - 上部の固定ヘッダーは全ページ共通です(下の「共通ヘッダー」)
2. `games.json` に `category: "talk"`, `access: "hub"`, `url: "talks/<slug>/"` で登録する
3. `node scripts/check.mjs` を実行する。`talks/` は本文も文章なので、ページ全体が公開 NG 文字列の検査対象です

### 読み物版と図解版

1つの対話に、読み物版 `index.html` と図解版 `visual.html` を並べて置けます。台帳には `"variants": [{"label": "図解版", "file": "visual.html"}]` を付けます。

**読み物版(`index.html`)**

- テンプレートから作り、対話を抜粋・編集した読み物にする。どの発言から先を対象にするかは対話ごとに決める
- 論点ごとに見出しを立て、最後に「着地」を置く。図や表は必要な所にだけ入れる

**図解版(`visual.html`)**

- 図解の HTML は別に作ったもの(ChatGPT などで生成)を受け取って取り込む
- **本文はそのまま使う。** 節の構成・図・文章・操作は作り直さない
- 元の対話そのものは公開しないので削除する(対話の抜粋やアーカイブの節、共有リンク、「対話内容は抜粋・編集」のような注記)
- 外枠だけを共通の形にする。見本は `talks/choice-design/visual.html`
  - 上部: 元の HTML にあったナビ・戻るリンク・切り替えは外し、共通ヘッダーに置き換える
  - 左の目次: 各節の `id` へのリンクを並べ、読んでいる節を強調する。720px 以下では隠す。左上のタイトルは**受け取った HTML の題名・見出しの書体や配色に合わせる**(見本のロゴの形にはそろえない)
  - フッター: 作品名と注記、「印刷 / PDF化」ボタン
  - 目次のぶん本文が狭くなるので、元の HTML のレスポンシブ切り替え(`@media(max-width:…)`)を、目次の幅(260px)だけ広い幅でも効くように複製して足す

**共通ヘッダー(`talks/talkbar.css` / `talks/talkbar.js`)**

- 読み物版・図解版のどちらでも、左に「← discoNeko works」、右に「読み物版 | 図解版」の切り替え、上端にプログレスバーを**同じ位置**に出す。版を切り替えてもボタンの場所が変わらないようにするため、各ページで独自に置き直さない
- `<head>` で `../talkbar.css`、`</body>` の前で `../talkbar.js` を読み込み、`<body>` の先頭に `.talkbar` を置く(マークアップはテンプレートを参照)
- 色はページの CSS 変数(`--bg` / `--stroke` / `--muted` / `--txt` か `--ink`)に合わせて決まる。プログレスバーの色は `--tb-accent` で変えられる
- 図解版で固定の左メニューを使う場合は、上端を `top: var(--tb-h)` にしてヘッダーの下から始める

**対話ログには個人的な話や仕事の情報が混ざりやすいので、公開前に必ず読み返してください。** 非公開にしたい議論は private リポジトリで管理し、台帳には `access: "private"` で存在だけ載せます(ゲームと同じ扱い)。

## メモ

**メモは作品本体と同じリポジトリの `notes/README.md` に置きます。** 台帳に `"notes": true` を付けると詳細パネルに表示されます。

| access | メモの場所 | パネル表示 |
|---|---|---|
| `hub` | このリポジトリの `<games|tools|talks>/<slug>/notes/README.md` | される |
| `pages` / `repo` | 各リポジトリの `notes/README.md`(既定ブランチ。台帳の `repo` から読む) | される |
| `private` | 各 private リポジトリ(場所は自由) | されない(`notes` は付けない) |

### サマリーと詳細な仕様書

`notes/` には 2 種類のメモを置けます。

| ファイル | 中身 | パネルでの扱い |
|---|---|---|
| `notes/README.md` | 表示用のサマリー(一言・遊び方・いまの状態・次にやりたいこと) | 本文を表示する(`"notes": true`) |
| `notes/spec.md` | 詳細な仕様書・議論のまとめ。手元で開発を続けるときの資料 | 本文は出さず、GitHub のファイル表示画面へのリンクだけ置く(`"spec": true`) |

- `spec.md` もリポジトリに入るので、**誰でも読める**ことは README.md と同じです。パネルに出さないのは読みやすさのため
- 同じ `notes/` にそれ以外の md を置いても構いません(パネルには出ません)
- `check.mjs` が存在と中身を確かめられるのは同居作品のメモだけです。外部リポジトリのメモは各自で確認してください

### 書いてはいけないもの

public リポジトリのメモはそのまま Web に公開されます。commit 前に次のものが含まれていないか確認してください。

- ローカルのパス(`/Users/...`)、マシン名
- パスワード・トークン・API キー・keystore などの秘密情報
- 素材の購入元や、ライセンス上公開できない素材のファイル名・URL
- 非公開リポジトリへのリンク、非公開の内部ドキュメントの中身

## GitHub プロフィールの作品欄

https://github.com/discoNeko のプロフィール README に出る作品欄(バナー・Featured・Recent・ダッシュボードへのリンク)は、このリポジトリで生成しています。

- `scripts/build-readme.mjs` が `games.json` から `readme/` に素材を書き出す
  - `readme/banner.svg`: 上部のバナー(作品数と、最新作のカードを扇状に重ねた絵)
  - `readme/thumbs/<slug>.svg`: 作品ごとのサムネイル
  - `readme/profile.md`: README に差し込む作品欄
- commit 時に pre-commit が自動で作り直して commit に含めるので、普段は意識しなくてよい
- プロフィール側(`discoNeko/discoNeko`)の GitHub Actions が毎日、公開中の `readme/profile.md` を取り込んで README を更新する。すぐ反映したいときは、その Actions を手動実行する
- バナーと Featured は非公開の作品を出さない。Recent では、非公開は 🔒 付きのリンクなしで出る。残りの作品はダッシュボードへのリンクにまとめる

## ローカルで見る

`fetch` を使うため、`file://` ではなく http サーバー経由で開いてください。

```bash
python3 -m http.server 8769
```

## commit 前のチェック

clone したら一度だけ実行してください。以降は commit のたびに `scripts/check.mjs` が走ります。

```bash
git config core.hooksPath .githooks
```
