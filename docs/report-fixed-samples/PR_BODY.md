Report PreviewとPDFの完成度を既存の正式document/block modelで検証する固定資料を追加します。R01〜R06を保持し、50項目の折れ線で発見した数値ラベル重複を修正し、固定画像の保存・取込・実描画検査を補強します。

- R01：長文約6,000字、12節、見出し3階層、箇条書き・引用、Source3件。
- R02：横／縦／正方形Figure、横同士／縦横Comparison、Source4件。横比較右側は異なる写真相当素材。
- R03：4×12と10×24の表、正負ゼロの棒、12時点折れ線、5項目の円。
- R04：5／18項目Timeline、Figure参照、3／12要素Diagram。
- R05：約3,000字と全ブロックを交互に配置、Source5件共有、実キー入力編集。
- R06：長文・200文字URL・800×3200画像・改ページ境界・空欄表。
- L01〜L04：50項目同値、50項目正負ゼロ、50項目3系列、12項目通常値。
- I01：6固定画像のFigureと左右を区別できるComparison2件。

レビューHEAD `33421c9` の50項目・1系列・全値1234567890・数値表示ONで、実Preview61組／実PDF18組の数値ラベル重複を再現しました。base `2a13b83` は重複なしですがPDF文字約0.854ptまで縮小されます。今回の修正は幅540を維持し、Reportだけ既存hideOnCollisionで配置不能ラベルを省略します。省略時は短い説明を表示し、全項目・系列・数値を既存の下部一覧に保持します。修正後は実SVG文字矩形の重複／枠外0、数値文字約10.275pt、全SVG文字最小約9.419pt。線・50点・ゼロ軸はレビューHEADと完全一致です。

既存4素材に四隅／中央のID・寸法・方向・枠を付け、写真相当の合成静物と透明PNGを追加しました。素材はリポジトリ固定、プロジェクト作成のCC0合成素材です。正式添付・保存・再読込・ZIP書出し・新規プロファイルへの正式取込を通し、ID再採番とは独立した変換後バイトSHA-256を確認します。長辺1800pxまでの既存縮小仕様に従い、800×3200は450×1800になります。

Preview1280／390と実PDF画像領域について、内容・5印・四辺・左右順序・比率・caption／Source対応を検査します。PDFは3倍ラスタライズし、OS間のPDF全体画素一致を要求しません。誤差閾値と1px位相丸めはREADMEに根拠を記載し、取り違え／中央10%切抜きの負例が必ず失敗します。初回／再出力一致は再現性として別検査です。通常Preview、保存形式、番号、Source、用紙設定は変更しません。

Windowsの11ケースは保存・再読込、ZIP取込（R01は編集から直接）、両browser・両幅Preview、Chromium実PDF PASS。R01〜R06は6/6/5/9/13/6ページ、L01〜L04は4/4/7/2ページ、I01は8ページ、計70ページ。新規／変更38ページを目視し、残り32ページは前回目視済みPNGと一致。透明画像の白背景合成、写真相当の細線・明暗、巨大画像の全体縮小を確認しました。

既存Report Preview／PDF E2E、Chart Chromium全体（初回985.1秒）、関連単体228件、全単体1799件、構文・diff検査PASS。今回のローカル初回でゼロ軸失敗とBridge health接続失敗は再現せず、再実行0回です。前回Bridge ECONNRESETは未解決の既存不安定性として別記録し、再実行成功で根本解消とは扱いません。検査開発時の省略寸法メタデータ・終了ボタン・既存(a)/(b)番号・細線サンプリングの失敗と修正もログ／JSONに保持します。

製品修正commit：`c019f02e54505cb5f83864d77b27cc347228e3b1`。その後にPDFの全項目・系列・正確な値の組を入力と直接照合する検査を追加し、全306組がWindows／LinuxでPASSしました。Windows、Node24.20.0、Playwright1.62.1、Chromium151.0.7922.34／WebKit26.5、Python3.14.7、PyMuPDF1.27.2。CIはUbuntu・Node22・Noto CJKで区別し、Chromium実PDFと両browser Previewを実行します。失敗時もPDF・全ページPNG・画像領域PNG・JSON・run.logを14日保持します。

LinuxではR01〜R06が7/6/5/10/15/7ページ、追加ケースはWindowsと同じで計75ページ。新規／変更38ページを目視し、I01全8ページも確認しました。残り37ページ全ての今回のLinux目視は未実施で、Windowsの目視と混同しません。最初の公開runは保存ログの末尾空白でCI checksが失敗し、空白だけを修正して成功を確認しています。同一SHA再実行で失敗を隠したものではありません。

**全面完了・マージ可能とは判定しません。** 現行A4縦・20mm固定のためR02/R03/R05横PDFとR05余白変更は未実施。iPhone実機とネイティブ印刷保存も未実施。WebKit PDFはPlaywright未対応で対象外です。全数値と全線の接触、あらゆる長いラベル・円の極小扇形を全面保証しません。Preview既存角丸は保持し、390pxの極小ID文字の可読性は自動保証しません。自動マージは行いません。

手順：[README](https://github.com/tetsujisugimori-coder/memo/blob/test/report-fixed-regression/docs/report-fixed-samples/README.md)。結果・制約：[RESULTS](https://github.com/tetsujisugimori-coder/memo/blob/test/report-fixed-regression/docs/report-fixed-samples/RESULTS.md)。修正前後PDF・ページ画像・Preview・ログ：[最新成果物](https://github.com/tetsujisugimori-coder/memo/tree/test/report-fixed-regression/docs/report-fixed-samples/review/followup)。前回HEADのCIも[成功を確認済み](https://github.com/tetsujisugimori-coder/memo/actions/runs/37614487823)です。公開最終HEADと対応するCIの結果は以下に記録します。
