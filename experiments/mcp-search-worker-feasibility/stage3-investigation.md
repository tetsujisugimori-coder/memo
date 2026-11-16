# #392 Worker停止・復旧：第3段階（PARTIAL／HOLD）

調査開始時 main `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba`、#393 remote `df9a713b3ef9188b4a6bc8ae500f92d20b9124ea`、local `fc7cd47cff4999936963dc1c7adae04f91a3406c`。双方tree `af099b81e31879160f950bc680e64cfe1b6ff115`、parent `597c1d4985724e3dd77660a3562020d7004b6d86`。GitHub APIによる別commit作成でSHAが異なる。日時は同じ瞬間、ローカルmetadataは+0900表記で、remote APIはUTCを返す。metadata生バイトとの差は未特定。証拠と既存作業を保持し、別cloneで作業。

## poll比較

Windows Chromium 151.0.7922.34／WebKit 26.5、比較試験を両engine各2回（うち最終スクリプト各1回）、架空originとephemeral fixture、認証・本文なし。各結果と時系列は `evidence/stage3-poll-windows-*.json`。即時、250ms保持、AbortController中断、世代切替、ページ閉鎖、context閉鎖、意図的な二重fulfillを比較した。両engineで即時・保持はHTTP 200、世代切替は旧応答をfixture内で破棄。abortはfetchがAbortErrorだがfulfill自体は返った。ページ／context閉鎖後のfulfillも返ったが、配送成功の証拠ではない。二重fulfillは両engineで `Error` / `Route is already handled` を検知。予期しない例外注入でrunnerが非zeroになることを両engineで確認。

この合成比較は旧UIや本物の認可取消・Worker連携ではない。終了中Workerとpoll同時操作、実認可、実配送は未実施。前回の実検索E2Eでは保持routeのfulfill失敗、その後の同一poll requestfailedとpageerrorを観測したが、今回は再現していない。二重fulfillという別条件のエラーを元の失敗原因と断定しない。元の例外種別と内部原因、pageerrorとの因果関係はUNKNOWN。既存WebKit失敗は維持し、回避修正はしていない。

## 終了と共有予算

|状態・証拠|扱い|
|---|---|
|予約（生成前）|同一ID・ownerの明示releaseのみ可能|
|running|生成を試みる前に永続化。枠を保持|
|停止要求／結果無効化|生成枠を保持|
|終了準備ack|正しいID・世代・IDB close申告を受信しても保持|
|ack欠落・期限後|unknown、遅延ackを拒否、枠を保持|
|termination confirmed／slot reusable|物理解放を示す外部証拠がなく到達させない|

`shutdown-protocol.cjs` は独立した合成モデルであり、台帳・本番検索へ接続しない。実ブラウザWorker試験では架空IDBのreadonly transaction完了後にcloseを呼び、旧世代・正しい世代・重複ackを送る。close呼出しとackは物理WorkerやOS資源の解放証拠ではない。両Windows engineで拒否／受理／拒否と枠の保持を確認。通知が物理的に遅れて届く条件は合成deadline試験であり、実Worker遅延配送の証明ではない。

同一origin・同一IDB partitionかつ全参加者が台帳を利用する範囲の生成予算であり、別プロファイル・ストレージ消去・非協調コード・OS全体は制御できない。異常時は管理状態を信用せず開始しない。実行中・unknownの自動回収はなく、HOLD。外部からプロセスを監督し終了を確認できる隔離基盤は候補だが、その証明は未実施。

## 検証記録

- Windows Chromium／WebKit：同時2タブで生成1、所有タブreload、所有タブ終了、全タブ閉鎖後の同context再開で枠保持。独立ブラウザ終了後、同じ専用persistent profileを用いた再起動でもrunningと中断reservedを保持、追加生成0。物理解放UNKNOWN。
- Windows両engine：架空IDB読取メソッド例外と書込メソッド例外を注入し、開始失敗・生成0。書込例外でtransaction abortを通る。破損・欠落も開始拒否。ただし実デバイス障害・transaction commit不確定の全ケースは未検証。
- Windows両engine：生成前release／再取得と旧ID拒否、生成失敗後の枠保持。正常終了済みWorkerの枠再利用は未実装。
- 合成終了モデル2件、既存モデル6件、検索broker17件：25件成功、skip 0。Windows Chromiumで異常注入runnerが非zeroと判定された。
- Windows WebKitのWorker試験の初版（routeによる架空HTTPS）はack timeout、診断版はworker_error_other。ephemeral loopback fixtureに変更した版は両engine成功。初版失敗の根本原因は未特定、製品不具合とも断定しない。
- 再現：`WORKER_POC_BROWSER=chromium` または `webkit` で `node experiments/mcp-search-worker-feasibility/{poll-compare,shared-ledger-browser,ledger-restart-browser,shutdown-browser}.cjs` を個別実行。`node --test experiments/mcp-search-worker-feasibility/shutdown-protocol.test.cjs`。専用CIはLinux両engineで同じスクリプトを実行する。

## #388と既存CI

#388のheartbeatは接続状態であり検索成功、Worker健全性、終了確認ではない。実broker要求IDの一意性、二重配送防止、配送直前の取消・期限・認可の再検証、旧session遮断、停止不能時の復旧は実統合の別受入条件。今回PoCはこれらを実装せず、本番採用HOLD。

基準df9a713の[正式CI](https://github.com/tetsujisugimori-coder/memo/actions/runs/41123427907)はWindows Chromiumのdiscovery launcher準備45秒timeoutでFAIL、後続artifactなし。exitCode=null、出力空。原因とWorker変更との因果はUNKNOWN。PoC CIとT7 standaloneはそのrunで各engine成功だが、過去のLinux WebKit T7 timeoutやcleanup UNKNOWNは別に保持する。Chart WebKitの過去失敗も別事象。
