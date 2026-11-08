# discoNeko.github.io

作ったゲームとツールをまとめるダッシュボード。https://disconeko.github.io/ で公開しています。

ビルドは不要です。`games.json` を読み込んで `index.html` が一覧を描画します。

## 構成

```
index.html, assets/   ダッシュボード本体
games.json            台帳(全作品のメタ情報)
games/<slug>/         このリポジトリで同居させているゲーム(単体 HTML など)
  notes/README.md     その作品のメモ(公開される)
tools/<slug>/         このリポジトリで同居させているツール
  notes/README.md     その作品のメモ(公開される)
thumbs/               サムネイル(16:9、横 640px 程度の jpg 推奨)
scripts/check.mjs     台帳の整合性チェック + 公開 NG っぽい文字列の検出
```

## 作品の掲載形態(`access`)

| access | 置き場所 | パネルの挙動 |
|---|---|---|
| `hub` | このリポジトリの `games/<slug>/` または `tools/<slug>/` | 「遊ぶ」「開く」でそのまま開く |
| `pages` | 個別の public リポジトリ + GitHub Pages | 外部リンクで開く |
| `repo` | public リポジトリ(Pages なし) | リポジトリへのリンク |
| `private` | private リポジトリ | パネルのみ。リンクは置かない(遷移できない) |

- 素材のライセンスなどで公開できない作品は、作品ごとに private リポジトリを作って管理し、ここには `private` として存在だけ載せます
- 本体・素材・メモなど、private 作品に関するものはすべて各 private リポジトリ側で管理し、このリポジトリには置きません
- private の項目には `url` / `repo` / `notes` を書きません(`check.mjs` がエラーにします)
- private 作品のサムネを置く場合は、公開してよい素材だけで作った画像にしてください

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

   - `category`: `game` / `tool`
   - `status`: `playable`(稼働中)/ `wip`(開発中)/ `prototype`(試作)/ `archived`(昔の作品)
   - `thumb` と `notes` は任意。`thumb` がなければタイトルの 1 文字目でプレースホルダーを描きます
   - `pages` / `repo` は `repo`(`"discoNeko/<name>"`)も書く。ソースへのリンクとメモの読み込みに使います
   - `featured: true` を付けた作品は、どの並び順でも常に先頭に表示され、強調表示されます(任意)
   - それ以外は更新が新しい順で、`archived` は後ろにまとめて表示します
2. `hub` の場合は、ゲームなら `games/<slug>/index.html`、ツールなら `tools/<slug>/index.html` を置き、`url` を `games/<slug>/` / `tools/<slug>/` にする
3. `node scripts/check.mjs` を実行する

## メモ

**メモは作品本体と同じリポジトリの `notes/README.md` に置きます。** 台帳に `"notes": true` を付けると詳細パネルに表示されます。

| access | メモの場所 | パネル表示 |
|---|---|---|
| `hub` | このリポジトリの `games/<slug>/notes/README.md` / `tools/<slug>/notes/README.md` | される |
| `pages` / `repo` | 各リポジトリの `notes/README.md`(既定ブランチ。台帳の `repo` から読む) | される |
| `private` | 各 private リポジトリ(場所は自由) | されない(`notes` は付けない) |

- 同じ `notes/` に設計メモなど他の md を置いても構いません。パネルに出るのは README.md だけです
- `check.mjs` が存在と中身を確かめられるのは同居作品のメモだけです。外部リポジトリのメモは各自で確認してください

### 書いてはいけないもの

public リポジトリのメモはそのまま Web に公開されます。commit 前に次のものが含まれていないか確認してください。

- ローカルのパス(`/Users/...`)、マシン名
- パスワード・トークン・API キー・keystore などの秘密情報
- 素材の購入元や、ライセンス上公開できない素材のファイル名・URL
- 非公開リポジトリへのリンク、非公開の内部ドキュメントの中身

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
