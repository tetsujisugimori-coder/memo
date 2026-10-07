# 固定レポート回帰検証結果

2026年10月7日、日本時間。全面的な完了・マージ可能とは判定しない。指定された横向きPDFと余白変更は現行製品に機能がなく未実施。GitHubでの実行結果はローカル検証と区別する。

検証した実装commit：`262fbe7b67a04ea11d0439dd2ced4be5f68efb98`。これ以降の成果物・結果追記commitは製品／検証コードを変更しない。開始・終了時のorigin/mainはいずれも `2a13b83bf56bcecf5204c75dfb0a9f03ba84b7db`。履歴でPR #347はこのmerge commit、PR #348は `1490063` としてmainに含まれることを確認した。GitHub CLIのPRメタデータ照会はHTTP 401だった。

## 一覧

保存・再読み込みとPreviewはChromium／WebKitの両方。Preview幅は1280px／390px。PDFはChromiumのA4縦・20mm・白背景。目視は全ページPNGによるエージェントの確認で、iPhone実機や人による紙面確認ではない。

| ID | 保存・再読み込み | Preview | PDF縦 | PDF横 | 全ページ目視 | ページ数 |
| --- | --- | --- | --- | --- | --- | --- |
| R01 | PASS | PASS | PASS | 対象外：指定なし | PASS | 6 |
| R02 | PASS | PASS | PASS | 未実施：現行A4縦固定 | PASS | 6 |
| R03 | PASS | PASS | PASS | 未実施：現行A4縦固定 | PASS | 5 |
| R04 | PASS | PASS | PASS | 対象外：指定なし | PASS | 9 |
| R05 | PASS | PASS | PASS | 未実施：現行A4縦固定 | PASS | 13 |
| R06 | PASS | PASS | PASS | 対象外：指定なし | PASS | 6 |

R05余白変更：未実施（製品は20mm固定）。WebKitのPDF生成：対象外（PlaywrightのPDFはChromiumのみ）。iPhone/Safari実機、ネイティブ印刷ダイアログの実保存：未実施（実機／対話的確認環境なし）。

全45ページを画像化して確認した。用紙外の切れ、文字・図表の重なり、画像の伸び／切り抜き、見出しだけの孤立、不要な空白ページは見つからなかった。図・説明・Sourceはまとまりを保ち、長表は行単位で分割されヘッダーを繰り返す。R02の6ページ目／R05の13ページ目はSource一覧の続きであり、空白ページではない。大きなFigure／Comparisonは残り領域に無理に入れず次ページへ送り、800×3200画像は縦横比を保って縮小する。

## 実際に確認した条件

- 正式な編集→保存→再読み込みで本文、ブロック順序、添付、表、Chart設定、Sourceが保持される。R05のキー入力で追加した文も保存・PDFで保持される。
- R02〜R06は正式なportableバックアップZIPを新規プロファイルへインポートし、元IDを含むZIP内の添付ファイル名から新旧IDを対応づけ、本文はID置換以外に変わらないことを確認。取り込み後に再読み込みし、PreviewとPDFを出力する。直接IndexedDB投入はない。
- 手書きの図表番号期待値、Source件数、本文順序、空欄を含む全表セル、Chartの項目／系列／数値のアクセシブル表現、Previewの画像比率を自動照合する。
- 実PDFの本文、captionの出現回数、全データセルの欠落／重複、Sourceと200文字URLのリンク注釈、A4寸法、連続ページ番号、空白ページ、本文／画像の用紙内位置、画像比率を確認。URLのネットワーク疎通は条件にしない。
- 画像・フォントの既存準備処理を通して初回／再出力を生成し、テキスト、ページ数、全ページの描画画素が完全一致する。同じ実行環境内の再出力比較であり、別OSとの画像一致を主張しない。
- ブラウザのpageerrorは全ケースで0件。円ラベルの実SVG文字bboxが重ならない。折れ線の印刷文字は実縮尺で最小9.419pt、すべてのSVG文字bboxがviewBox内に収まる。

## origin/mainとの差と修正

製品変更は `app.js` の `renderChartBlockContent` のReport分岐のみ。

1. R03円[60,25,10,4,1]の4%／1%が重なった。Reportで重なるラベルを移動し、扇形との対応を補助線で保持する。 [修正前](review/R03-before.png)／[修正後5ページ](review/R03-page-05.png)。
2. 12時点の折れ線SVGが横長のまま縮小され、文字が約5.05〜5.51ptになった。Report幅を540に制限し、既存のラベル間引き／折り返し処理を再利用する。最後のラベルのため右余白を確保する。全文・12値はグラフ下の既存一覧にも保持する。[修正後R03](review/R03-page-04.png)／[R05](review/R05-page-09.png)。

通常の編集／通常Preview、データ形式、図表採番、Source規則、保存基盤、用紙設定APIは変更していない。固定サンプル、E2E、Python実PDF検査、npmコマンド、専用CIジョブを追加した。CIはChromium／WebKitで実行し、失敗時にも成果物をuploadする。

Diagramの初期サンプルは長いラベルを隣り合う点に配置して自ら重ねていた。既存モデルに自動配置はないため、固定座標を修正した。製品のDiagram機能を新設・変更して解決したものではない。[投入座標修正前](review/R04-input-before.png)／[修正後](review/R04-page-09.png)。

## 環境・コマンド・既知の失敗

Windows、PowerShell、Node v24.20.0、Python 3.14.7、PyMuPDF 1.27.2、Playwright 1.62.1。Chromium 151.0.7922.34、WebKit 26.5。既定のシステムsans-serifを使用しWebフォントを選択していない。CIはUbuntu・Node 22・Noto CJKを指定するが、CI結果はpush後に別途確認が必要。

```powershell
# 最終実装commit上
node --test
node --check app.js
node --check report-fixed-samples.e2e.js
git diff origin/main --check
$env:PYTHON=(Resolve-Path ../report-pdf-v1/.pdf-venv/Scripts/python.exe).Path
node report-fixed-samples.e2e.js
$env:MEMO_NEXUS_E2E_BROWSER='webkit'
node report-fixed-samples.e2e.js
```

Pythonの上記パスは今回のローカル環境で使用した既存venv。他環境はREADMEの通常のPython設定を使う。

| 検証 | 実行・結果 |
| --- | --- |
| 最終固定サンプル | Chromium／WebKit各1回PASS、PDF45ページPASS |
| 単体全体の最終単独実行 | 1799 PASS |
| JS構文・diff whitespace | PASS |
| 既存PDF E2E（同じ修正済み円renderer） | PASS、caption10条件、spacing4条件、pagination6 PDF、mixed PC/mobile |
| main Chart E2E Chromium | 全機能を1回実行、PASS（907.3秒） |
| main dual-axis WebKit | 1回PASS（215.9秒） |
| branch dual-axis Chromium／WebKit | 各1回PASS（70.7／158.3秒）。これ以降の製品変更はReportの折れ線表示のみで、通常のdual-axis／ゼロ軸計算を変更しない |

既知のグラフゼロ軸位置の失敗は上記main／branchの実行では再現しなかった。再実行0回。Linux CIでの根本解消やiPhone実機の結果を主張しない。

別件：最終commitでブラウザと同時に実行した単体テストは1798 PASS／1 FAIL。未変更の `codex-bridge.test.js:120` healthテストが `fetch failed / ECONNRESET` で失敗した。該当ファイルを1回単独実行して5 PASS、続いて全体を1回単独実行して1799 PASS。単に再実行が成功したことを根本解消とは扱わない。Bridgeコードのmain差分はなく、既存の `docs/report-spacing/pdf-ci/README.md` にも同種の接続失敗の記録がある。今回のReport結果とは分離して未解決の不安定性として残す。[失敗ログ](review/complete-unit.log)／[該当ファイル単独](review/bridge-isolated.log)／[全体単独](review/unit-isolated-final.log)。

開発中にはサンプル／検証側のID規則、未参照Source数、Pythonのinspectモジュール名衝突、フッターの抽出順、インポートの新旧ID対応、添付非同期読込、WebKitの隠しテキストのinnerText取得に誤りがあり修正した。WebKitのpage.goto(load)タイムアウトも1回記録した。最終両ブラウザ実行は失敗なし。タイムアウト延長、固定待機、テスト無効化、期待値の許容差緩和は行っていない。途中ログはローカル成果物の `logs/` に保持する。

## 成果物

このディレクトリの `review/` に固定6PDF、全45ページPNG、両ブラウザ代表Preview4枚、検証JSON、主要実行ログをcommitする。 [Chromium結果JSON](review/results-chromium.json)／[WebKit結果JSON](review/results-webkit.json)。Chromium JSONの目視欄だけは実際の画像確認後に記録した。テスト自動生成JSONは目視を自動PASSにしない。

PDF：[R01](review/R01.pdf)、[R02](review/R02.pdf)、[R03](review/R03.pdf)、[R04](review/R04.pdf)、[R05](review/R05.pdf)、[R06](review/R06.pdf)。ページ画像は `review/R01-page-01.png` から各サンプルの最終ページまで。

全生成物、初回／再出力12PDF、再投入ZIP、全Preview、途中失敗ログはworktreeの `e2e-artifacts/report-fixed/` に残す。CI artifact名は `report-fixed-chromium`／`report-fixed-webkit`、保持14日。固定素材とモデル生成器はリポジトリに残るため再実行可能。

## 残る制約・引き継ぎ

横出力・余白変更は既存未対応のため未実施。一般フローチャートの自動配置／ラベル自動折り返しは未対応。今回の12要素DiagramはGeometry v2点・線・頂点ラベルで検証した。50項目の極小円扇形、長い値ラベル、多系列の折れ線など、今回の固定データを超えたすべての組み合わせの可読性は保証しない。読めることと意味的なページのまとまりは目視を含み、自動テストの全面保証とは表現しない。

GitHubへのpush／PR作成結果は最終報告に記載する。作成用の本文は [PR_BODY.md](PR_BODY.md)。認証が必要な場合はworktree `work/report-fixed-regression` で再認証後、専用ブランチ `test/report-fixed-regression` をpushし、本文ファイルを指定してdraft PRを作成する。自動マージはしない。
