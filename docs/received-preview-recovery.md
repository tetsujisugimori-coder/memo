# MCP受信経路：再起動後の復旧と保証範囲

基準main: `42e461c04e3e585286d17fd489cedef7938e4242`。2026-10-10 JSTにorigin/mainをfetch、未マージPR 0件を確認。独立worktree `work/mcp-restart-recovery`、ブランチ `feat/mcp-restart-recovery`。既存の未追跡work/、他のworktree、通常利用中の5500/8791プロセスは変更・停止していない。自動マージしない。

## 調査した既存保証と不足点

PR #352/#353/#356、AGENTS.md、PR-1/2/3文書、queue/service/mcp/ui、既存E2E・CI、createNote/putNote、保存キューとtombstoneを確認した。

| 項目 | 既存保証 | 今回の変更 |
| --- | --- | --- |
| requestId | 同一稼働中の同内容再送、異内容拒否 | 本文なしのSHA-256照合と識別履歴を再起動後も保持 |
| itemId | 最大5件の個別ID・状態 | 順序・個別ID・終端状態を保持 |
| noteId / collectionId | 初回beginで固定、再試行でも同一 | 計画を応答前にファイルへ確定 |
| attemptId | 最新試行と通知の照合、古い通知拒否 | 再起動後も照合。明示再試行で新しいID |
| 保存 | 手動クリック、Web Locks、ID照合、DB oncomplete | 保存証跡と新規メモを同一DB transactionで確定、既存IDへのaddで上書き拒否 |
| 履歴容量 | 128要求、履歴を追い出さない | 再起動後も128要求。自動削除しない |
| 障害 | 通信断、容量不足、通知消失 | 本文再送待ち、復旧情報不足、履歴障害・再起動の診断 |

再実装していないもの：入力検証、1枠、10分TTL、個別保存・破棄、Web Locks、Browser/Adapter token分離、Host/Origin/CORS/rate limit、textContent原文プレビュー、固定ダミー保存禁止。通常保存、Bridge、Clipperの機能は維持する。

## 永続化と保存先

CLI `node dummy-preview-service.js` / `start-dummy-preview.ps1` は必ず永続サービスを起動する。テスト注入用 `createPreviewService` は従来のメモリキューで、CLIでは使わない。

- Windows既定：`%LOCALAPPDATA%\Memo-Nexus\received-history\history.json`。checkout・ブランチが変わっても同じ履歴を使う。
- その他：`~/.local/share/Memo-Nexus/received-history/history.json`（LOCALAPPDATA指定時はその配下）。
- 専用検証の上書き（配信webrootの外の専用ディレクトリを使う）：起動するプロセスに `MEMO_PREVIEW_HISTORY_DIR` を設定する。既存履歴から別のディレクトリへ切り替えても同一保証が続くとは扱わない。
- 正規化したディレクトリ単位で、パスのSHA-256から導いた20000～49999のloopbackポートを排他的に保持する。別サービスの同時更新を拒否し、強制終了ではOSがロックを解放する。ポート衝突時は起動を拒否する。ロックの通信は受け付けず本文や状態を返さない。HTTP待受は従来の127.0.0.1:8791。
- WindowsはディレクトリDACLを現在ユーザーだけのFullControl・子への継承に設定する。設定失敗は起動拒否。Unixはディレクトリ0700・ファイル0600。専用ローカルディレクトリを使い、共有フォルダー・ネットワークFS・複製した履歴の並行稼働は保証対象外。
- ファイルはversion=1、records、SHA-256 checksumのJSON。厳密キー、UUID、状態・計画、日時、個別ID、保存IDの重複、アクティブ要求数を検査する。checksumは偶発的な破損検出で、ローカルユーザーの悪意ある改変を認証するものではない。
- 記録はrequestId、要求種別（dummy/items）、要求全体のダイジェスト、itemId、状態、collectionId、noteId、attemptId、受信時刻、期限のみ。タイトル・本文・トークン・MCPメタデータを保存しない。
- 更新は同ディレクトリのhistory.nextへ全snapshotを書き、fsync・close・renameする。Unixではディレクトリもfsync。応答前に更新を確定する。途中停止は直前の正常な履歴または新しい全履歴へ戻り、部分JSONを正常扱いしない。既存正常履歴があれば未公開のnextを復元に使わない。正常履歴がなくnextだけなら起動拒否。
- 読込破損、構造不一致、1MiB超過で起動停止。更新失敗は当該操作を503にし、そのプロセスの以後の受信・照会・保存制御を停止する。メモリ上の未確定成功を返さない。
- `.gitignore`はreceived-history/、history.json、history.nextを除外する。認証情報はプロセスメモリのみ。ログは安全なエラーコード、UI診断はrequestId/itemIdと日本語の確認段階を使う。

耐久性の範囲は通常のプロセス停止・強制終了。停電、ストレージ機器やOSの破損、バックアップ巻戻しまで無条件に保証しない。

## 保持期間・上限・運用

履歴の保持期間は無期限。未着手文章の10分TTLと、冪等性履歴の保持は別である。保存開始後はTTLで消さない。履歴は要求単位128件（各最大5項目）、ファイル容量1MiB。現在のメタデータ形式では件数上限が先に効く。満杯拒否IDも1件を使う。

終端IDや古いIDの自動削除は行わない。上限到達後も既知IDの再送・照会・未完了の手動処理は可能だが、新規IDはhistory_full/503。サービス再起動では枠を空けない。これは重複防止を優先した限定利用の運用方針であり、長期間の無制限受信には対応しない。

上限や破損を理由に履歴を削除して再送してはならない。まずサービスを止め、履歴を保管し、要求IDと元ブラウザのメモを確認する。履歴リセット・世代移行・管理画面は今回提供しない。新しい履歴領域を運用する場合、旧IDの再送に対する保証を失う。旧要求を継続できる自動移行とは扱わない。

## ブラウザ保存証跡と復旧

既存IndexedDB `local-config`に `received-preview:<requestId>:<itemId または single>` の証跡を追加する。DB schema/versionとメモ保存形式は変えない。証跡はnoteId、collectionId、要求title/bodyのダイジェスト、実際の保存タイトル（既存uniqueTitleで決定）、phaseを持つ。トークン・本文は記録しない。これはローカル設定ストアであり通常のメモexportによる別保存領域への移行保証はない。

1. ユーザーの信頼された保存クリックでrequestId Web Lockを取得する。
2. 最新statusと表示した保存先を照合し、beginで固定計画と新attemptIdを永続化する。
3. 初回のみintent証跡をブラウザへ確定する。intentだけでは保存成功と扱わない。
4. putNoteの受信専用オプションでnotes・tombstone・local-config・collectionsのtransactionを作る。削除済みIDと保存先の存在を確認し、notes.addとcommitted証跡を同時コミットする。通常のputNote呼出しは従来の経路を維持する。
5. DB oncomplete後にcompleteを送り、サービスのsaved履歴確定後に応答する。

サービス履歴とIndexedDBは別の保存領域で、両者にまたがるtransactionはない。再起動は何も自動保存しない。本文・タイトルは空で返しbodyAvailable:falseを表示する。同ID・同内容・同順序の再送で本文だけを復元する。itemId、計画、期限、状態を再生成・延長しない。内容が異なれば409。

保存再開は元の保存領域での明示クリックのみ。既存メモがある場合、committed証跡、固定ID、本文、実保存タイトル、保存先、削除状態を照合する。一致ならDBへ再作成・上書きせずcompleteだけを回復する。メモがなくintent証跡だけなら、note+committedが同一transactionであることから未コミットとして固定IDへ手動再試行できる。

committedなのにメモがない、削除済み、title/body/collectionの不一致、保存先消失、証跡破損、再起動後の計画に対する証跡不足は復旧不能・要確認。既存メモを変更しない。元ブラウザで一覧・ゴミ箱・保存先を確認する。サービスのsavedは過去の完了通知であり、照会先ブラウザにメモが現存する証明ではない。UIも「完了通知済み・未照合」と実際の照合成功を区別する。

| 停止点 | 再起動後 |
| --- | --- |
| A 受信直後 / B プレビュー後 | TTL内は再送待ち。原文再送→手動保存。期限切れなら復活しない |
| C begin後・DB前 | intent証跡があれば固定IDで手動再試行。intent確定前なら情報不足で停止 |
| D DB後・complete前 | committed証跡と既存メモ照合。一致なら再作成せずcomplete |
| E complete受理後・応答前 | saved履歴保持。明示クリックでブラウザ照合、追加メモ0 |
| F failed後 | 計画保持。intent/committedとメモを照合して明示再試行 |
| G 一部保存後 | 項目ごとのID・計画・終端状態を保持。未着手だけ元のTTL |
| H 破棄・期限切れ後 | 再送でも復活しない。要求内容復元は保存許可ではない |
| I 同ID・異内容 | 409、既存の内容と結果を維持 |

## 保証範囲と非対象

同じ永続履歴、同じOrigin・ブラウザ保存領域、対応版の全タブ、Web LocksとIndexedDBが使用可能な環境で、再起動をまたぐ重複防止を保証する。別端末・別Origin・別プロファイル、ブラウザデータ/証跡/履歴削除、履歴の古いコピー、旧版で発行した計画には無条件の保証はない。新仕様導入前のメモリ履歴は移行できない。更新前の保留を処理し、更新後は新しい専用試験IDを使う。

OAuth、MCPからDB保存、AIから既存メモ操作、タグ/コレクション自動作成、同期、保存形式変更、Report変更、管理画面は非対象。AdapterのHTTP応答からもsavePlan/attemptId/保存先を除き、MCPは送信者自身の原文と状態のみ返す。外部AIはブラウザ制御ルート・証跡・履歴列挙を取得できない。認証なしTunnel実証を一般公開可能な構成とは扱わない。

## 検証

単体 `received-history.test.js` は原文非記録、個別状態・固定ID復元、TTL・128件、排他、破損、fsync/write/rename失敗で旧履歴不変・以後停止を検証する。

復旧E2E `npm run test:e2e:received-recovery` は別Nodeプロセスの実HTTPサービスを停止・起動する。IPC専用beforeReplyゲートとブラウザPromiseゲートで停止点を制御し、固定時間待ちを使わない。本番HTTPにテスト操作ルートを追加しない。一時ディレクトリと新規BrowserContextを使う。既存5500/8791待受とプロファイルへ触れず、テスト専用の一時ポートへ論理URLを転送する。既存E2Eのstdio子プロセスだけテスト用ポート設定をpreloadする。本番MCPの固定送信先とOrigin設定は変更しない。

Windows Node v24.20.0 / Playwright Chromiumで実行。結果・初回失敗をignored `e2e-artifacts/received-preview/`に保持し、CIは失敗もartifact保存する。CIの結果はPRの最新HEADに対して別途確認する。ここに記載した自動試験は実Tunnel/ChatGPT、公開HTTPS/LNA権限、実拡張GUI、手動スクリーンリーダーの実証ではない。

ローカル最終結果：全単体1825件成功（永続履歴7テストを含む）、指定の既存4 E2E成功、実サービス再起動・履歴障害を含む復旧19シナリオ成功、全244 JavaScript構文成功、git diff --check成功。保存先がDB側で保存直前に削除された競合も、メモを作らず停止することを確認した。

初回失敗は保持している：既存5500ポート使用（環境条件、既存プロセスは停止せず一時ポートへ隔離）、全単体18失敗（今回のキャッシュ更新への期待値追随と通常putNote呼出しの維持で解消）、保存領域案内の欠落（既知の日本語だけ表示して解消）、Node子プロセスでのSet-Acl自動読込失敗（親シェルのPSModulePathの影響を.NET APIで回避）、追加競合E2Eの誤分岐（成功試験から安全停止試験を分離）。テスト削除・無効化はしていない。CIの最終結果はPR本文と最終報告で確認する。必要な回帰はnpm test、dummy-preview、received-preview、received-concurrency、received-notes、received-recovery。全単体には通常保存・Bridge・Clipper・tombstoneの回帰を含む。

## ユーザーによる実Tunnel手動検証

1. 元の受信要求を処理してから更新。全タブ再読込。通常メモと別の検証プロファイルを使う。既存サービスと競合させない。
2. 検証用PowerShellで専用履歴を指定する：`$env:MEMO_PREVIEW_HISTORY_DIR = Join-Path $env:TEMP ('memo-tunnel-recovery-' + [guid]::NewGuid())`。同じPowerShellとパスを再起動後も使う。本文・秘密値をファイルやチャットへ貼らない。
3. PR-1の既存手順でサービス・配信・Tunnelを起動し、ChatGPTのツール一覧を更新する。Browser tokenとAdapter tokenを混同しない。
4. 新requestIdでsubmit_text_previewまたはsubmit_notes_previewを送る。元IDと原文を送信側で保持し、ブラウザで確認だけではメモが増えないことを確認する。
5. 1項目を人が保存し、別項目は未保存または破棄する。固定IDのメモが1件だけ作られたことを記録する。
6. サービスウィンドウを閉じ、同じ履歴パスで再起動する。tokenは再生成されるため、Tunnelも新Adapter tokenで起動し直す。ブラウザへ新Browser tokenを入力し、元requestId照会で再送待ちを確認する。
7. 同ID・同順序・同原文を再送する。保存済み項目の明示保存操作で照合し、追加メモ0件と原文不変を確認する。未保存項目はTTL内で人が保存する。破棄・期限切れ項目は復活しない。異なる本文の再送は競合拒否される。
8. 保存途中停止を手動で試す場合、結果不明を成功と解釈しない。元のブラウザと履歴を保ち、同原文再送後に明示クリックで照合する。復旧不能ならIDとメモ一覧を確認し、別IDで自動再送しない。DB直後の厳密な停止点は自動E2Eで検証する。
9. 結果を記録して通常終了。履歴は削除せず検証用として保管する。公開HTTPS/LNAは別途実権限で確認する。マージはレビュー後にユーザーが判断する。

## 差分の要約

- `dummy-preview-history.js`：本文なし履歴、検証、原子的更新、権限、単一起動制御。
- `dummy-preview-queue.js`：個別状態・固定計画の復元、原文再送、応答前確定と更新失敗時停止。
- `dummy-preview-service.js` / `dummy-preview-mcp.js`：永続CLI起動、Adapter応答の権限分離、通信断時の不明表示。
- `app.js`：受信保存オプションだけでintent/committed証跡を追加。通常保存は従来どおり。既存ID上書き・保存先の暗黙変更を拒否し、タイトルを含む保存結果照合。
- `dummy-preview-ui.js`：再送待ち、保存中、結果不明、保存失敗、完了通知と照合済み、復旧不能の表示・日本語診断。
- `received-history.test.js` / `received-recovery.e2e.js` / test専用fixture・transport：永続化の障害と実サービス再起動、利用中プロセスに触れない隔離。
- 既存4 E2E：一時ポートへのテスト通信転送、全ストア比較に追加証跡の内容・件数検査。元の不変検査は維持。
- `index.html`とキャッシュ識別子を参照する既存単体：app.jsと受信UIの配信識別子だけ追随更新。
- `start-dummy-preview.ps1` / `.gitignore` / `package.json` / CI：起動説明、履歴除外、復旧試験コマンド、Ubuntu/Windows試験。
- PR-1/2/3文書と本書：過去の実証記録を保持し、現在の再起動仕様と保証範囲を明記。
