# Codexチャット試作（ローカル限定）

この機能は実験的なローカルPC連携です。Memo Nexusのブラウザ画面は `127.0.0.1` の小さなブリッジだけに接続し、ブリッジが Codex App Server を標準入出力で起動します。ローカルなのはこの接続だけで、CodexはローカルLLMではありません。入力メッセージと、利用者が明示添付した本文・選択範囲は、ログイン済みCodexを通じてOpenAIのサービスへ送信されます。本文は明示添付しない限り送信されません。GitHub Pages、iPhone、外部公開URLではブリッジ未接続の案内を表示するのが正常です。

Codexは会話専用として起動します。App Serverにはリポジトリ外の空の一時ディレクトリ、`read-only` sandbox、`never` approval policy、コマンド側の`networkAccess: false`を指定します。これはモデル・認証通信ではなく、Codexが起動するコマンド側の外部通信を制限する設定です。承認要求とクライアント側ツール要求はブリッジが拒否します。`read-only`は書込みを抑止しますが、developer instructions単独でファイル読取りや全ツール利用を完全に技術保証するものではありません。APIキーは扱わず、既存のCodex CLIログインを使います。

メモ本文・選択範囲は、利用者が添付ボタンを押した場合だけ送信されます。回答をMemo Nexusの本文へ自動反映したり、新規メモを自動作成したりしません。

## ローカル起動

1. `python -m http.server 8765 --bind 127.0.0.1` を実行する。
2. 別のターミナルで `npm run codex:bridge` を実行する。
3. `http://127.0.0.1:8765/` を開き、AIパネルの「Codex」タブを選ぶ。

利用できない場合は、`codex` コマンドが存在し、Codexへログイン済みであり、ブリッジが起動中かを確認します。

## App Server接続と再接続

ブリッジは起動ごとに、子プロセス、標準出力バッファ、pending RPC、SSE応答、一時ディレクトリを1つのruntimeとして管理します。初期化は `initialize` の応答を待ち、IDを持たない `initialized` 通知を送った後でruntimeを利用可能にします。同時のhealth確認は同じ起動Promiseを共有します。

子プロセスのerror・exit、RPCタイムアウト、stdin書込み失敗は、発生元runtimeだけを破棄します。古いruntimeの遅延イベントは新しいruntimeを操作しません。破棄時はpending RPCとSSEを一度だけ失敗させ、子プロセスへ終了要求を送り、exitまたはcloseを期限付きで待ってから、そのruntimeが所有する一時ディレクトリを削除します。異常終了後の次回health確認では新しいruntimeを起動できます。

Codex CLI 0.147.0から生成した実スキーマでは、`error` 通知は `error.message`、`threadId`、`turnId`、`willRetry` を持ちます。ブリッジはこの通知をturn単位に一時記録するだけでSSEを終了せず、最終判定は `turn/completed` の `turn.status` を使います。`completed`だけをdone、`failed`・`interrupted`・未知状態をerrorとして扱います。`warning`と`configWarning`は会話失敗にしません。

## 2026-08-17の検証状況

- `node --test`: 564件成功、失敗・skipなし。
- fake child process、fake stdin、fake timer、fake SSE responseで、初期化順序、同時起動、旧runtimeイベント隔離、各RPCタイムアウト、書込み失敗、冪等破棄、終了待ちとcleanup、App Server通知、ブラウザ側SSE分割・終端を確認した。
- Codex CLI 0.147.0で `/health` のconnected、添付なし実SSEのthread・delta・done、ブラウザUIの本文／選択範囲添付と取り消し、実回答表示とコピーを確認した。
- メモAの回答中にメモBへ切り替えてもBへ回答が表示されず、完了後にAへ戻るとAの履歴だけへ回答が残ることを確認した。
- 回答中にブリッジを停止するとエラー表示後に送信可能へ戻り、ブリッジ再起動後に再接続して実回答を受信できることを確認した。
- ページ再読み込み後の保存済みthreadId復元、「新しい会話」後の永続解除、複数回の正常shutdown後に一時ディレクトリが残らないことは、今回のブラウザ実機確認では未確認。対応ロジックは自動テストで確認している。
