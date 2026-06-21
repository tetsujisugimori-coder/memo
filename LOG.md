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

## 2026-06-21 iPhone保存対策: 編集中メモのlocalStorageドラフト退避

### 変更内容

* localStorageに全件バックアップする案は採用せず、容量を考慮して現在編集中の1件のみをドラフト退避する実装を追加
* saveCurrentDraftMirror() を追加
* scheduleSave() の先頭でドラフト退避するよう変更
* restoreCurrentDraftMirror() を追加
* init() で ensureStartupNotes() の前にドラフト復元を試すよう変更
* pagehide / visibilitychange 時にもドラフト退避するよう変更
* 古すぎるドラフトを復元しない判定を追加
* 削除したメモがlocalStorageドラフトから復活しないよう、一致するドラフトだけを削除
* 復元時・保存時の診断ログを追加
* README.md に編集中文書1件のドラフト退避・復元仕様を追記

### 修正理由

* iPhone Safari / PWA では、入力直後にアプリを閉じると遅延保存やIndexedDB保存が完了しない可能性があるため
* localStorageは容量が小さいため、全メモではなく現在編集中の1件だけを退避する方針にした
* IndexedDBを本保存として維持しつつ、直前の入力内容だけを救済できるようにするため

### 確認方法

* PCで既存のメモ作成・編集・削除・検索・Markdownプレビュー・Wikiリンク・ZIP出力が壊れていないことを確認
* iPhoneでメモを作成または編集する
* 入力直後にホーム画面へ戻る、Safariを閉じる、またはPWAを終了する
* 再起動後、直前に編集中だったメモが復元されることを確認
* console.log に Draft mirror saved / Draft mirror restored が出ることを確認
* ZIPの日付異常修正が維持されていることを確認

### 確認結果

* `node --check app.js` でJavaScript構文エラーがないことを確認
* localStorageに現在編集中の1件だけが保存され、タイトル・本文・各日時が含まれることを確認
* IndexedDBより新しいドラフト、およびIndexedDBから消失したIDのドラフトが復元されることを確認
* IndexedDB側の方が新しい場合はドラフトを復元しない条件を確認
* 30日以上古いドラフトが復元されず、localStorageから削除されることを確認
* 削除したメモと同じIDのドラフトが削除され、次回起動時に復活しないことを確認
* ZIP内ファイル名の重複回避とZIPヘッダーのDOS日時が維持されていることを確認
* `git diff --check` で差分の空白エラーがないことを確認
* iPhone Safari/PWAでの実機確認は未実施
