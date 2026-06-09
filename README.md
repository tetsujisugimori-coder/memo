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
