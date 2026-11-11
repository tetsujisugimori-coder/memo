# Chart WebKit 第2工程報告

## A. 総合判定: PARTIAL

元 CI に近い Ubuntu の全 Chart suite で、旧 main と PR #448 を計測なし・軽量計測各1回ずつ比較し、4/4 成功した。原失敗は再現せず、根本原因は UNKNOWN。詳細計測による全 suite 比較、失敗時の因果診断、異常終了の実試行は未実施。一般 CI の失敗もあるためマージ推奨は NO。

## B. 元 CI 条件

原 run は merge commit `dea1b38b983643f4cdb2d6926159fddff2055877`、tree `51298dab411abe16f02f52d0c021ec506d1e5216`。この tree は比較対象 PR #448 `a581cb66cb0dc4889ff8ce3434c1edad88546431` と一致。旧 main `08572bb0f888c5e8b6f57f3c1aefe98fbf5d2e4d` の tree は `bc6709ee93d44d8722ac653ef9cd960d99b93c03`。

今回の [有限比較 run 42982307800](https://github.com/tetsujisugimori-coder/memo/actions/runs/42982307800) は Ubuntu 26.04.1 / runner 2.338.2 / image 20261101.186.1 / Node 22.23.4 / Playwright 1.62.1。B 群で WebKit 26.5、manifest で WebKit build 2336 を確認。Chromium 151.0.7922.34 は manifest 上の値で、今回 Chromium 試行は未実施。各回は新規 checkout、別 process の actionability smoke 後、`npm run test:e2e:chart:all`。headless、対象 page の初期 viewport 1100×820、以降の viewport 変更は元テストのまま。block 内の create-edit-save → multiple-blocks → multi-series の先行順、block → file-export の順を原ログで確認した。suite と smoke の開始・終了 UTC および各 feature の所要時間は原票にあるが、各 feature の正確な開始・終了 UTC は UNKNOWN。

原 CI と異なり、4回を同じ hosted job 内で直列実行し、各回の TMPDIR は分離、依存は investigation 側 node_modules を NODE_PATH で参照した。B の recorder、1秒退避と close/reload 境界回収は負荷や後続 feature の開始時刻に影響し得る。A は recorder を読み込まない。runner 内の瞬間的負荷、原失敗時の focus・DOM・入力は UNKNOWN。同じ image でも同一の環境状態を意味しない。

## C. 固定 HEAD 全 suite 比較

| 固定 source | 群 | smoke | suite | file-export | suite 開始 UTC | suite 終了 UTC |
| --- | --- | --- | ---: | --- | --- | --- |
| 旧 main | A 計測なし | PASS | PASS 471.665秒 | PASS | 07:50:16.201 | 07:58:07.866 |
| PR #448 | A 計測なし | PASS | PASS 501.286秒 | PASS | 07:58:08.829 | 08:06:30.115 |
| 旧 main | B 軽量 | PASS | PASS 474.318秒 | PASS | 08:06:31.106 | 08:14:25.424 |
| PR #448 | B 軽量 | PASS | PASS 498.648秒 | PASS | 08:14:26.429 | 08:22:45.076 |

日付はすべて 2026-11-11。各群1回であり、計測による所要時間・失敗率の統計的同等性は判断できない。C 詳細は合成 fixture で限定確認したが全 suite は NOT_RUN。再現しなかったため追加試行は行わなかった。各 checkout は開始前 clean、終了後の tracked source status は空。

## D–F. 再現・入力・focus・DOM

原失敗の再現はなし。両 B 群の multi-series page 3、各 document 内の seq 147–158 で次を観測した（node ID は各 document 内のみ有効）。

1. 先行の項目 down click（seq147）の後、移動済み項目の up button へ focusin（148）。対象 input node 88 へ focusin（150）、値140、接続中。
2. 同じ node 88 の beforeinput（151）で140、input（152）で `Infinity`。対象は2件目・売上、`chartSeriesIndex=0`。
3. pointerdown と button focus の後、対象 down button の click 捕捉（156）。この時点で node 88 は接続中・値 `Infinity`、項目は `1月,2月,3月`、系列値は `[[100,140,120],[30,45,38],[60,80,70]]`。status は既に有限数値エラーだったため、click 自体が status を発生させたとは断定しない。
4. その後、同 node 88 に focusin（158）。元テストの複合 wait と、不正値保持・項目順 assertion は成功した。

軽量群は focus 呼出し stack、MutationObserver、rAF 発火時刻、wait 開始・終了を記録していない。両時点で同 node が接続されていたことは観測したが、間の一時的な切断や変更がなかった証明ではない。詳細群の合成 timeout 試験では wait 拒否と snapshot を確認したが、実 suite timeout は起きていない。異なる document の時計や node ID を直接比較しない。

## G. 仮説

| 仮説 | 今回の支持・否定材料と未取得 | 反証・判定に必要な条件 |
| --- | --- | --- |
| H1 rAF focus と fill の競合 | 成功2例では先行 button focus が input より前。失敗時 stack/rAF は未取得 | 失敗時の同一 document の focus call・入力と実行順 |
| H2 意図した node に入力が届かない | 成功2例では対象 node に beforeinput/input が到達。原失敗には値・event がない | 失敗時の fill 対象、受信 node、focus の一次証拠 |
| H3 DOM 再構築で値が消失 | 成功2例は input と click で同じ接続 node・Infinity。途中の変更は未観測 | 失敗時の mutation 通知、node 同一性、再構築前後値 |
| H4 値維持後に検証対象が異なる | 成功2例は click 時に Infinity を保持し、拒否 assertion が成功。原失敗は未観測 | 失敗時の検証直前 DOM、検証対象、status とモデル |
| H5 先行試験・状態・負荷 | 今回は先行 feature 順を復元したが再現なし。負荷の同一性は未検証 | 失敗条件と対照の browser/process・負荷の比較 |
| H6 PR #448 の間接影響 | 両固定 tree の今回の4回は成功。非同期影響は排除できない | 固定条件で失敗の有無と保存/UI時系列を比較 |

いずれも原失敗の因果は UNKNOWN。成功例は失敗時仮説の反証にはならない。

## H–I. 計測影響・異常終了

4試行の外側 timeout 0、suite test failure 0。A は通常の suite を追加計測なしで起動。B はページ内の最大1500件 queue、1秒ごとの非同期送信、1 MiB の Node write buffer 上限、close/reload 境界の回収を使う。C は focus call stack と MutationObserver の詳細機能を持つが、タイミングへの影響がある。タイマーや rAF は置換しない。

記録済み 11,602 event / 120 document で、観測された連番欠落・重複・dropped・recorder error は0。4 process の accepted write 799件はすべて write callback 完了、write error・rejected 0。ただし callback は永続記録の保証ではない。110 document に境界回収があり10 document にはない。最終受信 UTC は 08:22:44.777。未送信末尾・回収されなかった document の件数は UNKNOWN。正常終了でもこれらを完全取得と扱わない。

合成テストで wait timeout 時の snapshot・分類、Linux で detached 子孫の捕捉と終了を確認。外側 timeout や process 異常終了の実 trial は NOT_RUN。突然の終了時は最後に退避済みの範囲のみで、既に再親化した子孫と未送信末尾は UNKNOWN。容量監視は5秒ごとで1 GiB の厳密な上限ではない。

## J. 正式 CI・単体確認

実験 HEAD `6649e3fbfec3800475cfff58782890c2399bcbb5` の有限比較 workflow は SUCCESS。最初の通常 CI [42982307768](https://github.com/tetsujisugimori-coder/memo/actions/runs/42982307768) は診断専用 `.test.cjs` の自動検出により WebKit 未導入の2 job が FAIL。原ログを保全し、専用テストを `-check.cjs` に改名、専用 workflow で明示実行する局所修正を行った。診断機能の実行コードは同一。

修正 HEAD `5cd0724ab3c1308b49206990b3cb2983fba9bfc2` の通常 CI [42983927651](https://github.com/tetsujisugimori-coder/memo/actions/runs/42983927651) は **13 SUCCESS・Figure E2E 1 FAILURE・任意診断1 SKIP**。CI checks と Windows recovery はそれぞれ unit 1991 PASS・0 FAIL・0 SKIP。Figure は `report-preview.e2e.js:40` の入力値不一致で、原因 UNKNOWN、Chart と同一原因とはしない。修正 HEAD の診断 workflow は実験重複防止ゲートのみの成功で、追加試行ではない。

ローカル WebKit 合成 fixture の最初の2 FAIL は data URL 文字コード指定漏れで、反例原票を `validation/` に保存。修正後の専用チェックは4 PASS・Linux 固有1 SKIP、分析器の合成反例1 PASS。ローカル一般 test は sandbox 内で履歴権限エラー、制限外の再実行では MCP 関連1件 `ECONNRESET` で FAIL。CI の成功へ読み替えない。

## K. 独立レビュー

独立担当が実装者の集計とは別に原 suite log、JSONL、result、561ファイルの SHA-256、ZIP digest、入力 node、event 順、source status、各 exit と通常 CI 原ログを照合。4/4成功と上記の限定観測を確認し、未送信末尾・原失敗の因果・画像とバイナリの機密不存在は UNKNOWN とした。診断テスト自動検出と分析器が input 不在の click を見落とす点を指摘し、各局所修正と反例確認を実施。COMMENT 相当の独立確認であり APPROVE ではない。

## L–N. 別問題・原因・判断

第一工程の保存ガイド `#restore` / `#check` は別問題として [Issue #447](https://github.com/tetsujisugimori-coder/memo/issues/447) で追跡。保存競合本体10/10成功とガイド13 PASS・1 FAIL・6 NOT_RUNを混同しない。今回、保存処理・ガイド・製品コードは変更していない。原 Chart 失敗の根本原因 UNKNOWN、マージ推奨 NO。

## O–P. 次工程・証拠

異常終了時に未回収末尾が残る設計の改善と、詳細 C 群の full-suite 予算を別途設計する。原失敗の一次証拠を取得するまでは、製品修正や期待値・timeout の変更をしない。

- [原 artifact](https://github.com/tetsujisugimori-coder/memo/actions/runs/42982307800/artifacts/13839268363) は14日保持。原 ZIP をこのディレクトリに保存し、GitHub の digest と一致: SHA-256 `26a8bfa276ad4faef292cf16b5d990074afffe8a701bd3b94908cf78456483f4`。
- ZIP 内 manifest の561ファイル hash は全一致。manifest 自体の真正性や未列挙ファイルの不存在を、この照合だけでは証明しない。`analysis.json` は原票からの派生、原票は変更していない。
- CI の限定パターン走査はテキスト29ファイルが対象。追加の全561ファイル byte 走査で node compile cache の4ファイルに秘密鍵ヘッダー文字列を検出したが、対応部分は14 bytes で base64 形式不成立、正常な PEM 鍵を示さない。画像164枚のうち1枚を目視し合成 Chart fixture と確認したが、全画像・他形式の機密不存在を完全には証明しない。テスト fixture は合成データ。
- [Issue #449](https://github.com/tetsujisugimori-coder/memo/issues/449) / [Draft PR #450](https://github.com/tetsujisugimori-coder/memo/pull/450)。最終 HEAD とその CI は提出コメントで読み戻す。
