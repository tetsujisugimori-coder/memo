"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const { createPopoutGhost, getMemoSyncDecision } = require("./memo-popout-utils.js");

const html = fs.readFileSync("index.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const css = fs.readFileSync("style.css", "utf8");

function createFakeDocument() {
  const body = { children: [], appendChild(node) { this.children.push(node); node.isConnected = true; } };
  return {
    body,
    createElement() {
      const listeners = new Map();
      return {
        style: {},
        isConnected: false,
        className: "",
        setAttribute() {},
        addEventListener(name, callback) { listeners.set(name, callback); },
        dispatch(name) { listeners.get(name)?.(); },
        remove() { this.isConnected = false; }
      };
    }
  };
}

test("ポップアウトURLは同じmemoIdを開き、本文入力は既存の保存予約へ到達する", () => {
  assert.match(html, /id="popoutMemoBtn"[^>]*別ウィンドウで開く/);
  assert.match(app, /url\.searchParams\.set\("popout", memoId\)/);
  assert.match(app, /window\.open\("", `memo-nexus-popout-\$\{note\.id\}`/);
  assert.match(app, /flushSave\(\)\.then\(navigate\)/);
  assert.match(app, /function handleEditorTypingInput\([\s\S]*?scheduleSave\(\{ typingPerformanceContext: performanceContext \}\)/);
  assert.match(app, /editor\.addEventListener\("input", handleEditorTypingInput\)/);
});

test("同期判定はDBとの差ではなく明示的なローカル編集状態を使う", () => {
  const message = { type: "memo-changed", memoId: "memo-a", updatedAt: 20 };
  const note = { id: "memo-a", title: "保存済み", body: "本文", updatedAt: 20 };

  assert.equal(getMemoSyncDecision({ message, knownUpdatedAt: 10, note, currentId: "memo-a", isLocalMemoDirty: false }), "apply");
  assert.equal(getMemoSyncDecision({ message, knownUpdatedAt: 10, note, currentId: "memo-a", isLocalMemoDirty: true, localDirtyMemoId: "memo-a" }), "pending");
  assert.equal(getMemoSyncDecision({ message, knownUpdatedAt: 20, note, currentId: "memo-a", isLocalMemoDirty: false }), "ignore");
  assert.match(app, /function markLocalMemoDirty\([\s\S]*?noteSaveFoundation\.markChanged\(note\.id, note\.revision\)/);
  assert.match(app, /function scheduleSave\([\s\S]*?applyCurrentEditorDraft\(note\)/);
  assert.match(app, /function handleNoteSaveSuccess\([\s\S]*?state\.currentRevision === request\.revision/);
  assert.doesNotMatch(html, /id="memoSyncNotice"/);
  assert.match(app, /function renderMemoSyncNotice\(\)[\s\S]*?同期の保留状態は従来どおり維持/);
  assert.match(app, /function loadPendingMemoSync\(\)[\s\S]*?applyMemoSync\(note\)/);
});

test("別ウィンドウ同期は数値とISOのupdatedAtを同じ実時刻として比較する", () => {
  const older = "2026-08-19T23:19:22.291Z";
  const newer = "2026-08-19T23:20:22.291Z";
  const note = { id: "memo-a", updatedAt: newer };
  assert.equal(getMemoSyncDecision({
    message: { type: "memo-changed", memoId: "memo-a", updatedAt: newer },
    knownUpdatedAt: older,
    note,
    currentId: "memo-a"
  }), "apply");
  assert.equal(getMemoSyncDecision({
    message: { type: "memo-changed", memoId: "memo-a", updatedAt: Date.parse(newer) },
    knownUpdatedAt: newer,
    note,
    currentId: "memo-a"
  }), "ignore");
});

test("2画面の保存・同期では未編集を自動反映し、編集中だけ保留する", () => {
  const db = new Map([["memo-a", { id: "memo-a", title: "題名", body: "初期", updatedAt: 10 }]]);
  const popup = { id: "memo-a", knownUpdatedAt: 10, title: "題名", body: "初期", dirty: false, pending: null };
  const main = { id: "memo-a", knownUpdatedAt: 10, title: "題名", body: "初期", dirty: false };

  const receive = (windowState, message) => {
    const latest = db.get(message.memoId);
    const decision = getMemoSyncDecision({
      message,
      knownUpdatedAt: windowState.knownUpdatedAt,
      pendingUpdatedAt: windowState.pending?.updatedAt,
      note: latest,
      currentId: windowState.id,
      isLocalMemoDirty: windowState.dirty,
      localDirtyMemoId: windowState.dirty ? windowState.id : null
    });
    if (decision === "apply") {
      windowState.title = latest.title;
      windowState.body = latest.body;
      windowState.knownUpdatedAt = latest.updatedAt;
      windowState.dirty = false;
    } else if (decision === "pending") {
      windowState.pending = message;
      windowState.knownUpdatedAt = latest.updatedAt;
    }
    return decision;
  };

  db.set("memo-a", { id: "memo-a", title: "題名", body: "メイン保存", updatedAt: 20 });
  assert.equal(receive(popup, { type: "memo-changed", memoId: "memo-a", updatedAt: 20 }), "apply");
  assert.equal(popup.body, "メイン保存");
  assert.equal(popup.pending, null);

  popup.body = "ポップアウトの未保存入力";
  popup.dirty = true;
  db.set("memo-a", { id: "memo-a", title: "題名", body: "メインの新しい保存", updatedAt: 30 });
  assert.equal(receive(popup, { type: "memo-changed", memoId: "memo-a", updatedAt: 30 }), "pending");
  assert.equal(popup.body, "ポップアウトの未保存入力");
  assert.equal(popup.pending.updatedAt, 30);

  popup.title = db.get("memo-a").title;
  popup.body = db.get("memo-a").body;
  popup.knownUpdatedAt = 30;
  popup.dirty = false;
  popup.pending = null;
  assert.equal(popup.body, "メインの新しい保存");

  popup.body = "ポップアウトから保存";
  popup.dirty = true;
  db.set("memo-a", { id: "memo-a", title: popup.title, body: popup.body, updatedAt: 40 });
  popup.knownUpdatedAt = 40;
  popup.dirty = false;
  assert.equal(receive(main, { type: "memo-changed", memoId: "memo-a", updatedAt: 40 }), "apply");
  assert.equal(main.body, "ポップアウトから保存");
});

test("ゴースト演出要素は元カードの色を保って生成され、animationend後に削除される", () => {
  const documentRef = createFakeDocument();
  const ghost = createPopoutGhost(
    documentRef,
    { width: 500, height: 300, left: 20, top: 40 },
    "題名",
    "本文",
    { backgroundColor: "rgb(27, 33, 29)", color: "rgb(231, 236, 231)", borderColor: "rgb(58, 68, 61)" }
  );

  assert.equal(documentRef.body.children.length, 1);
  assert.equal(ghost.style.width, "500px");
  assert.equal(ghost.style.backgroundColor, "rgb(27, 33, 29)");
  assert.equal(ghost.style.color, "rgb(231, 236, 231)");
  assert.equal(ghost.isConnected, true);
  ghost.dispatch("animationend");
  assert.equal(ghost.isConnected, false);
});

test("reduced motionではゴーストの移動・縮小をフェードへ置き換える", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?memo-popout-ghost-fade/);
  assert.match(css, /@keyframes memo-popout-ghost-fade[\s\S]*?opacity:\s*0/);
  assert.doesNotMatch(html, /id="memoSyncNotice"|別ウィンドウで更新があります/);
  assert.match(app, /function writePopoutInitialShell\(opened\)[\s\S]*?opened\.document\.write/);
  assert.match(html, /data-initial-theme="dark"/);
  assert.match(css, /28%[\s\S]*?scale\(1\.025\)[\s\S]*?52%[\s\S]*?scale\(0\.9\)/);
});
