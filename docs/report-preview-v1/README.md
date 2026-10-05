# Report Preview v1 前半：Figure・Comparison・Table・Chartの共通Source

## PDF保存v1

後続のPDF保存はmain `63b0f8b`（#341を含む）を基準に追加する。「レポート表示」→「PDFとして保存」で標準印刷画面を開き、送信先「PDFとして保存」、A4縦、倍率100%、ヘッダーとフッターOFFを確認して保存する。A4の余白は上下左右20mm。ページ番号のみをCSSのページ余白へ表示する。用紙設定UI、PDF編集、別文書モデル、保存形式変更は追加しない。

### 再利用と印刷準備

既存のPreview DOM、Figure／Table／Chart／Geometry／Timeline／Citation rendererを再利用し、Sourceの番号と表示順を変更しない。画像は本文の位置を維持する。管理用添付一覧はレポートの末尾資料として扱わない。PDF添付そのもののページを合成する機能はない。詳細欄は一時的に開いて全文を出力し、Chartの既存アクセシビリティ用データ一覧も文字で出す。チェックリストの状態は白黒の記号で表示する。

既存の添付読込promise、Mermaid描画queue、document.fonts.ready、画像decodeを待ってから印刷を開始する。lazy画像は一時的にeagerにしてdecodeする。画像失敗や準備中のPreview更新は理由を表示して停止する。印刷画面の終了はafterprintで受け、詳細のopen、loading、要素style、スクロール位置、document.titleを復元する。本文・Source・revision・updatedAt・dirty・Undo/Redo・IndexedDBを変更する処理やflushSaveは印刷経路にない。印刷と独立して既に予約済みの通常保存は通常どおり進む。

ファイル名の候補は既存safeFileName／sanitizeWindowsNameを利用する。空タイトルは「無題レポート」。実際の保存名はブラウザが最終決定する。リンク文字列は本文のまま、Source URLは全文を折り返す。既存のsafeSourceUrl／safeFigureSourceUrlで許可したリンクのみPDFリンクとなり、無効URLは文字として残る。

### 改ページと縮小

- A4印刷幅170mm、高さ257mmで印刷専用CSSを一時有効化し、同じDOMを測定する。
- Figure／Comparison／Chart／Diagram／Timeline項目／Mermaid／単独画像はbreak-inside: avoid-page。残り領域に入らなければ次ページへ送る。
- 1ページより高い図は固定した測定幅とCSS zoomで全体を等倍比率で縮小する。親が一体扱いなら内部の図を重複縮小しない。画像とSVGは縦横比を維持する。
- 見出しはbreak-after: avoid-page。本文はorphans／widowsを3とする。
- Tableは9pt・固定レイアウト・セル内折返し。短い表は一体で、長い表は行間で改ページする。trは分割回避、theadは見出し繰返し。

CSSの分割回避は絶対保証ではない。1行が1ページを超える表、極端な多列、長い図版説明を含む縮小、非常に横長のChartでは可読性・分割に限界がある。表を9pt未満に自動縮小しない。Chartは比率を保つため軸文字が小さくなる場合があり、併記する9ptの項目・系列・値で全文を確認できる。ブラウザの余白・倍率・ヘッダー設定による上書きは印刷プレビューで確認する。Chrome／Chromium・Edge 131以降のページ余白内番号を前提とする。Ctrl+Pは非同期準備を行わないためボタンを使う。

### 実PDFの検証方法

`npm ci`、`python -m pip install pymupdf==1.27.2` の後、`npm run test:e2e:report-pdf` を実行する。Windowsで別Pythonを使う場合は環境変数PYTHONにその実行ファイルを指定する。Linuxではfonts-noto-cjkも用意する。CIは既存Figureジョブで実行し、report-pdf-review artifactへ生成PDF・全ページPNG・inspection.json・metrics.jsonを保存する。

混在レポートには長い日本語、本文リンク、チェックリスト、Figure、Comparison、55行Table、複数系列Chart、Diagram実図、Timeline Figure、大きな画像、不正マーカー、未登録Source、長いURLを含む。実PDFから日本語・全文URL・リンク注釈・図表ラベル・全数値・ページ番号を抽出し、ページ寸法・文字の余白・画像の比率と紙面内配置・表の見出し繰返し・見出しと図版の同一ページをassertする。印刷開始／終了の保存済み・dirty状態とUndo/Redo全配列を厳密比較する。decode失敗では印刷を呼ばないことも確認する。

ブラウザ標準印刷画面の操作を自動化する代わりに、同じ印刷準備・CSSとChromium page.pdf経路で実PDFを生成する。ファイル名はwindow.print境界でdocument.titleを検査する。ネイティブ印刷画面の保存／取消、Edge実機、Safari／iPhone／Firefox、ユーザー設定による余白上書きは手動確認範囲。独立したbuild scriptはない静的アプリであり、構文チェック・ブラウザ読込・CIを配信前の検証とする。

前半の共通Source接続の対象基準はmain 1a0b9a1d5aed8f9f0cbbd08b411207bbf6655d3d（Figure #329、Report Preview #331、Citation #333、Comparison #335、Timeline #337、Diagram #338がマージ済み）。その段階には図番号・表番号、全体デザイン変更、PDF・印刷専用処理を含まない。後続のPDF保存v1は上記に記載する。

## 保存と編集

- Source本体は従来のメモ内 sources-v1 マーカーのみ。Sourceを保存する際はマーカーを本文の先頭へ置き、未完のコード囲みに入ることを防ぐ。読込だけでは旧末尾配置を移動しない。コード外に複数の旧記録があれば従来どおり最後の有効記録を採用し、Source保存時にはコード外の記録だけを一件へまとめる。コード内の例は保持する。参照は安定IDの任意配列 citationIds。同じIDは一度だけ、配列順は維持し、登録されていない有効IDも保持する。番号は保存しない。
- Figure metadataの caption、dateLabel、sourceName、sourceUrl、sourceType、license、note は従来どおり画像に属する。citationIdsを持つ場合だけversion 2とする。解除後は従来情報を保持してversion 1へ戻す。旧画像は読込だけではマーカーを追加しない。
- Comparisonは既存Image Blockの2画像であり、比較全体にSourceを保存しない。画像オブジェクトの入替と同時に参照も入れ替える。片方の削除で残る画像情報は保持し、再追加した画像へ前画像のSourceを付けない。通常表示切替でも参照を保つ。
- 構造化TableとChartは既存version 1の任意citationIds。普通のMarkdown表を変換しない。Tableのnoteと共通引用は独立する。セル・行列・系列・並べ替え・種類変更にSourceを維持する。
- Table→Chartは作成開始時の配列をコピーする。変換確定前は既存draftに一時保持し、取消は本文を変えない。確定後の表編集へ追従しない。表とChartのSourceを別々に解除できる。
- Figureの資料情報編集とTable/Chartの共通Source選択は、保存まで本文・日時・保存予約・履歴を変えない。Sourceがない理由と「編集を取消して出典を管理」導線を表示する。管理への移動は編集中の選択を取り消す。
- 保存は既存本文・revision・updatedAt・保存キュー・Undo/Redoを使い、1回の保存は1回のUndo。無変更保存は原文のまま。元メモ・元本文・Chart draftが変わった選択ダイアログは上書きしない。
- 同一ID・同一全文のコピーは選択した出現だけを編集。Source・説明アンカーの除去後の表示offsetは編集に使わず、出現順で実本文ブロックへ対応させる。既存Figure ID競合解消は維持する。

## 引用順と表示

通常PreviewとReport Previewは同じ描画コンテキストを使う。上から表示順で初めて登場した登録済みSourceに1から番号を与える。同じSourceは同じ番号、末尾一覧は一度だけ、未参照Sourceは表示しない。

|表示単位|初出の順序|
|---|---|
|本文|引用が描画される順|
|Figure / Comparison|画像の並び順、それぞれのcitationIds順|
|Table / Chart|そのブロックのcitationIds順|
|Timeline|項目順、本文→参照Figure→項目citationIds順|
|Diagram|補足本文→citationIds順|

コードフェンス（backtick / tilde）とインラインコードの引用を解釈しない。描画・引用抽出・Source解析・Image/Table/Chart/Timeline/Geometry解析は markdown-fence-utils.js の同じ判定を使う。区切りは同じ文字が3個以上、閉じ行は同じ種類で開始以上の長さ、後ろは半角スペース／タブのみ。通常は0〜3列の字下げ、リスト継続は既存Geometryのリスト内容基準から0〜3列を許す。タブは4列のtab stopで数える。バッククォート開始行のinfoにバッククォートがあれば開始しない。infoの最初の語だけを既存language表示に使う。閉じ忘れは残りをコードとして表示し、本文に閉じ行を自動追加しない。Geometryの別規則である4列以上の字下げコードのブロック除外は維持する。この共通化は全Markdown仕様への対応を追加するものではない。画像caption・従来資料情報、Tableセル、Chartラベルなど既存のplain textフィールドはCitation構文を解釈しない。無効な構文や未対応情報からSourceを作らない。TimelineのFigureは元Image Blockを毎回参照して描画し、情報をTimelineにコピーしない。参照元が削除またはID競合なら参照先不在を表示する。

共通引用は「共通Source: [番号]」、従来資料情報は従来の資料情報欄に表示する。一致や正否を推測しない。Sourceの表示名・URLの安全判定は既存sourceDisplayLabel / safeSourceUrlを再利用。未登録IDは共通Source欄に「未登録Source: ID」を表示し、番号も一覧項目も作らない。Source編集は全参照に反映し、いずれかの現在本文参照が残れば削除拒否する。通常入力・タイトル入力ごとに新しい全文走査を追加しない。

Report Previewの編集操作は既存read-only処理で非表示・無効化し、閲覧だけでは保存データやUndo/Redoを変更しない。

## 互換性と復元

fixturesには基準mainのFigure/Table/Chart/backup/Source実装をそのままコピーした実行可能ファイルを置く（Source fixtureは実旧コードをVMで実行し、既存Timeline依存を注入する）。report-source.test.jsで実行する。

- 旧Figure readerはversion 1へ足したcitationIdsを黙って落とす。version 2なら拒否するため、新規参照はv2で保存する。新readerは不正・未来の資料情報をopaque原文として画像に結び付け、入替・通常表示切替で保持し、未対応情報の編集は拒否する。
- Table/Chartの旧readerは未知任意情報をspreadで保持し、直列化・復元でもcitationIdsを維持する。ブロックversionを変更する根拠はない。既存の未来version・未知項目保持方針も維持する。
- 完全バックアップversion / formatVersionは6へ上げる。旧v5 readerはv6を拒否。v1〜v5の移行は本文を変更せず、未知のv7以降は拒否する。DB schema・storeを変更しない。
- SourceのJSON version・マーカー構文はv1のままで、配置だけを変更する。実旧main readerが先頭v1を読めることをfixtureで確認した。旧版のSource編集は再び末尾へ保存するため、未完フェンスがある本文のSource編集は修正版で行う。完全バックアップの本文はopaqueであり、既存v6のまま新しい配置を往復できるので、今回の修正でv7には上げない。
- 旧末尾v1が未完フェンス内に入った場合はコード例との確実な識別情報がない。勝手に登録・移動・削除せず、原文を維持してsourceStorageConflict（読込結果のみ・保存しない）を返す。Source管理では追加・編集・削除・引用挿入を理由付きで拒否し、withSourcesも上書き・マーカー追加を行わない。旧保存情報と利用者が確認できる場合にだけマーカーをコード囲みの前へ移す。登録済みの先頭マーカーがある場合、未完コード内のマーカーはコード例として保持する。完全なコード例には一切登録しない。
- ローカルMarkdownは本文をそのまま保持。Markdown ZIPと完全バックアップ復元は既存経路で添付IDを新しく割り当てるがSource IDとレコードを変えない。完全バックアップは既存の対象メモ単位の置換・競合計画を使い、Sourceを他メモの同名IDへ統合しない。
- Markdown ZIPはversion manifestがないため旧版へ警告拒否できない。旧版が画像ブロックを再編集するとFigure情報・Sourceが失われ得る。対応版でのみ復元・再編集する。Markdown ZIPの既存仕様では未使用添付も末尾に追加されるが、新しいSourceは付かない。

## 検証と画像

fenced-source.test.jsは未完フェンス保存・曖昧な旧末尾保存保護・実旧Source reader互換・各parserと描画の字下げ／閉じ条件一致を検証し、既存Geometryのリスト／字下げ回帰も維持する。新しいSource E2Eはこの回帰の実UI追加・編集・削除・取消・Undo/Redo・再読込・実Markdown ZIP／完全バックアップZIP復元も行う。修正前headでは単体8件と実操作E2EのSource消失を再現した。

report-source.test.jsは複数/空/重複/未登録/不正ID、旧形式、旧parser、直列化と復元、初出順、一覧の重複排除、削除保護、同一出現編集、コード除外、Table→Chart独立コピーを検証する。report-source.e2e.jsは実UIで選択・解除・取消・Undo/Redo・再読込・複製独立編集・画像入替/削除/再追加・Source編集/削除拒否・番号共有・Timeline Figure・通常/Report Preview・PC/320px・実ZIP書出し/復元を検証する。

新E2Eは既存Table CIのChromium/WebKitジョブへ追加し、重複する新CIジョブは作らない。新規画像は e2e-artifacts/report-source-review/<browser>/ に生成してCI artifactへアップロードする。docsのPNGはローカルChromiumで採取した今回の変更のレビュー用スナップショットで、最新headの検証は同じheadのCI結果を参照する。画像内の資料名・URL・グラフ値・画像はすべて検証データで、実在資料を示さない。Safari/iPhone実機は未確認。WebKitの非永続コンテキストでは添付BlobのIndexedDB保存がUnknownError（Error preparing Blob/File data to be stored in object store）となる。Windowsでは変更前mainと作業ブランチの両方で失敗し、それぞれ新規通常プロファイルなら同じ画像の保存に成功することを確認した。Ubuntu CIでも非永続コンテキストの画像追加に失敗したため、新E2EのWebKitはlaunchPersistentContextで新しい一時プロファイルを使用する。ZIP復元ごとに別の空プロファイルを作り、アプリの保存経路を変更・置換せず、終了時に片付ける。非永続コンテキストの添付保存成功やSafari/iPhone実機の動作を確認したとは扱わない。

![検証用混在レポート PC](sources-report-pc.png)
![検証用混在レポート 320px](sources-report-320.png)

PDF/印刷の検証は行っていない。図番号とReport Preview全体の表示調整は今回のマージ後の次PR、PDF出力は別段階。
