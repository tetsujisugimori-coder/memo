# MCP Worker 復旧の限定試作（Issue #392）

判定は PARTIAL。本番採用および実際のMCP検索経路への接続は HOLD。PR #388 の未解決Promise問題を解決したとは判定しない。

## 何を試したか

`recovery-model.cjs` は接続先を持たない局所モデル。セッションIDと内部要求IDを照合し、期限・取消・タイムアウト後の結果を拒否する。要求期限は単調時計、許可期限は絶対時刻で検査する。結果の二重受理は同一実行内で拒否し、terminate例外時に結果を破棄する。Worker作成時に枠を消費し、terminateの戻りでも枠を解放せず、上限に達すると `capacity_unknown` で停止する。

この台帳は単一モデル内だけであり、実資源の数や解放完了を証明しない。ページ再読み込み・他タブ・ブラウザプロセスをまたぐ上限はない。実broker要求IDの重複配送、実認可、配送直前の取消・期限再検査、実IDB・既存検索仕様との同等性も未実装。既存検索へ統合しない。回復条件の文字列はモデルの安全側判断であり、実プロセス解放を検証する手順を実装したものではない。

`recovery-model.test.cjs` は合成Workerを使い、タイムアウト・再開始・古い結果・二重受理・取消・期限・壁時計逆行・terminate例外・上限を検査する。`recovery-browser.cjs` は実ブラウザの架空Blob Workerで無応答→timeout→別セッションの1件成功→容量枯渇を検査する。IDB・認可・配送は使わず、実停止時刻や物理解放は未観測。

## T7単独

`t7-only.cjs` は新規browser processとcontext、架空DBを使い、元の `suite.js` / `worker.js` のT7を1回実行する。T1〜T6は NOT_RUN、T7内の反復12回と8秒open・2秒削除の上限は従来どおり。fixture初期化・事前snapshotは実行する。結果は実観測のみを記録し、削除や接続の未確認は UNKNOWN のままとする。

Windowsローカルの1回ずつの結果：Chromium 151.0.7922.34／WebKit 26.5 ともT7の12回のupgrade成功・削除successを観測。いずれもT7判定は PARTIAL（物理資源は未計測）。実行時のsource hash・時系列は `evidence/t7-only-windows-*.json` に保存。過去のLinux WebKit primary T7失敗と削除UNKNOWNを上書きしない。T1〜T6の除去と新規processを同時に行うため、差の原因は特定できない。

独立Linuxの各1回は専用CIで確認する。結果はその実行のartifactとcheckを参照し、Windowsの成功で代用しない。A/B/Cの詳細／最小比較は既存の `run.cjs` を再利用する。Aは完了→明示close、Bは人工的な同期ゲート、Cは完了→closeなしであり、Bを元T7の未解決Promiseと同一視しない。

## 実行

```
node --test experiments/mcp-search-worker-feasibility/recovery-model.test.cjs
node experiments/mcp-search-worker-feasibility/recovery-browser.cjs
node experiments/mcp-search-worker-feasibility/t7-only.cjs
```

各ブラウザは `WORKER_POC_BROWSER=chromium` または `webkit` で選択する。架空データ・独立contextのみを使う。別途、既存 `run.cjs` のsnapshot比較と、実検索経路の架空OAuth/架空メモE2Eは別の検証であり、このモデルの認可や実データ保護の証明にはならない。

## 統合の前提

PR #388 は Draft、main と `LOG.md` で競合し、未解決PromiseのP2が残る。両変更を混同せず、#388 の競合解消と独立レビュー、配送境界の確認後に統合順序を決める。最低限、実broker要求の一意性、取消・期限後の配送阻止、複数タブと再読み込みを含む資源上限、実IDBのread-only・接続終了UNKNOWN下での安全停止、Chromium/WebKitの実検索E2Eを実証する必要がある。
