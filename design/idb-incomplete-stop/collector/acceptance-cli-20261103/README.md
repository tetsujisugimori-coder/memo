# PR #405 CLI障害P2 独立動的受入（2026-11-03）

## 結論

**今回の局所受入：PASS／CLI障害P2閉鎖：YES。PR全体：PARTIAL／マージ推奨：NO。**

旧版の既知反例を新しいNode子プロセスで再現し、同じ入力bytes・故障注入・独立期待値で修正版の拒否を確認した。製品・Collectorの実装、schema、既存試験、保存済み証拠は変更していない。このディレクトリは検証専用である。PRはDraft・未マージを維持する。

これは実装を行った同じ作業アカウントからの、別oracleによる再実行記録である。人間の別レビュー担当者による承認や、GitHubのrequired approvalの代替を主張しない。

## 固定版・事前調査

| 対象 | 固定SHA |
|---|---|
| 旧版 | `5d16dd0cc4d18186ec59947c2073c409b2f8c34b` |
| 受入対象版 | `e4a5d414689f23e1b33660bce3e006c46fb4e37f` |
| base | `a72e0657d07632926d2ace9bcd7836cfbc41ac13` |

開始時のGitHub HEADとローカルHEADは受入対象版と一致。baseは`investigate/idb-time-delay-only`、PRはopen/Draft/未マージだった。PR本文、過去レビュー、[今回のレビュー5750954418](https://github.com/tetsujisugimori-coder/memo/pull/405#pullrequestreview-5750954418)、Issue #404の履歴、AGENTS.md、研究契約とCollector契約を確認した。GitHub取得原文は`records/github-*.json.gz`に保存した。今回の証拠commitでHEADが進んでも、検証対象は上記e4a5版から変更しない。

`prepare.py`はGit blobを直接取得し、旧版4ファイル・対象版126ファイルを別ディレクトリへ配置する。改行変換を行わず、130ファイルのSHA-256・Git blob・mode・固定SHAを`records/prepared.json`へ記録した。既存の他worktreeを実行場所として使わなかった。

## 独立性と実行環境

- Windows `10.0.26300` x64、Node **v24.20.0**、Ajv **8.20.0**（`ajv/dist/2020`、strict/allErrors、Draft 2020-12）。依存を新規追加していない。
- 新規`accept.cjs`はCollectorをimportせず、保存済みPASS/TAP/summaryも判定に使わない。契約から手書きで固定した16条件のoracleを、既存expectationsと実行前に照合する。
- 既存shimは対象の合成入力fdだけに注入し、実際の読込み・cryptoを使うことを確認した。closeは実fdを閉じた後にJavaScript例外を注入する。**実OS起因のclose/EIOはNOT_TESTED**であり、ここでは実証していない。
- 各条件で本物のNode子プロセスを起動。実status・stdout・stderr・故障trace・入力hash・argv・期待値・全assert違反を保存する。状態不一致で最初に検査を打ち切らず、schema、診断、派生情報、禁止状態も独立確認する。
- 再生成したfixture/expectationsが固定Git版とbytes一致することも別途確認した。fixture生成器はCollector出力を読まない。
- 回帰183件も固定版から新しく実行した。過去JSONは出力の不変性比較にだけ使用し、新しい試験成功の代わりにしていない。

## 16条件の実測

`N`＝CONSISTENT／JSON exit 0／実Node exit 0／R PASS・U FAIL。`E`＝INVALID_SCHEMA／JSON exit 2／実Node exit 2。CLI取得エラーの場合はCLI_INPUT、両hash null、全派生配列空も要求する。サイズ超過・不正JSONは従来のJSON診断契約である。

| 条件 | 期待 | 旧版 | 対象版 |
|---|---|---|---|
| normal | N | PASS | PASS |
| short-read-success | N | PASS | PASS |
| open | E、open診断 | PASS | PASS |
| read | E、read診断 | PASS | PASS |
| partial-read | E、17 bytes後read障害 | PASS | PASS |
| close | E、全bytes+EOF後close障害 | **FAIL** | PASS |
| read-close | E、readとclose両診断 | **FAIL** | PASS |
| partial-read-close | E、17 bytes後、両診断 | **FAIL** | PASS |
| close-wrong-hash | E、CLI入力不採用優先 | **FAIL** | PASS |
| close-invalid-json | E、CLI入力不採用優先 | PASS | PASS |
| arity | E、usage診断 | PASS | PASS |
| missing | E、ENOENT診断 | PASS | PASS |
| oversize | E、2 MiB超、部分hash不採用 | PASS | PASS |
| long-open-error | E、CLI_INPUTと省略明示 | PASS | PASS |
| read-long-close | E、read保持・長いclose省略明示 | **FAIL** | PASS |
| invalid-json | E、従来JSON診断 | PASS | PASS |

**旧版16実行：11成功・5失敗。対象版16実行：16成功・0失敗。skip 0。**

旧closeは2962 bytesとEOFを読んでから注入が成立し、CONSISTENT／JSON 0／実終了0／R PASS／semantic hash・transaction・relation残存を再現した。旧close-wrong-hashはINCONSISTENT／終了1となり、CLI障害としてのINVALID_SCHEMA／2に一致せず、派生評価も残った。旧複合障害3件は終了2でもread診断を失う。5件すべてを「誤終了0」とは数えない。

対象版では、全CLI取得障害にCLI_INPUTを保持し、`actualSha256`・`semanticSha256`はnull、`transactions`・`relations`・`orderRelations`・`missingEvidence`・`contradictions`・`unknownReasons`はすべて空。read/close両診断と長文のDIAGNOSTICS_TRUNCATEDも確認した。正常2件は従来R PASS/U FAILを維持し、旧版から契約適合だった11条件はstdout bytesがすべて一致した。

両版**32/32のstdoutは単一JSON・result schema適合**。旧版の問題はschema構造だけでは検出できない意味的な矛盾である。対象版16件はJSON exitと実プロセスstatusがすべて一致し、契約のstatus/exit組合せにも一致する。各子プロセスのstderrは空、timeout・signal・起動例外なし。独立受入runnerの実終了は0。旧版5 REDは期待した負対照であり、旧版の不具合を隠してrunnerを成功扱いにしたものではない（`records/old-16.tap`の5 not okを保存）。

生データは`records/dynamic-final.tar.gz`内の各`*.judgement.json`・`*.stdout.json`・`*.stderr.txt`・`*.trace.json`。oracleと環境は展開不要の`dynamic-oracle.json`・`dynamic-environment.json`にも保存した。最初の実行も`dynamic-first-execution.tar.gz`として保全し、結論には最終oracleの新しい実行を使用した。

## 回帰183件と保存JSON比較

| 群 | 実行 | 成功 | 失敗 | skip | 実終了 |
|---|---:|---:|---:|---:|---:|
| Collector・judge等 | 96 | 96 | 0 | 0 | 0 |
| 追加回帰 | 69 | 69 | 0 | 0 | 0 |
| R1診断上限 | 18 | 18 | 0 | 0 | 0 |

Windows排他読込み拒否1件、Ajv比較31件を含め、今回はskipなし。R1の大量未知キー、256件上限、8192コードポイント、DIAGNOSTICS_TRUNCATED、後方の理由コード保持を新しい出力に対して再照合した。新しい95資料（40+37+18）の結果schemaもAjvで独立検査した。合計127結果（32+95）のschema検査は全件適合。controllerのargv/statusと原始TAP・JSON・stderrは`records/regression.tar.gz`へ保全した。

| 保存結果との比較 | bytes一致 | 環境pathだけの差分 |
|---|---:|---:|
| 既存40資料 | 40/40 | 0 |
| 追加37資料 | 35/37 | 2 |
| R1 18資料 | 17/18 | 1 |

差分はすべて`/validationErrors/0/detail`の1フィールドだけ。`A-missing`はENOENT、`A-denied`はEBUSYのエラーに含まれる隔離先fixture path、`long-cli-error`は長い不存在pathの保存先previewが異なる。errno・メッセージ・対象basename・他全フィールドは保持された。`output-comparisons.json`にbefore/afterとhashを記録した。pathだけを限定して正規化する照合を行い、JSON全体や理由文を無条件に無視していない。

最初の比較器はA-missingの隔離path差で停止した。これは実装不具合ではなく、差分全体を別途調べて上記3件を特定し、比較器の環境差許容を限定した。初版比較器と差分preflightも保存した。テスト、固定期待値、原出力は変更していない。

**完全に同じargv**での長い不存在path対照も別に新しく実行し、旧新stdout bytes一致・実終了2/2を確認した（`records/same-argv.tar.gz`）。R1の保存先path差と区別した。

## 根本原因の閉鎖

| 観点 | 判断 | 根拠 |
|---|---|---|
| A 旧欠陥の再現 | PASS | 固定旧版のclose誤成功と複合診断喪失を実Nodeで再現 |
| B 同条件で拒否 | PASS | 同一bytes・oracle・shim、対象版16/16 |
| C 原因の解消 | PASS | 入力取得失敗分岐では新しい不採用結果を構築し、collectEvidenceは無障害のelseでだけ実行 |
| D 正常系の保護 | PASS | 正常2条件、11条件bytes一致、183回帰、95出力比較 |
| E 診断の整合 | PASS | 複合障害のread/close保持、長文省略明示、Ajvと実status照合 |

`runCli()`より前の旧新ソースはbytes一致で、R/U判定、完全identity、部分順序、parser、Unicode、R2述語の変更はない。静的確認と動的結果が同じ根本原因の解消を支持する。新たなP1/P2/P3は今回の受入範囲で確認していない。追加の実装修正工程は不要と判断する。

## 保全と残件

- 62 worktreeのHEADを実行前後に確認。他61 worktreeのstatusも不変。事前4432ファイル（研究・既存変更・未追跡を含む）は全件hash一致。対象worktreeは開始時cleanで、今回の新規検証ディレクトリだけを追加した。
- 固定130ファイルのhashは実行後も一致。旧CLI修正manifestを固定Git blobから独立再計算し**449/449一致**。元の証拠は上書きしていない。
- `records/SHA256SUMS`はこの新規検証資料だけを対象とする。ソース対応は`prepared.json`のGit blob/mode/hashで追跡できる。証拠commit後にも旧Git treeのblob/mode不変を別照合する。
- CI結果とローカル再実行は別。証拠commitには`[skip ci]`を付け、GitHubで実runがなければ**CI NOT_RUN**と報告する。ローカル183件をCI成功とは扱わない。
- R2/P3（有限sourceMsの安全整数制限による誤拒否）は**未解決・無変更**。実OS close/EIO、実ログadapter、WebKit内部ID/build照合、実停止境界、外部recorderの完全性、条件U実験、本番統合は今回の成立範囲外。
- H1〜H3 UNKNOWN、H4 PARTIAL、条件U／実験 NOT_RUN、executionAuthorization NOT_GRANTED、startCondition BLOCKED、本番Worker HOLDを維持。ブラウザ・Worker・IndexedDB・実メモ・OAuth/MCP・8791/8792・Tunnel・実験環境は起動・操作していない。

## 再実行

PythonとNode、既存のAjv 8.20.0を利用する。作業先は未使用の短いpathにし、Windows排他読込み試験ではrepo内の`work/`配下を推奨する。既存出力への上書きは拒否する。

repo root（この検証資料を追加したbranch）からの例：

```powershell
$acceptance = 'design/idb-incomplete-stop/collector/acceptance-cli-20261103'
$run = 'work/u1-independent-cli-rerun'
python "$acceptance/prepare.py" $run
node "$acceptance/accept.cjs" $run "$run/dynamic-final"
node "$acceptance/replay.cjs" $run
node "$acceptance/check-results.cjs" $run .
node "$run/new/design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/fixtures.cjs" "$run/authored-fixtures"
node "$run/new/design/idb-incomplete-stop/collector/diagnostic-fix/cli-error/same-argv.cjs" "$run/same-argv" "$run/old/design/idb-incomplete-stop/collector/collect.cjs"
```

実行時の絶対argv・環境・終了コードは記録側を参照。`package.py`は今回の開始時audit snapshotを必要とする保存用であり、試験自体の実行には不要。archiveはtar+gzipで、固定ソース、入力、期待値、注入器、stdout/stderr/TAP/traceを含む。hash確認は次で行う（manifest自身は自己参照を避けて除外）：

```powershell
python "$acceptance/seal.py" verify
```

作成日時：2026-11-03 20:31 JST（実行時刻の詳細は環境記録と保全記録を参照）。
