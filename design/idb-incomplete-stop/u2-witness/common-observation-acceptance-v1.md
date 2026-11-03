# Stage U-2A 共通観測契約 v1 の静的受入・負の対照

**Issue #409。これは実測済み試験ではなく、先に固定する期待値（pre-registered oracle）。** 親[共通観測契約v1](common-observation-contract-v1.md)と、#401のR/U観測契約を優先する。変更時には独立レビューを受ける。現在の実測は0、HOLDを維持。

## 用語と出力の区別
- 「J/W/Tの肯定的な観測」は、その個別イベントを確定的な発生源で観測できることだけを意味する。**文書に登場するだけの状態やプロセスの戻り値は観測とは呼ばない**。
- `UNKNOWN`：必要な独立証拠が足りず判断できない。
- `NOT_APPLICABLE`：研究命題の対象外。条件が不成立と分かっている場合の`FAIL`と区別する。
- `FAIL`：十分な証拠で条件不成立が確定。単なるログ欠落はFAILでなくUNKNOWN。
- `INCOMPLETE`：期待される記録に欠測がある資料状態。整合性`CONSISTENT`も実証`PASS`ではない。
- `U-C`の研究用観測分類は、既存Collectorの`conditionU`とは別フィールドの**未実装構想**。現在は一律`UNKNOWN/NOT_RUN`。下表の「期待」は将来の実装に対する判断基準であり、新しい出力schemaを宣言しない。

## J/W/T/U-Cの静的負の対照

|ID|仮定する入力・観測|許容される結論（将来の判定器用の期待値）|拒否する誤推論|
|---|---|---|---|
|A01|main `terminate_called/returned`のみ|J2 UNKNOWN、W2/W3 UNKNOWN、T3/T4 UNKNOWN、U-C UNKNOWN|terminate戻り＝JS実停止／Worker終了|
|A02|`scheduleExecutionTermination()`呼出しを観測|J1のみ。J2 UNKNOWN|終了要求を実行停止ackに昇格|
|A03|Worker runloop queue killだけ観測|W2/W3 UNKNOWN、J2 UNKNOWN|queue killをthread退出に昇格|
|A04|`prepareForDestruction()`開始|W1観測候補。W2/W3 UNKNOWN。対象Tは別|cleanup開始＝context破棄／正常tx維持|
|A05|対象WorkerGlobalScopeの実破棄をnative観測|W2のみ。W3 UNKNOWN、T3/T4 UNKNOWN|context破棄＝OS thread退出／DB解放|
|A06|対象incarnationのthread exitをnative観測|W3のみ。T3/T4 UNKNOWN、physicalRelease UNKNOWN|thread退出＝DB transaction Finished／物理解放|
|A07|同一Client WebCore txが`Active`、cleanupで`IDBTransaction::stop()`|対象TはAbortingへ移行するコード経路。正常未終端の後段観測は**禁止**|server map在籍で「正常未終端」PASS|
|A08|同一Client WebCore txが`Inactive`、cleanupで`IDBTransaction::stop()`|A07と同様（先行Finishingがなければabort経路）|InactiveをFinishedと誤読／abort開始を無視|
|A09|Client T1=`Committing`のみ見える|Client Committing観測候補。backend result / U-CはUNKNOWN|client Committing＝backend commit未完了|
|A10|Client Committing、同native txのbackend `COMMIT_RESULT`がcutより前に確定|backend pending at cutは**FAIL**。U-C全体成立禁止|遅延通知をbackend未完了と誤認|
|A11|Client Committing、同native txのbackend `COMMIT_INTENT`だけがある|backend結果UNKNOWN、U-C UNKNOWN|commit intent＋result欠落でpending確定|
|A12|Client Committing、backend結果の記録元が停止/flush失敗|backend結果UNKNOWN、資料INCOMPLETE|結果未受信＝commit未発生|
|A13|Client `Aborting`、またはstop cutより前のabort intent/server lossが確定|正常なU-C候補には採用不可。異常/abort理由を保持|「Finishedでない」ので正常とする|
|A14|Client `Finished`が正しいnative IDで独立観測|T3観測。ただしT4、JS complete dispatch、W3はUNKNOWN|Client Finishedから成功commit/通知配送を推定|
|A15|backend commit resultが確定、Client T3未観測|T4観測。T3 / complete event deliveryはUNKNOWN|server終端からclientイベントを推定|
|A16|readonly SQLite `inProgress=false`、client/native論理IDB状態不明|論理IDB tx状態 UNKNOWN|SQL transaction状態をT3/T4として採用|
|A17|DB`m_inProgressTransactions`内に同IDが残るが、clientが`Aborting`|map在籍だけで正常U/UCとすることは禁止|map在籍＝正常未終端|
|A18|DB mapからIDが消えたがbacking-store commit結果はまだ未観測|T4 UNKNOWN|map不在＝正常commit完了|
|A19|完全一致のeventIdでも別run/worker/connection/native process incarnation|資料INCONSISTENTまたはidentity未結合として棄却、U-C UNKNOWN|ラベル一致・数値一致だけで結合|
|A20|同じ確定edgeを保ったまま配列順とsourceMsを逆転|R/U/UCの意味上の分類不変|異source時計・配列順でstop前後を確定|
|A21|同一producerの連番欠落、drop/overflow/flush未確認|資料INCOMPLETE、J2/W2/T4/UCはUNKNOWN|欠測をイベント非発生と扱う|
|A22|source別連番が全て連続だが、stop cutまでの全経路coverage未証明|資料の形式がCONSISTENTでもU-C UNKNOWN|連番の連続＝terminal不在証明|
|A23|Rの完全complete→send→receiveがmain stop要求より前|親契約条件が成立すればR PASS/U FAIL、U-Cは別途UNKNOWN|R PASSやU FAILからUC結果を自動生成|
|A24|Committingと停止境界の両ログがあり、明示したcross-source edgeがない|前後順UNKNOWN、U-C UNKNOWN|異producerの到着順や同一timestampで因果確定|
|A25|W2でcontext破棄が分かるが、J2の前後と停止原因が不明|J2の主張はUNKNOWN、W2だけ保持|context破棄点を事後に「cleanup前J2」と呼ぶ|
|A26|計測器が新しいDB lockを取得してstop/commitを直列化|元の競合との同一性UNKNOWN、要設計再レビュー|観測によって作った順序を元実験の証拠とする|
|A27|H1〜H3 UNKNOWN/H4 PARTIALのまま研究文書が全項目整合|条件U/実験NOT_RUN、NOT_GRANTED/BLOCKED/HOLD|文書CONSISTENTで実験承認や本番採用を解禁|
|A28|Committingとbackend result pendingが将来独立立証されたと仮定|U-C研究の成立候補としてのみ分類、**既存U PASSには昇格不可**。さらに実験承認は別|U-C→U PASS／Worker実停止証明の自動転用|

## P1 / P2 実装前のゲート
**P1（J2がcleanup前）**
1. 固定版のJavaScript実行終了/再開不能の**具体的なnative観測点**が見つからなければP1=BLOCKED。
2. 対象Worker incarnationとJ2、W1、該当Client txのT0/T1/T2との結合edgeを提示できなければUNKNOWN。
3. J2がW1より前に確定する境界だとしても、DB状態と異producer順序が未結合ならUはUNKNOWN。
4. 既存公開APIと時刻差だけでの確認案は拒否。実行実験の許可はこの文書にない。

**P2（U-Cのみ）**
1. 同一native txのClient T1（Committing）、Server commit intent、backing-storeのcommit resultを分離する。T1だけではbackend pendingはUNKNOWN。
2. SERVER_COMMIT_RESULTがcut前ならbackend pendingはFAIL。結果producerに未観測区間があればUNKNOWN。
3. Client Aborting / server loss / suspension / force closeがあれば正常commit継続を無条件に認めない。
4. U-Cは独立した研究命題。U判定器、既存Collector、既存result.schemaに同名の新規状態を追加しない。

## 正本と固定方法
本ファイルの固定は**未マージDraftでのソース正本化**であり、独立レビュー完了後の受入PASSではない。将来の子Issue・別PRは本ファイルと共通契約v1の**固定HEADとGit blob**を参照し、後から期待値を緩める場合は新しい明示版・差分・独立レビューを要する。A01〜A28は机上の期待値であり「28件の実行試験成功」ではない。実験0、runner/workflow変更0、CI NOT_RUN（run未取得ならその限り）。
