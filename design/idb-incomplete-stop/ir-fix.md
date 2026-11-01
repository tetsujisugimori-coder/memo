# P2-IR1 / P3-IR2 局所補訂

2026-11-02 JST。**総合PARTIAL／修正自己検証PASS／研究文書の受入は独立再レビュー待ち。** [独立レビュー全文](https://github.com/tetsujisugimori-coder/memo/pull/401#issuecomment-6563555503)を確認した。対象HEAD `8f7733753537e1a336de5998348bc38c2941c4a3` / tree `0d9f51f30f83e69821321439102043b55eebc20c` と開始時local・remote・PRが一致。追随差分なし。baseは `investigate/idb-time-delay-only` / `9872ee7aee773b017915364669bc31b98cc22e83`、変更しない。

## P2-IR1：採用する因果証拠

`judgeTrace()` はWorker `transaction_complete`、同Worker `complete_sent.completeId`、main `complete_received.sendId`を区別する。全identityと参照・発生元・連番を検査し、mainの受信sourceSeqがstop_requestedのsourceSeqより小さい場合だけ停止前受信を採用する。既存send/receive経路は保持する。異sourceの配列位置・時計値を因果証拠にしない。

Worker単独complete、送信だけ、停止後の受信はUについてUNKNOWN。公開イベントから内部未完了PASSへの経路は追加していない。記録不正はvalidTrace FAIL / recordError / R・U UNKNOWN（INVALID_TRACE）、有効な停止前完了記録はvalidTrace PASS / U FAIL（COMPLETED_BEFORE_STOP）。abort/errorは別のABNORMAL。

共通順序helperも同一sourceSeqだけに限定した。Worker要求受理→send、main受信→停止→terminate戻り、ゲート前後、upgrade、cleanupで異source配列順を使用しない。モデル専用oracleはbeforeSendId/afterReturnIdの明示仮定へ置換した。これは内部観測機構ではなく、モデルでしか利用できない証明仮定である。

## P3-IR2：RとUの分離

|記録|validTrace|conditionR|conditionU（stopConditionの意味）|
|---|---|---|---|
|対応complete受信が停止前、対象の要求/send/receive/stop/terminate列が成立|PASS|PASS|FAIL・COMPLETED_BEFORE_STOP|
|対応complete受信が停止後|PASS|FAIL・RECEIVED_AFTER_STOP|UNKNOWN|
|Worker completeのみ、停止との因果edgeなし|PASS|UNKNOWN|UNKNOWN|
|別identity、不正参照・sourceSeq等|FAIL|UNKNOWN・INVALID_TRACE|UNKNOWN・INVALID_TRACE|
|abort/errorあり|PASS（記録自体は有効の場合）|FAIL・ABNORMAL|FAIL・ABNORMAL|

Rは完了後停止観測、Uは正常未終端停止観測という別述語。将来upgradeの前提は、共通の実行承認・環境/ゲート操作・予算/保存等と**選択条件**のPASS。RにU用FAILを適用しない。Uの独立witness不足ではU NOT_RUN。RのPASSも試行全体の安全性・実行許可・接続閉鎖/物理解放の証明にしない。純粋モデルの出力は常にrealExperiment NOT_RUN / executionAuthorization NOT_GRANTED / startCondition BLOCKED。

## RED→GREENと回帰の内訳

入力は `records/ir-fix/inputs/`、検証出力は `records/ir-fix/outputs/`。旧 `records/tests.log` 等は上書きしない。旧判定器と旧試験ソースはレビュー対象Git blobから取得した。`merge-orders.json` はevent定義1組と有限4結合順で、identity・eventId・sourceSeq・参照を再採番しない。

REDの原始TAPはassertion出力の末尾空白も削らず、`outputs/red-merge-order.tap.gz` に可逆圧縮して保存した。展開byteが取得した原始出力と一致することを確認。その他の出力は独立したTAP/JSONで保存する。

|実行|試験数|結果|Node終了コード|
|---|---:|---|---:|
|修正前の既存試験|22|22 PASS|0|
|旧判定器で新反例（RED）|1（4結合順）|1 FAIL。出力UはFAIL / FAIL / UNKNOWN / UNKNOWN|1（意図した再現）|
|修正後の同じ反例（GREEN）|1（同じ入力byte）|1 PASS。全結合順UNKNOWN、理由を含む全出力一致|0|
|修正後の既存試験枠|22|22 PASS。期待値維持21、意図した期待値変更1|0|
|追加の受信・R/U等|13|13 PASS|0|

修正後合計 **36 PASS / 0 FAIL**（回帰22＋追加14）、skip/cancel/todoは0。新規反例1＋追加条件13を追加試験として数える。各suiteは明示した有限入力だけで実行し、結果に応じた反復なし。Node版・日時・終了コード・source/fixture SHAは出力JSONとmanifestに記録する。

上表のsuite別検証後、oracleの注記を「reviewed」から「model」に訂正し、独立承認を暗示しないようにした。最終ソース版でも同じ36試験をまとめて確認し36 PASS・終了コード0。初回出力は保持し、追加の最終確認を `outputs/final-tests.tap` / `final-tests.json`（検証時source SHA付き）へ保存した。試験種類は36のままであり、ブラウザ試行ではない。

旧試験3件目はWorker completeをmain受信なしで停止前とみなしていたため、期待値をFAIL→UNKNOWNへ変更した。成功させるための緩和ではなく、独立レビューの反例と契約に合わせた訂正。他21件の期待値を維持。うちoracle共通fixture利用2件は、暗黙の結合位置に替えてbeforeSendId/afterReturnIdを明示した（期待値変更なし）。

```text
node --test --test-reporter=tap design/idb-incomplete-stop/merge-order.test.cjs
node --test --test-reporter=tap design/idb-incomplete-stop/judge.test.cjs
node --test --test-reporter=tap design/idb-incomplete-stop/conditions.test.cjs
```

旧版REDの再計算は `STATIC_JUDGE_BASELINE=1` をそのNodeプロセスにだけ設定して最初のコマンドを実行する。旧純粋判定器を読むだけで、ブラウザ・Worker・IndexedDBは起動しない。保存されたRED/GREEN結果と入力は個別にhash照合できる。試験成功は実ブラウザ成立や物理解放の証明ではない。

## 保全・提出・残件

変更範囲は本設計ディレクトリだけ。製品、旧runner、workflow、旧実験証拠、既存の未コミット/未追跡作業を変更しない。旧manifestは `inputs/SHA256SUMS-before.txt` に保存し、旧Git版の検証に使用できる。現行 `records/SHA256SUMS` はmanifest自身以外の全成果物をGit blob byte（テキストLF）で更新する。旧保存ログ・旧JSONは保持。

workflowのbranch/path条件を再確認した。base・branchを変えず、commitは `[skip ci]`、手動dispatchなし。CI NOT_RUN。新規ブラウザ実験0、旧実験再実行0、製品変更0、runner/workflow追加0。正式Submit review、Draft解除、マージ、auto-merge、branch削除、main更新なし。

対象WebKitとupstreamの対応、実停止境界までの内部正常未終端witness、完全schema、ゲート終了割込みと内部abort契約、外側watchdog・予算ledgerは未証明/未実装。H1/H2/H3 UNKNOWN、H4 PARTIAL、本番Worker HOLD、将来実験未承認、開始条件BLOCKED。独立再レビューでは因果edge、記録不正と条件不成立、R/U述語と計画の対応、期待値変更・証拠保全を確認していただく。自己検証を独立レビュー済みとは扱わない。
