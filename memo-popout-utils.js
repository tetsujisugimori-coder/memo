"use strict";

(function attachMemoPopoutUtils(global) {
  function getMemoSyncDecision({ message, knownUpdatedAt = 0, note, currentId, isLocalMemoDirty = false, localDirtyMemoId = null, pendingUpdatedAt = 0 }) {
    if (message?.type !== "memo-changed" || !message.memoId) return "ignore";
    const updatedAt = Number(message.updatedAt) || 0;
    if (updatedAt <= Math.max(Number(knownUpdatedAt) || 0, Number(pendingUpdatedAt) || 0)) return "ignore";
    if (!note || note.deletedAt) return "unavailable";
    if (currentId !== message.memoId) return "refresh-list";
    return isLocalMemoDirty && localDirtyMemoId === message.memoId ? "pending" : "apply";
  }

  function createPopoutGhost(documentRef, sourceRect, title, body) {
    const ghost = documentRef.createElement("div");
    ghost.className = "popout-ghost";
    ghost.setAttribute("aria-hidden", "true");
    ghost.style.width = `${sourceRect.width}px`;
    ghost.style.height = `${sourceRect.height}px`;
    ghost.style.left = `${sourceRect.left}px`;
    ghost.style.top = `${sourceRect.top}px`;
    ghost.innerHTML = `<strong>${escapeHtml(title || "無題メモ")}</strong><span>${escapeHtml(body || "空のメモ")}</span>`;
    documentRef.body.appendChild(ghost);

    const remove = () => ghost.remove();
    ghost.addEventListener("animationend", remove, { once: true });
    setTimeout(remove, 500);
    return ghost;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
  }

  const api = { createPopoutGhost, getMemoSyncDecision };
  global.MemoNexusPopoutUtils = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window === "undefined" ? globalThis : window);
