# Memo Nexus

AI朝刊の取り込みに対応しました。

追加機能:

- 本文中の `[[語句]]` を検出して、プレビュー下部に一覧表示します。

使い方:

1. アプリ左側の `AI Import` ボタンを押します。
2. `C:\Users\tetsu\Documents\Codex\メモ帳\IMPORT` に保存された `json` を選びます。
3. `AI朝刊 YYYY-MM-DD` という新規メモが追加されます。

補足:

- `.md` と `.txt` も取り込めます。
- `.md` や `.txt` の中に ```json ... ``` のコードブロックがあれば、その JSON を優先して朝刊メモ化します。
- AI朝刊などの取込ファイル保存先は `C:\Users\tetsu\Documents\Codex\メモ帳\IMPORT` を想定しています。
- JSONの見本は [`ai-news-template.json`](C:\Users\tetsu\Documents\Codex\メモ帳\ai-news-template.json) に置いてあります。
- オートメーション向けの出力仕様は [`ai-news-automation-format.md`](C:\Users\tetsu\Documents\Codex\メモ帳\ai-news-automation-format.md) に置いてあります。

JSON生成コード:

- 朝刊本文から取込用JSONを作るには `node build-ai-news-json.js input.md output.json` を使います。
- 入力が `.json` の場合は正規化して出力します。
- 入力が `.md` や `.txt` で、その中に ```json ... ``` があれば、そのJSONを抽出して出力します。

語句統計機能 (新機能):

- 本文中の `[[語句]]` を集計して、プレビュー下部に一覧表示します。
- 同じ語句が普通テキストで出現している場合もカウントします。
- 各語句について「使用回数（本文での出現回数）」と「使用メモ数（その語句を含むメモの数）」を表示します。
- 語句が未作成（同名のメモタイトルが存在しない）かどうも判定して表示します（未作成は「未作成」と表示）。
- ツールバーの `語句` ボタンで統計パネルを開閉できます。

備考:

- 関連メモの判定やスコアリングは現時点では簡素化しています。将来的にメモが増えて煩雑になったら重み調整や表記ゆれ対応を行ってください。
- 実装ファイル: `app.js`, `index.html`, `style.css`
