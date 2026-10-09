# PR-3: 外部AIからの複数メモ受信

開始時 origin/main: `29e4d646e74c5b45773f49ce0a8ef6315a306da2`。
PR #352 と #353 はマージ済み。関連 Issue は #355。他の open PR はなし。複数メモ受付は既存実装になかった。
元作業ツリーは未追跡 `work/` のみ。既存の未追跡ファイル・全 worktree を保持し、`work/pr3-notes-preview` / `feat/received-notes-preview` で実装した。

## 変更対象

- `dummy-preview-queue.js`: `notesRequest`、`createQueue` の受付・状態・期限処理。1要求内にサービス生成の個別 `itemId` と固定保存計画・試行を持つ。
- `dummy-preview-mcp.js`: `submitNotes`、`createMcpHandler`、`runStdio`。新ツールを追加し、複数件を扱うstdio入力上限を設定。既存2ツールの入力・応答・HTTP制限は維持。
- `dummy-preview-service.js`: `createPreviewService`。Adapter専用 `/notes` とBrowser専用の個別制御を追加。
- `dummy-preview-ui.js`: 一覧・応答検証・選択・要求状態照会を追加。既存の原文プレビュー、保存先確認、Web Lock、明示保存・破棄を再利用。
- `index.html` / `dummy-preview.css`: 未処理一覧・処理済み一覧・任意requestId照会。長いタイトルの折り返しと受信JS/CSSのキャッシュ識別子のみ更新。
- `received-notes-preview.test.js` / `received-notes-preview.e2e.js`: 境界・部分保存・回復・競合・全ストア保護を追加。
- `dummy-preview.test.js`: ツール一覧に3番目を追加。データ項目 `notes` と保存用アプリ変数を区別し、裸の `notes` 参照、保存API・IndexedDB・HTML実行機能の禁止を維持。
- `package.json` / `.github/workflows/ci.yml`: 新E2Eを既存専用受信ジョブへ追加。既存チェックは除外しない。

`app.js`、createNote、putNote、DBスキーマ、Bridge、Clipperは変更していない。タグ登録、コレクション作成、既存更新・削除、Reportデータ取り込み、AI自動保存、OAuth、永続キューを追加しない。

## MCP 入出力契約

```json
{
  "name": "submit_notes_preview",
  "arguments": {
    "requestId": "7622dedf-66fc-4adb-bcde-714c1f0120db",
    "notes": [
      { "title": "確認用メモ1", "body": "日本語本文\n\n- 項目\n" },
      { "title": "確認用メモ2", "body": "別の本文\r\n末尾空白  " },
      { "title": "確認用メモ3", "body": "保留する文章" },
      { "title": "確認用メモ4", "body": "確認して破棄する文章" },
      { "title": "確認用メモ5", "body": "最後の文章" }
    ]
  }
}
```

- `requestId`: 要求全体で1つの小文字UUID v4。呼び出し側で生成。同ID・同順序・同title/bodyは同じ結果へ戻す。順序・件数・本文・タイトルの相違は `request_id_conflict`。別ツールで同IDを使っても競合を拒否する。
- `notes`: 1〜5件。各項目は必須文字列title/bodyのみ。要求・項目の未知キー、itemId、既存ID、保存先、タグ、添付、更新・削除等を拒否する。
- 原文はtrim・Markdown再生成・HTML変換しない。空文字・空白だけを拒否。
- 各titleは200 Unicodeコードポイント。既存仕様と同じで独立したUTF-8制限はない（最大800 byte）。各bodyは65,536コードポイントかつUTF-8 65,536 byte。
- 各メモの `textRequest` 相当JSON上限409,600 byteも維持する。要求全体の `/notes` JSONは2,048,000 byte（既存400KiBの5倍）。stdioの累積入力バッファは2,052,096 byte（4,096 byteの外側メタデータ余裕込み）。改行のない超過も接続終了。
- 既存 `/text` は409,600 byte、`/dummy` とBrowser制御JSONは1,024 byteのまま。MCPのHTTP応答読取上限は既存ルートで413,696 byte、新ルートで2,052,096 byte。ブラウザの応答上限は複数件対応の2,052,096 byte。
- `params._meta` は既存標準メタデータ検証を使い、キュー・保存計画へ渡さない。
- スキーマ違反はMCP `-32602`。競合等は `isError:true` と `state`。容量拒否はHTTP413。満杯はHTTP409、`queue_full`、MCP `isError:true`。

MCPの `content[0].text` はJSON文字列で、次を返す。

```json
{
  "requestId": "7622dedf-66fc-4adb-bcde-714c1f0120db",
  "notes": [
    { "itemId": "サービス生成UUID", "title": "原文タイトル", "body": "原文本文", "state": "queued", "saved": false }
  ],
  "state": "queued",
  "saved": false,
  "message": "各メモのstateとsavedを確認してください。このMCP呼び出しは保存しません。"
}
```

例の `notes` は説明のため1件のみ。実際は受信件数と同じ順序・件数。itemIdは保存されるメモIDとは別。MCPにsavePlan・attemptIdは公開しない。
要求のstateは `queued`（未処理が1件以上）、`completed`（全項目が保存・破棄・期限切れ）、`queue_full`（要求全体の拒否）。要求全体のsavedは全項目の保存完了通知が揃ったときだけtrue。一部保存ではfalseなので、各項目のstate/savedを確認する。savedはブラウザ通知済みの既存結果であり、ツールが保存した意味ではない。

## 状態遷移・ブラウザ制御

各メモは `queued`（未保存）→ 明示保存 → `saving`（完了不明）→ IndexedDB transaction完了 → complete通知 → `saved`。
保存エラーは `save_failed`（失敗・完了未確認）、通知通信断は `saving` のまま。次の明示保存で同じ固定noteId・collectionIdを照合し、新しいattemptIdで回復する。DBに既存結果があれば再作成しない。不一致・削除済みなら上書きせず停止。
`queued` / `save_failed` は明示破棄で `rejected`。`saving` の破棄は禁止。破棄は受信内容だけで、コミット済みメモを消さない。
未着手 `queued` は受信から10分で `expired`。操作時に状態を更新する。自動保存はない。

Browser tokenと既存許可Originを使う。複数件制御では以下にサービス生成itemIdを必須追加する。省略した保存・破棄は `item_id_required` で拒否し、全件一括操作を作らない。

- `/status`: `{requestId}` で全体、`{requestId,itemId}` で個別。
- `/begin`: `{requestId,itemId,collectionId,previousAttemptId}`。
- `/complete` / `/failed`: `{requestId,itemId,attemptId}`。
- `/reject`: `{requestId,itemId}`。

個別attemptIdを他項目へ流用した通知、古い試行のbegin/complete/failedは拒否する。既存単一メモの制御JSONは変更しない。

一覧から1件を選ぶと既存プレビューに原文と保存先が出る。保存・破棄も選択した1件のみ。保存完了後は未処理一覧から外れ、処理済み一覧で状態と原文を確認できる。部分処理後の再読込は保留要求から全項目の最新状態を復元する。全件処理済みで保留が空なら、requestId照会欄に元のIDを入れて「受信を確認」で結果を確認する。新しい永続ストレージ・履歴列挙APIは作らない。

PR-2の `memo-received-request:<requestId>` Web Lockを維持し、同要求の別項目でも保存・破棄を直列化する。固定保存先の不一致ではそのクリックでDBに触らず、変更先を表示して再クリックを要求。各項目で固定計画は独立。連打・選択変更・操作中の閉じるを既存ガードで抑止する。

## キュー容量・移行・保証範囲

1枠は1要求（従来1メモ、今回最大5メモ）。単一・ダミー・複数要求が共通の1枠と128要求の履歴を使う。保留項目が1件でも残れば別の要求は全体を `queue_full` とし、部分受付しない。失敗・保存中項目も枠を占有する。
拒否ID・保存済み・破棄済み・期限切れを追い出さず、128要求で新規 `history_full` / HTTP503。同内容の既知IDは履歴上限後も状態確認できる。終端項目は未処理へ戻らない。
全項目の本文上限を満たす128要求では、本文は最大40MiB相当（UTF-8、JS内部表現・メタデータ・JSONバッファは別）。履歴の件数は128のままで、1履歴に保持する本文件数が最大5に増える。大きな履歴を永続化しない。

各要求の未着手項目だけに従来の10分TTLを適用する。一部保存・一部破棄でも未着手項目の期限は延ばさない。保存を開始したsaving/save_failedはサービス終了まで固定計画を保持する。
更新時はサービスとMCPを更新版で再起動し、使用する全タブを再読込する。一時キューの既存状態を移行しない。再起動で旧要求・履歴・保存計画を失うため、更新前の要求を再投入しても重複防止を保証しない。保留を処理するか、専用テスト要求で開始する。

重複防止は同じサービス継続稼働・同じOrigin・ブラウザ保存領域内。サービス再起動、別Origin、別プロファイル、別端末をまたぐ保証はない。Web Locks・IndexedDBがなければ成功扱いにしない。保存はブラウザ内で、フォルダー同期完了・private browsing終了後の保持を保証しない。

## 安全性

title/bodyはtextContent、本文はpre。HTML/script/img/Markdownリンクを要素化せず、外部URLを自動取得しない。Browser/Adapterの別トークン、Origin/Host/CORS、ヘッダー・接続数・rate limit・loopback `127.0.0.1:8791` は維持。Adapterは保存状態ルートを使えず、MCPからDB保存やボタン操作を直接実行できない。
OAuthは未実装。ローカル実証用で、一般公開可能な認証済み構成とは扱わない。

## 検証記録（2026-10-09 JST）

- 既存受信単体の初回は12件中2件失敗。原因は旧2ツール固定一覧と `notes` フィールドも禁止する静的チェック。調整途中の再実行はローカル変数名notesがチェックに当たり1件失敗。ローカル変数をvalidatedNotesとし、保存能力禁止を維持して成功。除外なし。
- 全単体の初回は1817件すべて成功。stdio境界テスト追加後の最終は1818件すべて成功。保存基盤・Bridge・Clipperの既存テストを含む。
- 新複数件Chromium E2E初回は、テスト用の不完全なタグが再読込で既存正規化され、全ストア一致で失敗。再試行1はタグ生成APIの戻り値の取り違えでfixture作成失敗。再試行2は既存生成関数のdefinitionを使い成功。全ストア一致の期待値は変更しない。別項目2タブ・受理済み通知の応答消失を追加した最終実行も成功。
- 新E2E: 実stdio MCP→HTTP→隔離Chromium→明示クリック→既存IndexedDB。5件未保存、2保存/1破棄/2保留、再読込・同ID再送、容量不足、完了通知の要求断・受理後応答消失、連打、同項目/別項目2タブ、保存先不一致、保存と破棄の競合を確認。
- 原文CRLF・末尾空白・日本語・HTML/script/URL一致。実行マーカーなし、受信URLへの通信0。新規保存以外の全6ストア・添付byte・既存/ゴミ箱メモ不変。320px横あふれなし。
- 境界: 1/5/6件、title 200/201コードポイント、body 65,536/65,537、UTF-8 65,536/65,537 byte、5件の最大JSONエスケープ、HTTP2,048,000/2,048,001 byte、stdio2,052,096/2,052,097 byte。不正入力・認証・Host・Origin・scope・履歴上限・TTL・古い/別項目通知も確認。
- 既存単一保存E2E、既存競合7シナリオE2E、固定ダミーE2Eはそれぞれ初回成功。通常新規作成・編集保存、実transaction中断、ブラウザプロセス終了/同隔離プロファイル再起動も既存E2Eで維持。
- 全238 JavaScriptファイルの構文とgit diff --checkが成功。最新HEADのCI初回結果・再実行有無はPRに記録する。

生成物・失敗を含むログはignored `e2e-artifacts/received-preview/pr3-*.log`。CIでは同ディレクトリを失敗時もartifactとして保持。
新E2Eでは独立シナリオ間でサービスの注入可能な時計を1分進める。120/minuteの本番rate limitを変えず、テスト全体の操作数による待機を避ける。排他の順序はPromiseゲートとWeb Locks.queryで確認し、固定時間待ちに依存しない。
再読込は受信なし対照でも既存draft復元が現在メモのbodyUpdatedAt/updatedAt/revisionを進める。全メモの再読込後完全不変は主張しない。今回保存した非編集中メモの再読込後原文とID、不変ストアは照合している。

担当による実Tunnel/ChatGPT送信、公開HTTPS Origin/LNA実許可、実Bridge runtime/Clipper拡張GUI、手動スクリーンリーダーは未実証。新複数件E2EはWindowsの隔離Chromiumで実行し、実ユーザープロファイル・既存メモ・実Tunnel秘密を使わない。

## ユーザーによる実Tunnel確認

1. 更新版を配信し、保存可能な専用検証プロファイルで `http://127.0.0.1:5500/` を開く。既存5500/8791プロセスの版を確認して競合させない。実メモを試験データにしない。
2. 更新版の専用サービス・既存Tunnelランチャー・MCPを起動。全タブを再読込。秘密値をログやチャットへ貼らない。ChatGPT側のツール一覧を更新し `submit_notes_preview` を確認する。接続・トークン生成の既存手順は [PR-1文書](dummy-preview-pr1.md)、保存の注意は [PR-2文書](received-preview-pr2.md)。
3. 上の例を新UUIDで実Tunnelから送る。queued・全5件saved:falseとrequestIdを確認。同ID・同順序・同原文の再送で同じitemIdを確認。
4. ブラウザでBrowser tokenを入力し「受信を確認」。5件の原文・保存先を個別に確認し、受信だけではメモが増えないことを確認。
5. 人が2件を個別に保存、1件を破棄、2件は保留。未処理2件/処理済み3件になり、専用保存メモ2件だけが増えたことを確認。
6. 再読込・token再入力・受信確認で処理済みが復活しないことを確認。同ID再送で2件saved、1件rejected、2件queuedを確認。異なる本文で同IDを送ると競合拒否、既存結果保持を確認。
7. 必要なら同じ検証プロファイルの2タブで同項目を保存し、新規1件だけと固定保存先を確認。全件処理後は元requestIdを状態照会欄へ入力して結果確認。保存途中の通信断は重複保証の範囲内で同サービスを継続し、元のIDで明示再試行する。
8. 結果を記録して通常手順で停止。公開HTTPS/LNAは別途実権限で確認する。自動マージしない。

再現コマンド: `npm test`、`npm run test:e2e:received-notes`、`npm run test:e2e:received-preview`、`npm run test:e2e:received-concurrency`、`npm run test:e2e:dummy-preview`。
