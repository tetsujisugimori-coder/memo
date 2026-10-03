# Diagram v1

Visual Markdown Report v1 第6段階。既存Geometryを説明・作成図表示・共通Source引用を持つ図版へ拡張する。

## 使い方と表示

1. 既存「図形」から点・線分・多角形・円・注釈を作る。
2. 本文下の各Geometry編集欄の「図版情報」を開く。PC・モバイルの同じ入口を使う。
3. 既存キャプション（短い説明）、補足説明（読み方・前提・省略・模式化）、任意の「本レポート作成図」、既存Sourceの複数選択を編集する。
4. 「図版情報を保存」で確定する。「キャンセル」・×・Escは本文、revision、updatedAt、保存予約、Undo/Redo履歴を変更しない。

Sourceは既存「出典」で登録・編集する。図版情報には書誌情報をコピーしない。作成図表示は明示的な選択時だけ表示し、権利保有や資料の正確性を証明しない。

図 → caption → 補足 → 作成図表示 → 選択引用の順に表示する。空欄や空の見出しは表示しない。補足は既存Timeline本文描画を再利用し、MarkdownとCitationを扱う。補足のチェックリストは表示専用。captionは従来のテキスト表示を維持する。SVGの読み上げ説明にはcaptionと補足を使う。

Report Previewは通常Previewと同じrenderPreview / renderPreviewHtml / renderGeometryBlock / hydrateGeometryPreviewsを使い、作図UIや選択状態を持ち込まない。SVGは既存renderGeometrySvgで構造化データから再生成する。viewBoxと既存の縦横比維持を使い、長文とURLは折返す。閲覧では保存本文や履歴を変えない。

## 保存形式と再利用

既存インライン `<!-- memo-nexus:geometry-block:<hex UTF-8 JSON> -->` をそのまま使う。独立Diagramブロック、図形データの二重保存、SVG/HTMLの保存正本、Report専用document modelは追加しない。

図版情報を確定したGeometryは次の項目を追加する。

~~~json
{
  "type": "geometry",
  "version": 2,
  "id": "geometry-example",
  "caption": "三角形ABCの辺を比較する模式図",
  "diagram": {
    "description": "三角形の形と頂点の位置関係を示す。長さは実測値ではなく、比較のために模式化した。",
    "createdForReport": true,
    "citationIds": ["source-test-a", "source-test-b"]
  },
  "viewBox": { "x": 0, "y": 0, "width": 100, "height": 100 },
  "points": [],
  "objects": [],
  "annotations": []
}
~~~

上記は保存項目の説明用。レビュー画像の三角形は実際にGeometry UIで作成した。Sourceとexample.org URLは検証用の架空データであり、実在資料の引用ではない。

captionは既存の4,000文字上限、補足は16,000文字、Source選択は既存referencesPerItemと同じ1,000個、Source IDは共通規則の英数字・_・-の1〜128文字。JSON全体の262,144バイト上限は維持する。改行をLFに正規化し、同じSource IDの重複は最初の参照を保持して除去する。

normalizeGeometryBlockがdiagramを保持するので、geometry-editor-utilsの作図・移動・図形削除、cloneGeometryBlock、createHistoryのコピー／Undo／Redoも情報を保持する。図版情報は現在のGeometryをspreadして更新するので点・線・注釈を変えない。保存後は作図編集モデルを再生成する。

保存はreplaceGeometryBlockのstart/end/raw確認とcommitSourceBody → scheduleSave → 既存保存キューを使う。本文revision / updatedAt / dirty状態を通常経路で更新し、pushUndoSnapshotで1項目を確定する。通常入力・タイトル入力・保存予約に新しい全本文走査を追加しない。DB schema 6とIndexedDB storeは変更しない。

## 共通Citation・Source

本文、Timeline、Diagram補足と選択引用は既存citationRenderContextとrenderMarkdownInlineを使う。表示での最初の参照順から番号を導出し、同じSourceは同番号、末尾一覧は1件になる。コード中の引用は既存Markdown規則で変換しない。

Source削除時のextractCitationsへGeometryの補足と選択IDを追加する。Sourceのタイトル・URLを編集すると共有一覧へ反映される。未登録の有効Source IDは [@id] の欠落表示を残し、図版情報ダイアログでも「未登録Source」として選択を保持する。別のSourceへ自動接続しない。不正な型・IDや未知のdiagram項目・将来versionはGeometry全体を元マーカーの本文として保持し、編集UIで部分的に削除しない。

## 編集対象の安全性

Geometry編集欄は実editor本文を解析した出現順で構築し、同じ順番のブロックへstart/endで置換・削除する。IDやマーカー全文の最初の一致では対象を決めない。Diagram用のPreview編集ボタンは増やしていないので、SourceやExplanation Anchorを取り除いた表示用本文のoffsetは編集に使わない。同一ID・同一マーカーのコピーも個別に編集できる。ダイアログを開いた後にメモや本文が変更された場合は保存を拒否し、開き直しを案内する。

## 旧版との互換性

調査基準main: 2ec55385048dd9729ed3b5b3997ff2bd18f43766（PR #337まで）。PR #331 / #333 / #335 / #337のマージ状態と実装を確認した。

- 情報のない旧Geometryはversion 1のまま読み込み・作図・表示する。読込・閲覧だけでdiagramや作成図表示を付与しない。
- 旧normalizeGeometryBlockは固定フィールドだけを返す。version 1へdiagramを追加すると旧parseGeometryBlockLineで読み込めるが、diagramが黙って落ちる。このため新しい情報があるGeometryだけversion 2にする。
- 実旧parserはversion 2を拒否し、splitGeometryBlocksは元マーカーを通常本文として保持する。旧版では図として表示／再編集できないが、通常本文の保存で未知マーカーを消さない。旧版でユーザーが本文マーカーを削除・加工する場合の保持までは保証しない。
- 完全バックアップmanifestのversion / formatVersionは5に更新する。旧v4 readerはv5を新しい形式として拒否する。現行readerはv1〜v4を本文・Source・Figure・添付を変えずにv5へ移行し、v6以降を拒否する。保存キュー・DB構造を変更する必要はない。
- Markdown ZIPはmanifestがなく、旧アプリの取込みを拒否できない。対応版での図形・図版情報・Sourceの往復を保証する。旧版での描画・再編集、未知マーカーをユーザーが操作した後の保持は保証しない。ローカルMarkdownも同じ制約を持つ。
- 添付のない個別メモは既存仕様で.mdをダウンロードする。添付付きメモまたはコレクション書出しはMarkdown ZIPを使う。図版情報のために書出し仕様を変えていない。

旧版のGeometry / backup utilityはfixtures/に基準mainからコピーした実ファイルを置き、diagram.test.jsで実行する。旧parserの項目消失、v2拒否とマーカー保持、バックアップv5拒否を継続検証する。

## 検証とレビュー画像

- 単体: 全1,725件成功。diagram.test.jsの16件は正規化、直列化、再読込、旧新混在、空欄、日本語・特殊文字・長文、不正／未知／コード、共有Source、作図・複製・履歴保持、同一ID/rawの対象安全、実旧parser、ローカルMarkdown、両ZIP経路を確認する。
- Chromium実ブラウザ: npm run test:e2e 全体成功（Figure → Comparison → Report Preview → Citation Source → Timeline → Diagram）。Diagramは作図、図版情報の保存／キャンセル、図の再編集、図形内・本文のUndo/Redo、reload、同一ID/rawの独立編集・削除、Source削除保護・編集反映、本文／Timeline／補足／選択引用の共通番号、未登録ID保持、本文が更新されたダイアログの上書き拒否を確認。
- 実ダウンロード: 添付なしのローカルMarkdown、添付付きMarkdown ZIP、完全バックアップZIPを既存UIから書出し、両ZIPを新しいブラウザコンテキストへ取り込み、図形・図版情報・Sourceとreload後の保持を確認。
- 通常PreviewとReport PreviewのPC／320pxで横overflowなし、SVG CTMの縦横倍率一致、Reportの編集UI非表示と本文・revision・updatedAt・履歴不変を確認。
- 既存Geometry E2E、Mobile layout／writing E2E、backup-restore.e2e.jsもChromiumで成功。Geometryの主要シナリオはPCと390pxで検証。
- JavaScript構文とgit diff --checkを実行。CIはPR上で同一headの最終結果を確認する。
- 初回は作図テスト座標が多角形内部だったため既存仕様どおり選択になった。またモバイルカードを開いた状態で背面の開くボタンを押していた。E2Eの操作を既存UIに合わせて修正し、force clickや待機時間変更は使っていない。
- 添付なしの.mdをZIPとして取り込もうとした試験入口を修正。既存Figure／Citationのバックアップversion固定期待値を5へ同期した。機能の期待値は弱めていない。
- ページnavigation / reloadに30秒timeoutが発生した回は失敗ログを保持した。原因は未特定。直列の最終一式は成功し、固定待ち・retry・timeout変更・load待機条件の変更は追加していない。
- PC Report Preview: [diagram-report-pc.png](diagram-report-pc.png)
- 320px Report Preview: [diagram-report-320.png](diagram-report-320.png)
- 320px通常Preview: [diagram-preview-320.png](diagram-preview-320.png)

画像はChromium実画面。PCと320pxで実図・caption・補足・作成図表示・共有Source一覧を確認し、長文とURLの横overflowを実DOM計測する。レビュー画像には検証用データであることを表示する。

## 制約・対象外

本格的フローチャート、系譜・構造図、自動配置、任意SVG/HTML取込み、AI作図、TimelineからDiagram参照、メモ間参照、Figureライブラリ、図番号、Figure/Table/Chart全体へのSource接続、HTML/PDF・印刷専用出力、エディタ・保存アーキテクチャ再設計は含まない。

WebKit/Safari/iPhone実機でのDiagram操作と本番配信後のキャッシュ更新は未確認。既存SVGの作図表現とMarkdown表示の制約を引き継ぐ。マージは人間が行い、自動マージしない。
