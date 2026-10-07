Report Preview／PDFを組み合わせて再現する固定資料がなかったため、架空の「資料整理プロジェクト」のR01〜R06を正式な既存block modelで追加します。正式編集・保存・再読み込み、R02〜R06の新規プロファイルへのZIPインポート、両幅Preview、初回／再出力PDFを検証し、実際に確認した結果と画像を残します。

- R01：長文約6,000字、12節、3階層見出し、引用、Source3件。
- R02：3サイズFigure、横同士／縦横Comparison、Source4件。
- R03：4×12／10×24の表、正負・ゼロの棒、12時点折れ線、5項目円。
- R04：5／18項目Timeline、Figure参照、3／12要素Geometry v2 Diagram。
- R05：約3,000字と全種類のブロック、Source5件共有、実際のキー入力による編集。
- R06：長い見出し・説明・200文字URL、800×3200画像、改ページ境界、空欄表。

製品修正はReport表示に限定し、円の4%／1%ラベルの重なりを補助線つき配置で解消します。12時点折れ線の文字が約5ptへ縮小される問題は、SVG幅制限と既存のラベル配置処理の再利用で最小約9.419ptに改善し、最後のラベルが切れない余白を確保します。通常Preview、保存形式、番号／Source規則、用紙設定APIは変更しません。

検証commitは `262fbe7b67a04ea11d0439dd2ced4be5f68efb98`。その後のcommitは結果と成果物の追記のみです。Windows、Node24.20.0、Playwright1.62.1、Chromium151.0.7922.34／WebKit26.5、PyMuPDF1.27.2で実行しました。

| ID | 保存・再読込 | Preview両幅・両ブラウザ | PDF縦 | PDF横 | PDF全ページ目視 |
| --- | --- | --- | --- | --- | --- |
| R01 | PASS | PASS | PASS・6頁 | 対象外：指定なし | PASS |
| R02 | PASS | PASS | PASS・6頁 | 未実施：現行縦固定 | PASS |
| R03 | PASS | PASS | PASS・5頁 | 未実施：現行縦固定 | PASS |
| R04 | PASS | PASS | PASS・9頁 | 対象外：指定なし | PASS |
| R05 | PASS | PASS | PASS・13頁 | 未実施：現行縦固定 | PASS |
| R06 | PASS | PASS | PASS・6頁 | 対象外：指定なし | PASS |

番号、Source、本文順序、全セル、Chart入力、画像比率、実PDF文字・リンク・ページ番号・位置、初回／再出力の全45ページ画素一致を自動検証しました。全ページPNGの目視も行いました。読めることや一般的な重なりを自動で全面保証するものではありません。iPhone実機確認は未実施です。

最終単独 `node --test` は1799 PASS。構文／diff検査PASS。既存PDF E2EもPASS。main Chromium Chart全体とmain／branch WebKit dual-axisは各1回PASSで、既知のゼロ軸失敗は今回再現せず、再実行0回です。

別件として、ブラウザとの並行単体実行で未変更Bridge healthテストがECONNRESETで1件失敗しました。該当ファイル1回、全体1回の単独実行は成功しましたが、根本解消とは扱わずログと未解決の不安定性を残します。

**全面完了・マージ可能とは判定しません。** R02/R03/R05横PDFとR05余白変更は、製品がA4縦・20mm固定のため未実施です。一般Diagram自動配置、多数の極小円ラベル、多系列折れ線全組み合わせ、実機／印刷ダイアログの実保存は保証しません。未対応機能を今回新設していません。

手順・全結果：[docs/report-fixed-samples/README.md](https://github.com/tetsujisugimori-coder/memo/blob/test/report-fixed-regression/docs/report-fixed-samples/README.md)、[RESULTS.md](https://github.com/tetsujisugimori-coder/memo/blob/test/report-fixed-regression/docs/report-fixed-samples/RESULTS.md)。固定6PDF、全45ページPNG、代表Preview、JSONと主要ログは [review/](https://github.com/tetsujisugimori-coder/memo/blob/test/report-fixed-regression/docs/report-fixed-samples/review/) に含めます。全生成物／再投入ZIPはローカル `e2e-artifacts/report-fixed/`、CIは失敗時にも `report-fixed-chromium`／`report-fixed-webkit` artifactを14日間保存します。CIの実行結果はローカル結果と区別して確認が必要です。

PR #347/#348が取り込まれたorigin/main `2a13b83` から専用worktree／ブランチで実施し、元の未追跡workを保持しました。自動マージは行いません。

??main `2a13b83` ?Linux CI?????????[main CI](https://github.com/tetsujisugimori-coder/memo/actions/runs/37602937863)????PR CI??????????????
