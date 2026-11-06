# 保存・バックアップガイドの検証

- Issue: https://github.com/tetsujisugimori-coder/memo/issues/426
- Draft PR: https://github.com/tetsujisugimori-coder/memo/pull/427
- base main: `c9d350c83747b38c1e457430056282a479e080e1`
- 試験対象の固定コードHEAD: `cf19469870256d2d33ac1e1570b53ba717a4f2a4`
- 実行: `node storage-guide.e2e.cjs`（終了コード0）
- 環境: Windows / Playwright 1.62.1 / 同梱Chromium・WebKit。
- 実行日時のUTC原値・全判定・要求URL・例外/consoleログ: [browser/results.json](browser/results.json)。JSTはUTC+9。

## 検証した利用者の流れ

架空のメモを入力→通常の自動保存を待つ→設定のリンクをキーボードで別タブに開く→ガイドを読む→元のメモの全保存データが変化しない→編集を続ける→自動保存→再読込後もタイトルと本文を維持。

`browser.newContext()`による一時プロファイルと、毎回異なるloopbackポートだけを使用。既存プロファイル・実メモ・既存保存領域を開かず、保存領域の消去や初期化も実行しない。試験用HTTPサーバーは127.0.0.1のみで待受し、終了時に閉じる。

## 結果

| 条件 | Chromium | WebKit |
|---|---|---|
| 1280px / 390px × ライト / ダーク × 通常 / reduced-motion | 各8条件PASS | 各8条件PASS |
| Skip link、Tab、Enter、目次4リンク、先頭へ戻る | 全8条件PASS | 全8条件PASS |
| フォーカス枠（3px、可視位置）、横スクロールなし | 全8条件PASS | 全8条件PASS |
| 設定→ガイド別タブ→アプリ別タブへのリンク | 1280px/390px PASS | 1280px/390px PASS |
| ガイド表示中の全IDB store / localStorage / sessionStorage不変 | 1280px/390px PASS | 1280px/390px PASS |
| 通常の自動保存・再読込後の本文/題名維持 | 1280px/390px PASS | 1280px/390px PASS |
| JavaScript例外・console error・HTTP 4xx/5xx | 全条件0件 | 全条件0件 |
| ガイドの保存/通信APIアクセス | 全8条件0回 | 全8条件0回 |

合計20ケースPASS（ガイド16＋既存アプリ保存回帰4）。画像は`browser/*.png`。ガイドには元からアニメーションもtransitionもなく、両motion設定で計算済みスタイルに動作が0件であることを検査。

ガイドはscript/form/iframeを持たず、HTML/CSS以外の要求がないことも検査。試験ページでIndexedDB・localStorage・sessionStorage・fetch・Worker・SharedWorker・WebSocket・EventSource・XMLHttpRequestへのアクセスを監視し、0回であることを検査した。静的差分確認と組み合わせた判定であり、一般的な全APIの形式証明ではない。

既存アプリ試験では外部要求をすべてローカル応答へ置換し、観測した外部要求がjsDelivrの表示用資源のみであることを検査した。MCP/OAuthへ接続しない。外部CDNを利用した本番全機能の試験とは区別する。

## 検出・修正と限界

- 初回は追加リンクのフォーカス表示とWindows WebKitの既定Tab対象でFAIL。追加リンク限定のfocus-visibleと、ガイド/入口リンクのtabindex=0で対応。
- モバイル保存試験は非表示の設定/完了ボタン、初期コレクションパネルの遮蔽でFAIL。既存`mobile-layout.e2e.js`同様、実UIでパネルを閉じ、可視状態に従ってメニューを開く手順に修正。force clickや保存関数の直接呼出しで回避していない。
- 独立初期レビューP3の「その他→設定」説明不足をガイド2箇所で修正。
- 変更中の診断実行は受入証拠に使用しない。最終成果物は上記固定HEADの完全再実行結果。
- 実機iPhone/Safari/PWA、スクリーンリーダー、外部CDN条件、アプリ全体のテーマとの連動はNOT_TESTED。ガイド配色はOS/ブラウザ設定に従い、アプリの保存テーマは読まない。
- 実MCP・OAuth操作・Worker停止・IndexedDB停止・実データ操作は未実施（禁止範囲）。研究判断はUNKNOWN/HOLDを維持。

## 差分境界・統合条件

`index.html`の変更は導線1行と追加リンク限定CSS1行。`app.js`、`style.css`、保存・復元・認証・通信・Worker実装、研究workflowは無変更。全16研究PRの2042変更パスとの重複0。完全パスは[research-boundary.json](research-boundary.json)、選定理由は[boundary.md](boundary.md)。

この文書と画像・JSONの保存後も、固定コードHEADから実行コードが変わらないことを独立担当が確認する。独立最終判定・CIの最終結果とマージ可否はPR/Issueコメントに固定HEAD付きで記録する。branch protectionは設定なし（API 404）、branch rulesは空だったため、既存CIの非任意ジョブすべての成功を統合条件とする。任意のWebKit Inspector diagnosticのSKIPPEDをPASSに数えない。

2026-11-06 JST
