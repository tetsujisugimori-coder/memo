# 採用可否

**PARTIAL：Worker方式は候補だが本番採用は保留。** 架空DBでは未解決Promiseを解決せずWorkerを終了する操作、新Workerの検索、古い識別子の拒否、readonlyと内容不変を両エンジンで観測した。これは本番検索の移植や、すべての資源が速やかに解放される保証ではない。

本番移行には `app.js` のwindow・既存DB接続・upgradeフラグ・保存スナップショット・正規化・collection確認をWorker境界へ移す必要がある。`memo-search.js` の純粋な検索・読取・結果検査を再利用する方法、同一結果となるデータ正規化、Worker側でのDB versionchange／閉鎖、モバイルのWorker配信とCSPを実装・検証する。現行brokerによるOAuth主体・scope・Origin・capability・allowRead・期限・予算・結果照合はメイン／brokerに残す。移行作業量は現時点では未見積もりで、既存コードをそのままWorkerへ移すだけでは済まない。

採用前には、実際の読取競合と停止、複数セッションの取消未確認・期限・主体・範囲・本文配送、同一IDの重複防止、枠の公平な容量制御、資源の観測可能性、初回WebKit失敗の原因、iPhone Safari実機と実OSの凍結・復帰を検証する。終了完了や解放を観測できない場合は枠を安全にHOLDし、新規要求を拒否する条件と利用者への復旧方法が必要。

代替候補として、IndexedDB transactionの明示abortを伴う中断可能な読取API、あるいは専用プロセス側の隔離を調査できる。ただし一般の任意PromiseをAbortSignalだけで強制終了できるとは仮定しない。PoCの結果は本番導入を許可するものではなく、Issue #387／PR #388のP2は未解決。
