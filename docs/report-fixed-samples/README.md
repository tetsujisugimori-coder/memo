# Report固定サンプル R01〜R06

題材は架空の「資料整理プロジェクト」。Sourceは検証用の架空資料であり、URLは予約ドメインexample.comを使用する。乱数・現在日時・外部画像は使用しない。添付IDは正式な追加／インポート時にアプリが発行する。

`report-fixed-samples.cjs` が既存のImage/Table/Chart/Geometry v2/Timeline/Source serializerで本文を作る。HTMLを直接組み立てない。期待番号は同ファイルの手書き定数で、Report rendererから生成しない。通常利用者のメモには追加しない。

| ID | 内容 | 期待番号（掲載順、Timeline参照Figureを含む） | Source |
| --- | --- | --- | --- |
| R01 | 日本語本文約6,000字、12節、見出し3階層、長短段落、箇条書き、引用 | なし | 3 |
| R02 | 横1600×900、縦900×1600、正方形1000×1000、横同士／縦横Comparison | 図1,2,3,4,5 | 4 |
| R03 | 4列×12データ行、10列×24データ行、棒[-40,0,80,20,-20]、折線12時点、円[60,25,10,4,1] | 表1,2,図1,2,3 | 3 |
| R04 | 5／18項目Timeline、参照Figure、3／12要素Geometry v2 Diagram | 図1,1,1,2,3 | 3 |
| R05 | 約3,000字、Figure2、Comparison1、Table2、Chart2、Timeline1、Diagram1、連続ブロック | 図1,表1,図2,3,4,表2,図5,1,6 | 5 |
| R06 | 長い見出し・説明、200文字URL、800×3200画像、境界付近の図表、空欄表 | 図1,2,3,表1 | 3 |

## 実行

Node 22以上、lockfileのPlaywright 1.62.1、PythonとPyMuPDF 1.27.2を使用する。CIではUbuntu・Noto CJKを使用する。WindowsではPowerShellの実行ポリシーによって `npm` が拒否される場合、`npm.cmd` を使う。

```sh
npm ci
npx playwright install --with-deps chromium webkit
python -m pip install pymupdf==1.27.2
npm run test:e2e:report-fixed
MEMO_NEXUS_E2E_BROWSER=webkit npm run test:e2e:report-fixed
```

PowerShellのWebKit指定は `$env:MEMO_NEXUS_E2E_BROWSER='webkit'`。別のPythonは環境変数 `PYTHON` で指定できる。`REPORT_FIXED_OUT` で成果物ディレクトリを変更できる。同じ出力先で同時実行しない。実行前に出力先のR01〜R06成果物と結果JSONを削除するため、以前のPDFを今回の成功と誤認しない。

全ケースで画像を正式な添付操作で追加し、正式なエディタ入力・保存・再読み込みを通す。R05はキー入力で確認文を追加する。R02〜R06はportableバックアップZIPを新しいプロファイルへ正式にインポートし、添付IDと本文の完全一致を確認して再読み込みする。復元時の添付ファイル名は既存仕様どおりIDベースになる。その後Report Preview／PDFを検証する。IndexedDB直接投入は行わない。R01は編集・保存から直接検証する。すべて隔離したブラウザプロファイルで実行する。

## 成果物と再利用

`e2e-artifacts/report-fixed/{chromium,webkit}/` に結果JSON、固定本文、保存／インポート後の本文、再投入用バックアップZIP、1280px／390px Preview画像を保存する。Chromiumは初回／再出力PDF、全PDFページPNG、PDF検査結果も保存する。`.zip` は別の検証用プロファイルから既存の「Markdown/ZIP取込」で開き、バックアップ確認を経て復元できる。通常利用中のプロファイルへ投入しない。

CIは両ブラウザで実行し、失敗時も `report-fixed-chromium`／`report-fixed-webkit` artifactを14日間保存する。全ページ画像は自動生成するが、目視結果は自動でPASSにしない。実際の確認結果は [RESULTS.md](RESULTS.md) に記録する。

## 検証の限界

現行PDFはA4縦・余白20mm固定。横向きや余白変更を製品へ新設しないため、指定されたR02/R03/R05横出力とR05余白変更は未実施になる。WebKit自動検証をiPhone実機検証とは扱わない。ネイティブ印刷ダイアログの実際の保存操作、iPhone/Safari実機は未確認。

自動検証は保存本文、正式インポート、掲載番号、Source件数、本文順序、全セル、Chart入力のアクセシブル表現、画像比率、円ラベル非重複、PDF文字・caption・リンク・ページ番号・空白ページ・本文／画像の用紙内位置、初回／再出力の全ページ画素一致を対象にする。一般的な文字同士／線同士の重なり、読める文字サイズ、意味的な対応、全ブロックのページまとまりは目視を含む。取得テキストだけでレイアウト成功と判定しない。画像の期待値更新で差分を隠すスナップショット比較は行わない。

Diagramは既存Geometry v2の点・線・頂点ラベルで表す。自動配置・自動折り返しのある一般フローチャートではない。固定座標で重ならないよう配置する。Reportの円ラベル調整は今回の5項目を実測で検証し、多数の極小扇形や長い値ラベルの全組み合わせを保証しない。
