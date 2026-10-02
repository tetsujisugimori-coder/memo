# Comparison v1 レビュー資料

Chromium / Playwrightでアプリの実際のUIを操作して取得したスクリーンショットです。図A（640×240）と図B（240×640）は縦横比の検証用に生成したPNGで、実在資料の調査結果ではありません。Figure出典URLと共通Sourceは検証用のexample.orgです。

| 確認対象 | スクリーンショット |
| --- | --- |
| PC 通常Preview（比較ブロック） | [PC Preview](comparison-pc.png) |
| PC Report Preview | [PC Report](comparison-report-pc.png) |
| 320px 通常Preview（比較ブロック） | [320px Preview](comparison-preview-320.png) |
| 320px Report Preview（比較ブロック） | [320px Report](comparison-report-320.png) |

撮影時はPCが1800×1400、モバイルReportが320×1200、モバイル通常Previewが320×2000のviewportです。通常の操作・長文・空欄試験ではPCが1800×1000、モバイルが320×844です。撮影時だけ高さを増やし、比較ブロック全体がスクロール領域内に収まることを検証しています。比較ブロックの画像は切り抜かず、ラベルを画像の下、共通説明を2画像の下へ表示します。320pxはDOM順のまま縦並びです。画面の比較ブロックをキャプチャしているため、画像の拡大表示ではありません。

`comparison.e2e.js`は短いラベルの撮影に加え、長い日本語ラベル、500文字前後の出典URL、長い共通説明、HTML相当の特殊文字、空ラベル／説明なしを検証します。通常Previewのモバイルカードは実際のボタンで開き、画面内への移動とaria-hidden／inertの解除を確認します。画像の実寸比率、各画像とラベル・Figureの対応、比較ブロック／Preview／documentの横overflowもDOMで検証します。Reportでの拡大・資料情報の詳細閲覧では、保存本文・revision・updatedAt・Undo/Redoが変わらないことを確認しています。

旧main `cd2247b945240e25736ccf4291c25c0c143d565f` の `attachment-utils.js` を取得して新構文を解析した結果、2枚の画像参照IDは保持されますが、`explicit:false` の独立画像へ分かれ、ブロックcaptionは空になります。新マーカーとFigure情報はtext segmentへ残ります。旧 `backup-bundle-utils.js` はv4 manifestを「このバックアップは新しいMemo-Nexus形式です。より新しいアプリで開いてください」で拒否しました。この実行結果を根拠に、完全バックアップをv4へ更新しています。Markdown ZIPにはmanifestがないため拒否できず、旧版でのComparison再編集・再保存は保証しません。

CIの既存Figure jobではComparisonを1回だけ実行し、短文と長文条件の実行時スクリーンショットを `comparison-review` artifact（14日保持）へアップロードします。ここに保存した4枚はローカルで目視確認したレビュー用の資料です。
