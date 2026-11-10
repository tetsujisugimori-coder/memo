# 保存ガイド P3-01 / P3-02 後続改善

判定は **PARTIAL / マージ推奨 NO**。UI導線と試験登録を実装したが、既存保存処理の複数タブ競合を発見したため、限定PASSの条件は満たさない。今回はDraft PR提出までで、mainへの変更・マージを行わない。

- 作業Issue: https://github.com/tetsujisugimori-coder/memo/issues/428
- 先行Issue / PR: #426 / #427
- 分離した保存競合Issue: https://github.com/tetsujisugimori-coder/memo/issues/429
- base main: `8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`
- 最終実行コードHEAD: `e2f434e5c5c9d799158509fbea0294b7b4c47fcb`
- branch: `codex/storage-guide-ci-tab-followup-20261106`
- worktree: `work/storage-guide-ci-tab-followup-20261106`。baseと同じHEAD・cleanで開始。

## 差分と境界

| ファイル | 変更と理由 |
|---|---|
| storage-guide.html | 元アプリタブへ戻る案内。上部の新規タブリンクを外し、直接訪問向けの同じタブ内リンクをfooterのdetailsへ配置。複数タブの安全保証はしない。scriptなし。 |
| storage-guide.css | detailsのsummaryへフォーカス表示を適用。不要になった上部リンク用指定をsummaryの操作領域へ置換。 |
| storage-guide.e2e.cjs | 元20条件を維持。新導線、失敗画像/JSON、要求失敗、20件完走を確認。保存待ちはNodeで明示的にawaitして判定。 |
| storage-guide-negative.e2e.cjs | 静的資源だけを専用TEMPへコピーし、リンク欠落・横幅異常を注入。両エンジンが故障自体でexit 1になることを確認。timeoutや起動失敗は負対照PASSに数えない。 |
| storage-guide-tabs.e2e.cjs | 同一contextの架空メモをUIで編集。保存レコード・画面・保存状態・通知・再読込・ガイド副作用を観測。競合や途中失敗は非ゼロ終了。 |
| package.json | `test:e2e:storage-guide`、`:negative`、`:tabs`を登録。依存追加なし。package-lock.jsonは無変更。 |
| .github/workflows/ci.yml | 新規非任意storage-guide-e2eジョブのみ追加。Ubuntu 24.04、Node 22、Chromium/WebKit、pipefail、always成果物保存。既存ジョブは無変更。 |
| docs/storage-guide-followup/** | 今回の境界、原証拠、観測結果だけ。前回PR #427の証拠は上書きしない。 |

`index.html`の既存別タブガイド導線は維持。`app.js`、保存/復元/ZIP、IndexedDB、MCP/OAuth、Worker、研究契約/collector/judge/schema/研究workflowは無変更。

全open研究16PR・2042変更パスを再取得した[境界表](research-boundary.json)で、共通パスは`.github/workflows/ci.yml`（PR #388）だけ。ガイド専用ジョブ追加の43行に限定し、既存MCPジョブを含む全既存ジョブには変更なし。研究PRのbase/HEADを変更しない。

## 静的に確認した複数タブ保護の範囲

- app.jsの`memoSyncChannel` / `notifyMemoChanged` / `refreshMemoFromOtherWindow`と`getMemoSyncDecision`は、BroadcastChannelで別タブの更新を伝える。cleanな同一メモは`applyMemoSync`で画面へ反映する。
- dirty時の更新は`pendingMemoSync`として保留する。ただし`renderMemoSyncNotice`は表示しない。
- `note-save-foundation.js`の`entries`・`lockTail`・`withNoteLocks`は各タブ内の保存順序を制御する。
- 通常本文の`putNote`は同じIDへ`store.put`する。受信処理などで使う`navigator.locks`を、通常メモ保存全体のタブ間ロック保証へ拡張しない。
- 以上は静的な実装範囲の確認。全スケジュールの安全性、他ブラウザ/実機/PWAはUNKNOWN。

## 固定HEADの主担当ブラウザ結果

Windows、Node 24、Playwright 1.62.1。通常のPowerShellではnpm.ps1が実行ポリシーで拒否されたため、設定を変更せず`npm.cmd run ...`を使用。Linux CIはNode 22と`npm run ...`を使用し、CI結果はPR/Issueへ別記する。

| 試験 | 結果 | 原結果 |
|---|---|---|
| ガイド20条件 | 20/20 PASS、exit 0 | [local/results.json](local/results.json) |
| リンク欠落負対照 | 両エンジンが`guide anchor #backup missing`でexit 1。故障検出PASS | [負対照結果](local/negative-controls/results.json) |
| 横幅異常負対照 | 両エンジンが`guide horizontal overflow`でexit 1。故障検出PASS | 同上 |
| 複数タブ10条件 | 両エンジン7 PASS / 3 FAIL、全条件到達、例外なし、exit 1 | [複数タブ原結果](local/multiple-tabs/results.json) |

ガイド20条件は、両エンジン×1280px/390px×light/dark×通常/reduced-motionの16表示条件＋4保存回帰条件。Skip link、Tab/Enter、可視フォーカス、目次、リンク、横スクロールなし、ガイドの保存/通信API呼出し0を維持。ガイド中の全IDB store/localStorage/sessionStorage不変、前後の通常自動保存、reload後の本文/題名保持も確認。直接訪問向けリンクは同じタブへ遷移し、ページ数を増やさない。

一時browser context・動的loopback origin・架空データのみ。既存プロファイルを開かず、保存領域の初期化/消去、直接の保存関数呼出し、timer/channel/IDB writerの差替えをしない。外部表示資源はローカル応答で置換し、実MCP/OAuth接続なし。JavaScript例外、console error、HTTP失敗、要求失敗は最終主担当検証で0件。

## 複数タブ: 期待と実測

| 条件 | 期待 | Chromium / WebKit 実測・判定 |
|---|---|---|
| 1 | 同一保存領域で2タブ | 同一一時context・同一origin、2ページ。PASS / PASS |
| 2 | 同じメモを両方へ表示 | 同一ID・同一基準本文。PASS / PASS |
| 3 | 一方だけ編集して自動保存 | 明示的な読取りpollでレコードと保存済みを確認。PASS / PASS |
| 4 | 他方の画面と保存状態も反映 | cleanなタブへ通知反映、保存レコードと一致。PASS / PASS |
| 5 | 時間差で重なる非重複の行編集を保持 | Aの変更が残らずBの本文だけが保存。FAIL / FAIL |
| 6 | 保存済み画面とレコードの一致 | 両方ともB本文へ揃う。PASS / PASS（編集保持を意味しない） |
| 7 | 編集欠落時に警告/保存停止 | 両方保存済み、dirty=false、notice空、pending=null。FAIL / FAIL |
| 8 | reload後も両変更を保持 | reload後もA変更がない。FAIL / FAIL |
| 9 | ガイドを読むだけでデータ不変 | 両タブの全IDB store/local/session不変。PASS / PASS |
| 10 | 新規アプリタブを増やさず直接訪問者も移動可能 | 元ガイドを閉じれば元2タブのみ。別一時contextの直接訪問は同一タブ遷移・ページ数1。PASS / PASS |

再現本文: 両方`lineA=single`改行`lineB=sequential`から、通常autosaveの前にAは`lineA=overlap-A`へ、Bは`lineB=overlap-B`へUI入力。双方dirtyを確認する。保存後は`lineA=single`改行`lineB=overlap-B`となる。Aの非重複変更が残らない。架空データでの再現であり、実ユーザーデータ消失を観測したとは述べない。原JSONと画像を保全し、根本修正は#429へ分離した。

## 偽PASS防止・旧証拠の扱い

- 実環境の非同期`waitForFunction`について、300ms後にfalseを返すpredicateでも成功終了する最小例を観測。保存の待機はNode側で`await page.evaluate`した結果の真偽を判定し、明示的pollへ置換した。ライブラリ全環境の一般化はしない。
- `5f2e979`は上記保存待機の強化前。`68afff8`は強化後だが、読込/popup timeoutを含む旧実行。今回の受入PASS証拠に使わない。
- `7e35b7f`はtabs reload待機の修正途中。最終完全実行は`e2f434e`。
- DOM読込＋既存startupGuardを待ち、表示資源のload待ちとアプリ起動を分けた。timeout値を延長していない。
- 主担当/独立担当のローカルブラウザを順次実行し、同時実行の干渉を避けた。失敗・未到達をPASSへ読み替えない。
- suiteは20件完走かつ全PASSでのみ成功。途中例外、起動失敗、件数不足、保存不一致は非ゼロ終了。tabsの途中例外で未到達の条件はUNKNOWNを補完する。
- 負対照はmkdtempした静的資源だけへ注入。childの非ゼロだけでなく、両エンジンの対象故障メッセージまで一致を要求。製品HTML/CSSのhash不変を確認し、使い捨てコピーだけを削除する。
- CIはpipefailを使用し、ログ・JSON・失敗画像をalways保存。任意Inspector診断のSKIPPEDは成功に含めない。既存P2を検出するtabsを無効化してCIを通さない。

## 残件と判断

独立最終レビューと最終PR HEADのCI結果はPR/Issueコメントへ固定HEAD付きで追記する。コードHEAD以降に証拠だけを追加した場合は、実行コード差分0を確認する。CIや独立検証で今回の変更が妥当でも、既存P2が残るため総合PARTIAL・マージ推奨NO・Draft維持とする。

実機iPhone/Safari/PWA、スクリーンリーダー、外部CDN実通信、全並行スケジュールはNOT_TESTED/UNKNOWN。J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持。実接続・実OAuth・Worker/IDB停止実験・実メモ操作なし。

2026-11-06 JST
