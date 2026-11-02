# BASE_REVISION上書き見逃しP2の局所補訂

**総合PARTIAL／P2修正自己検証PASS／独立再レビュー待ち／マージ推奨NO。**
対象PR [#403](https://github.com/tetsujisugimori-coder/memo/pull/403)、Issue #402、
[提出版独立レビュー](https://github.com/tetsujisugimori-coder/memo/pull/403#issuecomment-6575852600)。
独立レビューは旧提出版のチェッカー受入FAILと判断した。今回の自己検証を独立受入としない。

## 固定版と変更範囲

着手時のlocal/remote PR HEADはともに `636e2796ef9fce16d69340601ed6c05dfefa80fd`。
OPEN/Draft、base `investigate/idb-time-delay-only` を確認。HEAD進行・先行修正はなかった。
既存branch `investigate/idb-webkit-evidence` の既存worktreeはcleanだった。
AGENTS.md・PR本文/最新コメント・Issue・worktree一覧・workflow発火条件を確認した。

変更は `design/idb-webkit-evidence/` 内のみ。

- check.cjs：parseUpstreamConfigを追加し、最初のmatch取得を全行検査へ置換。
- upstream-config.test.cjs：保存済み26ケースを実CLI子プロセスで検査する局所試験。
- upstream-config-fixture.cjs：旧check.test.cjsの非公開fixture関数を静的copyした再構成用資料。
  本番判定や実資料には使用しない。元のcheck.test.cjs・既存15試験はbyte不変更。
- contract.md・README.md・validation.md・本報告：構文、分類、現版/旧版の検証範囲を明記。
- records/p2-fix/：固定旧CLI・契約・試験、レビュー/一次資料再確認、合成入力、全JSON、TAP、
  source/入力hashと保全記録。旧records/inputs/一次資料/失敗ログを上書きしない。

schemaVersion、schema.json、版対応表、取得可能性報告、既存judge/runner/workflow、
製品検索・認可・保存は変更しない。大規模試験・ブラウザ・独自build・実サービス操作は0。

## 固定一次資料と対応構文

Playwright固定commit `26a9e470a7b3c7822084b09fb7f13902c5f37b51` の
[UPSTREAM_CONFIG.sh](https://github.com/microsoft/playwright/blob/26a9e470a7b3c7822084b09fb7f13902c5f37b51/browser_patches/webkit/UPSTREAM_CONFIG.sh)
をcontents APIから再取得し、保存済み126 bytesと完全一致を確認した。
Git blob `949eaeae6398ad5daaec26271f606f178cc0225a`、SHA-256はinspection.json。
REMOTE_URL、BASE_BRANCH、BASE_REVISIONの3つの二重引用符付き単純代入である。

対応するのはLF/CRLF、空行、ASCII space/tab、行全体コメント、
`NAME="LITERAL"` の単純代入だけ。行の前後space/tabは可、`=`前後の空白は不可。
名前はASCII識別子、値は英数字と `_ . / : @ + -` だけ（展開・escapeなし）。
BASE_REVISIONは小文字hex40桁が1代入のみ必要。同値・異値とも複数代入は拒否し、
先頭・末尾を選ばない。別名変数やコメント中の文字列はBASE_REVISIONと数えない。
他変数も同じ構文で検査する。裸CR等を全行matchの外に残さない。

単一引用符・無引用・行末コメントも含め、export、`+=`、条件文、間接設定、変数展開、
コマンド置換、source/dot/eval、その他命令など許容文法にない行は拒否する。
任意シェルを解析・実行できるとは主張しない。[契約の構文・分類表](contract.md)を正とする。

複数代入・値形式違反はデータ契約との矛盾なのでINCONSISTENT/終了1。
対応外構文は設定値を確定できない資料不足としてINCOMPLETE/終了1。
必須欠落もINCOMPLETE/1、単一の有効値が対象と違えば既存METADATA_MISMATCH/1。
外側JSON/schemaは有効なので、これらをschema不正/終了2にはしない。
対応外行があっても正常な値だけを選んで受理することはない。

## 同一反例の修正前後

レビュー原probeのファイル添付・取得URLはコメントにない。
**公開条件と旧固定HEADの既存fixture関数からの再構成**であり、原probeそのものではない。
旧CLIはgit showで固定HEADからbyte不変copy。source/evalで設定値を求めず、
両CLIとも同じ明示ファイルだけを読み、各configの宣言SHA-256を正しく更新した。

|同一入力（target）|旧固定CLI：状態／理由／実終了|修正版：状態／理由／実終了|
|---|---|---|
|単一a（a）|CONSISTENT／なし／0|CONSISTENT／なし／0|
|a→c（a、レビュー反例）|**CONSISTENT／なし／0：誤受理**|INCONSISTENT／MULTIPLE_REVISION／1|
|a→a（a）|CONSISTENT／なし／0：誤受理|INCONSISTENT／MULTIPLE_REVISION／1|
|c→a（c、順序反転）|CONSISTENT／なし／0：誤受理|INCONSISTENT／MULTIPLE_REVISION／1|
|c→a（a）|INCONSISTENT／既存METADATA_MISMATCH／1|INCONSISTENT／MULTIPLE_REVISION／1|
|必須欠落|INCOMPLETE／FIELD_MISSING／1|INCOMPLETE／FIELD_MISSING／1|
|短い/大文字/空のliteral|INCOMPLETE／FIELD_MISSING／1|INCONSISTENT／INVALID_REVISION／1|
|後続export/追記/展開等|先頭値だけでCONSISTENT／0|INCOMPLETE／UNSUPPORTED_SYNTAX／1|
|行全体コメント・別名変数|CONSISTENT／0|CONSISTENT／0|
|前後space/tab＋CRLF|旧文法でINCOMPLETE／1|明文化した文法でCONSISTENT／0|

理由名のMULTIPLE_REVISION等は `UPSTREAM_CONFIG_` prefixを省略した。
完全なJSON（全guard・reasons・入力hashを含む）は
`records/p2-fix/outputs/before-later-different.json` と `final-later-different.json`。
全26ケースの実終了・対応JSON・source hashは `outputs/comparison.json`。
入力は `inputs/cases/`、明示引数・期待値は `inputs/cases.json` と `line-end-case.json`。
HASH_MISMATCHで拒否したのではないことを各試験で確認した。

## 局所試験・実資料

|検証|結果|実終了|
|---|---|---:|
|旧固定HEADの既存15試験|15成功・失敗/skip0|0|
|旧CLI＋新契約の25ケース|RED：3成功・22失敗・skip0|1|
|初回補訂source＋同じ25ケース|GREEN：25成功|0|
|最終source、既存15＋追加26|**41成功、失敗/skip/cancelled/todo 0**|0|
|実資料、旧CLI／最終CLI|ともに不足11件、INCOMPLETE|1／1|

旧版への新契約oracleは、複数代入・対応外構文・新たに許容を明示した表記差を含む。
22失敗は22件の独立P2や既存15件の退行を意味しない。正常対照の旧成功と、
今回改善した上書き拒否を上表で分ける。初回GREENログも保存し、そのsourceは
inputs/first-fix-check.cjs。最終の根拠はoutputs/final-tests.tapとsummary.json。
補助の裸CRケースも別保存し、最終26ケースに含む。

実資料のschema・plan・source12件（計14ファイル）はbyte不変更。
旧CLI・最終CLIの再計算JSONは旧records/assessment-result.jsonとも**全bytes一致**。
不足11件を埋める架空証拠は追加していない。合成fixtureはparser専用の試験である。
実CLI終了0/1は追加試験、終了2とAPI経路は既存15試験でguardを確認した。
全経路でNOT_GRANTED / BLOCKED / U NOT_RUN / HOLDとH判定を維持する。

## 再計算

repository rootから、依存install不要：

```powershell
node --test --test-reporter=tap design/idb-webkit-evidence/check.test.cjs design/idb-webkit-evidence/upstream-config.test.cjs
$checkerArgs = Get-Content -Raw -Encoding UTF8 design/idb-webkit-evidence/records/check-arguments.json | ConvertFrom-Json
node design/idb-webkit-evidence/check.cjs @checkerArgs
# 41成功/終了0、実資料はINCOMPLETE/終了1。
```

旧版への同じ新oracleは、明示的に `STATIC_CONFIG_BASELINE=1` を設定して追加試験だけを実行する。
これは保存済み純粋CLIを選ぶ試験用切替で、製品checkerは環境変数を読まない。
個別CLIはcases.jsonの同じargsを `inputs/before-check.cjs` と現check.cjsへ渡せば再計算できる。
`STATIC_CONFIG_CAPTURE=1` は今回の試験結果JSONを初回保存するためだけに使用した。
既存出力を上書きしないwxなので再計算時は指定不要。checker自身の書込み機能ではない。

## 保全・限界・再レビュー

旧107 fileのbefore hash、関連7 worktree（main・研究6）の状態、既存変更・未追跡の
非ignored fileを保存した。対象worktreeの今回変更だけを区別して照合する。
旧records全件、固定inputs全件、旧15試験、schema、旧manifestはbyte不変更。
新manifest `records/p2-fix/SHA256SUMS` は自身を除く現directory全fileを対象とし、
旧manifestを更新しない。対象directory外の旧code/証拠はGit blob/modeでも不変更を確認する。
ignored cacheや無関係worktree全byteまで保全照合したとは主張しない。

CIはNOT_RUN、dispatchなし。[skip ci]、branch/base/path条件を維持して提出する。
公開API＋共有markerではUの独立証拠が不足するという研究結論、版対応・実停止境界・
内部計測候補のUNKNOWNはこのparser修正とは別であり、解消を主張しない。

独立再レビューでは、全行の狭い文法、同値/異値の重複と対応外行の拒否、
分類理由・JSON/実終了コード、同じinput bytesとsource hash、既存15試験・実資料の不変を
確認いただきたい。総合PARTIAL、マージ推奨NO、修正後独立受入未実施。
H1〜H3 UNKNOWN、H4 PARTIAL、本番Worker HOLD、将来実験未承認、開始BLOCKED、U NOT_RUN。
