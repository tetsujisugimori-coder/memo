const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const client = fs.readFileSync("codex-chat.js", "utf8");
const clientUtils = fs.readFileSync("codex-chat-utils.js", "utf8");
const bridge = fs.readFileSync("codex-bridge.js", "utf8");
const bridgeConfig = fs.readFileSync("codex-bridge-config.js", "utf8");
const runtime = fs.readFileSync("codex-bridge-runtime.js", "utf8");
const packageJson = fs.readFileSync("package.json", "utf8");

test("Codexチャットは通常AIと別タブで明示添付だけを提供する", () => {
  assert.match(html, /note-save-foundation\.js\?v=0\.5\.0-8/);
  assert.match(html, /codex-chat-utils\.js\?v=0\.5\.0-6/);
  assert.match(html, /app\.js\?v=0\.5\.0-117/);
  assert.match(html, /codex-chat\.js\?v=0\.5\.0-6/);
  assert.match(client, /codexChatTab/);
  assert.match(client, /このメモを添付/);
  assert.match(client, /選択範囲を添付/);
  assert.match(client, /添付を取り消す/);
  assert.match(client, /コピー/);
  assert.doesNotMatch(client, /body:\s*note\(\)\?\.body/);
});

test("Codex tokenはpassword入力とsessionStorageを使いメモ保存へ混ぜない", () => {
  assert.match(client, /codexBridgeTokenInput/);
  assert.match(client, /type="password"/);
  assert.match(client, /sessionStorage/);
  assert.match(client, /buildBridgeRequestHeaders\(bridgeToken/);
  assert.match(clientUtils, /headers\.Authorization = `Bearer \$\{normalized\}`/);
  assert.match(client, /clearSessionBridgeToken/);
  assert.match(client, /トークン不一致/);
  assert.match(client, /ローカルネットワークアクセス/);
  assert.doesNotMatch(client, /[?&](?:token|authorization)=/i);
  assert.doesNotMatch(client, /saveForNote\([^\n]+bridgeToken/);
  assert.match(packageJson, /"codex:token": "node codex-bridge-token\.js"/);
});

test("メモ切替時にCodexスレッドを切り替え、本文を自動送信しない", () => {
  assert.match(app, /MemoNexusCodexChat\?\.onMemoChanged\(currentNote\(\)\)/);
  assert.match(app, /MemoNexusCodexChat\?\.onMemoChanged\(note\)/);
  assert.match(client, /requestNoteId/);
  assert.match(client, /saveForNote\(requestNoteId/);
  assert.match(client, /extractEditorSelection\(editor\)/);
  assert.match(client, /withoutCodexThread/);
});

test("Codexスレッド保存は共通基盤へ接続し、クライアントからIndexedDBを直接更新しない", () => {
  assert.match(client, /enqueueCodexThreadSave\(noteId, updater\)/);
  assert.doesNotMatch(client, /putNote\(|getAllNotes\(/);
  assert.match(clientUtils, /CODEX_THREAD_RESOURCE_PREFIX/);
  assert.match(clientUtils, /foundation\.markChanged\(resourceKey/);
  assert.match(clientUtils, /foundation\.enqueueSave\(request\)/);
  assert.match(clientUtils, /generationByNoteId/);
  assert.match(clientUtils, /isCurrentRequest/);
  assert.match(clientUtils, /markPersisted/);
  assert.match(app, /noteSaveFoundation\.runExclusive\(\[snapshot\.noteId\][\s\S]*codexThreadSaveCoordinator\.isCurrentRequest\(request\)[\s\S]*putCodexThreadSnapshot\(snapshot\)/);
  assert.match(app, /: putNote\(snapshot, \{ preserveStoredCodexThread: true \}\)/, "通常メモwriterは従来の保存先で確定済みCodex値を維持する");
  assert.match(app, /mergeStoredCodexThread\(note, request\.result\)/);
  const enqueueSource = app.slice(app.indexOf("async function enqueueCodexThreadSave"), app.indexOf("function applyCodexThreadSaveResult"));
  assert.match(enqueueSource, /await codexThreadSaveCoordinator\.enqueue/);
  assert.doesNotMatch(enqueueSource, /const liveNote = applyCodexThreadToMemory/);
  assert.ok(enqueueSource.indexOf("await codexThreadSaveCoordinator.enqueue") < enqueueSource.indexOf("return applyCodexThreadSaveResult"));
  assert.match(app, /putCodexThreadSnapshot[\s\S]*STORE_NAME, TOMBSTONE_STORE_NAME/);
});

test("ローカルブリッジは実スキーマのread-only会話設定と限定CORSを使う", () => {
  assert.match(bridge, /"thread\/start"/);
  assert.match(bridge, /"thread\/resume"/);
  assert.match(bridge, /"turn\/start"/);
  assert.match(bridge, /sandbox: "read-only"/);
  assert.match(bridge, /approvalPolicy: "never"/);
  assert.match(bridge, /networkAccess: false/);
  assert.match(bridge, /127\.0\.0\.1/);
  assert.match(bridgeConfig, /https:\/\/tetsujisugimori-coder\.github\.io/);
  assert.match(bridgeConfig, /CODEX_BRIDGE_ALLOWED_ORIGINS/);
  assert.match(bridgeConfig, /timingSafeEqual/);
  assert.match(bridge, /Access-Control-Allow-Private-Network/);
  assert.match(bridge, /Authorization/);
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
