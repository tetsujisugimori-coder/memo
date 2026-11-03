# PR #405 CLI入力障害の結果整合性・P2局所修正

2026-11-03 JST。**総合PARTIAL／P2は自己検証で修正確認済み／独立再レビュー待ち／マージ推奨NO／Draft維持。**
Issue #404、[レビュー5743656504](https://github.com/tetsujisugimori-coder/memo/pull/405#pullrequestreview-5743656504)。
固定旧HEAD `5d16dd0cc4d18186ec59947c2073c409b2f8c34b`、base `a72e0657d07632926d2ace9bcd7836cfbc41ac13`、
branch `implement/idb-evidence-collector-u1`。開始時の最新HEAD/baseは指定と一致、OPEN/Draft、root/対象worktreeはclean。
AGENTS.md、PR本文、独立レビュー、collector契約・両schemaを確認した。

## 反例と検証方法

既存の正常10イベントfixture作者から別の固定入力を作り、入力・期待値・障害注入scriptを**修正前に固定**した。
元レビューの障害条件を再構成したもので、レビュー担当の元scriptそのものの再実行とは主張しない。
Node子プロセスの `--require fault-preload.cjs` で、明示した合成入力のfdだけにfs API障害を注入する。
正常なfs読込みとcryptoによるhash計算は実際に行い、hashは模擬しない。
close注入は、試験fdを実際にcloseした直後にJavaScript Errorをthrowする方式。
これは**実Nodeプロセスの実終了コードを測るJS障害注入**であり、**実OS自身のclose/EIO発生を実証しない**。

正常入力は2,962 bytes、SHA-256 `0ac1843651c9b0ed2d2e142ccb1ae382a13b976a21adeba27126bbef73ac49aa`。
固定期待値hashは `3095913f32287c9493b6f862b34d5f7e7a2514349c189ef4650807a094fa7919`、
障害shim hashは `e3d7b29db0a74345714497aff088a3fc9517dc6b1a862cece9fb58442480fa1c`。
before/afterで両hash、fixture bytes/hash、fault mode、schema hashは一致する。

[入力・期待値](fixtures/expectations.json)、[注入実装](fault-preload.cjs)、[前後比較](records/comparison.json)。
各条件でstdout、stderr、process status、例外stage/code/メッセージprefix・文字数、read bytes、
終了trace、期待値、独立schema判定を新規before/afterへ保存した。
長い注入メッセージ全体は固定shimの生成式から再構成できる。stderrは今回すべて空だった。

## 原因と局所修正

旧版は読込み成功後のclose障害でも、`collectEvidence(bytes)`の成功結果を先に作り、
diagnosticだけを上書きしていた。正常10イベントで、CLI_INPUTとactualSha256=nullに加え、
CONSISTENT/0、R PASS、semantic hash、relationsが残る不整合を実Nodeで再現した。
read障害とclose障害の併存では、finally中のclose例外がread例外を置き換えていた。
以前のP3懸念が具体化した経路であり、R1診断上限修正が持ち込んだ新規回帰とは扱わない。

**本体変更はrunCli()だけ（21行追加・10行置換/削除）。**

- read障害とclose障害を別々に診断器へ記録し、closeで元のreadエラーを隠さない。
- CLI障害時は読めたbytesを評価へ渡さず、エラー結果を新しく構築する。
- evidenceStatus=INVALID_SCHEMA、exitCode=2、actualSha256/semanticSha256=null。
- transactions/relations/orderRelations/missingEvidence/contradictions/unknownReasonsは空にする。
  空配列は「入力を採用・評価していない」という意味で、イベント非発生の証明ではない。
- 外部materialIdラベルと、形式が有効なexpectedSha256だけを保持する。入力identityを捏造しない。
- 既存diagnosticCollectorを再利用し、256件/8,192コードポイント、DIAGNOSTICS_TRUNCATED、理由保持を維持。
- 読込みとcloseが正常なら従来どおりcollectEvidence()を呼ぶ。正常資料の0や不正資料の1/2を一律に変更しない。

runCliより前の全ソースとexportsはbytes一致。
両schema、R/U、identity、部分順序、judge、parser、Unicode判定、R2数値述語、R1診断器は不変更。
[変更境界のhash確認](records/scope.json)。

## RED→GREEN

|条件|旧版|修正版|
|---|---|---|
|正常/短いreadの正常完遂|CONSISTENT/0、R PASS/U FAIL|同じ、出力bytes一致|
|open/read/部分read後の障害|INVALID_SCHEMA/2|同じ、出力bytes一致|
|正常資料のclose障害|**CONSISTENT/0、R PASS、semantic hash残存**|**INVALID_SCHEMA/2、hash null、派生評価なし**|
|read＋close、部分read＋close|終了2だがread診断が隠れる|終了2、両方の診断を保持|
|外部hash不一致＋close障害|INCONSISTENT/1、派生情報が残る|INVALID_SCHEMA/2、派生情報を採用しない|
|read＋長いcloseエラー|read診断が隠れる|両方保持＋短縮を明示|
|不正JSON＋close、引数不足、不存在、超過、長いopenエラー、不正JSON対照|旧版から期待どおり|同じ、出力bytes一致|

新規16条件は旧11成功/5失敗/skip 0（実終了1）→**16成功/0失敗/skip 0（実終了0）**。
5件のREDは条件数で、5個の独立P2と数えない。旧版からPASSの11件は修正済み不具合に数えない。
中心close反例は旧版も構造上のschemaには適合していたため、schema判定だけでなく
status/exit/CLI_INPUT/hash/transactions/relations/実行禁止状態の独立assertで不整合を検出した。

修正版の全CLI障害で単一JSON、INVALID_SCHEMA、JSON exitCode=実終了2、両hash null、
派生情報なし、CLI_INPUT、実験禁止状態を確認。read/close両方のメッセージも検査した。
全16結果を既存ローカルAjv **8.20.0 / Draft 2020-12**で独立照合して適合。
環境はWindows／Node **v24.20.0**。新規依存install/lockfile変更なし。今回NOT_TESTEDなし。
利用不能環境では独立validatorの未実施をenvironmentへNOT_TESTEDとして記録する。

[旧TAP](records/before/tests.tap)／[新TAP](records/after/tests.tap)／[集計](records/summary.json)。

## 回帰と出力差分

|対象|今回の結果|
|---|---|
|既存96試験|96成功/0失敗/skip 0、終了0|
|追加69試験|69成功/0失敗/skip 0、終了0|
|R1専用18試験|18成功/0失敗/skip 0、終了0|
|既存40資料CLI|旧保存JSONと40件すべてbytes一致|
|追加37資料CLI|旧保存JSONと37件すべてbytes一致|
|R1の18保存JSON|17件bytes一致、1件は保存先由来のpath previewだけの差|

R1のlong-cli-errorは、既存harnessが出力directoryから過長な不存在ファイル名を作るため、
今回の新しい保存先を使うとvalidationErrors[0].detail中のpath previewだけが変わる。
このfield以外は一致し、P2修正による診断・判定変更ではない。
別途、**完全に同じargv**のnative open拒否を旧/新CLIへ渡す対照を行い、JSON全bytes一致・終了2を確認した。
こちらはfs/hash mockなしのOS open拒否で、OS close障害の実証ではない。

[40比較](records/old40-comparison.json)／[37比較](records/old37-comparison.json)／
[R1の18比較](records/old18-comparison.json)／[同argv対照](records/same-argv/comparison.json)。
過去Linuxの69試験37成功/32skipという記録は不変更。今回のWindows実行で全69件を実施した事実と区別する。

## 保全・再現・残件

開始前に62 worktree、既存3,985 raw hashを記録。許可されたcollect.cjs以外の不測変更0。
対象以外61 worktreeのHEAD/status、既存変更・未追跡ファイルを保全。
既存原始TAP/JSON/fixture/期待値/manifest/レビューは上書きせず、新規記録は本directoryへ分離した。
固定旧HEADの全Git blob/mode一覧を保存し、commit後も変更がrunCliの本体1ファイルと新規専用資料だけかを照合する。
親judge/契約の既存CRLF作業コピーとLF Git blobは区別する。固定試験用ソースはGit blob bytesで保存した。
今回manifestは `records/SHA256SUMS`。自身以外の本directory全fileと明記した親Collector/両schemaを対象にする。
旧manifestは各歴史的HEAD用として保全し、現在コードへ再計算して上書きしない。

```powershell
# 未存在の出力先を指定。既存記録を上書きしない。
node design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/run.cjs work/cli-error-new-run

# 同じ入力・期待値・shimで固定旧版を再実行。5条件がRED、終了1。
node design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/run.cjs work/cli-error-old-run design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/records/fixed/collector/collect.cjs
```

R2/P3「有限sourceMsの安全整数制限による誤拒否」は未解決・未修正。
実OSでのclose/EIO、実ログadapter、内部ID結合、対象WebKit build対応、実停止境界、recorder完全性は未確認のまま。
実ブラウザ/実Worker/実IndexedDB/実メモ、OAuth/MCP実接続、8791/8792/Tunnel、WebKit改造、
1ms実験、実験承認変更、本番統合、main更新、Draft解除、auto-merge、マージは0。
CIは最終指定HEADで確認して未実行ならNOT_RUNと記録する。

H1〜H3 UNKNOWN、H4 PARTIAL、条件U/実験 NOT_RUN、executionAuthorization NOT_GRANTED、
startCondition BLOCKED、本番Worker HOLD。自己検証PASSは独立再レビューによる閉鎖判定の代わりではない。
