# 工程③ 検証記録

Issue #431 / stacked Draft PR #432。baseは親Draft #430の`4651a506245f19086e34125cc1eed00512eb71ab`、固定コードHEADは`58e3cb8e09a5c0e8d24071f173054209de72b6b6`。この文書と証拠の追加後の最終HEADおよびLinux CI実行URLはPR/Issueの追補に記録する。コードHEADの結果を最終HEADで再実行したものと偽称しない。

## 分離した判定

| 対象 | Windows時点の判定 | 根拠 |
|---|---|---|
| テスト契約の改善 | PASS（Linux CIは別途追補） | A/B正常合成例、偽PASS反例、有限観測、独立レビュー |
| 現行製品の複数タブ保存安全性 | FAIL | 架空メモのA行変更が消失し、再読込・タブ終了後も回復しない |
| CI全体 | 未実行、最終HEADで追補 | 製品REDを非任意試験で検出するため、全体SUCCESSを期待しない |
| マージ推奨 | NO | 製品競合未解消。今回の依頼はDraft提出まで |

## Windows・固定コードHEAD

すべて隔離browser context、localhost、一時データで実施。実ユーザーデータ・実MCP・OAuth・Worker停止操作なし。試験は順次実行した。

| 試験 | 実装担当 | 独立担当 |
|---|---|---|
| 判定/観測の単体 | 40/40 PASS、exit 0 | 40/40 PASS（tabs起動時にも実施） |
| 元の保存ガイド20条件 | 初回FAIL、無変更の1回再試験20/20 PASS | 初回20/20 PASS、exit 0 |
| 負対照2件 | 2/2 PASS、対象故障でchild exit 1 | 2/2 PASS、対象故障でchild exit 1 |
| 複数タブChromium | 10条件到達、5/7/8 FAIL、exit 1 | 10条件到達、5/6/7/8 FAIL、exit 1 |
| 複数タブWebKit | 10条件到達、5/7/8 FAIL、exit 1 | 10条件到達、5/7/8 FAIL、exit 1 |

40件は**純粋関数・観測器に対する合成入力等の検査**。正常自動統合Aと安全停止Bの合成入力は双方PASSするが、現行製品がA/Bを実装・達成した証拠にはしない。

元20条件のコードは親から変更なし。Chromium/WebKit、1280/390px、light/dark、通常/reduced-motion、キーボード・focus・横スクロール・リンク・例外・保存不変性・自然自動保存・再読込保持の条件を維持。

実装担当の最終コードHEAD初回20条件ではChromium 390/dark/reduceのアンカーで期待`#check`に対し実測`#restore`となり、そのブラウザの後続条件は未到達。`evidence/windows/guide-first-failure/results.json`を保存した。製品・試験コードを変更せず、1回の独立した再実行が20/20成功した記録が`guide-retry/results.json`。独立担当は同じHEADの初回で20/20成功。最初の失敗をPASSに再分類しない。アンカー検査のタイミング依存は残存リスクとして工程③外へ残す。

負対照は使い捨てコピーでリンク欠落・横幅不正を注入し、両engineで所定の故障を検出した。元製品ハッシュ不変。故障注入コードは製品に残していない。

## 製品REDの実測

同じ2行メモにA/B別行の編集を行い、自然な自動保存を待つ。実装担当では両engineともB行編集だけがDBに残り、双方の画面は保存済み、警告なし。再読込・両タブを閉じて再起動した後も同じメモでA行編集は失われていた。`lossDemonstrated=true`、`silentOverwrite=true`。5/7/8はFAIL、productSafety=FAIL。

独立担当Chromiumは観測タイミングが異なる。terminal時のDBはA本文、A画面はA本文、B画面はB本文で、双方saved/dirty=false/警告なし。条件6がUI/DB不一致でFAIL。その後reload/reopenではDB・双方画面がB本文になりA編集消失。`silentOverwrite=false`でも後段の`lossDemonstrated=true`によりFAILする。独立WebKitはterminalからB本文、`silentOverwrite=true`、同じ消失でFAIL。観測順序を完全なcommit履歴と呼ばず、異なる実測を同一結果へ書き換えない。

全実tabs結果のJavaScript例外、console error、HTTP error、request failureは0。現行製品には契約で要求する原稿保全・拒否記録・回復UIがなく、回復操作はUNAVAILABLE。手動コピーできるはずという推測でBをPASSにしない。

## 独立レビューと局所修正

別Codex子エージェント`/root/tab_contract_review`が固定HEADの実差分、単体、実ブラウザ結果を確認した。

- 初回P2: Bの回復操作後に未保存本文を保存済み表示しても通る経路。回復前後のUI/DB整合性検査、反例単体を追加。
- 初回P2: 不完全reportやNOT_TESTED/FAILの実行状態がproductSafetyへ正しく反映されない経路。全10条件・実行状態・エラー配列等の完全性を検証し、不備時の製品PASSを禁止。
- 有限待機の残時間でsleepを制限。回復書出し後に正しい確定本文のsaved UIへ戻る安全なケースもBとして許可し、単体で確認。
- 試験の再読込で別のTodayメモを検証しないよう、実UIで同じ架空メモを選択。ナビゲーションはapp起動guard完了とeditor可視を待ち、無関係なDOMContentLoaded待ちに依存しない。

最終固定コードHEADの再レビューでは新規P1/P2なし。詳細と最終HEADのdocs-only照合はレビュー追補参照。既存製品P2 #429を解消したという判定ではない。

## 境界・証拠・未確認

親baseからコード差分はtabs runner、contract、observer、contract単体、package.jsonの専用tabs起動1行だけ。packageの依存追加なし。app.js、note-save-foundation.js、元20条件、負対照、workflowは変更なし。mainからの差分には親PR #430の変更が含まれるため、工程③のレビュー範囲は親HEADからの差分とする。

開始時open PR全17件（親#430と研究16件）のbase/headと全変更pathは`boundary.json`。研究PRの変更・研究専用workflowの変更なし。最終照合はPR追補に記録する。

証拠は`evidence/windows`と`evidence/independent-windows`。JSONのtestedHeadを保持し、画像名・ソースパスを改変しない。元TEMP絶対パスがJSONに残っていても同内容をこのディレクトリへ複製したもの。hash manifestを併記する。

方式Bの実製品正常試験はNOT_TESTED（未実装）。保全形式とDOM bindingは具体的に検証できるtest-only契約であり、将来別の安全な回復UIを採用する場合は意味条件を維持してobserverを適応する。全保存interleaving・全commit履歴・ブラウザ外の異常終了耐性を今回保証しない。Linuxは最終HEAD CIで別途観測する。

次工程②は`contract.md`のとおり、原子的revision比較による古い書込み拒否、note/attempt単位の永続原稿保全、明示的な競合/未保存UI、実回復手段を優先する。今回保存処理は変更していない。

J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持。

2026-11-07 JST
