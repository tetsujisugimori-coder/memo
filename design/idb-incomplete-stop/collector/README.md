# Memo-Nexus Stage U-1 Evidence Collector

[Issue #404](https://github.com/tetsujisugimori-coder/memo/issues/404)。
オフライン実装の自己検証PASS候補／研究を含む総合PARTIAL、独立レビュー待ち。
条件Uの実証、本番Worker停止の安全性認定ではない。

[イベント契約](contract.md)、[入力schema](input.schema.json)、[結果schema](result.schema.json)、
[Collector](collect.cjs)、[合成fixtureと独立期待値](fixtures/cases.json)、
[試験](collect.test.cjs)、[検証・保全記録](validation.md)。

## 実行（repository root、依存install不要）

```powershell
$case = Get-Content -Raw -Encoding UTF8 design/idb-incomplete-stop/collector/fixtures/cases.json | ConvertFrom-Json | Where-Object name -eq single
node design/idb-incomplete-stop/collector/collect.cjs design/idb-incomplete-stop/collector/fixtures/single.json single $case.expectedSha256
# JSON evidenceStatus=CONSISTENT、実終了0。観測R PASS/U FAIL、実験conditionU NOT_RUN。

node --test design/idb-incomplete-stop/collector/collect.test.cjs
# 新規60試験。既存36試験は親directoryのjudge/conditions/merge-order.test.cjs。

node design/idb-incomplete-stop/collector/verify.cjs work/u1-recheck-unique
# 出力先は未存在のdirectoryを指定。既存保存物への上書きは拒否する。
```

`collectEvidence(bytes,{materialId,expectedSha256})` は純粋なデータ処理。
CLIは明示した1ファイルだけを読み、stdoutへJSON、実終了コード0/1/2を返す。
expected hashは独立manifest等から与える。ファイル内容に書かれた実行命令・URLは追わない。
外部schemaや入力内のschema参照を実行/取得しない。独立した汎用JSON Schema実装との照合は未実施。
固定schema用の限定validatorを同梱し、非対応type・余分field・重複JSON keyを拒否する。

sourceSeqと明示ID参照から部分順序を出し、同一source内に正規化した記録を
既存judgeへ渡す。異sourceの配列順・時計は使わない。複数transactionでも混合しない。
profileは単一session・単一main・worker別stream、各tx各type1件、readonly公開観測の合成入力に限定。
実ログや実内部hookのadapter、gate/oracle/upgrade/cleanupは追加していない。

`evidenceStatus` は資料整合性、`transactions[].assessment` は保存イベントのR/U分類、
トップレベル `conditionU` は実験実行状態。異なる軸である。
CONSISTENTでも `missingEvidence` のFUTURE_WITNESSは残る。
Worker completeのみ/送信のみ/停止後受信でU PASSに上げない。
JSONと実終了コードの一致は [40 CLI比較](records/self-check/comparison.json)、
試験96成功（新規60＋継承36）は [原始TAP](records/self-check/tests.tap)、
旧版負対照の意図した失敗は [RED TAP](records/self-check/negative-control.tap) に保存した。

## 保全と再検算

baseはPR #401の正式な研究統合 `a72e0657d07632926d2ace9bcd7836cfbc41ac13`。
main `438cf201abe83a53e8cb8e7ed160c4d6dbe147ba` へ研究系列を統合しない。
PR #403は未マージのまま参照し、独立再レビューとマージ判断を分離する。
差分はこのdirectoryの新規ファイルのみ。既存judge/schema/fixture/原始証拠/製品/runner/workflowは不変更。

`records/SHA256SUMS` は自身を除く本directoryの全保存ファイルのraw SHA-256。
`records/self-check/comparison.json` は40入力/出力のhash、宣言hash、実終了コード。
GitHub取得時の応答、worktree取得時状態、前後hash保全、base blob照合をrecordsに保存する。
旧証拠はコピー生成や再計算で上書きしていない。

```python
from pathlib import Path
import hashlib
root = Path('design/idb-incomplete-stop/collector')
for line in (root/'records/SHA256SUMS').read_text(encoding='utf-8').splitlines():
    expected, name = line.split('  ', 1)
    assert hashlib.sha256((root/name).read_bytes()).hexdigest() == expected, name
```

H1〜H3 UNKNOWN、H4 PARTIAL、本番Worker HOLD、将来実験未承認、開始BLOCKED、U NOT_RUN。
新旧ブラウザ実験/実Worker/実IndexedDB/実メモ/OAuth/MCP検索/8791・8792/Tunnel操作は0。
CIは別途GitHubで確認し、未実行を成功と扱わない。Draft維持、独立レビュー前のマージは禁止。
