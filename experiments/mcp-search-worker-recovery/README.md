# Worker停止・復旧の独立実装（#391）

**研究専用 / 本番採用HOLD。製品コードへは読み込まれない。** main `714b1c6` の#390を土台とする。#388 `4fe3ea8` の未解決poll待機はこのPRで直接修正しない。

## 実装

`supervisor.js`は要求ごとにWorker・generation・requestId・synthetic sessionを照合し、同時要求を1に制限する。正常Workerを再利用し、transaction completeとclose呼出し後の応答のみ採用する。期限はtimerだけでなく受信時にも再確認する。キャンセル・許可置換は先に要求を失効させる。

未解決要求は期限にcallerをrejectし、Workerにterminateを要求する。**戻りは解放証明でない**ため、作成予算2回を生涯固定し、強制停止・生成失敗でも返却しない。残る1枠で次のsynthetic sessionを実行できるが、2枠消費後は`STOPPED_RESOURCE_UNCONFIRMED`で安全停止する。再試行・新sessionで予算は復元しない。正常応答後も物理資源解放はUNKNOWN。これは作成回数の上限でありbytes/OS資源上限を証明しない。

同じsupervisorを再作成して予算をリセットする製品設計は禁止。PoCには製品tab全体を統制するownerはまだなく、本番へ採用できない。独立browser lifecycleと再認可が将来の復旧候補だが、browser終了が資源を解放したとの証明もないため自動復旧しない。

`worker.js`は`recovery-fixture-UUID`という架空DBだけを読み、readonly transaction以外を作らない。normal search/fulltextとclose後の未解決Promiseを実行する。実MCPの検索アルゴリズム・OAuth・collection・回数/転送量制限の代替ではない。syntheticの`allowRead`は実認可検証ではない。実メモ・未保存draft・資格情報に接続しない。fixtureの作成と削除は隔離テストだけ。

## 検証と限界

- `node --test experiments/mcp-search-worker-recovery/supervisor.test.cjs`：識別子、期限、取消、新session、遅延/二重結果、busy、生成失敗、枠枯渇。fake Workerによる受信注入は実terminate後message発生の証明でない。
- `WORKER_RECOVERY_BROWSER=chromium node experiments/mcp-search-worker-recovery/run.cjs`（webkitも同様）：実Worker/架空IndexedDBで検索・全文・実未解決ゲート・timeout・次session検索・取消・枯渇・保存原文比較。30秒runner期限、削除2秒。UNKNOWN cleanupは非成功。
- T7独立診断の上限・比較条件は `plan.md`。元#390のsuite・証拠・失敗条件を変更しない。追加成功で元T7失敗を相殺しない。

ソースhash・実HEAD・engine・時刻入りJSONを一意名で保存。コード変更前の実行と最終HEADのCIを区別する。iPhone Safari・実OAuth/MCP配送・実OS背景停止・物理資源は未検証。未実施をPASSにしない。

## #388との統合順序

本PRはmainから研究のみ。#388へのcherry-pickや上書きなし。#388のheartbeat・遅延result分類を独立レビュー後に統合し、その上で実検索のWorker移植、tab全体owner、実認可/取消/期限/collection/転送量との結合試験が成立した別PRで初めて製品統合を判断する。#388のP2は未解決のまま。製品保存・認証・受信プレビューは差分なし。

## 2026-10-30 初回CIと局所修正

run [41066494950](https://github.com/tetsujisugimori-coder/memo/actions/runs/41066494950)、PR HEAD5187514、実checkout61a0f8aで両engineの新受入はFAIL：default clearTimeoutをsupervisorのmethodとして呼び、Window receiver違反となった。製品不変更だが新PoCの実装不具合。global timerをarrow wrapper経由で呼ぶ局所修正と12件目の回帰を追加した。修正後の実ブラウザ結果はPRコメントへ記録する。

有限T7診断は同runで予定の各engine2条件を完了：Chromium original-primary PARTIAL（T7 PARTIAL、T12 HOLD）、T7-only PASS。WebKit original-primaryはT7 iteration1の8秒upgrade timeout、delete2秒UNKNOWN、T8〜T12 NOT_RUN。別browser起動T7-onlyはupgradeとdelete success。両engineのbrowser.closeはRETURNEDだが物理解放はUNKNOWN。先行T1〜T6の有無・試行数の差があり、根本原因は確定しない。

artifact: Chromium12982139030、WebKit12981779289（保存期限2026-11-13）。取得JSONのt7-runソースSHA256 `648dd85dd4370790158e26bdeb76a97e2726bc341e707c04bbcc7b765eeb941c` は現行不変更ソースと一致。旧失敗と元suiteを保持する。ローカルにも未加工JSONを一意保存した。

診断は修正pushごとに反復しない。専用workflowの通常PR実行は新受入を再検証し、追加T7診断は明示workflow_dispatch入力のみ。診断の再実行対象外を「T7成功」にしない。最終HEADでも旧T7 FAILと本番HOLDを維持する。
