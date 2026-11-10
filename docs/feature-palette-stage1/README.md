# 機能パレット Stage 1 / Issue #440

## 着手時の境界と変更対象

- 基準main: `8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`。2026-11-10取得。新規cloneと独立branch `feat/feature-palette-stage1-440` を使用し、基準の別worktreeも保持した。
- 未完了Issueと23件のopen PRを確認。保存競合#435、研究/診断#388–#439などは取り込まず、main・別PR・既存作業ツリーを変更しない。
- 着手前にAGENTS/README/LOG、editor-toolsの15ボタンと注意書き選択、title-row/title-content/note-meta、editorのflex高さとスクロール、mobileWritingTools、popout・テーマ・既存UI/E2E契約を確認。
- 変更前に提示した対象は index.html（同一DOM/IDをパレットで囲み入口を設置）、style.css（上部の余白と重ね表示）、app.js（開閉UI連携だけ）、UI専用module、対応テスト、文書・配信識別子。実装許可は利用者の依頼本文に明記済み。
- app.jsでは `openNote` と `setMobileWritingMode` に閉鎖/再配置を追加し、既存のボタンlistener直前にUI controllerを初期化。保存writer・キュー・DBスキーマ・データ形式・MCP認可・Worker停止制御は差分なし。

## 実装と操作

- 件名右端の虹色枠ボタン。ライト/ダーク共通のテーマ変数を使い、別のキーボードフォーカス輪郭を持つ。常時アニメーションなし。
- 初期・再読込・メモ切替で閉じる非モーダルdialog。本文レイアウト外のfixed表示。PCは見出しだけドラッグ、矢印/Homeでも位置変更可能。viewport内へclampする。
- 320/375/390/430px、縦/横/短いviewport、Visual Viewport resize/scroll、CSS safe-area insetに対応。執筆モードは共通パレットの「機能」と「完了」だけを常設する。古い操作ボタンDOMを複製しない。
- 一般的な挿入/書式で閉じない。Escape、閉ボタン、外側pointerdownで閉じる。外側操作のフォーカスを奪わず、閉ボタン/Escapeは起動元へ戻る。起動元が執筆モードで隠れた場合は本文へ戻る。
- 固定の関連メモ/AI起動ボタンより手前に表示し、モバイル最下段のAI操作も実tapで確認。native dialogが開いている場合のEscape/外側処理は既存dialogへ渡す。file pickerをblurで閉じない。タグ/AIへ移る場合だけパレットを閉じ、既存処理へそのまま渡す。ポップアウトのAI非表示を維持する。
- 選択位置・スクロールはpointerdown前に取得し、既存click listenerの前に復元。ダイアログなどが本文/メモIDを変更した場合は古い位置を使わず最新位置を取得する。選択維持のために偽clickやイベント二重配送をしない。

## 将来の検索拡張

`feature-palette.js` のimmutable `commands` は15操作について `id / controlId / label / description / category / icon / keywords` を持つ。`controlId` は実行する既存ボタンへの参照であり、新たなコマンド実装や保存経路ではない。今回は検索欄・自然言語解析・AI操作選択は実装しない。将来の検索候補表示はこのカタログへ追加できるが、自動実行の許可を与えるものではない。

## 変更前後の実測

`feature-palette-measure.cjs` が同じ本文/件名/日時表示、800px高、同じブラウザーcontext設定（日本語、JST、Reduced Motion）、右パネル閉（閉鎖transition完了を座標で待機）、通常モードでbaseとcandidateを測定する。初期の保存警告は両方で表示したまま。日時表示の文字だけ固定し、取得/更新ロジックは変更しない。

幅・高さ・面積はCSS pxの`#editor.getBoundingClientRect()`によるborder box。開状態の重なり面積はJSONの`paletteOverlapArea`に別記する。パレットが覆う部分まで「見える面積が増えた」とは扱わず、改善値は閉状態同士で比較する。件名/日時/タグの合計占有高はtitle-row、日時/タグ個別矩形もJSONに含む。

ローカルは配布ZIP取得が失敗した固定Playwright 1.62.1の代わりに、別場所のPlaywright 1.56.1 / Chromium 141 / WebKit 26.0を使用。依存/lockは変更しない。WebKitは公式Debian依存ライブラリを一時フォルダーへ展開し、既存実行ファイルと組み合わせた代替検証。CIはpackage-lockの固定版を使う。

| Engine / viewport | 本文幅 | 高さ before → after | 高さ増分 | 面積 before → after | 上部高 before → after |
|---|---:|---:|---:|---:|---:|
| chromium 1280×800 | 682.44 | 183.11 → 397.66 | +214.55 | 124960.70 → 271375.54 | 191.39 → 156.84 |
| chromium 768×800 | 417.53 | 193.11 → 413.66 | +220.55 | 80629.20 → 172714.41 | 197.39 → 156.84 |
| chromium 320×800 | 302.00 | 364.00 → 373.00 | +9.00 | 109928.00 → 112646.00 | 106.50 → 97.50 |
| chromium 375×800 | 357.00 | 364.00 → 373.00 | +9.00 | 129948.00 → 133161.00 | 106.50 → 97.50 |
| chromium 390×800 | 372.00 | 364.00 → 373.00 | +9.00 | 135408.00 → 138756.00 | 106.50 → 97.50 |
| chromium 430×800 | 412.00 | 383.50 → 392.50 | +9.00 | 158002.00 → 161710.00 | 106.50 → 97.50 |
| webkit 1280×800 | 682.44 | 200.61 → 405.00 | +204.39 | 136903.36 → 276387.19 | 186.39 → 151.00 |
| webkit 768×800 | 417.53 | 174.61 → 421.00 | +246.39 | 72904.87 → 175780.66 | 228.39 → 151.00 |
| webkit 320×800 | 302.00 | 367.00 → 376.00 | +9.00 | 110834.00 → 113552.00 | 106.00 → 97.00 |
| webkit 375×800 | 357.00 | 367.00 → 376.00 | +9.00 | 131019.00 → 134232.00 | 106.00 → 97.00 |
| webkit 390×800 | 372.00 | 386.00 → 395.00 | +9.00 | 143592.00 → 146940.00 | 106.00 → 97.00 |
| webkit 430×800 | 412.00 | 405.00 → 414.00 | +9.00 | 166860.00 → 170568.00 | 106.00 → 97.00 |

全幅で本文の幅は維持、閉鎖時の旧ツール行は0px、開閉による本文の高さ/幅/位置の差は0。mobileの旧ツール行はもともと非表示なので、各+9pxは上部配置の圧縮だけの効果。

代表画像と原計測JSONは `evidence/`、全幅の画像はCI artifact（14日保存）に出力する。CIはbaseとの幅一致・高さ改善・開閉矩形一致をassertし、改善しなければ失敗する。

## 検証記録と限界

- 新規palette単体3件、関連UI63件、保存統合73件はPASS。全単体は1902件中1901 PASS/1 FAIL/skip0。残りは `memo-nexus-launcher.test.js` の既存fixtureで、環境が`/tmp/.git`を持つため「checkout内に認可configを置かない」検査が拒否する。同じ基準mainでも再現。認可の検査/製品処理を緩めていない。
- パレットE2EはChromiumでPASS。画像実挿入回帰を追加する前はWebKitもPASS。初期検証範囲は、初期閉、全15操作の到達/名前、開閉/Tab/Enter/Space/Escape、無変更・無dirty・日時不変、選択/強調/注意書き、Undo/Redo、表/グラフ/図形挿入、CSV選択/取消、画像選択、解説/記法/出典/Timeline dialog、AI選択範囲の既存導線、タグ、保存/メモ切替/再読込、両テーマ、popout、4幅のtouch/低高/横向きを検証。AIプロバイダへの実データ送信はしない。
- 通常モバイルの操作から執筆モードに移る際のパレット再配置を検査。追加した「出典追加後、閉じずにキーボードで画像を入れてマーカーを保つ」回帰はChromium PASS / 代替WebKit FAIL。独立に基準mainの通常添付でも同じ `UnknownError: Error preparing Blob/File data to be stored in object store` を再現した。パレット経由/選択保持ではなく、このWebKit環境でのIndexedDB Blob保存が障害箇所。保存実装やassertは変更しない。
- Calculatorへの選択式付き導線は外部通信をfixtureへ遮断して確認。AI要約/選択の設定導線を確認するが、生成/送信はしない。
- 既存執筆モードE2EはChromium/WebKitでPASS。Figure、Comparison、Report Preview（caption10条件を含む）、Timeline、Diagram、Citation Source、Report SourceはローカルChromiumでPASS。
- 既存mobile-layout/tableのローカル検査は外部CDNの `ERR_EMPTY_RESPONSE` をconsoleエラーとして検出してFAIL。assertは削除せず、固定版・通常ネットワークのCI結果を別途確認する。
- テストの新しい入口/明示閉鎖への変更は、収納されたボタンを利用者と同じ方法で操作するため。旧来の本文・保存・焦点・Undo・復元のassertは維持した。時間待ちの追加は行わず、viewport更新/保存/メモ切替の状態を待つ。
- 実機iPhone Safari、実ソフトウェアキーボード、物理safe-area、実スクリーンリーダー読み上げは未確認。WebKit/viewport縮小は代替検証であり、実機成功を意味しない。

## 独立レビュー

別担当がソース差分と局所Chromium操作を確認。P2「通常モードから執筆モードへ入るとパレットが下部操作を覆う」を修正し、4幅でパレット下端743px/操作上端751pxの非重複を独立再確認。回帰中に検出した出典更新後の古い選択復元も修正し、ソース再確認で追加確定指摘なし。レビューは実機Safari/固定版検証の代わりではない。

## 提出状態

Draft PR、最終HEADのCI結果はPR本文に記録する。mainへのマージは行わない。最終CIと残存ブロッカーが確定するまでは総合PARTIAL・限定マージ推奨NO。
