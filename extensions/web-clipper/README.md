# Memo-Nexus Web Clipper

Chrome / Edge 共通の Manifest V3 開発版拡張です。選択テキスト、ページタイトル、URL、ホスト名、取得日時だけを Memo-Nexus の保存前確認画面へ渡します。画像、本文全体の抽出、ダウンロード、AI要約は扱いません。

## 開発版のインストール

1. Memo-Nexus本体を `http://localhost:5500/` で開けるようにします（別のURLを使う場合は下記設定を先に変更します）。
2. Chrome は `chrome://extensions`、Edge は `edge://extensions` を開き、開発者モードを有効にします。
3. 「パッケージ化されていない拡張機能を読み込む」を選び、この `extensions/web-clipper` フォルダを指定します。
4. 表示された拡張IDをコピーし、本体側の `web-clipper-config.js` の `YOUR_DEVELOPMENT_EXTENSION_ID` をそのIDへ置き換えます。公開用IDも使う場合だけ `YOUR_PRODUCTION_EXTENSION_ID` を置き換えます。
5. 本体ページを再読み込みします。

## 接続先の設定

- 拡張の開発URL・本番URL: `config.js` の `targets`
- 拡張に許可するURL: `manifest.json` の `host_permissions`
- 本体が受信を許可する拡張ID: 本体ルートの `web-clipper-config.js` の `allowedExtensionOrigins`

URLを変更する場合は、`config.js` と `manifest.json` を同じ値に更新します。拡張IDを変更した場合は本体の設定も更新します。`<all_urls>` は使いません。選択情報の取得には、ユーザーが拡張アイコンを押したタブだけに一時的に与えられる `activeTab` 権限を使います。

## 動作確認

1. 任意のWebページで日本語の文章を選択し、拡張アイコンを押します。
2. ポップアップに選択有無、タイトル、URLが表示されることを確認します。
3. 接続先を選び「Memo-Nexusで確認する」を押します。
4. 本体の確認画面でタイトル、本文、コレクションを確認・編集して保存します。保存前に自動保存はされません。
5. 選択なしでも同じ操作でURLクリップ候補を開けます。

本文はURLパラメータに入れず、受信準備完了後に `window.postMessage` で渡します。受信側は設定済みの `chrome-extension://<ID>` origin 以外を拒否します。

## 制約

- 画像のクリップ、画像ダウンロード、本文全体の抽出、AI要約は未対応です。
- iPhone / iPad のSafari拡張には未対応です。
