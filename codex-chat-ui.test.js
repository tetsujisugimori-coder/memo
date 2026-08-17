const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const client = fs.readFileSync("codex-chat.js", "utf8");
const bridge = fs.readFileSync("codex-bridge.js", "utf8");
const runtime = fs.readFileSync("codex-bridge-runtime.js", "utf8");

test("Codexチャットは通常AIと別タブで明示添付だけを提供する", () => {
  assert.match(html, /codex-chat-utils\.js\?v=0\.1\.0-3/);
  assert.match(html, /app\.js\?v=0\.4\.0-89/);
  assert.match(html, /codex-chat\.js\?v=0\.1\.0-4/);
  assert.match(client, /codexChatTab/);
  assert.match(client, /このメモを添付/);
  assert.match(client, /選択範囲を添付/);
  assert.match(client, /添付を取り消す/);
  assert.match(client, /コピー/);
  assert.doesNotMatch(client, /body:\s*note\(\)\?\.body/);
});

test("メモ切替時にCodexスレッドを切り替え、本文を自動送信しない", () => {
  assert.match(app, /MemoNexusCodexChat\?\.onMemoChanged\(currentNote\(\)\)/);
  assert.match(app, /MemoNexusCodexChat\?\.onMemoChanged\(note\)/);
  assert.match(client, /requestNoteId/);
  assert.match(client, /saveForNote\(requestNoteId/);
  assert.match(client, /extractEditorSelection\(editor\)/);
  assert.match(client, /withoutCodexThread/);
});

test("ローカルブリッジは実スキーマのread-only会話設定と限定CORSを使う", () => {
  assert.match(bridge, /"thread\/start"/);
  assert.match(bridge, /"thread\/resume"/);
  assert.match(bridge, /"turn\/start"/);
  assert.match(bridge, /sandbox: "read-only"/);
  assert.match(bridge, /approvalPolicy: "never"/);
  assert.match(bridge, /networkAccess: false/);
  assert.match(bridge, /127\.0\.0\.1/);
  assert.match(runtime, /承認・ツール要求を許可しません/);
  assert.match(bridge, /createRuntimeManager/);
  assert.match(runtime, /Codex CLIが見つかりません/);
  assert.match(bridge, /type: "error"/);
  assert.match(bridge, /req\.once\("aborted"/);
  assert.match(bridge, /onResult: \(result\)/);
  assert.match(runtime, /res\.once\("close", state\.closeHandler\)/);
  assert.match(runtime, /detachStream\(runtime, turnId, res\)/);
  assert.match(bridge, /runtimeManager\.discardTurn\(runtime, activeTurnId\)/);
});
