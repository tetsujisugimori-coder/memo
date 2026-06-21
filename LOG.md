## 2026-06-21 Memo Nexus 保存安定化・ZIP修正

### 変更内容

* IndexedDB の putNote/deleteNote を transaction 完了待ちに変更
* flushSave() を追加し、ZIPバックアップ前に遅延保存を強制実行
* pagehide / visibilitychange でiPhone終了時の保存漏れ対策を追加
* ZIPヘッダーに正しいDOS日時を書き込むよう修正
* ZIP内ファイル名の重複を避ける uniqueZipFileNames() を追加
* README.md にiPhone保存安定化とZIPバックアップ改善の仕様を追記

### 修正理由

* iPhoneでは遅延保存や非同期IndexedDB保存が、ページ終了・画面ロック・アプリ切替で完了しない可能性があるため
* ZIPの日付が u16(0), u16(0) になっており、iPhone側で1979/11/30のような不正な日付として表示される可能性があるため
* 同名タイトルのメモがあると、ZIP内で同じ .md ファイル名が複数生成される可能性があるため

### 確認方法

* PCブラウザでメモを作成・編集し、再読み込み後に残ること
* iPhone Safariまたはホーム画面追加版でメモを作成・編集し、アプリを閉じて再起動しても残ること
* ZIPバックアップを作成し、ZIP内ファイルの日付が1979/11/30のような不正日付にならないこと
* 同じタイトルのメモが複数あっても、ZIP内ファイル名が -2, -3 付きで一意になること
* 既存のメモ作成、編集、削除、検索、Markdownプレビュー、Wikiリンクが壊れていないこと

### 確認結果

* `node --check app.js` でJavaScript構文エラーがないことを確認
* IndexedDBモックで putNote/deleteNote がtransaction完了前には解決せず、完了後に解決することを確認
* 同名ファイルが `新規メモ.md`、`新規メモ-2.md`、`新規メモ-3.md` になることを確認
* 指定日時がDOS日時へ変換され、ZIPのローカルヘッダーとセントラルディレクトリヘッダーの両方へ同じ値が書き込まれることを確認
* `git diff --check` で差分の空白エラーがないことを確認
* PCブラウザおよびiPhone Safari/PWAでの実機確認は未実施
