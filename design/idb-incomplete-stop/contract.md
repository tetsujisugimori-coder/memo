# 観測・判定契約 v1

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

同一sourceの連番を検査。send→receiveはID参照で結び、mainのreceive→stop→call→returnはmain連番で示す。受信ログの配列順は観測順であって、異なるsourceの発生時刻順ではない。後着Worker completeのsourceSeqがsendより後でも、停止との前後は受信や別の因果edgeがない限りUNKNOWN。任意の時刻差・欠測から因果edgeを生成しない。

## 判定軸

|軸|PASSに必要なもの|FAIL／UNKNOWN|
|---|---|---|
|workerObservation|同一txのreadonly要求追加受理イベント。既存request successだけでは不可|要求受理なしUNKNOWN。不正identityはvalidTrace FAIL、異常はstopCondition FAIL。これはAPI呼出時だけの正の証拠|
|callbackHold|同一epoch/nonceのHELD通知→main受信→claim成功→terminate呼出前後のCLAIMED確認、単調遷移契約|期限切れ/退出FAIL。nonce不一致・情報欠落UNKNOWN。これ単独でstopCondition PASSにしない|
|stopCondition|Worker観測＋**停止境界まで正常未終端を維持した独立の証明**＋完全なID/因果関係＋abort/errorなし|公開API/共有markerだけならUNKNOWN。停止前complete受信ならFAIL（条件不成立）。abort/errorはFAIL（異常）。欠測/後着terminalはUNKNOWN|
|upgrade|対応openに対するsuccess、timeout/errorなし|timeout/error FAIL、openあり終端なしUNKNOWN、未要求NOT_RUN。遅いsuccessがあってもtimeoutを消さない|
|cleanup|保存済み証拠の後、許可されたdelete1回でsuccess|期限UNKNOWN、error FAIL、未実行NOT_RUN。要求再発行なし|
|connectionClosed / physicalRelease|本設計で利用できる独立証拠なし|常にUNKNOWN。terminate戻り、upgrade/cleanup成功から昇格しない|

stopConditionの独立証明には、対象ビルド対応の内部計測がcommit/abort/異常終了と競合する停止境界を識別し、同じIDで正常未終端区間を挟む、などが必要。現在はその手段を確立していない。「complete listenerが走れない」はこの証明に該当しない。任意の`unfinished:true`や自己申告proofを受け入れない。

## 結果表現

- Worker時点のみ確認：workerObservation PASS / stopCondition UNKNOWN。upgrade成功でも実験成立UNKNOWN。
- 停止前complete確認：workerObservation PASSでもstopCondition FAIL（条件不成立）。元T7のupgrade失敗とは別。
- 観測欠損：UNKNOWN、収集違反（古いID/重複・順序不整合/上限超過）：FAIL、abort/error：FAILかつ異常。正常な未完了として採用しない。
- 仮に十分な独立証明が確立した将来条件：stopCondition PASS / upgrade FAIL（timeout）を同時記録する。研究目的の成立とupgrade成否を合成しない。
- 正常未終端とfinished状態の証明をモデルで与える疑似oracleは、`synthetic-oracle-v1` 明示入力だけに限定。出力には必ず `syntheticOnly:true, realExperiment:NOT_RUN` を付ける。実ログparserやrunnerへ接続しない。

## 疑似判定の保守性

`judgeTrace()` は保存された配列だけを処理する。sourceMsは判定に使わない。公開入力でstopCondition PASSを返す経路はない。モデルのoracle証拠も同一identity、stopId、sendId、begin/end、main停止列を要求し、異常やterminal矛盾があれば拒否する。実ブラウザの実現可能性・内部abort不在・物理解放の証明ではない。
