# R2/P3 sourceMs 数値検証の局所修正・自己検証

## 判定と範囲

**局所自己検証 PASS／R2独立再レビュー待ち。PR全体 PARTIAL／マージ推奨 NO。**

固定旧HEAD：`8873b351b17e2a0e2a7a6367718ef37baadb8c99`。
開始時のGitHub/local HEADは一致し、対象worktreeはcleanだった。
branchは`implement/idb-evidence-collector-u1`、baseは`investigate/idb-time-delay-only`／`a72e0657d07632926d2ace9bcd7836cfbc41ac13`を維持する。
AGENTS.md、PR本文・過去レビュー、Issue #404履歴、Collector契約、両schema、既存試験を確認した。
取得時のGitHub原文は`records/github-*.json.gz`に保全した。

既存本体の変更は**collect.cjsのvalidateInto()内、4行追加・3行削除だけ**。
両schema・契約・既存fixture・期待値・TAP・JSON・manifestは一切変更していない。
CLI障害P2の閉鎖判断を再修正・撤回する工程ではない。

## 調査と設計判断

[JSON Schema Draft 2020-12 §6.1.1](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.1.1)では、numberに対してintegerは小数部が0の数値を意味する。
上下限は別のminimum/maximum制約である。同仕様§4.2は安全整数に相当する暗黙の上限を設けていない。
[ECMAScript Number.isInteger/isSafeInteger](https://tc39.es/ecma262/multipage/numbers-and-dates.html#sec-number.isinteger)は、整数性と、整数性に加えて絶対値が2^53−1以下であることを別々に検査する。

旧版は実値から`type='integer'`を作り、schemaがnumberを要求する場合にも、その実値が整数ならisSafeIntegerを適用していた。
1e20や1e308もJavaScript Numberとして整数性判定がtrueになるため、有限sourceMsを不正範囲として拒否した。
これはschemaのnumber契約を実装側の安全整数制約で狭めたものだった。

比較した方式：

| 方式 | 判断 |
|---|---|
| sourceMs名による特例 | 数値検証自体の原因が残るため不採用 |
| schemaがintegerならisSafeIntegerを課す | schemaにない制約が残るため不採用 |
| schemaに基づく整数性と、有限性・明示範囲を分離 | **採用** |

実値のtypeはnumberのままとし、schemaがintegerを許すときにNumber.isIntegerを使う。
numberは有限なら受理し、minimum/maximumがあれば従来どおり検査する。NaN/±Infinityは拒否する。
これは単なる安全整数検査の一律削除ではなく、数値の型一致をschema側の制約に合わせる修正である。

input/resultの数値schema全54箇所を棚卸しした。integerの39箇所はすべて有限のenum、またはminimum=1/maximum=8192を持つ。
sourceSeq、iteration、stream範囲、schemaVersion、exitCodeの整数性・上限は維持される。
numberの15箇所はすべて任意sourceMsである。詳細は`records/verification.json`のnumericSchemaInventory。
上限のないintegerを単独で検査する追加試験では大きな整数を受理するが、これは一般の型の意味の確認であり、既存アプリintegerフィールドの範囲を拡大するものではない。

JavaScript JSON.parse後のNumberに対する検証であり、任意精度decimal parserの実装ではない。
JSONとして数値構文を持つ1e309はJSでInfinityになるため、既存契約「有限数値」とAjv strictNumbersに従って拒否する。
NaN/InfinityというJSON外の字句はparserで拒否し、APIへ直接渡す非有限値は別試験で拒否を確認した。

## 修正前の固定とRED→GREEN

`fixtures.cjs`はCollectorを読まず、正常10イベントの保存fixtureから入力と契約上の期待値を生成する。
入力46資料・期待値・試験コードを本体修正前に固定した。
旧版126ファイルをGit blob bytesで隔離し、旧版の実Node子プロセスを実行してから本体を修正した。
修正版はその隔離環境のコピーにcollect.cjsだけを置換した。

| 対象 | 試験 | 成功 | 失敗 | skip | 実終了 |
|---|---:|---:|---:|---:|---:|
| 固定旧版 | 60 | 50 | 10 | 0 | 1 |
| 修正版 | 60 | 60 | 0 | 0 | 0 |

60件＝実CLI入力46件＋API非有限値6件＋数値keyword8件。
旧REDは巨大な有限sourceMs 7件、巨大な時計値を混在させ配列を逆転した1件、上限なしinteger/nullable-integerの2件に限られる。
旧版から成功していた50件を修正済み不具合とは数えない。
修正前のhash・期待RED名は`records/red-before-edit.json`。試験コードと期待値のhashはGREEN後にも同一だった。

有限sourceMsは0、1.5、−0.5、1e−6、±9007199254740992、±1e20、±1e308、MAX_SAFE_INTEGER、MAX_VALUEを検査した。
各資料は正常10イベントのsourceMsだけを変えており、修正版はCONSISTENT／JSON exit0／実exit0／R PASS・観測U FAILとなる。
入力hash・semantic hashは不変と仮定せず、全入力の実hashを記録した。
sourceMs以外の情報が同じ資料では、transactions（完全identityとR/U）、relations、orderRelations、欠落・矛盾・理由のprojectionが正常対照と一致する。
混在時計と配列逆転も同じ結果だった。

型不正（文字列、boolean、null、array、object）、±1e309、JSON外NaN/Infinityを拒否した。
sourceSeq/iterationの1と8192、小数、0、8193、巨大整数、巨大数値、文字列、nullも検査した。
sourceSeq=8192の資料はschema上有効だが途中の連番が不足するため**INCOMPLETE／1／R/U UNKNOWN**を期待した。
整数の型・範囲受理と、資料としての因果証拠完備を混同していない。

候補collect.cjs SHA-256：`d549f6fd4f60979bc3049d261539066a8db7fc84ae2449504de5ea7e2dbb561f`。
全CLIのstdout、stderr、実status、診断、argv、入力hash、Ajv・内蔵validator結果を`red.tar.gz`／`green.tar.gz`へ保存した。

## 独立Ajvと回帰

環境：Windows x64／Node v24.20.0／既存Ajv 8.20.0、Draft 2020-12、strict/allErrors/strictNumbers。
依存のinstallやlockfile変更は行っていない。
期待値は契約から事前定義し、同一のJSON.parse結果へAjvと内蔵validatorを適用した。
修正版は46資料すべてで入力妥当性が一致。JSON構文不正2件は両validatorの前で拒否する。
API6件・keyword8件もAjvと一致。結果schemaは新旧の専用92出力＋回帰222出力＝**314/314適合**。

既存の試験コード・期待値を変更せず、両版で新しく実行した結果：

| 群 | 旧 成功/失敗/skip/実終了 | 新 成功/失敗/skip/実終了 |
|---|---|---|
| Collector・judge等96件 | 96/0/0/0 | 96/0/0/0 |
| 追加69件 | 69/0/0/0 | 69/0/0/0 |
| R1原本18件 | 18/0/0/0 | **17/1/0/1** |
| CLI障害P2 16条件 | 16/0/0/0 | 16/0/0/0 |

**R1の1失敗は`R2-out-of-scope-sentinel`だけ。**
元fixtureは自ら「Known R2/P3 remains unchanged; not a normative number-schema oracle」と記した歴史的な不具合固定試験である。
旧期待値INVALID_SCHEMA／2を保全したため、新しいCONSISTENT／0で原本harnessが失敗する。
この失敗を隠さず原始TAPと実終了1を保存し、R1を18成功とは報告しない。
同じ入力はAjvで妥当であり、新出力は正常対照とinput以外の全フィールドが一致することを別途確認した。
新規sourceMs試験にも契約準拠の正対照を置いた。誤った旧期待値に合わせて修正を戻したり、旧期待値を黙って緩めたりしていない。
回帰controllerの終了0は、この既知の履歴sentinel差だけを許容した集計結果であり、R1原本harnessの終了0を意味しない。

Unicode境界、JSON重複キー、R/U因果関係、identity、sourceSeqの回帰は96/69群に含まれる。
R1の大量未知キー・256件・8192コードポイント・DIAGNOSTICS_TRUNCATED・表示枠外の理由保持の17件は無変更で成功した。
CLI障害P2のclose、read/close複合、長い診断も旧新16条件すべて成功し、CLI失敗時のhash null・派生評価空を再確認した。

## 前後出力比較と保全

| 出力群 | bytes一致 | 環境pathだけ | 意図したR2修正 |
|---|---:|---:|---:|
| 40資料 | 40 | 0 | 0 |
| 37資料 | 35 | 2 | 0 |
| R1 18資料 | 16 | 1 | 1 |
| CLI16資料 | 15 | 1 | 0 |

環境差4件はvalidationErrors[0].detailの1フィールドだけ。
A-missing、A-denied、CLI missingの隔離fixture pathと、R1 long-cli-errorの保存先path previewである。
errno・理由文を保持した限定的なpath正規化で照合し、他フィールド差がないことを確認した。
同一argvの長いnative open拒否対照は旧新bytes一致・実終了2/2。これはOS close/EIOの実証ではない。
前後値・hashは`output-differences.json`へ保存した。

実行前後62 worktreeを照合し、対象外61のHEAD/statusは不変。事前4477ファイル中4476はraw hash一致し、差は意図したcollect.cjsだけ。
既存未追跡物も保全した。旧CLI修正manifest449項目と独立受入manifest44項目は、固定旧Git blobで493/493一致。
旧隔離126ファイルはすべて不変、候補126ファイルもcollect.cjs以外不変。
diagnosticCollector、parser、R/U、identity照合、部分順序、runCliの旧新bytes一致を照合した。
sourceMsはhash/canonical資料には含まれるが、因果順序や安全判定に時計として使用しない。

commit後に`verify-tree.py`で旧treeのblob/modeを比較し、collect.cjsの内容以外の旧項目と、collect.cjsのmodeの保全を確認する。
今回の新しいmanifestはこのディレクトリ専用で、過去manifestを書き換えない。
CIは実際のGitHub run/checkを照会し、runがなければNOT_RUNと報告する。ローカル実行はCI成功ではない。

## 再実行手順

この変更版のrepo rootから、未使用の短い保存先を指定する。Windows排他読込み試験のためrepo内または隣接work配下を推奨する。
Node、Python、既存Ajvが必要。ここに記した全コマンドの実argvと終了コードは保存記録にもある。

```powershell
$s = 'design/idb-incomplete-stop/collector/source-ms-fix'
$r = '../u1-r2-rerun'
python "$s/prepare.py" $r
node "$s/fixtures.cjs" "$r/fixtures"
node "$s/run.cjs" "$r/old/design/idb-incomplete-stop/collector/collect.cjs" "$r/fixtures" "$r/red"
# 旧版は期待したREDのため終了1。以下を順に継続する。
if (Test-Path "$r/new") { throw 'new already exists' }
Copy-Item -LiteralPath "$r/old" -Destination "$r/new" -Recurse
Copy-Item -LiteralPath 'design/idb-incomplete-stop/collector/collect.cjs' -Destination "$r/new/design/idb-incomplete-stop/collector/collect.cjs"
node "$s/run.cjs" "$r/new/design/idb-incomplete-stop/collector/collect.cjs" "$r/fixtures" "$r/green"
node "$s/regression.cjs" $r
node "$s/compare.cjs" $r
node "$r/new/design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/same-argv.cjs" "$r/same-argv" "$r/old/design/idb-incomplete-stop/collector/collect.cjs"
python "$s/seal.py" verify
python "$s/verify-tree.py"
```

古い証拠は上書きできない。固定版と候補の全126ファイル、入力46件、期待値はtar.gz内にも保持している。
`package.py`は開始時worktree snapshotと既存のread-only snapshot helperを使う今回の保全作業用で、試験実行そのものには不要。

## 残件と引継ぎ

今回の範囲で新たなP1/P2/P3は確認していない。
R2/P3は自己検証で修正確認済みだが、独立再レビューによる閉鎖PASSとはしない。
再レビューでは、schema側の型判断、全integerの既存範囲維持、旧同条件RED、新GREEN、R1履歴sentinel差の扱いを確認してほしい。

実OS close/EIO、実ログadapter、WebKit内部ID/build結合、実停止境界、外部recorder完全性、条件U実験、本番統合は今回も未確認・未実施。
ブラウザ、Worker、IndexedDB、実メモ、OAuth/MCP、8791/8792、Tunnel、実験環境の操作は行っていない。
H1〜H3 UNKNOWN、H4 PARTIAL、条件U/実験 NOT_RUN、executionAuthorization NOT_GRANTED、startCondition BLOCKED、productionWorker HOLDを維持する。
PR #405はDraft・未マージ。Issue #404は閉じない。独立再レビューまでは**PR全体PARTIAL・マージ推奨NO**。

作成日：2026-11-03 JST。
