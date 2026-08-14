(function initLocalSaveState(globalScope) {
  "use strict";

  const STATUS_LABELS = Object.freeze({
    unconfigured: "未設定",
    saving: "保存中",
    saved: "保存済み",
    pending: "要保存",
    "permission-required": "再接続が必要",
    conflict: "確認が必要",
    error: "保存失敗",
    unsupported: "非対応"
  });

  function createLocalSaveState(overrides = {}) {
    const status = Object.prototype.hasOwnProperty.call(STATUS_LABELS, overrides.status)
      ? overrides.status
      : "unconfigured";
    return {
      status,
      lastAttemptAt: overrides.lastAttemptAt || null,
      lastSuccessAt: overrides.lastSuccessAt || null,
      pendingChanges: Boolean(overrides.pendingChanges),
      directoryName: String(overrides.directoryName || ""),
      errorCode: String(overrides.errorCode || ""),
      errorMessage: String(overrides.errorMessage || ""),
      requiresUserAction: Boolean(overrides.requiresUserAction)
    };
  }

  function transitionLocalSaveState(current, status, patch = {}, now = Date.now()) {
    const next = createLocalSaveState({ ...current, ...patch, status });
    if (["saving", "error", "conflict", "permission-required"].includes(status)) next.lastAttemptAt = patch.lastAttemptAt || now;
    if (status === "saved") {
      next.lastSuccessAt = patch.lastSuccessAt || now;
      next.pendingChanges = false;
      next.errorCode = "";
      next.errorMessage = "";
      next.requiresUserAction = false;
    }
    if (status === "pending") next.pendingChanges = true;
    if (["permission-required", "conflict", "error"].includes(status)) next.requiresUserAction = true;
    return next;
  }

  function resolveLocalScanState(current, candidates = []) {
    const types = new Set(candidates.map((candidate) => candidate?.classification?.type));
    const hasConflict = types.has("conflict");
    const hasRestore = types.has("restore");
    if (hasConflict || hasRestore) {
      if (hasConflict && current?.status === "conflict" && current?.errorCode === "conflict-held") {
        return {
          status: "conflict",
          patch: {
            errorCode: "conflict-held",
            errorMessage: current.errorMessage || "競合を保留しています。どちらを残すか選ぶまで自動上書きしません。",
            requiresUserAction: true
          }
        };
      }
      return hasConflict
        ? {
            status: "conflict",
            patch: {
              errorCode: "external-conflict",
              errorMessage: "Memo-Nexusが最後に保存した後でローカルMarkdownが変更されています。内容を確認してください。",
              requiresUserAction: true
            }
          }
        : {
            status: "conflict",
            patch: {
              errorCode: "restore-candidate",
              errorMessage: "ローカルに復元の確認が必要なMarkdownがあります。内容を確認してください。",
              requiresUserAction: true
            }
          };
    }

    if (current?.status !== "conflict") return null;
    const status = current.pendingChanges || !current.lastSuccessAt ? "pending" : "saved";
    return { status, patch: { errorCode: "", errorMessage: "", requiresUserAction: false } };
  }

  function resolveDisplayedCreatedAt(note) {
    return note?.localCreatedAt || note?.createdAt || null;
  }

  function applyLocalSaveSuccess(note, savedAt = new Date().toISOString()) {
    const normalizedSavedAt = new Date(savedAt).toISOString();
    return {
      ...note,
      createdAt: note?.createdAt,
      localCreatedAt: note?.localCreatedAt || normalizedSavedAt,
      localSavedAt: normalizedSavedAt
    };
  }

  function localSaveLabel(status) {
    return STATUS_LABELS[status] || STATUS_LABELS.error;
  }

  const api = {
    STATUS_LABELS, applyLocalSaveSuccess, createLocalSaveState, localSaveLabel,
    resolveDisplayedCreatedAt, resolveLocalScanState, transitionLocalSaveState
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusLocalSaveState = api;
})(typeof window !== "undefined" ? window : globalThis);
