# 資料整合性契約 v1

この契約をCLI実装前に固定する。対象は提出資料の形式と参照整合のみ。
schemaVersion=1はこのJSON形式の版であり、証拠の実装版・WebKit版ではない。
参照ソースのrevisionと配布物のbrowserRevisionは別の識別子である。

## 入力

`node check.cjs --schema schema.json --plan inputs/assessment.json --source ID FILE ...`

schema、plan、各sourceを呼出者が個別に明示する。plan内URLや参照からファイルを
自動取得・探索しない。ネットワーク、環境変数入力、実行コードimport、dispatch、
動的評価、自動起動、入力書換えを持たない。UTF-8 JSON、通常ファイルのみ。
各ファイル最大8MiB、source最大64、配列最大128、schema/JSON深さ32まで。
ファイルパスはCLI引数だけで指定する。sourceの内容は文字列としてのみ読む。

`schema.json` が必須項目・型・列挙値・余分なキー禁止を定義する。
CLIのschemaは同梱定義と構造一致を要求し、緩めたschemaを採用しない。
planId、R/U、target、sources、versionMapping、transactionId、candidates、
unknownsが必須。空配列は形式上許すが必要資料が空なら資料不足となる。
revisionは40桁Git SHA、sha256は64桁小文字hex。文字列UNKNOWNはrevision欄では
許さず、対象上流版未特定時はtarget.upstreamRevisionをnullとする。

## 状態と出力

|documentStatus|終了コード|意味|
|---|---:|---|
|INVALID_SCHEMA|2|引数・JSON・schema・型・必須キー・未知キー違反。schema/plan読取不能もここ|
|INCONSISTENT|1|資料間矛盾、重複ID、不正参照、hash/行範囲/target/revision/transaction不一致|
|INCOMPLETE|1|必要source取得不能・未指定、根拠なし、UNKNOWN/UNAVAILABLE/PARTIAL/UNMAPPED、必要区別なし|
|CONSISTENT|0|上記検査の範囲で提出資料が整合。記載事実の真実性・証明力は未検証|

schemaが有効なら不足と矛盾は双方列挙する。優先順位はINVALID_SCHEMA >
INCONSISTENT > INCOMPLETE > CONSISTENT。reasonsはcode/path順で正規化する。
入力ファイルhashと正規化した対象/候補をJSON stdoutに出す。stack/秘密情報は出さない。
hash一致は供給されたファイルbytesの同一性だけ。URL内容や意味を認証しない。
参照の行番号はLFで分割した1起点、末尾LFを仮の追加行に数えない。

versionMapping.statusはVERIFIED_METADATA/PARTIAL/UNKNOWN/UNMAPPED。
VERIFIED_METADATAでも配布バイナリ同一性は主張しない。
候補statusはCANDIDATE/INSUFFICIENT/UNKNOWN、accessはPUBLIC_API/
EXISTING_DIAGNOSTIC/CUSTOM_BUILD/UNKNOWN。
identityMappingと5境界（normalUnterminated/actualWorkerStop/commit/abort/abnormal）の
statusはDOCUMENTED/UNAVAILABLE/UNKNOWN。DOCUMENTEDは候補記述があるという宣言。
各境界とID対応には同じupstreamRevisionのsource参照を要求する。
sources.roleのLOCK/BROWSERS/UPSTREAM_CONFIG/SAVED_LOGを各1つ要求し、固定parserで
lockの両package版、metadataのWebKit表示版・platform overrideを含むrevision、
BASE_REVISION、保存logのdownload表示版・revision・URL revision・platformを照合する。
Ubuntu24.04 x64/arm64以外のlog platform対応はUNKNOWNとして終了する。
その他のsourceはREFERENCEとし、codeとして扱わない。同じ依存版のmetadata/config、
同じアプリtransactionに対する内部ID宣言と境界状態の候補間整合も検査する。
区別statesDistinguishedはNORMAL_UNTERMINATED/COMMIT/ABORT/ABNORMAL全てが必要。
statesAtBoundaryは資料上の排他的な状態宣言で、複数の確定状態やUNKNOWNとの併記は矛盾。
この宣言自体を観測済みの証明として使わない。

CONSISTENTでも、全出力で次を固定する：

```json
{"executionAuthorization":"NOT_GRANTED","startCondition":"BLOCKED","realExperiment":"NOT_RUN","conditionU":"NOT_RUN","productionWorker":"HOLD","hypotheses":{"H1":"UNKNOWN","H2":"UNKNOWN","H3":"UNKNOWN","H4":"PARTIAL"}}
```

conditionRは出力しない。このCLIはtrace判定器ではなく、#401のR/Uや
complete発生→送信→main受信契約を変更しない。自己申告proofなど未知キーは拒否する。
既知キー内の自己申告も意味検証されず、実験開始可能へ昇格する経路はない。

## UPSTREAM_CONFIGの対応構文（P2補訂）

固定一次資料 `26a9e470a7b3c7822084b09fb7f13902c5f37b51` の設定は
REMOTE_URL/BASE_BRANCH/BASE_REVISION各1行の二重引用符付き単純代入である。
これはシェルparserではなく、以下のデータ形式だけを扱う。**ファイル全体**を検査し、
解釈できない行を読み飛ばさない。設定をsource/eval/シェル実行せず、展開・コマンド置換もしない。

- UTF-8（既存decoderによる先頭BOM許容）、改行LF/CRLF。空行、ASCII space/tabのみの行を許容。
- 最初の非space/tabが `#` の行全体コメントは無視する。コメント内のBASE_REVISIONや
  シェル風の文字列は代入ではない。行末コメントは対応外として拒否する。
- 代入は `[space/tab]*NAME="LITERAL"[space/tab]*` だけ。NAMEは
  `[A-Za-z_][A-Za-z0-9_]*`、LITERALの文字はASCII英数字と `_ . / : @ + -` のみ（空文字可）。
  `=` の前後に空白は置かない。空白は引用符の内側には置けない。
- BASE_REVISION以外の単純代入も同じ文法で検査する。OTHER_BASE_REVISIONや
  BASE_REVISION_SUFFIXは別変数であり、必須代入の代用にも重複数にも含めない。
- BASE_REVISIONは**ちょうど1代入**、値は小文字hex40桁が必須。同値・異値とも複数は拒否。
  最初・最後いずれの値も選ばず、代入順を反転しても拒否する。
- 単一引用符、無引用、escape/行継続、export/declare/readonly、`+=`、条件文、
  関数、配列、間接代入、パラメータ展開、コマンド置換、source/dot/eval、他の命令、
  複数命令行・heredoc等はすべて許容文法外。意味を推測して受理しない。

|拒否・不足|reason code / level|documentStatus / 終了|
|---|---|---|
|複数の対応構文によるBASE_REVISION代入|UPSTREAM_CONFIG_MULTIPLE_REVISION / conflict|INCONSISTENT / 1|
|対応構文の値がhex40桁でない|UPSTREAM_CONFIG_INVALID_REVISION / conflict|INCONSISTENT / 1|
|対応外の行（行番号付き）|UPSTREAM_CONFIG_UNSUPPORTED_SYNTAX / missing|INCOMPLETE / 1（他の矛盾があればINCONSISTENT）|
|必須代入なし|METADATA_FIELD_MISSING / missing|INCOMPLETE / 1|
|有効な単一値と対象revisionが異なる|既存METADATA_MISMATCH / conflict|INCONSISTENT / 1|

設定sourceの問題であり、外側JSON schema不正の終了2とはしない。対応外形式は
実際の設定値を静的に確定できないため資料不足、複数代入・値形式違反はデータ契約との矛盾。
各理由は併記し、いずれかがあれば値の比較に進まない。hash一致だけでこれらを免除しない。
この局所補訂でschemaVersionや研究上のR/U・実行承認契約は変更しない。
