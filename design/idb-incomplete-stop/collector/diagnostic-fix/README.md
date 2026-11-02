# PR #405 R1/P2 診断生成の局所修正

2026-11-03 JST。**総合PARTIAL／P2は自己検証で修正確認済み／独立再レビュー待ち／マージ推奨NO。**
Issue #404、[独立レビュー5741974797](https://github.com/tetsujisugimori-coder/memo/pull/405#pullrequestreview-5741974797)。
固定旧HEAD `189b184781e78e474879dab0c89a8dfca9db4254`、
base `a72e0657d07632926d2ace9bcd7836cfbc41ac13`、branch `implement/idb-evidence-collector-u1`。
GitHubの最新HEAD/baseは指定と一致、OPEN/Draft、開始時root/対象worktreeはclean。
AGENTS.md、両契約、schema、元レビューを確認した。既存レビューは変更しない。

## 再構成反例とRED→GREEN

添付Libraryリンクから原ZIPを取得できず、ローカルにも原本はなかった。
既存の正常10イベントfixture作者から同じ欠陥条件を**再構成**した。
原反例の再実行や原本SHA-256との一致は主張しない。
入力・期待値を固定してGit blob bytesから保存した旧CLIでREDを確認し、その後で実装を修正した。

|反例|今回の再構成サイズ|旧版の実CLI|修正後の実CLI|
|---|---:|---|---|
|A 未知トップキー130,000個|1,451,852 bytes|RangeError、stdout 0 bytes、実終了1|有効JSON、INVALID_SCHEMA、JSON/実終了2、schema適合|
|B 未知キー8,192コードポイント|11,159 bytes|JSON/実終了2だがsubject 8,193文字でschema不適合|subject 8,192文字以内、短縮を明示、schema適合、終了2|
|C 未知トップキー8,193個|83,782 bytes|JSON/実終了2だが8,193診断でschema不適合|256診断以内、省略を明示、schema適合、終了2|

今回の入力SHA-256：

- A `e6fe086276f4d28af908f75fbe7487e931be01306a6f6fca8672f0bba3be95ef`
- B `530f91d89c4ee97c70872464fbcf15e04c5be63da6b1f89d29c81bf4d65c073b`
- C `5c418f8f776ccde97d5ca701802ecd1f17370dedd9c4bb7bcf1ff95f50cde855`

全件2MiB以内。固定したgzip入力を展開したbytesと外部hashを同一にして前後実行し、
入力自体や照合対象hashを切り詰めていない。
[入力・期待値](fixtures/expectations.json)、[全前後比較](records/comparison.json)、
[旧TAP](records/before/tests.tap)、[新TAP](records/after/tests.tap)を保存。
各資料のstdout JSON、stderr、実終了、独立schema検査、raw入出力hashはbefore/afterに分離した。

## 採用した診断方針

schemaを変更せず、**表示診断は256件、各文字列は8,192コードポイントまで**に制限する。
result schemaのmaxItems=8,192を緩和していない。256は診断表示の予算であり、入力受理条件ではない。

- `diagnosticCollector()` が生成中から保持件数とsubject/detail長を制御する。保持枠を超えた診断オブジェクトは作らず、総件数と理由コードは収集し続ける。
- 短縮時は文字列末尾へ `...[truncated]` を付ける。UTF-16単位ではなくコードポイント単位で扱う。
- 省略または短縮がある場合、既存validationErrorsの1枠へ `DIAGNOSTICS_TRUNCATED` を入れる。満杯なら通常診断は255件＋この表示1件。
- detailに `diagnostics omitted=N; fields shortened=N; reason codes=...` を記録する。fields shortenedは保持処理中に短縮したfield数で、最後に省略表示へ置換される項目を含み得る。
- `reasons` は表示された診断だけでなく、表示枠外を含む理由コード集合から生成する。後方のINPUT_DESCRIPTORも保持する。
- 実検査は表示枠が埋まっても続行する。oneOfの適合性だけを調べるprobeは診断を生成せず、不適合を確定したら終了できる。選ばれた実診断の走査は全体を継続する。
- 有効性を表示配列から推測せず、検出した不正の有無で保持する。schema不正→INVALID_SCHEMA/2、矛盾優先、全体無効化を変えない。

変更箇所は `collect.cjs` の `validate()`、内部の `validateInto()` / `diagnosticCollector()`、
`collectEvidence()` の診断受渡し・理由整形、長いCLIエラー診断の同じ上限処理だけ。
大量の診断を関数引数へ展開する経路を除去した。
無関係な例外を握り潰すcatch、すべて終了2にするfallback、新しいschema項目は追加していない。

Aは129,745件、Cは7,938件の省略、Bはfield 1件の短縮を表示する。
後方のINPUT_DESCRIPTOR、255/256/257件、subjectの8,191/8,192/8,193文字、
補助平面文字・結合文字、後方イベントの不正、長いCLIエラーも確認した。

## 試験と回帰

Windows／Node v24.20.0、既存ローカルAjv **8.20.0 / Draft 2020-12**を使用。
依存install・lockfile変更なし。結果schemaは固定旧版と同じhashで、全18出力が独立検査に適合した。

|対象|今回の実行|実終了|
|---|---|---:|
|R1追加18試験・旧版|8成功／10失敗／skip 0|1|
|同じ18試験・修正版|18成功／0失敗／skip 0|0|
|既存96試験・別実行|96成功／0失敗／skip 0|0|
|既存40資料CLI|40成功、旧保存JSONと全bytes一致|各期待値0/1/2|
|前回追加69試験・別実行|69成功／0失敗／skip 0|0|
|その37資料CLI|旧保存JSONと全bytes一致|各期待値0/1/2|

18試験の失敗10件は診断制限方針・境界も含む試験のREDであり、10個の独立P2と数えない。
確認・修正対象はR1の1件、中心反例A/B/Cの3条件。正常系と欠落＋矛盾の優先順位は元からPASS。
入力/期待値hashは前後一致し、旧結果に合わせて変更していない。
正常出力、Unicodeコードポイント判定、R/U、完全identity、部分順序、parserは不変更。
R/U領域・parser・Unicode判定行・R2の数値述語のソースhashも照合した。

前回Linux独立実行の69試験は37成功・32skipだったことを保持する。
今回のWindowsでは排他読込み拒否とAjvも利用できたため69件実施、skip 0。
これを前回Linuxの未実行32件まで当時成功していたという意味にしない。
Ajvが利用不能なら今回harnessの独立検査は環境記録にNOT_TESTEDと残す。今回は全件実施済み。

[集計](records/summary.json)／[96回帰](records/regression96/summary.json)／
[69回帰](records/regression69/summary.json)／[旧40 JSON比較](records/old-40-output-comparison.json)／
[旧37 JSON比較](records/old-37-output-comparison.json)／[非変更領域](records/unchanged-boundaries.json)。

## R2/P3は未解決・未修正

sourceMs=2^53の有限数値を誤拒否する既知P3は今回の対象外。
数値判定の述語は不変更で、専用sentinelの旧新JSONもbytes一致、INVALID_SCHEMA/2のまま。
sentinelのPASSは「既知の誤拒否をこの工程で変更していない」という回帰条件であり、
その拒否を正しいJSON Schema解釈として承認したり、R2を修正済みにしたりしない。

## 保全・再現

最初のroot/対象clean確認後、fixture作者script1件を追加してから保全snapshotを取得した。
62 worktree、3,593 hash（この新規script1件を含む）のうち意図したcollect.cjsだけ変更、不測変更0。
対象以外61 worktreeのHEAD/status、既存変更・未追跡物を保全し、stash/破棄/上書きしていない。
旧固定HEADの全Git blob/mode一覧も保存し、commit後に非対象ファイルの不変を照合する。
親judge/contractの既存CRLF作業コピーとLF Git blobは区別する。旧試験用コピーはGit blob bytesを直接保存した。

既存fixture、期待値、原始TAP/JSON、旧manifest、研究・製品コード、input/result schemaは不変更。
古いmanifestは各旧HEADの記録として保全し、現在Collectorへ再計算して上書きしない。
今回用 `records/SHA256SUMS` は自身以外の本directory全fileと、明記した親Collector/両schemaのraw hash。
Git保存bytesとも照合する。元レビューとGitHub取得時応答、前後snapshotを別保存した。

```powershell
# 未存在の出力先だけを指定する。保存済みbefore/afterは上書きしない。
node design/idb-incomplete-stop/collector/diagnostic-fix/run.cjs work/r1-recheck-new

# exact Git blob bytesで同梱した固定旧版。中心反例A/B/CはREDになる。
node design/idb-incomplete-stop/collector/diagnostic-fix/run.cjs work/r1-recheck-old design/idb-incomplete-stop/collector/diagnostic-fix/records/fixed/collector/collect.cjs
```

実ブラウザ・実Worker・実IndexedDB・実メモ、OAuth/MCP実接続、8791/8792/Tunnel、
新1ms実験、WebKit hook/build、dispatch、実験承認変更、本番統合は0。
CIの実run/checkは提出後の指定HEADで確認し、未実行はNOT_RUNと記録する。
baseをmainへ変更せず、main更新・Draft解除・auto-merge・マージを行わない。

H1〜H3 UNKNOWN、H4 PARTIAL、条件U/実験 NOT_RUN、executionAuthorization NOT_GRANTED、
startCondition BLOCKED、本番Worker HOLD。P2は自己検証で修正確認済み、独立再レビューによる閉鎖判定は未了。
