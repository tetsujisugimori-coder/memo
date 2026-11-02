# PR #405 独立負対照・局所修正

2026-11-02 JST。**総合PARTIAL、独立再レビュー待ち、マージ推奨NO、Draft維持。**
既存自己試験のfixture/期待値/出力から新しい期待値を生成せず、契約v2とCollector契約から
別の合成資料・期待値を先に固定して検証した。「独立」は既存試験からの独立性であり、
今回の実行を第三者による修正後の独立受入・承認の代わりにはしない。

対象固定HEAD `9deca60bc329acc124e4909e4954bf2dc3e27049`、
base `a72e0657d07632926d2ace9bcd7836cfbc41ac13`、
branch `implement/idb-evidence-collector-u1`。Issue #404 / Draft PR #405。
着手時のGitHub HEAD/baseは指定と一致。OPEN/Draft、正式COMMENTレビュー1件を確認した。

## 結果

|項目|固定旧版|修正後|結論|
|---|---|---|---|
|A CLI（8件）|8成功|8成功|誤判定未再現、CLI処理は未修正|
|B 欠落/矛盾の優先順位（8件）|8成功|8成功|全理由の保持、矛盾優先、全txのR/U UNKNOWNを確認|
|C 因果関係/前提/source制限（13件）|13成功|13成功|レビューのP2候補は現行schemaで未再現、未修正|
|D 複数tx/Worker（8件）|8成功|8成功|完全identity照合と資料全体の無効化を確認|
|配列・時計の意味同値比較（1件）|成功|成功|raw hash等の変更と意味上の判定を区別|
|E 独立Draft 2020-12照合（31件）|30成功・1失敗|31成功|Unicode長のP3互換性不具合1件を局所修正|
|追加試験計|**68成功・1失敗、終了1**|**69成功・0失敗、終了0**|旧版からPASS68、RED→GREEN1|
|既存96試験（別実行）|過去保存記録を保全|96成功・0失敗、終了0|コード・期待値を変更していない|

今回確認された欠陥の未修正残数は0。未再現の堅牢性提案や将来研究のUNKNOWNを解消した意味ではない。
skip/cancelled/todoは0。追加37資料のCLI JSONと実終了0/1/2を照合。
修正前後の37 JSONは全bytes一致。既存40資料のCLI出力も旧保存JSONと全bytes一致。

[全体要約](records/summary.json)／[旧版TAP](records/before/tests.tap)／[修正後TAP](records/after/tests.tap)／
[既存96試験TAP](records/regression/tests.tap)／[CLI比較](records/cli-comparison.json)／
[schema比較](records/schema-comparison.json)。各CLI資料のstdout JSON・stderr・実終了はbefore/afterに分離保存。

## 再現したP3：Unicode文字数

`E-output-unicode-length-valid` は、結果schemaの `validationErrors[0].detail` に
補助平面文字U+1F642を5,000文字置く。maxLength=8,192なのでDraft 2020-12では有効。
これは手書きのschema適合性入力であり、実CLIがこの長文エラーを生成したという主張ではない。

- 固定旧版 `validate()` はJavaScript `value.length` を使用し、UTF-16の10,000単位として誤拒否。
- 既存ローカルAjv **8.20.0**の `ajv/dist/2020` は受理。入力17・結果14の計31ケースを独立照合。
- `collect.cjs` の `validate()` だけでUnicodeコードポイント数に変更した（2行追加・1行置換）。
- 同じ5,000文字入力・同じ期待値でGREEN。8,193文字は引き続き拒否。
- input/result schema、R/Uロジック、CLI結果構築、親judge/契約、既存試験は不変更。

[旧診断](records/before/E-output-unicode-length-valid.json)／[新診断](records/after/E-output-unicode-length-valid.json)。
schema自体を緩めず、JSON Schemaの文字数単位へ実装を合わせた。
R/Uの誤PASSや実行許可の誤付与は再現しておらず、確定P2とは扱わない。

## 未再現・判断境界

A：引数不足、不存在、読込み拒否、2MiB超過、不正UTF-8/JSON、外部hash不一致、materialId不正を
実CLI子プロセスで検査。全8件でstatus/JSON exitCode/実終了/reasons/validationErrors/安全状態が一致。
読込み拒否は新規合成ファイルへのWindows **FileShare.None** による実OSのopen拒否（EBUSY）。
fs mockや既存ファイルのACL変更は行っていない。ACLによるEACCESを実行したという主張ではない。
未読・全体未読の超過入力はactualSha256=null。読めた不正JSON/UTF-8は全bytesのhashを保持。

固定旧版のCLI_INPUT経路はvalidationErrorsに加えてreasonsも差し替えていた。
今回の引数/open失敗では空bytesのINVALID_SCHEMA/2が残り、実際の誤判定は再現しなかった。
有効bytesの読込み後にcloseが失敗する等の経路を、今回の実OS試験で再現したわけではない。
独立したエラー結果構築への堅牢化案はP3提案として残し、仮想的な失敗のための本体変更はしていない。

C：レビュー対象の列挙ペアは現行schemaで同一sourceに限定される。
workerイベントのsource=main、mainイベントのsource=workerをschema不正として拒否する負対照もPASS。
同じmainの対応complete受信がstop前ならR PASS/U FAIL、stop後ならR FAIL/U UNKNOWN。
Worker completeのみ/送信のみ/比較不能はU UNKNOWN。不正資料は正常txが同居しても全tx R/U UNKNOWN。
今後schemaを拡張する場合はsource前提を改めて検証する必要がある。

E：依存追加・install・lockfile変更なし。既存ローカルAjvを使用した。
正常/型/余分field/oneOf/enum/整数/長さ/末尾改行/nullableを照合し、修正後31件一致。
利用不能環境ではEをNOT_TESTEDとして記録・skipし、Node標準機能の試験は継続する構成。
今回のEは全件実施済み。schemaだけで実記録の真実性や実行時因果関係を認証しない。

## 再現コマンド（repository root）

```powershell
# 出力先は必ず未存在のdirectory。保存済みbefore/afterには書き込まない。
node design/idb-incomplete-stop/collector/independent/run.cjs work/u1-independent-new-run

# Git固定旧HEAD由来の4ファイルをbyte不変更で同梱。旧版では69件中1件RED、終了1。
node design/idb-incomplete-stop/collector/independent/run.cjs work/u1-independent-old-run design/idb-incomplete-stop/collector/independent/records/fixed/collector/collect.cjs

# 既存96件と旧IR1負対照を別directoryで実行。
node design/idb-incomplete-stop/collector/verify.cjs work/u1-regression-new-run
```

fixture作者スクリプトはCollectorをimportしない。生成済みの入力と期待値をcommitし、試験では
それを読む。`fixtures/expectations.json` hashは
`9b39164f20c46b926bc809a92944232f743927f39e8220603b117df2d6212f46`、
schema期待値hashは `5d12b8c8c0ec9130e0c6ddbf4d20c6ac2c37fd98c2b5647e36b19c8f7716e1c9`。
before/afterで一致し、旧出力に合わせた変更を行っていない。

## 保全・残る研究制限

着手時62 worktreeを記録し、対象以外61のHEAD/statusと既存変更・未追跡物を保全。
旧3,181ファイルhashのうち意図したcollect.cjsの1件だけ変更、不測変更0。
旧固定HEADの全1,083 blob/mode一覧、source/schema/fixture/旧manifest hash、前後snapshotを保存。
commit後tree比較でも、既存変更がcollect.cjsだけでmode不変であることを確認する。
製品、D/E/F/G/T7、既存judge/contract/96試験/fixture/原始JSON/TAP/manifestは不変更。

親の `collector/records/SHA256SUMS` は**旧固定HEAD用として不変更保全**している。
現在コードに対してその旧manifestのcollect.cjs項目まで一致すると主張しない。
今回用の `independent/records/SHA256SUMS` は自身を除く本directory全fileと、明記した親sourceを対象にする。
各入力/出力/期待値/検証器・schema・ソースのhashも別保存する。
原始TAPの空白と超過入力bytesを保持する専用属性は新directory内だけに追加した。

実ブラウザ、実Worker、実IndexedDB、実メモ、OAuth/MCP実接続、8791/8792/Tunnel、1ms実験、
WebKit内部hook、build、dispatch、実験承認変更、本番統合は0。
CIは指定最終HEADで確認してPRに記録し、未実行を成功と扱わない。

H1 UNKNOWN、H2 UNKNOWN、H3 UNKNOWN、H4 PARTIAL、条件U/実験 NOT_RUN、
executionAuthorization NOT_GRANTED、startCondition BLOCKED、本番Worker HOLD。
実ログadapter、内部ID結合、対象build照合、実停止境界、外部recorderの完全性は未成立のまま。
今回の局所修正と負対照成功によって昇格させない。独立再レビュー前のマージは禁止。
