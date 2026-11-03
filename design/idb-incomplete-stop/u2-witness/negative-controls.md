# U-2 反例・静的受入行列

**本書は実ブラウザ実験結果ではない。** 既存契約が許さない推論を見つけるための**静的期待値**である。実行回数0、実witness0。実装した試験器・未確立の内部ログを実行したかのように報告しない。

## 共通の判定前提
- `materialStatus` は`INVALID_SCHEMA > INCONSISTENT > INCOMPLETE > CONSISTENT`。矛盾と欠落が併存するとき、statusはINCONSISTENTだが**両理由を保存**。ここでの分類は将来の観測資料に対する設計案で、現行Collector schemaの受理入力を拡張するものではない。
- `U`の成功候補に必要なG1〜G4証拠と独立したstop cutが**いずれか未成立ならUNKNOWN**。Rは親#401契約で別判定。実行状態`conditionU=NOT_RUN`と観測評価の`U UNKNOWN/FAIL`は別の軸。
- `sourceMs`、異sourceの結合配列位置、recorderへの到着順は**あらゆるケースで因果edgeとしない**。
- どの入力でも`realExperiment=NOT_RUN`、`executionAuthorization=NOT_GRANTED`、`startCondition=BLOCKED`、`productionWorker=HOLD`、`H1..H3=UNKNOWN/H4=PARTIAL`は不変。

|ID|合成反例／対照|独立に期待する取り扱い|誤判定として拒否すること|
|---|---|---|---|
|N01|Worker`transaction_complete`のみ、main側未受信|Worker観測あり、stopとの順序UNKNOWN／U UNKNOWN|completeのログ位置からstop前完了を作る|
|N02|完全ID付き`complete→complete_sent→complete_received→main stop`の受信順が正しい|親#401の条件が他にも成立すればR PASS／U FAIL (COMPLETED_BEFORE_STOP)|Rの成立をUの成立に転用|
|N03|N02の配列を逆転、sourceSeqと参照edgeは同じ|N02と同じ結果|配列順でFAIL/PASSを変える|
|N04|complete受信がstop要求**後**。Worker completeの時刻は不明|R FAIL (RECEIVED_AFTER_STOP)／U UNKNOWN（内部stop境界の先後未確定）|Worker completeはstop後に起きたと断定|
|N05|別worker/tx/processの`completeId`を偶然同じ文字列で参照|identity不整合／矛盾、R/U採用禁止|短いID・名前一致で別txを結合|
|N06|同native IDがprocess再起動後に再利用|processIncarnation違いとして別transaction、再結合禁止|resource番号だけでID同一とする|
|N07|G1で表示WebKit版だけ一致、browser binary/hashは不明|build対応UNKNOWN、U UNKNOWN|表示版一致をverified binaryとする|
|N08|内部`COMMIT_RESULT`が実stop cutの前に確定|U FAIL／正常未終端PASS禁止（完全な証拠がある場合）|完了通知欠落を理由にU PASS|
|N09|内部`ABORT_INTENT`またはserver-lossがstop前に確定|正常U PASS禁止、異常/abort判定を保持|正常未終端として扱う|
|N10|正常BEGINだけあり、後続commit/abort/abnormalログ不在。high-water/flush未確定|不足／U UNKNOWN|terminal不在を「未終端」と断定|
|N11|DB側commit観測はあるがreadonly SQL transactionの記録だけ|LOGICAL_IDBの終端証拠はUNKNOWN|SQLite mapやSQL inProgressだけで論理IDB終端を断定|
|N12|mainの`terminate_called`／`terminate_returned`だけある|実停止境界UNKNOWN／U UNKNOWN|terminate戻りをthread/context停止のackとする|
|N13|native producer連番欠落、overflow/dropフラグが存在|INCOMPLETE（矛盾もあればINCONSISTENT）、U UNKNOWN、理由を保存|欠けたイベントは起きていないとみなす|
|N14|flush要求はあるがack/永続化hashなし、末尾tailが未検証|recorder completeness UNKNOWN／U UNKNOWN|書込み呼出しをdurable flushとする|
|N15|source間時計を大幅にずらすが確定edgeは同じ|因果関係の採否は不変|`sourceMs`差やwallclockを順序に採用|
|N16|source別producerSeqは完全、しかしstopとDB状態のcross-source edgeなし|記録整合でもU UNKNOWN|CONSISTENTをU PASSにする|
|N17|stop前BEGIN、stop後ABORT_RESULTが見えるがabort intentの位置もrecorder完全性も不明|正常未終端の独立証明はUNKNOWN|stop後abortだけでstop時正常と証明|
|N18|ログ到達順が逆転、native ID/edge/high-waterは同じ|観測分類の意味は変わらない|到着順でstop前後を決める|
|N19|合成モデルに`unfinished:true`／`proof:yes`だけ追加|証拠として採用禁止、未対応fieldはreject|自己申告でU PASSに昇格|
|N20|log producer停止、process-lossを明示。以降のterminalの有無は不明|保存済みprefixだけ採用、tail欠測・U UNKNOWN|部分証拠を完全記録とみなす|
|N21|同一IDのcommit結果とabort結果が相反する形で存在|INCONSISTENT、両原始記録を残しU UNKNOWN|最初/最後だけ選んで成功|
|N22|commit/abort矛盾とrecorder tail欠測が同時発生|INCONSISTENTを優先し両理由保存、U UNKNOWN|矛盾に隠れて欠測を消す|
|N23|異常がないように見えるが異常経路の一部がinstrumentation未対応|異常不在を確定できず、U UNKNOWN|未instrumentedな異常を自動否定|
|N24|DB状態を固定するため計測器が新lockを取得し、stop前後順序を人工的に直列化|計測摂動のため元実験への一般化不可／設計再レビュー|計測器が作った順序を元条件の証明に採用|

## 必須のメタ反例
- **版入替**：一致する文字列を含む異なる配布バイナリを与えた場合、G1をUNKNOWN/FAILに保つ。
- **元ログの改ざん**：入力本文とSHA-256を同時に変更した場合、自己申告hashだけでは真正性が得られない。独立の取得元・署名なしでは出所UNKNOWN。
- **ログ配送分断**：発生記録、送信記録、受信記録を3つの独立streamに分離し、無根拠にひとつの時系列へmergeしない。
- **停止後観測のみ**：後のupgrade success、cleanup success、close/terminate戻りだけでは停止時の正常未終端や物理解放を確定できない。
- **HOLD不変**：どのケースで書類が整合しても、本実験を起動しない限り`NOT_RUN`、許可がなければ`BLOCKED`のまま。

## 文書の静的受入基準
1. 各N01〜N24の期待値が`witness-contract.md`の規則と矛盾しない。反例でU PASSを出す項目が1つもない。
2. negative controlが**何を否定したのか**が分かり、failure・unknown・incomplete・inconsistentを混同していない。
3. 同じidentityを保証しないリンクは必ず不採用とする。過去のP2-IR1の配列順誤分類を繰り返さない。
4. 反例の基準を実装結果から作り直さない。将来実装時にこの文書をpre-registered oracleとして固定し、変更時は理由・版・diffを残す。
5. 机上のPASSは**実証PASSでも独立ブラウザ実験PASSでもない**。

**現時点：表の作成のみ。動的実行 NOT_RUN／条件U実験 NOT_RUN。**
