# 静的照合・負対照の結果

自己照合の記録。独立レビューはPR本文の固定HEAD記録と分離する。製品・既存judge/schema/Collector/runner・旧検査器・旧recompute scriptは実行していない。

|対象|結果|限界|
|---|---|---|
|receipt250件|MATCH247、UNKNOWN3、FAIL0、CLI終了0|UNKNOWNはbuilder候補と固定版2pathの404。終了0は全証拠取得成功ではない|
|G独立pin|#423由来のhash/size/run/artifactと一致|他receiptの自己記載hash一致は独立origin認証でない|
|fixture9件|全literal期待値と一致、CLI終了0|合成反例、実Worker実験の成功件数でない|
|不正JSON manifest|UNKNOWN、CLI終了2|解析不能な外部資料を肯定しない|
|保存index|D/E19、F20、G25のfile/gzip/raw hash全一致、各CLI終了0|recorder全観測の完全性とは別|
|元結果ZIPとGit保存raw|D/E・F・Gのresults.jsonがbyte一致|派生analysisをnative直接観測にしない|
|結果source参照|T7四結果+DE/F/Gの7JSON、66参照が記録checkout固定Git objectと一致|PR HEADと実merge checkoutを区別。native binaryへのjoinでない|
|source索引|#403 CAPTURED25件のSHA-256/blob一致|build全体ではない|
|local source manifest|372件+11件のblob/行数不一致0|source-only。new-source-manifestの404を成功件数にしない|
|現在archive|65memberのCRC/hash/ELF静的解析、出力とarchive-inspection一致|現在bytes。依存名は実ロードlibrary実体でない|
|pw_run.sh|現在ZIPと固定Playwright source byte一致|当時cache/条件の一致は未証明|
|観測prefix|D152/E334/F346/G346。内部欠番/重複0、overflow=false|flush/high-waterなし、未受信tailなしとは言えない|
|local有限探索|指定6root対象884fileをhash、ELF/native候補名0|全worktree/外部storage/ZIP内部の全探索ではない|

## 意図的に壊した資料と独立期待値

subjectはfixtures/subjects.json、期待値はexpectations.jsonの別file。3bytesのabc、literal SHA-256 ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad、synthetic-run-Aを使う。subjectから期待値を再生成しない。

|対照|入力|期待|
|---|---|---|
|valid|正しいpayload/size/hash/run|MATCH|
|missing-file|存在しないfile参照|UNKNOWN、必須receipt欠落もUNKNOWN|
|wrong-run|hash一致のままsynthetic-run-Bへ変更|FAIL（独立identity pin不一致）|
|wrong-digest|digestを0へ変更|FAIL|
|duplicate|同receiptを二重登録|MATCH、FAIL|
|invalid-manifest|receiptsを文字列へ破壊|FAIL（shape）|
|external-unavailable|取得exitCode=1|UNKNOWN|
|outside-root|../outside.txt参照|FAIL、必須receipt欠落UNKNOWN。root外を読まない|
|missing-receipt|空list|UNKNOWN|

## 静的な偽肯定の反例

- 同URLでも旧digest receiptがなければ「現在archive=旧archive」はUNKNOWN。
- bundled/checkout条件不成立で汎用MiniBrowserのみある机上入力では、WPE探索設定だけから実WPEを認定できない。
- 372 sourceが一致しても生成物/config/link/ELFが欠ければB3〜B7はUNKNOWN。
- 親ELF digestがあってもchild/module/Worker/VM世代joinがなければB8はUNKNOWN。
- 1..N連番prefixでも最終high-waterがN+Kか不明ならtailはUNKNOWN。
- terminate戻りだけでnative thread退出/VM entry終端がなければJ2はUNKNOWN。
- 別process/Worker世代でowner/tx1を再利用する入力ではsame-native joinはUNKNOWN。別世代が明示されればその同一性主張はFAIL。

これらは今回実証拠の不一致を観測したという意味ではない。局所MATCHや文書整合をJ2/U-C/条件U/実行承認のPASSへ移送しない。

実CLI stdoutは一時rootのcheck-*.json、checks-all.jsonに保存。再現コマンドはREADMEのF節。[temporary-inventory.json](temporary-inventory.json)に取得・一時fileのsize/hash・削除方針を記録する。checkerは入力を書かず取得fileを実行しない。

J2=UNKNOWN / U-C=UNKNOWN / conditionU=NOT_RUN / realExperiment=NOT_RUN / executionAuthorization=NOT_GRANTED / startCondition=BLOCKED / productionWorker=HOLD。

2026年11月5日 JST
