# Timeline v1

レポート内で出来事を保存した順序どおり縦に表示するコンテナ。専用の画像・Source・Citationモデルは作らない。

## 使い方

「画像」でFigureを、「出典」でSourceを先に追加する。「Timeline」（モバイルは編集ツールメニュー）からタイトル・説明を入力し、「出来事を追加」で日付・期間、タイトル、本文、Figure、出典を選択して保存する。カードの「Timelineを編集」で追加・上下移動・削除できる。新規Timelineは本文末尾のSourceレコードの前に追加する。

画像・出典なしの項目、空のTimelineも扱える。日付は1945、1951年9月、1945–1952、2026 Q3、初期開発期など自由な文字列で保持する。自動並べ替えは行わない。

## モデルと共通部品

本文内の memo-nexus:timeline-v1:<hex UTF-8 JSON> マーカーで保存する。

~~~js
{
  version: 1,
  timeline: {
    id, title, description,
    items: [{ id, dateLabel, title, body, figureId, citationIds }]
  }
}
~~~

- items配列順を保持する。項目IDの重複を除き、文字列の欠落は空欄、配列の欠落は空配列に正規化する。
- Figureは既存Image Blockを参照する。選択したブロックだけに任意の memo-nexus:figure-id:<id> マーカーを追加し、item.figureIdから解決する。画像のattachment ID、alt、figureMetadata、ブロック説明、Comparison設定は元のブロックにあり、Timelineにはコピーしない。画像編集でもFigure IDを保持する。
- 同じFigureを複数項目・Timelineで共有できる。元のFigureを編集すると全参照へ反映される。通常のFigure表示も維持するため、元の表示とTimeline内の表示は両方表示される。元ブロック削除時は参照先不在の表示を出す。
- 現行Citationは独立レコードではなく [@source-id] トークン。citationIdsには既存Source IDを保存し、描画時は同じトークンと共通Citationレンダラーを使う。本文引用と同じ通し番号・重複排除・末尾出典一覧を利用する。未知IDは既存どおり文字列で残す。
- Source削除チェックはTimeline本文と選択citationIdsを解読する。項目本文の未閉じコードフェンスも、他項目や選択Citationの抽出へ影響しない。

保存は既存のcommitSourceBody、Undo/Redo、通常save、IndexedDBを通る。DB schema 6とバックアップv4は変更しない。Report PreviewはrenderPreviewHtmlを共有し、FigureはrenderImageBlockとrenderFigureMetadataを使う。Timeline内にFigure編集メニューを複製しないためDOM IDは衝突しない。Timeline本文のチェックリストは表示専用とし、通常本文のチェックリスト操作位置へ影響しない。


## IDの範囲とコピー／貼り付け

- Figure IDは同一メモ内のImage Blockへの参照キーであり、一意な場合だけ解決する。
- 同じIDを持つImage Blockが複数ある場合、完全コピーから元ブロックを識別できないため、競合する全ブロックからFigure IDマーカーだけを除去する。先頭を選ばない。TimelineのfigureIdは保持され、参照先不在になる。片方を削除しても、残ったコピーへ参照が復活しない。
- ユーザーがFigureを再選択すると、そのImage Blockに新しいIDを付与する。他の参照は自動で付け替えない。画像、attachment ID、alt、figureMetadata、caption、alignment、Comparison設定は除去処理で書き換えない。一意なFigure IDも変更しない。
- 通常の文字入力・削除・タイトル入力で呼ばれるapplyCurrentEditorDraft / scheduleSaveではFigure IDを解析しない。貼り付けとテキストdropは、本文挿入後のinputイベント（insertFromPaste / insertFromDrop）で正規化する。メモopen（import/reloadを含む）、popout初期化、別ウィンドウsync、Timeline selector構築前の処理は維持する。構造化本文確定・Undo/Redo復元後も正規化する。
- 手入力やプログラム経由の本文にも対応するため、draft mirror実書込み、保存キューへ渡す直前、ローカルMarkdown保存、現在draftを取り込むatomic batchの境界で最終確認する。重複があれば既存applyCurrentEditorDraftでlive bodyとrevisionを更新してから既存snapshotを確定し、snapshotだけを別内容へ書き換えない。debounceやsave queue、dirty state、draft mirrorの形式は変えない。除去したマーカー分のselectionStart / selectionEnd / selectionDirection補正を保持し、正規化専用のUndo項目は追加しない。未正規化本文の直接描画でも重複参照は解決しない。
- Timeline IDは現時点ではコンテナのメタデータであり、Timeline間参照のキーではない。マーカーのコピーによる同一IDを許容する。編集対象は表示用本文のTimeline出現順を実editor本文の出現順へ対応させ、実本文のstart/endで置換する。Source・説明Anchorの除去によるoffset変化や、同じID/rawに依存しない。
- Timeline item IDは各Timeline内に限定する。同一Timeline内の重複は既存normalizationで除外するが、別Timelineのitem IDが同じでも編集は各コンテナ内で完結する。将来Timeline間リンクを追加する時には、Timeline IDの一意性とコピー時の再採番を改めて設計する。

## 保存・ZIP・互換性

Markdown ZIP、ローカルMarkdown、完全バックアップは本文マーカーを保持する。import時に添付IDが変わっても、Figure IDは添付IDと独立しているため参照が維持される。Sourceマーカーも既存経路で保持する。

Timelineのない旧メモ、IDのない旧Figure、Comparison、Sourceは従来どおり扱う。バックアップv1〜v4の復元は既存migration経路を使い本文を保持する。不正・将来版Timelineマーカー、コードフェンス内のマーカーは通常本文として残す。

汎用のメモJSON export/import UIは現行実装に存在しない。既存JSON取込はニュースなどの専用形式であり、新形式は追加していない。本文のJSON直列化による保持は単体テストで確認する。

## 検証

- npm test: 1,707件、失敗0。Timeline関連25件（初期14件＋ID修正5件＋入力性能修正6件）はモデル、順序、置換、欠落値、特殊文字、不正マーカー、コードフェンス、引用、Figure編集・添付ID再割当、旧メモ、ローカル保存、Markdown ZIP、バックアップv1〜v4を確認する。
- npm run test:e2e: Figure、Comparison、Report Preview、Citation Source、TimelineのChromiumフロー。Timelineは実UIで作成、複数項目、並べ替え、共有Figure更新、項目・Timeline削除、保存/reload、Undo/Redo、Source削除保護、ZIP import後のreload、DOM ID重複、通常本文チェックリスト、PC/320px Report・カードとモバイル編集幅を確認する。追補でFigureの前方コピー、全競合ID除去、元ブロック削除後の安全性、明示的再選択、旧保存本文の正規化、同一raw/Timeline IDの3個の独立編集、Source/Anchor除去のoffset差、Undo/Redo、reloadを追加した。性能修正では実クリップボード貼り付けのcapture-phaseで挿入後の重複を観測し、inputハンドラー内での即時安全化、カーソル位置、Undo/Redo、reloadを確認する。
- npm run test:e2e:mobile、node geometry-block.e2e.js、node table-block.e2e.js: 既存機能の回帰確認。
- node chart-block.e2e.js、node backup-restore.e2e.js: Chromiumで成功。Chartの全サブケースと既存完全バックアップ復元を確認した。
- 入力性能回帰: Figure IDを60個含む長文でinsertText・削除・タイトル入力を計60回、実inputハンドラーと実正規化関数のspyを使い、保存予約中の解析呼び出し0回を確認する。時間の短さを成功条件にしない。paste/dropの即時処理、draft mirror実書込み、ローカル保存境界とhot-pathのソース構造も検証する。
- 全JavaScriptのnode --check、git diff --check。
- formatter/lint、typecheck、buildの設定・スクリプトはない。直接配信のJavaScriptアプリとして構文・空白と実ブラウザ起動を確認する。未定義のコマンドは成功扱いしない。

WindowsのPlaywright WebKitでは変更前mainでも画像BlobのIndexedDB保存が「添付ファイルの保存に失敗しました」となることを比較確認した。Figureを含むWebKit全フローは未確認。FigureなしのTimeline＋SourceはWebKitで作成・保存・reload・320px Reportを別途確認した。CIに追加したTimeline E2Eは既存FigureジョブのChromiumで実行する。

レビュー画像（Chromium）: [PC Report](timeline-report-pc.png)、[320px Report](timeline-report-320.png)、[320px カード](timeline-preview-320.png)。

## v1の境界と将来候補

Figure/Sourceの追加・編集は既存UIを使い、Timeline画面では選択する。Figure参照は同じメモ内に限る。元Figureの削除で参照が切れる。共通Figureライブラリと元表示の省略は将来の判断とする。

横型、ズーム、年代スケール自動生成、複数系列、分岐、ガント、高度なスクロール/ドラッグ＆ドロップ、アニメーション、Timeline同士のリンク、AI生成、暦処理・日付自然言語解析、Before/After特殊統合は対象外。
