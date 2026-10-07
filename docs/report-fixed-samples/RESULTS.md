# 固定レポート・折れ線・画像回帰検証結果

2026年10月7日、日本時間。PR #350の公開HEADは開始時点で指定どおり `33421c9472ae061e6f120d1e9cb792f65ff10707`。専用worktreeに未コミット変更はなく、元mainの未追跡 `work/` を保持した。PR base／origin/mainは `2a13b83bf56bcecf5204c75dfb0a9f03ba84b7db`。PR #347/#348は取り込み済み。

今回の製品修正commit：`c019f02e54505cb5f83864d77b27cc347228e3b1`。Windowsの正式ブラウザ実行もこのSHA。その後はPDFの全項目・系列・値の抽出照合を検査に追加し、文書・成果物を更新した。製品コードは以後変わっていない。公開最終HEADと対応CI結果は [PR #350](https://github.com/tetsujisugimori-coder/memo/pull/350) の本文／Checksで記録する。前回HEAD `33421c9` の [CI](https://github.com/tetsujisugimori-coder/memo/actions/runs/37614487823) は成功しており、古い「CI未確認」を今回の結果として引き継がない。

## Windows結果一覧

保存・再読込とPreview1280px／390pxはChromium／WebKit両方。R01以外は正式ZIP書出し→新規プロファイルへの正式取込→再読込もPASS。R05は実キー入力による編集を含む。PDFはChromium、A4縦・20mm・白背景、初回／再出力。

| ID | 保存・再読込 | ZIP取込 | Preview両幅・両browser | PDF縦 | PDF横 | PDF目視 | ページ数 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R01 | PASS | 対象外：編集から直接検証 | PASS | PASS | 対象外：指定なし | PASS | 6 |
| R02 | PASS | PASS | PASS | PASS | 未実施：現行縦固定 | PASS | 6 |
| R03 | PASS | PASS | PASS | PASS | 未実施：現行縦固定 | PASS | 5 |
| R04 | PASS | PASS | PASS | PASS | 対象外：指定なし | PASS | 9 |
| R05 | PASS | PASS | PASS | PASS | 未実施：現行縦固定 | PASS | 13 |
| R06 | PASS | PASS | PASS | PASS | 対象外：指定なし | PASS | 6 |
| L01 | PASS | PASS | PASS | PASS | 対象外：今回指定なし | PASS | 4 |
| L02 | PASS | PASS | PASS | PASS | 対象外：今回指定なし | PASS | 4 |
| L03 | PASS | PASS | PASS | PASS | 対象外：今回指定なし | PASS | 7 |
| L04 | PASS | PASS | PASS | PASS | 対象外：今回指定なし | PASS | 2 |
| I01 | PASS | PASS | PASS | PASS | 対象外：今回指定なし | PASS | 8 |

計70ページ。新規25ページと既存から変わった13ページ、計38ページを19枚の読み取り可能な2ページ画像でエージェントが目視した。残り32ページは前回目視済みのPNGと画素一致。[目視一覧](review/followup/visual-review.json)。自動生成JSONの目視欄は自動PASSにしない。

R05余白変更、iPhone/Safari実機、ネイティブ印刷ダイアログの実保存は未実施。横向き・余白変更は新設しない。WebKit PDFは対象外（PlaywrightはChromium PDFのみ）。前回依頼の全必須条件まで全面完了・マージ可能とは判定しない。

## 折れ線の再現と修正

L01は50項目・1系列・全値1234567890・数値表示ON。ID／項目名は一意。修正前Previewと実Chromium PDFを正式経路で生成し、実SVG文字矩形を測定した。

| 対象 | Preview1280重複組数 | PDF重複組数 | PDF数値文字 | 判定 |
| --- | --- | --- | --- | --- |
| PR base `2a13b83` | 0 | 0 | 約0.854pt | 重複なしだが極端な縮小 |
| レビューHEAD `33421c9` | 61 | 18 | 約10.275pt | 幅540で配置不能ラベルが重複 |
| 今回修正 | 0 | 0 | 約10.275pt | 幅540を維持し配置不能ラベルを省略 |

[base画像](review/followup/base-before.png)／[実PDF](review/followup/base-before.pdf)、[レビューHEAD画像](review/followup/reviewed-before.png)／[実PDF](review/followup/reviewed-before.pdf)、[修正後画像](review/followup/L01-page-01.png)／[実PDF](review/followup/L01.pdf)。修正前JSONも同じ場所にある。観測モードのPDF PASSは本文・リンクなどの検査結果であり、重複／可読性成功を意味しない。

製品変更は `app.js` の `renderChartBlockContent` のReport折れ線のみ。既存 `hideOnCollision` で配置不能な数値を描画せず、カテゴリ領域まで数値が降りないよう既存baseline内に制限する。省略時だけ既存noticeスタイルで説明し、全項目・系列・値を下の既存一覧に残す。通常Preview・保存形式・Source・番号・用紙設定を変えていない。

| ケース | 条件 | 期待 | Windows省略数 | 実SVG重複／枠外 | 全値対応 |
| --- | --- | --- | --- | --- | --- |
| L01 | 50項目1系列、同値1234567890 | 省略あり | 30 | 0／0 | 50件PASS |
| L02 | 50項目1系列、正負・ゼロ | 省略あり | 16 | 0／0 | 50件PASS |
| L03 | 50項目3系列、同値2系列＋負値／ゼロ | 省略あり | 130 | 0／0 | 150件PASS |
| L04 | 12時点の既存小値系列 | 省略なし | 0 | 0／0 | 12件PASS |

L01の線・50点・ゼロ軸はレビューHEADの実描画座標と完全一致。点y座標と正負のゼロ軸を独立した線形式で検査。通常PreviewはReport開閉前後のSVG完全一致。1280／390／印刷でgetBBoxを測定し、PDF全SVG文字は最小約9.419pt・viewBox内。全ラベルと全線の接触まで回避する機能ではない。同値系列が同じ位置を通ることは入力どおり。長大な既存一覧／データ表とcaption／Sourceは複数ページに続く現行方針を維持する。L03最終ページにはSourceがあり白紙ではない。

Previewだけでなく、実PDFから抽出した項目名・系列名・正確な値の組を入力と照合し、欠落／重複を検査する。L01/L02/L03/L04は50/50/150/12組、全サンプルのChart合計306組がWindows・LinuxともPASS。

## 画像ごとの検査

4既存素材に四隅・中央の色付きID、方向、寸法、8px外枠を追加。写真相当photoは固定粒状模様・細線・連続階調・陰影のある合成静物で、実写ではない。transparentはalpha=0背景と半透明図形。全てプロジェクト作成の合成検証素材、CC0-1.0。生成コードとmanifestを同梱。

| 素材 | 元寸法→正式添付後 | 保存／ZIPバイト一致 | 両Preview領域 | 実PDF領域・5印・枠 | 目視 |
| --- | --- | --- | --- | --- | --- |
| landscape | 1600×900→同寸法 | PASS | PASS | PASS | PASS |
| portrait | 900×1600→同寸法 | PASS | PASS | PASS | PASS |
| square | 1000×1000→同寸法 | PASS | PASS | PASS | PASS |
| boundary | 800×3200→450×1800 | PASS | PASS | PASS | PASS：全体を1ページ内に縮小 |
| photo | 1400×1000→同寸法 | PASS | PASS | PASS | PASS：細線・明暗・粒状模様 |
| transparent | 1000×800→同寸法 | PASS | PASS | PASS | PASS：白背景と半透明色 |

ZIP後のID変更と画像内容を分離し、変換済みバイトSHA-256は完全一致。長辺1800pxまでの縮小とPNG再圧縮を考慮して元素材とは白背景RGB内容・比率・寸法を比較する。取込で寸法メタデータが省略される仕様は実画像デコードで確認する。

I01は独立した画像順序・左右番号・caption ID・Source s1の期待値を検証。各出現が完全な1矩形として1ページ内にあり分断なし。I01の短いcaptionは全て画像と同ページ。R06の長いcaptionも画像と同ページで本文を保持。I01全8ページを目視。Preview既存7px角丸は維持し、5識別印はその内側に保持される。外縁の既存角丸マスクを意図しないcover切抜きとは扱わない。390pxで極小になるID文字の全字可読性は自動保証しない。

実PDFを3倍で画像化し、全体30×30サンプル、5印内部8×8の平均色、四辺の枠を別に検査。Previewは実画像領域スクリーンショットから検査。RGB誤差18／35と1px位相丸めの根拠は [README](README.md)。異素材と中央10%切抜きの負例は必ず失敗。初回／再出力の全ページ画素一致は再現性の確認として別検査。OS間PDF全体の画素一致や未確認基準更新は行わない。

## 環境・コマンド・失敗記録

Windows、Node24.20.0、Playwright1.62.1、Chromium151.0.7922.34／WebKit26.5、Python3.14.7、PyMuPDF1.27.2。ブラウザ既定フォントを含む同じWindows環境で比較。CIはUbuntu・Node22・Noto CJKで区別して記録する。

```powershell
$env:PYTHON=(Resolve-Path ../report-pdf-v1/.pdf-venv/Scripts/python.exe).Path
node report-fixed-samples.e2e.js
$env:MEMO_NEXUS_E2E_BROWSER='webkit'
node report-fixed-samples.e2e.js
Remove-Item Env:MEMO_NEXUS_E2E_BROWSER
node report-preview.e2e.js
node report-pdf.e2e.js
node chart-e2e-suite.js
node --test chart-block-utils.test.js report-pdf.test.js
node --test
node --check app.js
node --check report-fixed-samples.e2e.js
node --check report-regression-cases.cjs
git diff --check
```

Pythonパスはローカル既存venv。環境構築はREADME。実行時は `REPORT_FIXED_OUT` と必要に応じ `REPORT_CASES` を指定した。

- 固定11ケース：Chromium／WebKit PASS。I01番号・caption・Source追加検査も両方PASS。
- 既存Report Preview／PDF E2E：PASS（PDF caption10条件、spacing4、pagination6 PDF、PC/mobile）。
- Chart Chromium全体：初回PASS、985.1秒、再実行0回。既知のゼロ軸失敗は再現せず。
- 関連単体228 PASS。ブラウザ終了後の全単体は初回1799 PASS、Bridge接続失敗なし、再実行0回。構文・diff PASS。
- 前回Bridge ECONNRESETを根本解消したと主張しない。前回1798 PASS／1 FAIL、該当ファイル1回・全体1回の再実行で成功した既存不安定性は [前回失敗ログ](review/complete-unit.log) と分離して保持。
- 検査開発時はZIP省略寸法、Report終了ボタン、Comparison既存(a)/(b)番号の期待値に誤りがあり修正した。I01追加確認はChromium初回番号期待値FAIL→修正後1回PASS、WebKit初回PASS。原寸画素と縮小細線／文字を比べる誤検査も実寸の枠・印領域比較へ修正。途中JSON／初回失敗ログを残す。閾値拡大、固定待機、タイムアウト延長、テスト無効化はしていない。
- 結果JSONのoriginalIdsが取込用の共有オブジェクトを参照していた記録上の誤りも修正。runnerは取込前にコピーする。収録済みJSONは保持された元ID付きZIPファイル名から正確な元IDを復元し、metadataRepair欄で明示した。添付SHA-256／内容／本文の検査には影響しない。原記録はGit履歴に残る。

## 成果物と公開

最新は [review/followup/](review/followup/)：11実PDF、新規／変更38ページPNG、修正前base／HEADの実PDFと画像・JSON、両browser代表Preview、結果JSON、主要ログ、目視一覧。未変更32ページPNGは一つ上の `review/` の同名ファイルと一致。前回資料も履歴／同ディレクトリに区別して保持する。

ローカル `e2e-artifacts/report-fixed/` に再投入ZIP、変換後画像、初回／再出力PDF、全70ページPNG、全Previewと開発記録を保持。CIはChromium実PDFと両browser Previewを検査し、失敗時もJSON・PDF・ページ画像・画像領域PNG・run.logを `report-fixed-chromium`／`report-fixed-webkit` artifactに14日保存する。

既存PR #350のブランチを更新。別PR／自動マージは行わない。最終HEAD・対応CI・Linuxページ数／目視範囲をPR本文に追記し、実際に確認できた結果だけを報告する。

## Linux CI成果物の確認

[実行37630852442](https://github.com/tetsujisugimori-coder/memo/actions/runs/37630852442) の両固定サンプルジョブPASSを確認し、実成果物を取得した。Ubuntu・Node22.23.3・Noto CJK・Chromium151.0.7922.34、PyMuPDF1.27.2。CIのgit SHA `f4306217492d4143140c0b88ff2fd9aeeb663d7e` はbase `2a13b83` と公開HEAD `d2cd723` のGitHub merge commitで、親SHAも確認した。最終公開HEADのCIはPR本文で別途記録する。

LinuxのR01〜R06は7/6/5/10/15/7、L01〜L04は4/4/7/2、I01は8、計75ページ。フォント差でWindows70ページと異なるが全自動検査PASS。新規25＋変更13ページをすべて目視し、I01全8ページの5印・外枠・透明合成・写真相当品質、折れ線の修正箇所を確認した。Linux残り37ページ全ての今回の目視は未実施（前回Linux成果物と画素一致し、今回は変更／新規ページを目視対象とした）。Windows目視結果と混同しない。結果JSONと目視一覧を `review/followup/linux/` に置く。

最初の公開run [37630770192](https://github.com/tetsujisugimori-coder/memo/actions/runs/37630770192) は失敗ログの末尾空白でCI checksがFAILし、新HEADへのpushで残りジョブは自動cancel。`d2cd723` で空白だけを修正し、CI checks PASSを確認した。同一SHAへの再実行は0回。ゼロ軸／Bridgeの不安定性とは別原因であり、ログ内容やテスト条件を隠す変更はしていない。

公開HEAD `28eb18d` の [run37633250403](https://github.com/tetsujisugimori-coder/memo/actions/runs/37633250403) では固定サンプル両browserとChart両browserはPASSしたが、既存Report Preview番号テストが初回FAIL（期待：図1/表1/図2/図3/図4、実際：図1/図2/表1）。このケースは棒グラフで、今回変更したReport折れ線分岐を通らない。テストもmainと同一だった。原因は未確定で、解消扱いにしない。[初回ログ](review/followup/figure-ci-first-failure.log)を保持する。

失敗時の入力本文・保存データ・Preview DOM・textareaへの代入元stack・画面を記録する診断を追加し、CI artifact対象をPNGだけからJSONを含むディレクトリへ変更した。期待値／待機条件は変えない。Windowsで同じ診断テストをPR側とbase/main側に各1回実行し、どちらもPASS（ログをfollowupに保持）。Linuxでの診断実行結果は最終CIと併せてPR本文に記録する。単に再成功しても初回失敗の原因解消を主張しない。

診断HEAD `75a0978` の [run37635079031](https://github.com/tetsujisugimori-coder/memo/actions/runs/37635079031) でも同じ番号FAILを再現した。[JSON](review/followup/numbering-ci-failure.json) と [画面](review/followup/numbering-ci-failure.png) では、保存前からtextareaが前ケースの本文のままで、代入記録も空。テストの1280px変更とアプリのresize処理の間に、compact表示のinert編集欄へfillする競合経路を特定した。独立した最小再現 [inert-fill.cjs](review/followup/inert-fill.cjs) でも、Chromiumのfillはinert時にエラーを出さず古い本文を保持し、解除後は新本文を入力した（[結果](review/followup/inert-fill-result.json)）。

番号テストはwide表示とinert解除という実状態を待ってからfillし、直後の入力本文一致も検査するよう修正した。製品の番号処理は変更しない。Windowsの修正後PR側／main側は各1回PASS。Linuxの修正後確認は最終CIを参照。同一SHAの盲目的な再実行0回、診断を加えた失敗再現1回、根拠のある準備状態待ちを加えた確認1回。固定待機・タイムアウト延長・期待値緩和はない。

### 公開43b77b0の確認結果と未解決事項

[run37635713105](https://github.com/tetsujisugimori-coder/memo/actions/runs/37635713105) で修正後の既存Report Preview番号テストはLinuxでもPASSした。固定Chromium全11ケース・実PDF75ページ・全306数値組、Chart Chromium、CI checks、Geometry、Table両browser、Mobile両browserもPASS。PDF全75ページPNGは上記目視対象を含む取得済みLinux成果物とSHA-256一致した。結果JSON／inspection.logを `review/followup/linux/final-head-*` に保持する。

一方、**CI全体はFAIL**。既存Chart WebKitの通常Editor複数系列featureが `chart-block.e2e.js:1617` の不正値Infinity入力後の並べ替え拒否確認で30秒timeout。並べ替えが実行された状態を初回ログに保持した。今回のReport折れ線分岐を通らず、該当Editor処理・テストはmainから未変更。Windowsで該当featureをmain／PR各1回確認し、ともにPASS。Linuxの原因は未確定で、既存不安定性と推定するが解消とは扱わない。ゼロ軸／Bridgeとも別の失敗である。[失敗ログ](review/followup/chart-webkit-final-ci-failure.log) と比較実行ログを保持し、期待値や待機条件は変更しない。

Figureジョブは依存取得に約9分を要し、番号テストPASS後に既存10分上限でcancel。既存PDF E2Eはこのrunでは未実施（Windowsと先行Linux runではPASS）。固定WebKitもapt依存取得中に10分上限でcancelし、このrunでは未実施（Windowsと先行Linux runでは11ケースPASS）。両cancelログを保持する。タイムアウト延長は行わない。資料更新後の最終公開HEAD・CI結果はPR本文を参照し、上記初回FAIL／cancelを成功結果で上書きしない。
