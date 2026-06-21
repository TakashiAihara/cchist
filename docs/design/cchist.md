# cchist 設計

## 意図

Claude Code の session 履歴 (`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`) を
非対話で inspect / 分析する CLI。既存 `claude-history` は TUI 閲覧 + resume が主目的で、
「直近 session_id を黙って取る」「トークン/ツール利用を集計する」といったスクリプタブルな
分析用途に向かない。cchist はそこを埋める。

stdout = データ (human table / `--json`)、stderr = ログ・進捗、の分離 (mfme-cli 準拠)。

## データソース

1 ファイル = 1 session (ファイル名 = session_id)。1 行 1 レコードの JSONL。
`.type` でレコード種別が分かれる:

- `user` / `assistant`: 会話本体。`cwd` `gitBranch` `version` `entrypoint` `timestamp` `uuid` を持つ。
  - `assistant.message.usage`: `input_tokens` / `output_tokens` / `cache_read_input_tokens` /
    `cache_creation_input_tokens` / `server_tool_use.{web_search,web_fetch}_requests`
  - `assistant.message.content[]`: `text` / `thinking` / `tool_use(.name)`
  - `user.message.content`: string (実プロンプト) または `tool_result[]` (ツール応答)
- `ai-title`: `aiTitle` = セッション名
- `last-prompt`: `lastPrompt`
- `system` / `attachment` / `file-history-snapshot` / `mode` / `permission-mode` / `queue-operation`: メタ

session_id はファイル名で確定するため、集計は 1 ファイル 1 パスで完結する。

## 正規化レコード (SessionMeta)

`id / file / cwd / gitBranch / version / entrypoint / title / lastPrompt /
firstTs / lastTs / durationMs / records / userTurns / assistantMsgs /
models[] / usage{input,output,cacheRead,cacheCreate,webSearch,webFetch} /
blocks{text,thinking,toolUse} / tools{name:count}`

## コマンド

```text
cchist sessions list   [--local] [--cwd P] [--since D] [--limit N] [--json]
cchist sessions latest [--local] [--cwd P] [--json]   # 既定は id だけ出力 (冒頭の用途)
cchist show <id|latest> [--tools] [--thinking] [--json]
cchist path <id|latest> [--json]                      # session id -> 実 cwd 逆引き
cchist stats  [--by session|day|repo|model] [--since D] [--local] [--json]
cchist tokens [--since D] [--local] [--json]
cchist tools  [--since D] [--local] [--json]
cchist bash   [--top N] [--full] [--since D] [--local] [--json]   # Bash コマンド頻度 (先頭語)
cchist files  [--top N] [--since D] [--local] [--json]            # 編集ファイルランキング
cchist activity [--since D] [--local] [--json]                    # active 時間 + 時間帯ヒストグラム
cchist commands [--top N] [--skills-only] [--since D] [--local] [--json]   # slash command / skill 利用頻度
cchist search <q> [--regex] [--case] [--role R] [--thinking] [--context N] [--limit N] [filters] [--json]
```

- 共通フィルタ: `--local` (cwd === 実行時 cwd)、`--cwd P`、`--since D` (lastTs >= D)、
  `--exclude-cwd <glob>` / `--exclude-entrypoint <val>` (除外、複数可)
- `--json` で機械可読出力。指定なしは human table。
- projects dir は `CCHIST_PROJECTS_DIR` / `CLAUDE_PROJECTS_DIR` env で上書き可。
- 設定ファイル `$XDG_CONFIG_HOME/cchist/config.json` (`CCHIST_CONFIG` で上書き) に
  恒久的な除外ルールを書ける。CLI フラグと OR でマージ。

## 除外機構 (noise session の排除)

claude-mem の observer session のように、分析に含めたくない session が混ざる。
cchist は特定ツールを名指しで知らない (密結合を避ける) 方針で、除外は汎用ルールで表現する:

- cwd glob (`*` / `?` のみ対応の簡易 glob) と entrypoint 完全一致の 2 軸。
- ルールの出所は CLI フラグと設定ファイルの 2 つ。`withConfigExcludes` で union してから
  `applyFilter` / `iterFiltered` / `sessionsLatest` に渡す。`applyFilter` は opts のみ参照する
  純粋関数のまま (config 読込は上位層に閉じる) でテスト容易性を保つ。
- 既定は何も除外しない。observer を消すかは利用者が設定で宣言する
  (例: `exclude.cwd=["*observer-sessions"]` または `exclude.entrypoint=["sdk-cli"]`)。

## 層構成

```text
src/index.ts          CLI 配線 (commander)
src/lib/discover.ts   projects dir 探索・JSONL 列挙 (mtime 降順)
src/lib/parse.ts      JSONL -> SessionMeta
src/lib/types.ts      型
src/lib/format.ts     table / 数値整形 / stdout・stderr 出力
src/commands/*.ts     各サブコマンド (parse 層の上の集計に専念)
```

サブコマンドは discover + parse の上に薄く乗る。分析軸の追加は commands/ にファイルを足すだけ。

## 検討した選択肢

- フル TUI 再実装 (claude-history 相当): 工数・メンテ義務が大きく、resume 等は本家で足りるため不採用。
- claude-config bin/ に同梱: PATH・同期は楽だが「ツールとして仕上げる」スコープに対し手狭。独立 repo を採用。
- 言語: Bun + TypeScript (CLAUDE.md 第一選択。`bun run` で .ts 直接実行、commander 流用)。
  配布バイナリ単体化が要件化したら Rust/Go を再検討。

## 未実装 (phase 2)

- cost 算出: model 別単価テーブルが必要。単価は変動するため claude-api skill で確定値を取ってから実装する
  (training data の記憶で単価を埋めない)。`tokens --cost` として追加予定。
- semantic (vector) 検索: 設計を [`semantic-search.md`](semantic-search.md) に分離。オフライン完結を
  最優先する方針で、lexical な `cchist search` (実装済み) の `--semantic` 拡張として計画。着手は未定。
