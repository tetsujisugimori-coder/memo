# Chart WebKit CI失敗の第一工程調査

対象 Issue #449 / Draft PR #450。製品修正を行わない調査提出。

## A. 総合判定: PARTIAL

固定ソースの比較・計測・証拠保存を完了。原失敗は再現せず、原因確定や不具合解消の判定はしない。

## B. 根本原因: UNKNOWN

有力な静的仮説は、直前の項目移動がrequestAnimationFrameで行うfocus確定と、次のPlaywright fillの競合。実際の失敗時eventを取得できていないため未確定。修正を正当化する反例は得られなかった。

## C. 旧mainとの比較結果: C（今回の有限比較では両方成功）

| 環境 / モード | main 08572bb | PR448 a581cb6 |
|---|---:|---:|
| Ubuntu正式CI / WebKit / 計測なし | 2/2 | 2/2 |
| Ubuntu正式CI / WebKit / 軽量 | 2/2 | 2/2 |
| Ubuntu正式CI / WebKit / 詳細 | 2/2 | 2/2 |
| Ubuntu正式CI / Chromium / 計測なし | 1/1 | 1/1 |
| Debianローカル / WebKit / 計測なし | 2/2 | 2/2 |
| Debianローカル / WebKit / 軽量 | 2/2 | 2/2 |
| Debianローカル / WebKit / 詳細 | 2/2 | 2/2 |

計26試行、成功26、テスト失敗0、試験前停止0、外側timeout0。これは固定された `--feature chart-multi-series` の結果であり、全Chartスイートの成功数ではない。

正式比較は同一job内で両HEADを順次実行。Playwright1.62.1、WebKit26.5/build2336、Ubuntu26.04.1、Node22.23.4。Chromium対照は151.0.7922.34。各組で同じfixture、初期viewport1100×820、元の30秒wait、診断方式。6重要sourceをGit objectとbyte照合し、実行後も不変を確認。各ソース全体の事前manifestも保存。

ローカルはDebian13 / Node24.22.1、同じPlaywright/WebKit版。両HEADに同じ補助ライブラリとlauncherを使用。Ubuntu原CIと同一環境とは扱わない。正規Chromiumバイナリのローカル取得は非ZIP応答で失敗し、その環境では試験未実施。正式CI対照で代替環境の事実を隠していない。

## D. PR #448差分の影響: UNKNOWN

Chart test、Chart utility、typing schedulerは両HEADで同一。PR448のapp.js差分にChart入力/項目移動ハンドラの直接変更はない。一方、保存・競合UIの非同期読取りの変更が時間順序へ影響する可能性は未排除。両HEAD成功を「保存修正と無関係」の証明にしない。

## E. Chart WebKit失敗の直接観測

原run42947740643 / job130284500412ではchart-block.e2e.js:1620の複合waitが30000msでtimeoutした。失敗後のsnapshotは次の状態。

- 項目順: 1月,3月,2月。
- 売上値: [100,120,140]、営業利益値: [30,38,45]、原価値: [60,70,80]。系列順は売上,営業利益,原価。
- status: 「2月」を3件目へ移動しました。
- 期待する「数値は有限な数値を入力してください」が表示されておらず、少なくともerror条件が不成立。
- 原ログはinput欄value、activeElement、DOM node identity、event順、保存event、wait開始時刻を記録していない。最後の観測はtimeout後であり、失敗直前の状態とは呼ばない。
- feature開始02:42:29.1196360Z、legacy段階開始02:42:29.6440802Z、失敗snapshot02:43:04.3638915Z、例外出力02:43:04.4103956Z。30秒待機の正確な開始はUNKNOWN。

原同一runのChromiumは当該feature15.3秒で成功。WebKit特有の根本不具合とまでは断定しない。

静的にはtype=text入力であり、validatorはNumber.isFinite(Number(value))でInfinityを拒否する。入力イベントと項目移動はlive DOMの不正値を同期検査する。成功した今回の計測では、前操作のfocus確定→数値欄focus→Infinity入力→同じ欄への拒否focusの順序を観測した。失敗時にInfinityが届かなかったのか、DOM再構築で消えたのか、別経路なのかは未確定。

## F. 計測の影響

計測なしは実行中のbrowser recorderなし。終了後にsnapshot/画像を採取。軽量はpassive event記録。詳細はfocus呼出しstack、DOM childList、対象waitのNode時計を追加。タイマー、rAF、IDB writer、保存処理は差し替えない。reload前に観測を保存するので対象区間後の追加待ちがある。

正式CI WebKitのfeature時間は計測なし18.0〜23.9秒、軽量18.1〜18.3秒、詳細18.2〜18.4秒。ローカル詳細は27.3/45.9秒(main)、25.6/27.5秒(PR)。少数試行で負荷も完全固定できないため、計測が無影響・高速化した・統計的に同等とは主張しない。取得した対象eventの欠落数は0だが、失敗した順序そのものは観測できていない。

## G. 修正内容

製品コード・既存テストの修正なし。追加は診断preloader/controller、固定比較workflow、調査資料と原証拠のみ。原因未確定のためsemantic wait追加を含む推測修正を見送った。

原CI logの末尾空白を通常CIのdiff検査が拒否したため、原文をtrimせず、byte復元を照合したgzip保管へ変更。初回失敗ログも保持。既存CIの検査は緩和しない。診断workflowはPR opened時の有限比較だけとし、資料追記だけで同じ26試行を漫然と再実行しない。

## H. 再現・検証

修正前反例の再現: 未達。修正後比較: NOT_APPLICABLE（修正なし）。原失敗を偶然の成功で解消済みとしない。

全26正式試行の日時、command、expected/source識別、実測、DOM、chart、focus、保存state、stdout/stderr、画像、JSON、hashを添付archiveへ保存。ローカルlauncher実行確認2回と診断smokeは正式比較26試行から除外。

## I. 正式CI

- [固定HEAD比較run42960691579](https://github.com/tetsujisugimori-coder/memo/actions/runs/42960691579): WebKit12/12、Chromium2/2成功。診断HEAD caf3f697598c606df850cfd9fc94de5b7c704777。
- [初回通常CI run42960691445](https://github.com/tetsujisugimori-coder/memo/actions/runs/42960691445): unit1991/1991、skip0成功。CI checksはその後の原ログ末尾空白検査でFAIL。単体不具合ではないがjob成功へ読み替えない。
- 初回通常CIは全Chart両engine・save-conflict safetyを含む13 job成功、CI checks1 job失敗、任意診断1 SKIPで終了。初回Track A、Palette integrationも成功。最終提出HEADの通常CIは、完了後にPR450本文/最終コメントへSHAを明記して追記する。この文書の固定比較結果を、後続HEADのCI成功へ流用しない。
- 条件付き診断SKIP、既存Track A固定SHA差分ガードの試験前停止は、製品FAIL/成功とは別に報告する。

## J. 独立レビュー

独立担当がsource差分、診断の非侵襲境界、有限予算、元データ、26試行、全source照合、ZIP hash、成功event順を確認。詳細は `independent-final-review.md`。最終判定UNKNOWNを支持し、推測修正を要求しない。GitHubへCOMMENTとして提出し、自己APPROVEやマージ承認にはしない。

## K. 残存リスクとUNKNOWN

- 原CI失敗時の入力値/focus/event/DOM再構築/保存eventがないため因果を確定できない。
- 原CIは先行featureを実行した全suite。この固定比較は当該feature単独。先行feature・browser processの温まり・renderer負荷との相互作用は未検証。
- Playwright fillは要素選択とkeyboard.insertTextが別の非同期段階だが、その間のfocus割込みは今回再現していない。
- 独立した実user入力、Safari/iPhone実機、長期稼働、保存研究の停止復旧はNOT_TESTED。
- 通常保存CAS/IndexedDB/競合原稿保全回復/tombstone/280ms/MCP/OAuth/HOLDは全て不変。実データなし。本番Workerなし。

## L. GitHub提出・証拠

- [Issue #449](https://github.com/tetsujisugimori-coder/memo/issues/449)
- [Draft PR #450](https://github.com/tetsujisugimori-coder/memo/pull/450)
- 原PR448 branchとmainは未変更。最終commit SHAはPRの最終コメントに記録。
- `comparison.json`: 26試行の比較表データ。
- `local-evidence.zip` / manifest: ローカル原票・全26比較のうちローカル12・元CIログ・環境設定失敗・独立初期レビュー。
- `chart-infinity-webkit-initial.zip`: 正式比較12試行の取得ZIP原本。
- `chart-infinity-chromium-initial.zip`: 正式比較2試行の取得ZIP原本。
- `archives-SHA256SUMS` / `raw/SHA256SUMS` / `raw/DECODED_SHA256SUMS`: archiveと解凍原文のhash。

## M. マージ推奨: NO

原因UNKNOWN。Draft維持。#429/#436/#448を原因解消扱いにしない。マージ・公開なし。

## N. 次工程案

元CIと同じ先行featureを含む全Chart実行で、当該前後だけの低負荷event/DOM記録を残す。失敗時のfill対象node・Infinity実入力・前操作rAF focus・click直前値を捕捉し、必要なら同一失敗counterexampleに対して「前操作focus/status完了のsemantic barrier」を検証する。証拠が揃ってからテストまたは製品の最小修正を判断する。この工程では開始していない。
