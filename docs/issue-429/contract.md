# Issue #429 通常メモの保存競合拒否・原稿保全契約

base: `8f35ca25001ffa031abfd304dd2a5e9a3d9197dd`。mainから独立したbranch `codex/issue-429-save-conflict-20261107`。既存Draft #430/#432へ製品変更を追加しない。研究PRの固定点はboundary.json。ユーザー指示どおりマージ・公開を実行しない。

## 原因と変更境界

旧putNoteは同IDへ無条件putし、別タブで確定した本文を比較しない。foundationのrevisionはタブ内の入力世代で、lockTail/entriesもタブ内Map。BroadcastChannelはdirty原稿を上書きせずpendingにするが、通常保存を拒否しない。単一localStorage mirrorは別タブの原稿保全を保証しない。

通常保存はnoteSaveBasesにraw DB由来の基準版を保持する。読取結果にはWeakMapで元snapshotを対応させるが、getStoredNotes/getAllNotesの単なる読取りでは基準を進めない。初期ロード/初回登録、明示openNote/applyMemoSyncで画面へ採用する時と、自タブの成功transaction.complete後にだけ基準を反映する。dirty重畳後の原稿を保存基準として採用せず、foundationの入力/キューrevisionとも分離する。

変更対象はapp.jsの通常writer・基準管理・mirror復元・保存状態UI接続、専用store/UIモジュール、index/CSS、専用試験、必要な既存試験のschema/VM環境、通常CIの独立ジョブ。foundation本体、ZIP形式/復元writer、MCP/OAuth/Worker、研究collector/judge/schema/workflowは変更しない。

## 第1段階: 比較と保存確定

- notes / note-tombstones / note-conflictsを含む同じreadwrite transaction内で、tombstone、現在revision、基準revision、基準本文/タイトルを確認する。
- 一致時だけnotesへ書く。revisionは現在版より新しく、入力revision以上の安全整数とする。
- 旧v6レコードのrevisionプロパティ欠落だけをlegacy初期値0とする。null/文字列/負数/非整数/unsafe値を0へ丸めて正常一致にしない。基準未取得も一致にしない。
- read requestのsuccessは確定ではない。transaction.completeでのみ書込みをresolveし、基準Mapと保存済み状態を進める。abort/error/quota/version差を成功にしない。
- 同じメモのキュー内で自タブが先行保存した場合は、complete済みの自タブ基準を次の保存で使う。外部更新ではdirty基準を付け替えない。
- 通常batchも同一transaction内で全件確認する。1件でも競合した場合はnotes全件を変更せず、batch原稿を保全する。既存batch validate/原子性を維持する。

## 第2段階: 原稿と拒否証拠

DB version 7は独立したnote-conflicts store（keyPath=id、noteId index）を追加する。既存store・レコードを削除せず、既存versionchange/blocked/VersionError処理を利用する。旧v6タブはupgrade時に接続を閉じ、新しいDBへ旧バージョン指定で再接続できない。実機PWAのcache/更新動作は別途UNKNOWN。

競合時は元メモを書かず、次を同じtransactionでcommitしてから型付きNOTE_SAVE_CONFLICTをrejectする。transactionをabortして保全も失う方式ではない。

- memo-conflict-draft: noteId、attempt requestId、ownerタブID、日時、基準revision/本文、全文body/title、拒否snapshot。
- memo-conflict-rejection: noteId、requestId、期待/確定revision、拒否全文、確定全文/snapshot、日時。

同じ編集世代・同じ本文/タイトルの再試行は同じattempt IDを使う。既存recordはそのまま返し、作成日時等を偽造し直さない。IDが同じで本文が異なる場合は保全失敗として停止する。別世代/再競合は別原稿として残す。

保全失敗はNOTE_CONFLICT_PRESERVATION_FAILEDで、dirty・原稿・再試行情報を保持し「保全失敗」と表示。保全済みにはしない。原稿全文の書出しを提供する。拒否requestの保存中に追加入力があった場合は、最後のlive原稿も別attemptとして保全し、編集欄を読取り専用にする。

## 第3段階: 比較・回復

- 競合と保全結果は確定したtransaction証拠から直ちに表示し、その後readonlyで現在内容を再確認する。
- 保存済み全文と拒否原稿全文を表示。テキストはtextContentで扱い、HTMLとして評価しない。
- 原稿全文を書き出す操作は本文だけを正確なUTF-8テキストとしてdownloadする。元メモを変更しない。
- 「再編集」は明示操作で現在DBを読み、最新基準を固定して選んだ本文/タイトルを編集へ戻す。最新メモのcollection/タグ/未知フィールド等を古いsnapshotで戻さない。
- 再編集開始だけでは保存しない。明示保存ボタンまたは利用者の追加入力による通常autosaveで、再度CASを実行する。
- 回復途中でさらに別タブが更新すれば再拒否・再保全する。明示保存成功時だけ、同じ回復系列にresolvedAt/revisionを付ける。原稿レコード自体は削除しない。
- タブIDはhistory状態で再読込を識別する（popupで複製され得るsessionStorageに依存しない）。ブラウザのタブ複製・終了後の元タブ自動特定は保証しない。所有者IDは表示補助だけで保存権限には使わない。新しいタブでは実UIの原稿一覧から利用者が選び、比較・書出し・再編集する。

## mirrorとその他の保存経路

mirrorには保存基準を持たせる。古い/基準不明のmirrorを、起動時に読んだ最新DBへ黙って付け替えて再保存しない。既存IDでは本文だけでなくタイトル/collection/削除/flag/tagsを比較し、差分があればmirror固有の基準で検証する。既に同じ本文・タイトル・対象metadataの原稿を保全している場合は重複復元しない。旧形式mirrorは比較不能なら保全側へ送る。mirror自体をIndexedDB永続回復の証拠にはしない。

ZIP全体置換等の明示インポート、Codex thread専用writer、添付writerは既存経路を維持する。Codex thread保存は既存stored-thread mergeで通常本文を変更しない。通常保存と明示インポートの全interleavingまで今回一括保証しない。回復storeは既存ZIP形式へ自動追加しないため、未解決原稿は専用書出しを使う。ZIPへの回復原稿包含、異常終了/長期保管、実quota枯渇は未実測範囲を分けて報告する。

## 受入証拠

方式Bの純粋判定契約は#432の固定d2bb569から複製し、意味条件を変更しない。合成A/BのPASSは製品PASSではない。新しいUI observerは既存のreadonly観測/有限Node pollを使う。タブ終了後には実UIから原稿を選ぶ手順を追加し、元タブを自動推測しない。

旧REDは固定mainを使い捨て領域へgit archiveし、対象sourceをgit blobと照合する。Windowsの改行変換はarchive時に明示的に無効化する。旧製品のFAILをchild exit 1・両engine・編集消失の実測で確認し、起動失敗やtimeoutを対照成功へ数えない。

修正版は同じ2行・同じ自然280ms autosave経路を使う。保存関数、timer、BroadcastChannel、IDB writerを差し替えない。入力順・実際の確定本文・保全原稿・保存表示・再読込・全タブ終了後の実回復を保存する。障害モデル単体は合成と明記し、実ブラウザのquota枯渇証明へ転記しない。

J2/U-C=UNKNOWN、conditionU=NOT_RUN、executionAuthorization=NOT_GRANTED、startCondition=BLOCKED、productionWorker=HOLDを維持。実データ、実MCP/OAuth、Worker停止/復旧実験なし。

2026-11-07 JST
