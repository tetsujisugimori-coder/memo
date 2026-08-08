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
  assert.match(app, /window\.open\(popoutUrlForMemo\(note\.id\), `memo-nexus-popout-\$\{note\.id\}`/);
  assert.match(app, /editor\.addEventListener\("input", \(\) => \{[\s\S]*?scheduleSave\(\);/);
});

test("未保存の入力中は同期を保留し、未編集なら同期内容を反映できる", () => {
  const message = { type: "memo-changed", memoId: "memo-a", updatedAt: 20 };
  const note = { id: "memo-a", title: "保存済み", body: "本文", updatedAt: 20 };

  assert.equal(getMemoSyncDecision({ message, knownUpdatedAt: 10, note, currentId: "memo-a", title: "編集中", body: "本文" }), "pending");
  assert.equal(getMemoSyncDecision({ message, knownUpdatedAt: 10, note, currentId: "memo-a", title: "保存済み", body: "本文" }), "apply");
  assert.equal(getMemoSyncDecision({ message, knownUpdatedAt: 20, note, currentId: "memo-a", title: "保存済み", body: "本文" }), "ignore");
  assert.match(app, /loadMemoSyncBtn\.addEventListener\("click", loadPendingMemoSync\)/);
  assert.match(app, /function loadPendingMemoSync\(\)[\s\S]*?applyMemoSync\(note\)/);
});

test("ゴースト演出要素は生成され、animationend後に削除される", () => {
  const documentRef = createFakeDocument();
  const ghost = createPopoutGhost(documentRef, { width: 500, height: 300, left: 20, top: 40 }, "題名", "本文");

  assert.equal(documentRef.body.children.length, 1);
  assert.equal(ghost.style.width, "500px");
  assert.equal(ghost.isConnected, true);
  ghost.dispatch("animationend");
  assert.equal(ghost.isConnected, false);
});

test("reduced motionではゴーストの移動・縮小をフェードへ置き換える", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?memo-popout-ghost-fade/);
  assert.match(css, /@keyframes memo-popout-ghost-fade[\s\S]*?opacity:\s*0/);
  assert.match(html, /id="memoSyncNotice"[\s\S]*?id="loadMemoSyncBtn"/);
});
