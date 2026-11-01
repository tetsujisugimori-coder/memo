# 根拠対応表と確認版

確認日時は `records/inspection.json` のJST。仕様は保証、ソース読解は実装からの推論、D/E/F/Gは既存実測として分離する。仕様適合性やソースと配布バイナリの一致を実測したものではない。

## リポジトリ・レビュー

|対象|確認した現在HEAD|参照版との差|本文・レビューの扱い|
|---|---|---|---|
|main|438cf201abe83a53e8cb8e7ed160c4d6dbe147ba|ローカルとremote一致|AGENTS.md確認、製品変更なし|
|[#393](https://github.com/tetsujisugimori-coder/memo/pull/393)|f2168f194b326b0ce9ffb722e81aa47e42ce0d03|前工程の識別子証拠版と一致|正式レビュー1件は旧df9a713対象。資源枠回収/物理解放・実配送境界の未証明を現HEAD承認に読み替えない。本文と8コメントも確認|
|[#397](https://github.com/tetsujisugimori-coder/memo/pull/397)|3734f82d117e09355cc721077ead626fa368e451|指定D/E証拠版と一致|正式レビュー0、F報告コメント1。不存在の指摘を補わない|
|[#398](https://github.com/tetsujisugimori-coder/memo/pull/398)|105d80a467e96aa7038052f501c4a1776a6e69bb|指定F証拠版と一致|正式レビュー1件、当該HEAD。P3：別run/checkoutをまたぐ上限、ログ/error監視もタイミング差。静的設計へ反映|
|[#399](https://github.com/tetsujisugimori-coder/memo/pull/399)|9872ee7aee773b017915364669bc31b98cc22e83|指定G証拠版と一致|正式レビュー0、コメント0。G本文の限定SUPPORTEDとINCONCLUSIVEを保持|

全PRはOPEN/Draft、inline review commentsは全件0。本文・レビュー・コメントをgzipに保存。関連[Issue #392](https://github.com/tetsujisugimori-coder/memo/issues/392)と[Issue #396](https://github.com/tetsujisugimori-coder/memo/issues/396)の目的・研究計画・結果を確認。#393が参照する過去レビュー対象SHAと現在HEADを混同しない。#396のG事前登録コメント末尾には文字化けが存在するため、数値・固定commit・保存済み計画を根拠にし、壊れた文章を推測復元しない。既存本文は変更しない。

## 既存実測

|条件|実行commit / tree|証拠commit|観測と限界|
|---|---|---|---|
|D/E|53445474028601131136e2bc540ee48aee83cd7a / 0a9f3bf1d88c035a33ed46efbda4e79207aa378e|3734f82d117e09355cc721077ead626fa368e451（証拠tree 940110ecd079f4d1feb68ea79b96af2e4d293860）|D i2 2→3 timeout8000ms、cleanupUNKNOWN、Worker終端UNKNOWN。E complete+close+協調記録で12成功、複数要素が交絡|
|F|6b25f7ecf1d3b290958556708fee9899f188c5f2 / af4e504157e334bdc62d0082f614e7489b3a8435|105d80a467e96aa7038052f501c4a1776a6e69bb（tree f879982c6b83ae1ee464b91bfaa5544dd8c6649c）|complete待ち、追加協調close/ackなし、12成功。未完了で停止した実例ではない|
|G|b08c0f8b73ec4184478669fb4ac5907be83dbb52 / 7ce3d9c7b33847cccad747ef3376890518b4e1b6|9872ee7aee773b017915364669bc31b98cc22e83（tree fc77cecb5c5b51add1eb062eedc9aff49979a55c）|固定1ms、12成功、全件送信前complete・main停止前受信。自然完了との分離INCONCLUSIVE|

D run `eec76e89-5f10-45d0-8830-8dcb3ddf2110` / DB `worker-poc-d12d5caa-4a7d-4223-81c0-0a6cd77a1f74`。

E run `e22b6648-7957-44f7-bb08-a902f835d763` / DB `worker-poc-8de8fd09-68f4-436d-8c65-0297dd6436cf`。

F run `61b757bd-6b5f-4fdf-aab8-574c511aea93` / DB `worker-poc-877ab5bc-0794-4ccf-97da-5c6664645508`。

G run `16060bc8-4b98-435c-a534-f276b70ae612` / DB `worker-poc-d941090b-4231-4752-9a72-20b40592915f`。

Linux WebKit26.5。原始結果を読むだけで、旧runnerをimport/起動していない。D/E19件、F20件、G25件のindex登録ファイルとgzip展開SHAを検査。各原始resultの実行commit/tree/run/DB/cleanupはinspection.jsonに記録。[D/E原始証拠](https://github.com/tetsujisugimori-coder/memo/tree/3734f82d117e09355cc721077ead626fa368e451/experiments/idb-upgrade-lifecycle/evidence)、[F証拠](https://github.com/tetsujisugimori-coder/memo/tree/105d80a467e96aa7038052f501c4a1776a6e69bb/experiments/idb-transaction-complete-only/evidence)、[G証拠](https://github.com/tetsujisugimori-coder/memo/tree/9872ee7aee773b017915364669bc31b98cc22e83/experiments/idb-time-delay-only/evidence)。原版primary失敗DBは未観測のまま。

## 仕様上の根拠

旧CIは [D/E #41299732744](https://github.com/tetsujisugimori-coder/memo/actions/runs/41299732744)（D失敗を含むFAIL）、[F #41303212794](https://github.com/tetsujisugimori-coder/memo/actions/runs/41303212794)（SUCCESS）、[G #41316288566](https://github.com/tetsujisugimori-coder/memo/actions/runs/41316288566)（SUCCESS）。後の成功をDの解消や原因確定へ転用しない。今回のCIはNOT_RUN。

|ID|一次資料・確認版|保証の要旨|設計への適用と限界|
|---|---|---|---|
|S1|[IndexedDB 3.0 transaction lifecycle](https://w3c.github.io/IndexedDB/#transaction-lifecycle)、Editor’s Draft 2026-10-30、参照repo [f9f83f1](https://github.com/w3c/IndexedDB/tree/f9f83f196f8501429282ff1747ebcbe35d41381a)|active/inactive/committing/finishedは別状態。requestイベントdispatch中は追加要求を扱える。通常commitには処理結果を扱い終わる条件がある。abortはactive中にも可能|callback保持は通常commit前提の制御候補だが、未観測abortを否定しない|
|S2|[IDBRequest.readyState](https://w3c.github.io/IndexedDB/#dom-idbrequest-readystate)、[success event](https://w3c.github.io/IndexedDB/#fire-a-success-event)、[close](https://w3c.github.io/IndexedDB/#close-a-database-connection)、S1と同版|要求のdoneはtransaction全体の終端ではない。close呼出しと閉鎖は別。通常closeの完了eventはない|pending/close戻りで内部処理・解放を証明しない。error eventも必ずabort確定という意味ではないが研究上は異常停止|
|S3|[HTML worker termination](https://html.spec.whatwg.org/multipage/workers.html#terminate-a-worker)、Living Standard表示2026-10-30、repo [404b3eb](https://github.com/whatwg/html/tree/404b3eb14a7a936dddefb2d78e224dbeb01d2358)|Worker実行と並行した終了手続きでtask破棄・実行script中断があり得る|finallyや終端通知の配送を必須証拠にできない。terminate戻りは物理解放ackではない|
|S4|[ECMAScript Atomics.wait/DoWait](https://tc39.es/ecma262/multipage/structured-data.html#sec-dowait)、ECMAScript 2027 online、repo [4d8fed0](https://github.com/tc39/ecma262/tree/4d8fed0daae61bad78b5f27ae0c57bc4b3e6e99b)|共有integer bufferの同期wait。有限timeout指定でもpaddingやスケジュール遅れがあり、厳密な復帰時刻保証ではない|1回だけ有限wait。main/Node側の外側期限も必要。時間だけで保持を推定しない|
|S5|[HTML agents](https://html.spec.whatwg.org/multipage/webappapis.html#agents)、S3と同版|専用/共有Worker agentがblocking Atomicsを利用可能。共有メモリにはagent cluster制約がある|対象環境でSAB・crossOriginIsolated・secure context・COOP/COEP条件を固定確認する必要がある。今回は未実測|

上表のrepo SHAは閲覧時にAPIで固定した版。online HTML表示とrepo生成物のバイト同一性までは検証していない。確認日時・repo commit日時をinspection.jsonに残す。将来実行時に仕様版と対象バイナリ対応を固定する。

## 公開WebKit実装からの推論（対象バイナリの実証ではない）

参照commit [dddaa9bb93f1061268dc42f5f5bdd01dcc34e065](https://github.com/WebKit/WebKit/commit/dddaa9bb93f1061268dc42f5f5bdd01dcc34e065)。GitHub raw contents APIで読み、取得テキストhashをinspection.jsonへ記録。

- [IDBRequest.cpp:300](https://github.com/WebKit/WebKit/blob/dddaa9bb93f1061268dc42f5f5bdd01dcc34e065/Source/WebCore/Modules/indexeddb/IDBRequest.cpp#L300)：dispatchをTransactionActivatorで囲み、後で要求の完了処理・除去へ進む。同期callback保持を検討する根拠。
- [IDBTransaction.cpp:1550](https://github.com/WebKit/WebKit/blob/dddaa9bb93f1061268dc42f5f5bdd01dcc34e065/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L1550)：autoCommitはInactive、操作map/open requests等を検査する。対象外のバックエンドabortを封じる証明ではない。
- [IDBTransaction.cpp:576](https://github.com/WebKit/WebKit/blob/dddaa9bb93f1061268dc42f5f5bdd01dcc34e065/Source/WebCore/Modules/indexeddb/IDBTransaction.cpp#L576)：commit応答処理とcompleteイベントenqueueは別段階。イベント配送を止めただけでは内部処理の未完了と言えない。

**このupstream commitとPlaywright Linux WebKit26.5配布物の対応はUNKNOWN。** Worker/DB別スレッド・プロセスの停止境界やabort通知経路全体を検証していない。参考実装を対象26.5の保証に転用しない。将来の公開APIのみの実験ではstopCondition UNKNOWNを保持し、内部未完了を必須とする計画の実行承認を出さない。
