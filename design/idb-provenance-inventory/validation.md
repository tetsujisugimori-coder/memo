# 静的チェッカー3件の局所修正契約

修正基準HEAD: `544aebbbe57b3a4380e8611af0a5cfbf4ce98328`。以下の契約を実装修正より先に記録する。旧証拠・取得台帳・解析結果の内容を変更せず、MATCHの証明範囲を拡大しない。

## 判定・終了コード（今回の契約）

|入口・条件|判定と理由|終了コード|
|---|---|---|
|saved-index: 必須files欠落 / 空list|UNKNOWN / index-files-missing または index-files-empty|2（不完全）|
|saved-index: decoded indexがobjectでない、filesがlistでない、recordの型・値の形式不正|FAIL / index-shape、index-files-shape、index-record-shape等|1|
|saved-index: recordのfile/digest等の必須情報欠落、実file欠落、独立profile未指定・必須集合の一部欠落|UNKNOWN / index-record-incomplete、unavailable-bytes、index-profile-required、missing-index-file等|2|
|saved-index: 独立profileと矛盾、重複、不正path、実bytes/hash矛盾|FAIL / pinned-index-*、duplicate-or-outside-root、invalid-path、digest-or-size等|1（UNKNOWNが併存してもFAIL優先）|
|saved-index: 独立profileの必須集合と各digestが一致し、全file/raw照合成立|各record MATCH|0（限定された静的照合のみ）|
|receipts: 取得失敗、保存bytesのhash/size一致|UNKNOWN。acquisition=FAILED、contentIntegrity=MATCH|従来どおりbatch終了0。取得対象の真正性MATCHではない|
|receipts: 取得失敗でも保存bytesに明示矛盾|FAIL。acquisition=FAILED、contentIntegrity=FAIL|1|
|receipts: 保存bytes取得不能|UNKNOWN / unavailable-bytes等|従来どおりbatch終了0。欠落を肯定しない|
|receipts: 同一の解決済みpathの別表記 / pinned identity不一致 / root外path|FAIL|1|
|controls: literal期待値との不一致|ok=false|1。全期待一致は0（負対照を実験PASSにしない）|
|外部fileの読取り・JSON構文解析不能|UNKNOWN、errorを出力|既存の2を維持。decoded schema違反のFAILとは分離|

saved-indexの最小schemaは非空`files` listと、その各objectの非空相対`file`、小文字hex64桁の`sha256`または`gzipSha256`。`rawSha256`がある場合はgzipを展開せずメモリで復号してhash照合し、`rawBytes`がある場合は非負整数かつrawSha256必須。複数のcompressed digest主張がある場合は一致必須。未記載の必須情報はUNKNOWN、存在するが型・形式不正の値はFAILとする。

独立profileは`expectations.json`へ固定Git版`592ccb63478d0a23312237d1f736a419c096f5f8`のD/E・F・G indexの必須file集合・digestを保存する。出自のGit blob・index SHA-256も記録する。照合中の入力indexの件数や自己申告だけでは完全性を証明しない。既存配置では親の実験directory名からprofileを選び、移設時はCLIの`--profile`で明示する。未知profileの非空indexはfile単体を照合しても全体UNKNOWNとする。

receiptと期待値は同じpath解決を使い、解決済み絶対pathをhostのcase規則で正規化して重複・pin・必須receipt欠落を照合する。root内symlink aliasも同じキーとし、root外への解決は読取り前に拒否する。portableに解釈を固定するためbackslash、drive/UNC/絶対path、`..`、Windowsのdevice/ADS・末尾dot/spaceを拒否する。`./`と内側の重複slashは同じ相対fileとして扱う。静止したfilesystemを対象とし、同時にsymlinkを変更する攻撃への保証は追加しない。

今回の検証は原資料を再取得しない。原本が失われていればNOT_TESTED。新規tracked fileは追加せず、合成入力・CLI stdout/exit code・hashは別の今回用一時directoryへ保存し、既存一時証拠を上書きしない。

## 修正前の既存記録（歴史的結果、今回の再実測と分離）

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
