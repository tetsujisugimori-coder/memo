# Windows実Ollama比較手順 — PENDING_MANUAL

今すぐの利用者操作は不要。この手順は未実行。実モデルdownload、pull、認証情報の記録はしない。

## 準備

1. 後日、時間を確保したうえで実施する。Windows/ブラウザ/Ollamaの版、PR HEAD、実行日時、既にインストール済みのモデル識別子を記録する。
2. `ollama --version` と `ollama list` で確認する。対象モデルがなければNOT_TESTEDとして終了する。インストールは本手順に含めない。
3. 実データのないテスト用ブラウザ領域を用意し、READMEの起動手順で当該HEADを開く。架空メモ「The blue bird sits by the window.」だけを用意する。Ollama接続確認後、既存モデルを選ぶ。モデル設定、system指示を試行間で変更しない。
4. AI診断をオンにする。実モデル名に私的な命名を使っている場合、公開報告では伏せ、ローカル対応表で管理する。

## Memo-Nexus比較

|条件|操作|回数|期待する観測|
|---|---|---:|---|
|A 翻訳・履歴なし|通常入口から新規会話。架空メモを明示参照、日本語へ翻訳|独立2回|履歴0、異なるrequestId、最終本文と表示の文字数一致|
|B 翻訳・履歴あり|同じ会話で同じ架空文を日本語へ翻訳|連続5回|history件数増加、毎回のrequestId/完了/本文/thinkingを比較|
|C 自由質問・履歴なし|新規会話、参照なし、「2+3はいくつですか」|独立2回|参照none、履歴0、回答表示|
|D 自由質問・履歴あり|同じ会話で同じ質問|連続5回|過去回答との混入や空表示がないか、診断値を比較|
|言語切替|同じ架空メモで日本語→英語→日本語|各1回|purpose/languageとuiPurpose/uiTranslationLanguage一致|
|開閉/停止|生成中に停止、パネルを閉じAIタブで再開、新規会話でも送信|各1回|停止分類、旧要求と新要求のID分離、表示本文保持/新規reset|
|モデル切替|別の既存モデルがあれば設定変更・接続確認後同じ質問|1回|使用モデル記録と実送信が一致。無ければNOT_TESTED|

各回に診断コピーをローカルファイルへ保存する（外部自動送信なし）。質問/回答の正しさや日本語かどうかは目視欄に記録し、メタデータ成功と分ける。診断UI文字数はDOM反映の証拠であり、画面可視性は別に確認する。本文を含む画面画像を公開しない。

## Ollama単体との同条件比較

CLIの単純質問だけではsystem/履歴が同一にならない。厳密比較にはアプリと同じbuildAiMessagesを使い、架空fixtureのmessagesを作る。

次はPowerShellからそのまま実行できるA条件のfixture作成例。モデル識別子だけをインストール済みの値へ置換する。system設定は既定値なのでアプリ側も既定値にそろえる。ここでは通信せず、架空入力ファイルだけを作る。

```powershell
$env:AI_MANUAL_MODEL = 'インストール済みモデル名'
$env:AI_MANUAL_PURPOSE = 'translate' # C条件は question
$env:AI_MANUAL_LANGUAGE = 'ja'       # 英語は en
New-Item -ItemType Directory -Force .\ai-manual-local | Out-Null
@'
const fs = require('node:fs');
const { buildAiMessages } = require('./ai-prompts');
const { DEFAULT_AI_SETTINGS } = require('./ai-provider');
const purpose = process.env.AI_MANUAL_PURPOSE;
const history = fs.existsSync('ai-manual-local/history.json')
  ? JSON.parse(fs.readFileSync('ai-manual-local/history.json', 'utf8')) : [];
const messages = buildAiMessages({ purpose,
  reference: purpose === 'translate'
    ? { mode: 'selected-text', content: 'The blue bird sits by the window.' } : { mode: 'none' },
  userInstruction: purpose === 'translate' ? '' : '2+3はいくつですか',
  translationLanguage: process.env.AI_MANUAL_LANGUAGE,
  systemInstruction: DEFAULT_AI_SETTINGS.systemInstruction, history });
fs.writeFileSync('ai-manual-local/request.json', JSON.stringify({
  model: process.env.AI_MANUAL_MODEL, stream: true, messages, options: {}
}, null, 2));
'@ | node
```

A/Cではhistory.jsonを置かない。B/Dでは架空試行の過去メッセージだけを `[{"role":"user","content":"…"},{"role":"assistant","content":"…"}]` としてhistory.jsonに保存する。アプリの同じ試行と完全に合わせる。翻訳の空追加指示の場合、過去の空userはアプリで除外されるので履歴fixtureからも除外する。このローカルフォルダはコミットや共有へ含めない。

```powershell
$response = Invoke-WebRequest -Method Post -Uri http://127.0.0.1:11434/api/chat `
  -ContentType 'application/json' -InFile .\ai-manual-local\request.json
$response.Content | Set-Content -Encoding utf8 .\ai-manual-local\response.ndjson
```

1. リポジトリ直下で、Nodeから `require('./ai-prompts').buildAiMessages(...)` を呼ぶ専用fixtureを作る。引数はpurpose、reference（架空文のみ）、userInstruction、translationLanguage、systemInstruction、history。A〜Dそれぞれの条件を上表に合わせる。historyにはその試行で得た架空のuser/assistantを順序通り入れる。
2. `{model: '<インストール済みモデル>', stream: true, messages: fixture, options: {}}` をUTF-8 JSONとして案件専用フォルダに置く。共有Tempを清掃しない。実メモ・質問・認証情報を使わない。
3. PowerShellで `Invoke-WebRequest -Method Post -Uri http://127.0.0.1:11434/api/chat -ContentType 'application/json' -InFile <fixture.json>` を実行する。返却NDJSONについてcontent、thinking、done、行数を区別して確認する。これはレスポンスを一括受取する比較であり、ブラウザのストリーミング描画試験ではない。
4. 同じfixtureとモデルで2回/5回の連続実行を記録する。実行後に結果の本文文字数・thinking文字数・done有無を数え、Memo-Nexusの同条件と比較する。モデル内部の乱数や実行順序が同じとは保証できない。
5. 両方で失敗すればOllama/モデル/指示の候補、単体で本文ありアプリで本文なしならadapter受信、受信本文あり最終回答なしなら状態管理、最終回答ありUI不一致なら描画経路を調査する。1回の一致/不一致だけで根本原因を確定しない。

## 記録票

日時、HEAD、Windows/ブラウザ/Ollama版、モデル（公開時は要確認）、A/B/C/D、反復番号、履歴有無、言語、参照mode、requestId、HTTP、受信chunk、本文chunk/文字数、thinking有無/文字数、doneCount、EOF、最終回答/UI文字数、result、手動の言語/内容/可視性結果、単体比較結果、UNKNOWN理由。

PASSは実施した条件だけにつける。未実施=PENDING_MANUAL、モデル不在=NOT_TESTED、判断不能=UNKNOWN。生回答が必要なら架空fixtureでも共有先と範囲を利用者が明示確認してから扱う。停止不能、異常表示、秘密の混入を見つけた場合はその試行を中止し、診断メタデータだけを保全する。
