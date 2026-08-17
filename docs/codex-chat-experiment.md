# Codexチャット試作（公開版＋ローカルブリッジ）

この機能は実験的なPC向け連携です。Memo Nexusはブラウザから`http://127.0.0.1:8787`の小さなブリッジへ`fetch`で接続し、ブリッジがCodex App Serverを標準入出力で起動します。回答はSSEとして同じ`fetch`のresponse streamから受信します。EventSource、WebSocket、APIキー入力は使いません。

GitHub Pagesの公開URLは`https://tetsujisugimori-coder.github.io/memo/`、CORSで使うOriginはパスを含まない`https://tetsujisugimori-coder.github.io`です。公開URLを開くだけではCodexは動きません。`127.0.0.1`は閲覧者自身のPCを指し、他人のPCからあなたのCodexへ接続されるわけではありません。iPhoneの`127.0.0.1`はiPhone自身を指すため、Windows PC上のブリッジへは接続できません。

## 必要条件

- Node.js
- Codex CLI
- Codexへのログイン
- 利用者自身のPCで起動したローカルブリッジ
- 32文字以上で空白を含まないランダムな接続token

## tokenとOriginの設定

PowerShellでリポジトリを開き、次のように設定します。

```powershell
$env:CODEX_BRIDGE_TOKEN = npm run --silent codex:token
$env:CODEX_BRIDGE_ALLOWED_ORIGINS = "http://127.0.0.1:8765,http://localhost:8765,https://tetsujisugimori-coder.github.io"
npm run codex:bridge
```

`npm run codex:token`はtokenを標準出力へ生成するだけで、ファイルへ保存しません。`CODEX_BRIDGE_TOKEN`が未設定、短すぎる、空白を含む、サンプル値のままの場合、ブリッジは起動しません。tokenをURL、HTML、公開JavaScript、メモ、IndexedDBのメモ本文、ZIPへ保存しません。

既定では次のOriginだけを許可します。

- `http://127.0.0.1:5500`
- `http://localhost:5500`
- `http://127.0.0.1:8765`
- `http://localhost:8765`
- `https://tetsujisugimori-coder.github.io`

`CODEX_BRIDGE_ALLOWED_ORIGINS`は完全なhttp/https Originをカンマ区切りで追加します。空要素、パス、query、fragment、認証情報、`null`、その他のschemeは起動時に拒否します。類似ドメイン、サブドメイン、前方一致、後方一致は許可しません。旧`CODEX_BRIDGE_ORIGINS`も追加Originとして読み込みます。

環境変数はPowerShellを閉じると失われます。恒久設定とWindows自動起動は今回未対応です。tokenを`.env`やGit管理ファイルへ自動保存する仕組みは追加していません。

## 公開版で使う

1. ローカルPCでCodex CLIへログインする。
2. 上記の環境変数を設定する。
3. 同じPowerShellで`npm run codex:bridge`を起動する。
4. `https://tetsujisugimori-coder.github.io/memo/`を開く。PythonのHTTPサーバーは不要。
5. AIパネルの「Codex」タブへ、ターミナルに設定したものと同じtokenを入力して「トークンを設定」を押す。
6. ブラウザがローカルネットワークアクセスを求めた場合、接続先を確認して許可する。
7. 「接続済み」を確認して会話を送る。

入力tokenはpassword欄から`sessionStorage`へ保存し、入力欄へ再表示しません。同じタブの再読み込みでは利用できますが、タブを閉じると消えます。認証が401になった場合はsessionStorageから削除し、再入力を求めます。通信時だけ`Authorization: Bearer <token>`へ設定します。

## ローカル開発版で使う

ブリッジとは別のPowerShellで次を起動します。

```powershell
python -m http.server 8765 --bind 127.0.0.1
```

`http://127.0.0.1:8765/`を開き、公開版と同じようにtokenを入力します。ブリッジの待受は常に`127.0.0.1`です。`0.0.0.0`、LAN内IP、ポート転送、リバースプロキシ、インターネット公開へ変更しないでください。

## 接続状態と確認項目

- 「トークン未入力」: tokenを入力する。
- 「トークン不一致」: PowerShellの`CODEX_BRIDGE_TOKEN`と入力値を確認する。
- 「Codex App Serverの初期化に失敗」: `codex`コマンドとログイン状態を確認する。
- 「ローカル連携へ接続できません」: ブリッジ停止、Origin未許可、ブラウザのローカルネットワーク権限拒否の可能性を確認する。
- ストリーミング中の切断: ブリッジとブラウザ権限を確認して再送信する。

ブラウザはCORS拒否、ブリッジ未起動、ローカルネットワーク権限拒否を完全には区別できません。接続できない場合は次を順に確認します。

1. Codex CLIへログイン済みか。
2. `npm run codex:bridge`が起動中か。
3. PowerShellのtokenと入力値が一致するか。
4. ブラウザのローカルネットワークアクセスを拒否していないか。
5. ページのOriginがブリッジの許可対象か。

## 安全性とデータ

App Serverはリポジトリ外の空の一時ディレクトリ、`read-only` sandbox、`approvalPolicy: "never"`、コマンド側の`networkAccess: false`で起動します。承認要求とクライアント側ツール要求は拒否します。これはモデル・認証通信ではなく、Codexが起動するコマンド側の外部通信を制限します。会話専用developer instructionsだけでファイル読取りや全ツール利用を完全に技術保証するものではありません。

メモ本文と選択範囲は「このメモを添付」「選択範囲を添付」を押した場合だけ送信し、送信前に取り消せます。メモごとの`codexChat.threadId`、`lastUsedAt`、短いtitleだけを従来どおり保存します。tokenはこのデータへ含めません。回答の自動反映、ファイル操作、Git操作、GitHub操作は行いません。

未認証の`/health`は`running`とtoken必須であることだけを返し、Codex CLIの版、パス、設定、初期化エラーを公開しません。`/chat`と、認証済みhealthからApp Serverへ進む経路はBearer tokenで保護します。OPTIONSはrouteごとの必要なmethodと`Authorization`／`Content-Type`だけを許可し、要求された場合だけPrivate Network Access応答を返します。

公開URLへこの変更がデプロイされる前は、実際の公開ページを使ったブラウザE2Eは実施できません。デプロイ後に、公開Origin、ブラウザ権限、token入力、thread開始・再開、delta・doneを人間が確認する必要があります。
