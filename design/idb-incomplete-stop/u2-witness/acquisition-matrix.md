# U-2 証拠取得・独立性マトリクス

**2026-11-03 JST。机上調査と取得候補の整理であり、各系統の実測はNOT_RUN。** #403の上流コード調査には固定上流commit `343e13bf22dca9d0ec227801419aab0f9001a32f` を利用した静的対応表がある。ただしその対応は配布実行バイナリとの動作一致を証明しない（#403未マージ／独立再レビュー待ち）。本書はその結論を継承し、未証明箇所を埋めたふりをしない。

## G1：配布バイナリ／上流ID（BUILD-ID）
|項目|既存から分かること|欠けている証拠|次の安全な確認|拒否条件|
|---|---|---|---|---|
|Playwright lockとmetadata|#403はlockと保存ログのrev 2336・対応上流候補を静的照合|実行バイナリ全体、patch適用、ビルド設定と配布経路の独立証明|保存されたpackage・browser metadata・配布物のhashの照合可能性を調べ、照合不能ならUNKNOWNと明記|表示版だけ一致、別platform rev、上書きBASE_REVISION、入手不能|
|portとIPC経路|#403は固定上流コードにclient/server transaction identifierを調査|対象portの実行時IPC・プロセス移行を含めた改変版との同一性|製品入出力に触れない構成の一次資料・署名の有無を調べる|違うplatformまたは違う上流を黙って代用|
**候補：** A)公開metadataと配布物hashの再照合（ただしbinary同一性が証明できるかUNKNOWN）、B)公式diagnostic利用可否の静的照合、C)別途レビューで許可された独自ビルド。今回A/Bの*資料取得可否*のみ計画。ビルド・取得・実行は0。

## G2：アプリから内部transactionへの結合（ID-BIND）
|項目|#403静的観察|欠けている証拠|必要な最小観測|拒否条件|
|---|---|---|---|---|
|ID採番|WebCore IDBTransactionInfoが内部IDを生成、connection IDとresource numberの対が候補|完全JS identity→内部IDを結ぶ実行時レコード|creation時点の一意な相互参照＋processIncarnation＋producer epoch＋run nonce|transactionId文字列、同じdbName、時刻近接だけでjoin|
|跨プロセス|proxy/connection-to-server/serverで同identifierを参照する候補|実対象ビルドのIPC経路、異常・再生成とID reuseの確認|client→serverの明示ID付きedge、各層の生成/解放を含む結合表|別worker/別connectionの偶然一致、process再起動でID再利用|
**候補：** 現行公開APIでは内部ID直接対応が確立せず、WebKit内native計測または診断channelの実装設計レビューが必要。内部のresource numberのみでは不足。

## G3：論理IDB状態と実停止境界（TX-STOP）
|項目|#403静的観察|欠けている証拠|必要な最小観測|拒否条件|
|---|---|---|---|---|
|内部状態|UniqueIDBDatabaseTransaction/UniqueIDBDatabaseのcommit/abortとcallbackが候補。readonlyのSQLite transaction状態は論理IDBと異なる|正常開始、commit intent/result、abort intent/result、server loss、suspension、destroyの同一ID系列|LOGICAL_IDBの状態変化とterminal結果の別観測、異常経路網羅性|SQLのinProgress=falseを論理終了とみなす／map takeを終端とみなす|
|停止|Worker terminate経路、run loop、cleanup、context破棄のコード候補を調査|本実装の停止境界（単一具体的なcut）とDB側状態への順序edge|停止要求／戻り／JS中断／cleanup開始／context破棄／thread退出を分離したイベントと因果結合|terminate returned、Inspector通知、Worker complete未受信だけを実停止とみなす|
|区間証明|markerや要求追加受理はJS側状態だけ|commit/abort/異常の全経路を含む「stop cutまで正常未終端」の陽性証拠|同一transactionのBEGINとcut、履歴完備性を持つ終端/異常の負対照|JS successからの推測、異source時計による順序、終端後の停止をU PASS|
**難所：** 「DB状態を切断面として正しく観測」すること自体が未成立。計測同期のための新しいlockは対象の競合条件を変え得る。正しいcutが構成不能なら条件Uを`BLOCKED`に保つ。公開APIだけで解消できる見込みを主張しない。

## G4：Worker停止後に生き残る記録器（RECORDER）
|項目|#403静的観察|欠けている証拠|必要な最小観測|拒否条件|
|---|---|---|---|---|
|連番/欠損|Worker単独記録は停止/queue破棄で末尾欠落し得る|producerごとに欠測が検出できる最後の範囲と外部生存保証|source別連番、epoch、high-water、両端checkpoint、drop/overflow/process-loss|未配送を「イベント非発生」と扱う|
|flushと確定|source別の配列順もcollectorへの到着順も因果を保証しない|停止境界後も永続化確認できる証跡|batch idとdigest、永続化後flush ack、明示的な未保存/破損状態|flush要求だけ、自己申告lastSeqだけ|
|容量/摂動|元有限案は1MiB/512eventなど上限を示すが新計測への転用許可ではない|ネイティブ計測後の予算・摂動・プロセス損失条件|有限ring・overflowしたらUNKNOWN、事前確保と独立保全、停止時の黙った切捨て禁止|過剰負荷・overflow・logger死亡でもPASS|
**候補：** Worker外のnative collectorは設計候補であり、実行可能性UNKNOWN。既存ログを同等の完全性証明に昇格しない。

## 横断する必須提出物（実装に進む前）
- 対象ビルドが同定可能な一次資料（URL、取得日時、hash、license/配布経路、存在しないなら欠測報告）。
- source→native transaction→JS identityの対照表と、ID再利用に対する独立負対照。
- 正常開始／終端／異常／実停止cutと、それぞれのproducer、発生layer、因果edge一覧。レビュー可能な図・表として残す。
- Recorderの完全性に対する失敗時遷移、上限、保存後の検証可能な封印（hash + count + high-water）。
- 別版・別tx・無通知・commit/abort・drop・process loss・再起動という**偽成功を誘う反例**を、判定基準を先に決めて検査。
- 計測摂動・実験開始許可・有限環境・teardown安全のレビューはこれらが整った後の別工程。

## 最小追加証拠の優先順位
1. **版の実体対応の判定可能性**：不可なら内部ソースの引用だけを追加しても前進しない。
2. **ID結合＋stop cutの因果関係を成立させられる設計か**：単独で成立しなければUの証明はBLOCKED。
3. **recorderの「終端が観測されない」を陰性証明にできる完全性機構が成立するか**：不成立ならUNKNOWN。
4. 上記の設計可能性が全て肯定された時だけ、計測改変ビルドの実施是非を別途レビューする。肯定されても実行承認ではない。

**既存状態：G1 PARTIAL（metadataのみ）、G2 UNKNOWN、G3 UNKNOWN、G4 UNKNOWN。H1〜H3 UNKNOWN、H4 PARTIAL、U/実験 NOT_RUN、NOT_GRANTED/BLOCKED/HOLD。**
