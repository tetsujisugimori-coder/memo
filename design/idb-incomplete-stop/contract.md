# 観測・判定契約 v2（P2-IR1 / P3-IR2補訂）

## 用語

|事象|正に確認できる範囲|推論禁止|
|---|---|---|
|request success|当該requestの結果通知がWorkerでdispatchされた|transaction complete・全要求終了|
|要求追加受理|readonly要求APIが成功した呼出時のAPI上のactive条件（S1/S2）|後の送信/停止時までactive、内部read実行中|
|active / inactive|要求追加可能性に関するライフサイクル|active=未完了全体、inactive=完了という同一視|
|処理未完了|API transaction未finished、内部処理未終端、要求未配送を別記録|request.readyStateをtransaction状態に転用|
|complete / abort / error|Worker listenerで観測したイベント。内部処理とdispatchは別|通知未受信=未完了。errorを正常未完了/必ずabort済みと解釈|
|Worker send|通知の送信操作、sendIdとsourceSeq|main受信済み、停止時も同状態|
|main receive|対応sendIdの受信、mainSeq|別run/txの採用、Worker時計との差をlatencyとする|
|stop / terminate call / returned|別々のmain連番・結果|終了完了・接続閉鎖・物理解放|
|upgrade open / upgradeneeded / success|要求発行、upgrade開始、要求successの各事実|成功だけで未完了停止条件成立、旧FAIL解消|
|blocked / error / timeout|受信イベントまたはobserver期限|blocked不在=接続残留なし、timeout=要求取消済み|
|close called / returned|close要求を呼び戻った|通常閉鎖完了event、物理解放|

## 識別と順序

全記録に planId / runId / dbName / workerId / connectionId / transactionId / iteration / requestId / eventId / source / sourceSeq / clockDomain / sourceMs / result を持たせる。ゲートにはepoch/nonce、sendにはsendId、receiveにはそのsendIdを含める。今回の純粋モデルでは必須identityをrun/db/worker/connection/transaction/iterationに絞り、要求受理にはrequestIdを必須にする。実装前に完全schemaを固定する。

同一source内は、正の整数sourceSeqが配列内で厳密増加することを検査する。欠落・重複・逆転は記録不正。異sourceの結合配列位置は共通時刻でも因果順でもない。send→receiveはID参照、mainのreceive→stop→call→returnは同一main連番で結ぶ。時刻差や配列位置から異source間のedgeを生成しない。同じ部分順序を保った結合順では意味上の結果と理由を変えない。

### completeの発生・送信・受信

停止前完了として採用する最小経路を次に限定する（別の推定経路は追加しない）。

1. Workerの `transaction_complete`：発生記録のeventId。
2. Workerの `complete_sent`：`completeId` が1のeventIdを参照し、同一WorkerのsourceSeqで1より後。
3. mainの `complete_received`：`sendId` が2のeventIdを参照する。
4. `complete_received.sourceSeq < stop_requested.sourceSeq` が同一mainで成立する。

全段で同じrun/DB/Worker/connection/transaction/iterationを要求する。complete通知用sendIdは、既存unresolved等の `send`→`receive` と別の参照。参照先欠落・型/所有者違い・別identity・不正sourceSeqはvalidTrace FAILであり、停止前完了の証拠として採用しない。イベント自体が存在しないことは正常に記録が不足している場合もあるため、UNKNOWNと区別する。

Worker単独complete、complete_sentまでしかない記録は、結合配列のどこにあっても停止との前後UNKNOWN。対応main受信が停止要求後の場合も、Worker内の完了発生と停止との前後はUNKNOWN。ただし「受信してから停止するR」の条件は満たさない。停止要求前に対応受信した場合だけ、Uの未完了条件を不成立とする。実停止と内部処理の境界を証明したという意味ではない。

## 判定軸

|軸|PASSに必要なもの|FAIL／UNKNOWN|
|---|---|---|
|validTrace / recordError|同一identity、イベント参照・sourceSeq・上限等の整合|収集/参照違反はvalidTrace FAIL、recordErrorに理由、R/UはUNKNOWN・理由INVALID_TRACE。正常な条件不成立と区別|
|workerObservation|同一txのreadonly要求追加受理イベント。既存request successだけでは不可|要求受理なしUNKNOWN。不正identityはvalidTrace FAIL、異常はstopCondition FAIL。これはAPI呼出時だけの正の証拠|
|callbackHold|同一epoch/nonceのHELD通知→main受信→claim成功→terminate呼出前後のCLAIMED確認、単調遷移契約|期限切れ/退出FAIL。nonce不一致・情報欠落UNKNOWN。これ単独でstopCondition PASSにしない|
|conditionR（完了後停止観測）|validTrace PASS、対象の要求受理→send/receive→停止/terminate戻りの対応、および上記complete通知のmain受信が停止要求前、abort/errorなし|受信が停止要求後ならFAIL・RECEIVED_AFTER_STOP。停止列が不足ならUNKNOWN。abort/errorはFAIL・ABNORMAL。実験全体の安全性/承認を含めない|
|conditionU / stopCondition（互換alias）|Worker観測＋**停止境界まで正常未終端を維持した独立の証明**＋完全なID/因果関係＋abort/errorなし|公開API/共有markerだけならUNKNOWN。対応main受信が停止前ならFAIL・COMPLETED_BEFORE_STOP。abort/errorはFAIL・ABNORMAL。Worker単独/停止後受信はUNKNOWN|
|upgrade|対応openに対するsuccess、timeout/errorなし|timeout/error FAIL、openあり終端なしUNKNOWN、未要求NOT_RUN。遅いsuccessがあってもtimeoutを消さない|
|cleanup|保存済み証拠の後、許可されたdelete1回でsuccess|期限UNKNOWN、error FAIL、未実行NOT_RUN。要求再発行なし|
|connectionClosed / physicalRelease|本設計で利用できる独立証拠なし|常にUNKNOWN。terminate戻り、upgrade/cleanup成功から昇格しない|

conditionReasonR/Uをそれぞれ記録する。validTrace PASS / conditionU FAIL / COMPLETED_BEFORE_STOP は条件不成立。validTrace FAIL / conditionU UNKNOWN / INVALID_TRACE は判定材料の不正であり、未完了でも完了でもあるという結論を出さない。collection_errorも後者。異常イベントを有効に記録したabort/errorは前者とは別のABNORMALであり、正常なR/Uに採用しない。

conditionUの独立証明には、対象ビルド対応の内部計測がcommit/abort/異常終了と競合する停止境界を識別し、同じIDで正常未終端区間を挟む、などが必要。現在はその手段を確立していない。「complete listenerが走れない」はこの証明に該当しない。任意の`unfinished:true`や自己申告proofを受け入れない。

## 結果表現

- Worker時点のみ確認：workerObservation PASS / stopCondition UNKNOWN。upgrade成功でも実験成立UNKNOWN。
- 対応main complete受信が停止前で停止列も成立：conditionR PASS / conditionU FAIL。同じ証拠で相反する二条件を正しく分離する。元T7のupgrade失敗とは別。
- 観測欠損：UNKNOWN、収集違反：validTrace FAIL・R/U UNKNOWN、abort/error：R/U FAILかつ異常。正常な未完了として採用しない。
- 仮に十分な独立証明が確立した将来条件：stopCondition PASS / upgrade FAIL（timeout）を同時記録する。研究目的の成立とupgrade成否を合成しない。
- 正常未終端とfinished状態の証明をモデルで与える疑似oracleは、`synthetic-oracle-v1` 明示入力だけに限定。出力には必ず `syntheticOnly:true, realExperiment:NOT_RUN` を付ける。実ログparserやrunnerへ接続しない。

## 疑似判定の保守性

`judgeTrace()` は保存された配列だけを処理する。sourceMsは判定に使わない。公開入力でconditionU PASSを返す経路はない。モデルのoracle証拠も同一identity、stopId、sendId、begin/endを要求する。異source配列順への依存を除くため、begin.beforeSendIdとend.afterReturnIdを明示的な**疑似証明の仮定**として照合し、同一oracle内begin→endの連番を検査する。異常やterminal矛盾があれば昇格しない。実ブラウザの実現可能性・内部abort不在・物理解放の証明ではない。

R/Uの述語は観測の分類であり実行許可ではない。全出力は `executionAuthorization:NOT_GRANTED`、`startCondition:BLOCKED`、`realExperiment:NOT_RUN`。将来のupgrade観測は、実行承認・環境/ゲート/保存等の前提を別に満たしたうえで、RではconditionR、UではconditionUを選ぶ。RにUのFAILを流用しない。今回の判定器はその実行制御を行わず、記録されたupgrade結果だけを独立分類する。
