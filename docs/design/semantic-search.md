# cchist semantic (vector) search 設計

status: 設計のみ (未実装)。lexical な `cchist search` は実装済み。本書は将来の
`--semantic` 拡張の設計を残すもので、着手は未定。

## 意図

`cchist search` は substring / regex の lexical 検索。「rebase の話をした session」
のような完全一致しないが意味的に近い過去会話を引きたい用途には弱い。embedding +
近傍検索でその穴を埋める。

要件として最優先するのは オフライン完結 (ネットワーク不要・履歴を外部送信しない)。
session 履歴は PII / 機密を含みうるため、embedding 生成を外部 API に投げる選択は
取らない。

## 全体像

```text
cchist index build [filters]      # 履歴をチャンク化 -> embedding -> ローカル index に保存 (増分)
cchist index status               # index の鮮度・件数・次元・model を表示
cchist search <q> --semantic      # q を embedding 化 -> cosine 上位 k 件
```

lexical と semantic は同じ `search` コマンドに同居させ、`--semantic` で経路を切り替える。
出力スキーマ (`SearchHit`) は lexical と共通にし、`score` を任意フィールドで足す。

## データフロー

### チャンク化

検索単位は record そのものではなく チャンク。理由: 1 つの assistant message が
数千トークンになることがあり、message 丸ごとを 1 ベクトルにすると意味が薄まる。

- 対象テキストは lexical search と同じ抽出規則を再利用する (`recordTexts`: user prompt /
  assistant text、`--thinking` で thinking)。tool 入出力は対象外。
- 各テキストを ~512 トークン相当 (文字数近似でよい) の窓で、overlap 64 程度を持たせて分割。
- チャンク key = `sessionId + recordIndex + chunkIndex`。元 record の `timestamp` / `role` を保持。

チャンク化と overlap 計算は純粋関数にして単体テストする (lexical 側の `excerpt` と同様)。

### embedding backend (オフライン完結を主軸に検討)

採用候補と評価:

#### 案 A: ローカル ONNX 埋め込み (transformers.js / fastembed) — 主軸候補

`@huggingface/transformers` (旧 `@xenova/transformers`) や `fastembed` で ONNX model を
ロードし、プロセス内で embedding を生成する。model は初回のみ download してローカル
キャッシュ、以後はネットワーク不要。

- 長所: 真にオフライン完結。daemon 不要。CI / 別マシンでも同じ挙動。
- 短所: cchist の 依存ゼロ方針 (commander のみ) を崩す。ONNX runtime + model file
  (数十〜百 MB) を抱える。Bun での ONNX runtime 動作は事前検証が要る
  (deepwiki-cli / 実機 PoC で確認してから採用)。
- model 候補: `bge-small-en` / `all-MiniLM-L6-v2` (384 次元, 軽量) や多言語が要るなら
  `bge-m3` / `multilingual-e5-small`。履歴が日英混在なので多言語 model を優先。

#### 案 B: ローカル Ollama daemon

同一マシンの `ollama serve` に `/api/embeddings` を fetch (`nomic-embed-text` 等)。

- 長所: npm 依存ゼロを維持 (fetch のみ)。model 管理は ollama 任せ。
- 短所: ローカルに ollama daemon が常駐している前提。CI / daemon 無し環境では動かず
  「オフライン完結」が環境依存になる。家庭内 ai1 (`192.168.0.191`) を使う形は
  ネットワーク依存になるので本要件 (オフライン) からは外れる。

#### 案 C: 外部 embedding API — 不採用

履歴を外部送信するためプライバシー要件に反する。オフライン要件も満たさない。検討のみ。

判断: オフライン完結を最優先する以上、第一候補は 案 A。ただし依存ゼロ方針との
トレードオフがあるため、採用前に (1) Bun での ONNX 動作、(2) 多言語 model の日本語
品質、(3) model file の取得・キャッシュ方針 を PoC で確定する。daemon 常駐を許容
できる運用なら 案 B を「依存を増やさない簡易版」として併設してもよい。backend は
index メタに記録し、異なる backend / model のベクトルを混在させない。

### index 永続化

- 置き場: `~/.cache/cchist/index/` (XDG 準拠。env で上書き可)。session JSONL とは分離。
- 形式: チャンクごとに `{key, sessionId, ts, role, vector:number[]}`。当面は JSON or
  NDJSON で十分 (数千〜数万チャンク規模)。規模が増えたら binary (Float32Array dump) に移行。
- メタ: `{backend, model, dim, builtAt, version}` を併記。model / dim が変わったら full rebuild。
- 増分更新: session JSONL の mtime を index メタの per-session スタンプと突合し、
  新規・更新分だけ再 embedding する。削除済み session のチャンクは除去。

### 近傍検索

- query を同じ backend / model で embedding 化。
- cosine 類似度で全チャンク線形スキャン -> 上位 k (既定 10)。数万チャンクなら線形で十分。
- cosine / top-k は純粋関数にして単体テスト (正規化済みベクトルなら内積)。
- 同一 session に複数ヒットしたら session 単位に畳む (最大 score 採用) オプションを検討。

## コマンド面

```text
cchist index build   [--local] [--cwd P] [--since D]   # 増分。--rebuild で全再構築
cchist index status  [--json]
cchist search <q> --semantic [--top 10] [--role ...] [--thinking] [filters] [--json]
```

- lexical と同じ共通フィルタ (`--local` / `--cwd` / `--since`) を index build / search 両方で効かせる。
- `--semantic` 指定時に index が無ければ stderr で「`cchist index build` を先に実行」と促す
  (黙って空結果を返さない)。

## テスト方針

- チャンク化 (窓・overlap) / cosine / top-k は純粋関数化して fixture テスト。
- embedding backend は interface (`embed(texts: string[]) => number[][]`) で抽象化し、
  検索ロジックのテストは固定ベクトルを返す fake backend で行う (実 model に依存させない)。
- index 増分更新 (mtime 突合・削除反映) は一時 dir + 固定ベクトルで振る舞いテスト。

## 未確定 / TODO

- 案 A 採用可否の PoC (Bun + ONNX 動作 / 多言語品質 / model 取得)。
- 多言語 model 選定 (日英混在履歴での品質)。`ollama.com/library` / HuggingFace で
  同サイズ帯の最新版を確認してから固定する (記憶のタグ名で決め打ちしない)。
- index のサイズが膨らんだ場合の binary フォーマット / ANN (hnsw 等) 導入判断。
- lexical と semantic のハイブリッド (lexical で絞ってから rerank) は phase 3 候補。
