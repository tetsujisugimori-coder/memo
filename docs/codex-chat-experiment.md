# Codexチャット試作（ローカル限定）

この機能は実験的なローカルPC連携です。Memo Nexusのブラウザ画面は `127.0.0.1` の小さなブリッジだけに接続し、ブリッジが Codex App Server を標準入出力で起動します。GitHub Pages、iPhone、外部公開URLではブリッジ未接続の案内を表示するのが正常です。

Codexは会話専用です。App Serverにはリポジトリ外の空の一時ディレクトリ、`read-only` sandbox、`never` approval policyを指定します。ファイル変更、コマンド実行、ネットワーク、GitHub、MCPや動的ツールの承認はブリッジが許可しません。APIキーは扱わず、既存のCodex CLIログインを使います。

メモ本文・選択範囲は、利用者が添付ボタンを押した場合だけ送信されます。回答をMemo Nexusの本文へ自動反映したり、新規メモを自動作成したりしません。

## ローカル起動

1. `python -m http.server 8765 --bind 127.0.0.1` を実行する。
2. 別のターミナルで `npm run codex:bridge` を実行する。
3. `http://127.0.0.1:8765/` を開き、AIパネルの「Codex」タブを選ぶ。

利用できない場合は、`codex` コマンドが存在し、Codexへログイン済みであり、ブリッジが起動中かを確認します。
