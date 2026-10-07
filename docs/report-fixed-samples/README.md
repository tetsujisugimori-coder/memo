# Report固定サンプル R01〜R06・追加回帰 L01〜L04／I01

題材は架空の「資料整理プロジェクト」。Sourceは検証用の架空資料であり、URLは予約ドメインexample.comを使用する。乱数・現在日時・外部画像は使用しない。添付IDは正式な追加／インポート時にアプリが発行する。

`report-fixed-samples.cjs` と `report-regression-cases.cjs` が既存のImage/Table/Chart/Geometry v2/Timeline/Source serializerで本文を作る。HTMLを直接組み立てない。期待番号は手書き定数で、Report rendererから生成しない。通常利用者のメモには追加しない。

| ID | 内容 | 期待番号（掲載順、Timeline参照Figureを含む） | Source |
| --- | --- | --- | --- |
| R01 | 日本語本文約6,000字、12節、見出し3階層、長短段落、箇条書き、引用 | なし | 3 |
| R02 | 横1600×900、縦900×1600、正方形1000×1000、横同士／縦横Comparison | 図1,2,3,4,5 | 4 |
| R03 | 4列×12データ行、10列×24データ行、棒[-40,0,80,20,-20]、折線12時点、円[60,25,10,4,1] | 表1,2,図1,2,3 | 3 |
| R04 | 5／18項目Timeline、参照Figure、3／12要素Geometry v2 Diagram | 図1,1,1,2,3 | 3 |
| R05 | 約3,000字、Figure2、Comparison1、Table2、Chart2、Timeline1、Diagram1、連続ブロック | 図1,表1,図2,3,4,表2,図5,1,6 | 5 |
| R06 | 長い見出し・説明、200文字URL、800×3200画像、境界付近の図表、空欄表 | 図1,2,3,表1 | 3 |
| L01 | 50項目・1系列・全値1234567890・数値表示ON | 図1 | 2 |
| L02 | 50項目・1系列・[-1234567890,0,1234567890]の繰返し | 図1 | 2 |
| L03 | 50項目・3系列。2系列同値1234567890、残り正負ゼロ混在 | 図1 | 2 |
| L04 | 既存と同じ12時点の小さい値、全数値ラベル維持 | 図1 | 2 |
| I01 | 6固定素材の個別Figure、異なる素材のComparison2件 | 図1〜8 | 2 |

## 実行

Node 22以上、lockfileのPlaywright 1.62.1、PythonとPyMuPDF 1.27.2を使用する。CIではUbuntu・Noto CJKを使用する。WindowsではPowerShellの実行ポリシーによって `npm` が拒否される場合、`npm.cmd` を使う。

```sh
npm ci
npx playwright install --with-deps chromium webkit
python -m pip install pymupdf==1.27.2
npm run test:e2e:report-fixed
MEMO_NEXUS_E2E_BROWSER=webkit npm run test:e2e:report-fixed
```

PowerShellのWebKit指定は `$env:MEMO_NEXUS_E2E_BROWSER='webkit'`。別のPythonは環境変数 `PYTHON` で指定できる。`REPORT_FIXED_OUT` で成果物ディレクトリを変更できる。同じ出力先で同時実行しない。実行前に出力先の対象サンプル成果物と結果JSONを削除するため、以前のPDFを今回の成功と誤認しない。`REPORT_CASES=L01,I01` などで対象を絞れる。通常実行は11ケース全部。

全ケースで画像を正式な添付操作で追加し、正式なエディタ入力・保存・再読み込みを通す。R05はキー入力で確認文を追加する。R01以外はportableバックアップZIPを新しいプロファイルへ正式にインポートし、添付IDの再採番以外の本文不変を確認して再読み込みする。ZIP内の添付ファイル名（元ID＋拡張子）から新旧IDを対応づけ、添付バイトSHA-256とデコード寸法の一致を確認する。その後Report Preview／PDFを検証する。IndexedDB直接投入は行わない。R01は編集・保存から直接検証する。すべて隔離したブラウザプロファイルで実行する。

## 成果物と再利用

`e2e-artifacts/report-fixed/{chromium,webkit}/` に結果JSON、固定本文、保存／インポート後の本文、再投入用バックアップZIP、1280px／390px Preview画像を保存する。Chromiumは初回／再出力PDF、全PDFページPNG、PDF検査結果も保存する。`.zip` は別の検証用プロファイルから既存の「Markdown/ZIP取込」で開き、バックアップ確認を経て復元できる。通常利用中のプロファイルへ投入しない。

CIは両ブラウザで実行し、失敗時も `report-fixed-chromium`／`report-fixed-webkit` artifactを14日間保存する。全ページ画像は自動生成するが、目視結果は自動でPASSにしない。実際の確認結果は [RESULTS.md](RESULTS.md) に記録する。

追補CIではReport番号テストのinert編集欄への入力競合を診断し、表示切替完了を待つ検証手順へ修正した。公開43b77b0でLinux番号テストと固定ChromiumはPASSしたが、既存Chart WebKitの不正値入力検査FAIL、依存取得遅延によるFigure／固定WebKit cancelが残った。初回失敗・比較実行・未実施条件をRESULTSに分離し、最終HEADのCI結果はPR本文に記載する。再成功だけで不安定性の根本解消とは扱わない。

## 検証の限界

現行PDFはA4縦・余白20mm固定。横向きや余白変更を製品へ新設しないため、指定されたR02/R03/R05横出力とR05余白変更は未実施になる。WebKit自動検証をiPhone実機検証とは扱わない。ネイティブ印刷ダイアログの実際の保存操作、iPhone/Safari実機は未確認。

自動検証は保存本文、正式インポート、掲載番号、Source件数、本文順序、全セル、Chart入力のアクセシブル表現、画像比率、円ラベル非重複、PDF文字・caption・リンク・ページ番号・空白ページ・本文／画像の用紙内位置、初回／再出力の全ページ画素一致を対象にする。一般的な文字同士／線同士の重なり、読める文字サイズ、意味的な対応、全ブロックのページまとまりは目視を含む。取得テキストだけでレイアウト成功と判定しない。画像の期待値更新で差分を隠すスナップショット比較は行わない。

Diagramは既存Geometry v2の点・線・頂点ラベルで表す。自動配置・自動折り返しのある一般フローチャートではない。固定座標で重ならないよう配置する。Reportの円ラベル調整は今回の5項目を実測で検証し、多数の極小扇形や長い値ラベルの全組み合わせを保証しない。

## 折れ線の期待条件と修正前再現

実SVGの `getBBox()` で数値ラベル同士の重なりとviewBox外へのはみ出しを調べる。印刷時の実効文字サイズ9pt以上、全項目・系列・値の一覧との完全対応、点のy座標とゼロ軸の独立した式による検査を行う。L01の線・50点・ゼロ軸はレビューHEADで採取した `line-geometry-before.json` と完全一致させる。L01〜L03は混雑したラベルの省略と説明表示、L04は省略なしを期待する。通常PreviewのSVGはReport開閉の前後で完全一致、保存本文も不変である。

幅540を維持し、Reportだけ既存 `hideOnCollision` を使用する。配置先のない数値は描画せず、既存の一覧に全値を残す。カテゴリ／数値の既存書式、線・点・ゼロ軸の計算は変更しない。

修正前は対象アプリのworktreeを用意し、同じfixture runnerから配信先を指定する。観測モードは重なり・9pt条件をFAILにせず数値を記録するため、回帰成功の証拠として扱わない。

```sh
REPORT_APP_DIR=/path/to/reviewed-or-base-worktree REPORT_CASES=L01 REPORT_OBSERVE=1 REPORT_FIXED_OUT=e2e-artifacts/report-fixed/before node report-fixed-samples.e2e.js
```

## 固定画像の内容検査

四隅TL/TR/BL/BRとCENTERの色・画像ID・方向・寸法、8px外枠を付けた4既存素材に、photo1400×1000とtransparent1000×800を加えた。写真相当素材は明暗の連続階調、固定粒状模様、細線、陰影のある静物を合成したもので、実写ではない。透明PNGはalpha=0の背景と半透明図形を含む。すべてプロジェクト作成の合成検証素材、CC0-1.0。出所・寸法・印座標は `assets/manifest.json`、開発用の再生成手順は `node docs/report-fixed-samples/generate-assets.cjs`。再生成時はWindows・同じChromium・monospaceフォントを固定し、画像を実際に確認する。CI／通常テストで素材を再生成しない。

R02の横同士Comparison右側はphotoにして取り違えを検出する。I01を独立ケースにし、R01〜R06の番号・目的を保持する。I01は横／縦／正方形／800×3200／写真相当／透明のFigure6件と、landscape-photo、portrait-transparentのComparison。画像順序、左右番号、caption、Sourceを別の手書き期待値で検証する。

既存の添付変換は長辺1800pxまで縮小するためboundaryは450×1800になる。ファイルの圧縮バイトは元素材と同じとは限らない。保存・ZIP取込後の比較は変換済みバイトSHA-256、元素材との比較は白背景に合成したRGB内容・印・枠・寸法を使う。寸法はZIP取込で省略されるメタデータでなく実画像から取得する。

`image-region-checks.py` はPreviewの実画像スクリーンショットと、PDFを3倍で画像化した実画像矩形を検査する。全体30×30の固定相対位置でRGB平均絶対誤差18以下、5印それぞれの内部8×8の平均色差35以下、4辺の枠誤差35以下を要求する。18/35は0〜255の色成分単位。Windows両browserとLinux Chromiumで観測した最大値は全体14.42、印20.09、枠16.75。閾値はこれらの縮小描画差を許容し、負例を拒否する範囲に固定する。縮小後の細線・文字のアンチエイリアスを考慮し、外枠は実寸へ再サンプルした参照と比較し、画素位相の丸めは1px以内で照合する。閾値を途中で広げて成功にせず、原寸1画素を縮小された文字画素と比べる誤った検査を領域比較へ修正した。異なる画像と中央10%切抜きの負例が必ず失敗することも検査する。

PDF画像出現数・掲載順・1出現1矩形・比率・用紙内位置、I01の短いcaptionが画像と同ページにあることを検証する。図の本体を複数ページへ分断しない。長大な既存ブロックのcaption／Sourceは現行の継続配置方針を維持し、目視で記録する。透明合成・写真相当画像の品質・画像ID文字の可読性は目視も含む。画像領域検査は全意味内容の保証ではない。初回／再出力画素一致は再現性の検査であり、内容の正しさの検査とは分離する。OS間のPDF全体画素一致は要求しない。
