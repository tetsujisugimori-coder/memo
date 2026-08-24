(function (globalScope) {
  "use strict";
  const CONTEXT_LIMIT = 12000;
  const BRIDGE_TOKEN_SESSION_KEY = "memo-nexus-codex-bridge-token";
  const MIN_BRIDGE_TOKEN_LENGTH = 32;
  const CODEX_THREAD_RESOURCE_TYPE = "codex-thread";
  const CODEX_THREAD_RESOURCE_PREFIX = `${CODEX_THREAD_RESOURCE_TYPE}:`;
  function clipText(value, limit = CONTEXT_LIMIT) {
    const text = String(value || "");
    return { text: text.slice(0, limit), truncated: text.length > limit };
  }
  function buildAttachment(note, kind) {
    if (!note) return null;
    if (kind === "selection") {
      const selected = clipText(note.selection || "");
      return selected.text ? { kind, title: note.title || "無題メモ", text: selected.text, truncated: selected.truncated } : null;
    }
    const body = clipText(note.body || "");
    return { kind: "note", title: note.title || "無題メモ", text: body.text, truncated: body.truncated };
  }
  function formatPrompt(message, attachment) {
    const question = String(message || "").trim();
    if (!attachment) return question;
    const label = attachment.kind === "selection" ? "選択範囲" : "このメモ";
    return `${question}\n\n[Memo Nexus 添付: ${label}]\nタイトル: ${attachment.title}\n内容:\n${attachment.text}${attachment.truncated ? "\n（安全上の上限で末尾を省略）" : ""}\n[/Memo Nexus 添付]`;
  }
  function normalizeBridgeToken(value) {
    const token = String(value || "").trim();
    return token.length >= MIN_BRIDGE_TOKEN_LENGTH && !/\s/.test(token) ? token : "";
  }
  function loadSessionBridgeToken(storage) {
    if (!storage || typeof storage.getItem !== "function") return "";
    try {
      const token = normalizeBridgeToken(storage.getItem(BRIDGE_TOKEN_SESSION_KEY));
      if (!token && typeof storage.removeItem === "function") storage.removeItem(BRIDGE_TOKEN_SESSION_KEY);
      return token;
    } catch {
      return "";
    }
  }
  function saveSessionBridgeToken(storage, value) {
    const token = normalizeBridgeToken(value);
    if (!token || !storage || typeof storage.setItem !== "function") return "";
    try {
      storage.setItem(BRIDGE_TOKEN_SESSION_KEY, token);
      return token;
    } catch {
      return "";
    }
  }
  function clearSessionBridgeToken(storage) {
    if (!storage || typeof storage.removeItem !== "function") return;
    try { storage.removeItem(BRIDGE_TOKEN_SESSION_KEY); } catch (_) {}
  }
  function buildBridgeRequestHeaders(token, includeJson = false) {
    const headers = {};
    if (includeJson) headers["Content-Type"] = "application/json";
    const normalized = normalizeBridgeToken(token);
    if (normalized) headers.Authorization = `Bearer ${normalized}`;
    return headers;
  }
  function normalizeThreadInfo(value) {
    if (!value || typeof value !== "object" || !String(value.threadId || "").trim()) return null;
    return { threadId: String(value.threadId), lastUsedAt: value.lastUsedAt || null, title: String(value.title || "").slice(0, 80) };
  }
  function extractEditorSelection(editor) {
    if (!editor || typeof editor.value !== "string") return "";
    const start = Number.isInteger(editor.selectionStart) ? editor.selectionStart : 0;
    const end = Number.isInteger(editor.selectionEnd) ? editor.selectionEnd : start;
    return start < end ? editor.value.slice(start, end) : "";
  }
  function withCodexThread(note, thread, now = new Date().toISOString()) {
    if (!note || note.deletedAt || !thread?.threadId) return note;
    return { ...note, codexChat: { threadId: thread.threadId, lastUsedAt: now, title: thread.title || "Codex会話" } };
  }
  function withoutCodexThread(note) {
    if (!note || !note.codexChat) return note;
    const { codexChat, ...rest } = note;
    return rest;
  }
  function codexThreadResourceKey(threadId) {
    const normalizedThreadId = String(threadId || "").trim();
    if (!normalizedThreadId) throw new Error("Codex threadId is required");
    return `${CODEX_THREAD_RESOURCE_PREFIX}${normalizedThreadId}`;
  }
  function isCodexThreadSaveRequest(request) {
    return request?.resourceType === CODEX_THREAD_RESOURCE_TYPE
      && String(request.resourceKey || "").startsWith(CODEX_THREAD_RESOURCE_PREFIX);
  }
  function mergeStoredCodexThread(noteSnapshot, storedNote) {
    if (!noteSnapshot || typeof noteSnapshot !== "object" || !storedNote || typeof storedNote !== "object") return noteSnapshot;
    const merged = { ...noteSnapshot };
    if (storedNote.codexChat) merged.codexChat = storedNote.codexChat;
    else delete merged.codexChat;
    return merged;
  }
  function createCodexThreadSaveCoordinator({ foundation, createSaveRequest } = {}) {
    if (!foundation || typeof foundation.markChanged !== "function" || typeof foundation.enqueueSave !== "function") {
      throw new Error("save foundation is required");
    }
    if (typeof createSaveRequest !== "function") throw new Error("createSaveRequest is required");
    const latestRequests = new Map();
    const latestResourceByNoteId = new Map();
    const generationByNoteId = new Map();
    const persistedRequests = new WeakSet();

    function isCurrentRequest(request) {
      if (!isCodexThreadSaveRequest(request)) return false;
      const noteId = request.snapshot?.noteId;
      return Boolean(noteId)
        && latestResourceByNoteId.get(noteId) === request.resourceKey
        && generationByNoteId.get(noteId) === request.snapshot.generation;
    }

    function markPersisted(request) {
      if (!isCodexThreadSaveRequest(request)) throw new Error("Codex save request is required");
      persistedRequests.add(request);
      return request;
    }

    function enqueueRequest(request) {
      return foundation.enqueueSave(request).then((result) => {
        if (!result.state.dirty && latestRequests.get(request.resourceKey) === request) {
          latestRequests.delete(request.resourceKey);
        }
        return result;
      });
    }

    function enqueue({ noteId, threadId, codexChat } = {}) {
      const fixedNoteId = String(noteId || "").trim();
      const fixedThreadId = String(threadId || "").trim();
      if (!fixedNoteId) throw new Error("Codex noteId is required");
      const resourceKey = codexThreadResourceKey(fixedThreadId);
      const normalizedThread = codexChat == null ? null : normalizeThreadInfo(codexChat);
      if (codexChat != null && (!normalizedThread || normalizedThread.threadId !== fixedThreadId)) {
        throw new Error("Codex thread snapshot must match threadId");
      }
      const previousResourceKey = latestResourceByNoteId.get(fixedNoteId);
      const previousGeneration = generationByNoteId.get(fixedNoteId) || 0;
      const generation = previousResourceKey === resourceKey && previousGeneration
        ? previousGeneration
        : previousGeneration + 1;
      const currentRevision = foundation.getState(resourceKey)?.currentRevision || 0;
      const revision = foundation.markChanged(resourceKey, currentRevision);
      const request = createSaveRequest({
        resourceKey,
        resourceType: CODEX_THREAD_RESOURCE_TYPE,
        revision,
        snapshot: { noteId: fixedNoteId, threadId: fixedThreadId, generation, codexChat: normalizedThread }
      });
      if (previousResourceKey && previousResourceKey !== resourceKey) latestRequests.delete(previousResourceKey);
      latestRequests.set(resourceKey, request);
      latestResourceByNoteId.set(fixedNoteId, resourceKey);
      generationByNoteId.set(fixedNoteId, generation);
      return enqueueRequest(request);
    }

    function retry(threadId) {
      const resourceKey = codexThreadResourceKey(threadId);
      const request = latestRequests.get(resourceKey);
      if (!request) return Promise.resolve(null);
      if (latestResourceByNoteId.get(request.snapshot.noteId) !== resourceKey) return Promise.resolve(null);
      return enqueueRequest(request);
    }

    return {
      enqueue,
      getState: (threadId) => foundation.getState(codexThreadResourceKey(threadId)),
      isCurrentRequest,
      markPersisted,
      wasPersisted: (request) => persistedRequests.has(request),
      retry
    };
  }
  function createCodexChatState(resolveThread = () => null) {
    const state = { active: false, busyRequestNoteId: null, currentNoteId: null, selectionSnapshot: "", conversations: new Map() };
    function conversation(noteId = state.currentNoteId) {
      if (!noteId) return { thread: null, history: [], attachment: null };
      if (!state.conversations.has(noteId)) state.conversations.set(noteId, { thread: normalizeThreadInfo(resolveThread(noteId)), history: [], attachment: null });
      return state.conversations.get(noteId);
    }
    function switchNote(noteId) {
      const nextNoteId = noteId || null;
      if (nextNoteId !== state.currentNoteId) state.selectionSnapshot = "";
      state.currentNoteId = nextNoteId;
      return conversation();
    }
    function startRequest(noteId = state.currentNoteId) {
      if (!noteId || state.busyRequestNoteId) return null;
      state.busyRequestNoteId = noteId;
      return conversation(noteId);
    }
    function finishRequest(noteId) {
      if (state.busyRequestNoteId === noteId) state.busyRequestNoteId = null;
    }
    return { conversation, finishRequest, startRequest, state, switchNote };
  }
  async function readCodexEventStream(reader, onEvent = async () => {}) {
    if (!reader || typeof reader.read !== "function") throw new Error("Codex応答ストリームを読み取れません。");
    const decoder = new TextDecoder();
    let buffer = "";
    let terminalEvent = null;

    async function processFrame(frame) {
      if (terminalEvent || !frame.trim()) return;
      const data = frame.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) return;
      let event;
      try {
        event = JSON.parse(data);
      } catch (error) {
        throw new Error(`Codex応答のJSONを解析できません: ${error.message}`);
      }
      if (event.type === "done") terminalEvent = "done";
      if (event.type === "error") {
        terminalEvent = "error";
        throw new Error(event.error || "Codexとの通信に失敗しました。");
      }
      await onEvent(event);
    }

    function takeFrames(flush = false) {
      const frames = [];
      let match;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        frames.push(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (flush && buffer.trim()) {
        frames.push(buffer);
        buffer = "";
      }
      return frames;
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      for (const frame of takeFrames()) await processFrame(frame);
    }
    buffer += decoder.decode();
    for (const frame of takeFrames(true)) await processFrame(frame);
    if (terminalEvent !== "done") throw new Error("Codexとの接続が途中で終了しました。");
    return { type: "done" };
  }
  const api = { BRIDGE_TOKEN_SESSION_KEY, CODEX_THREAD_RESOURCE_PREFIX, CODEX_THREAD_RESOURCE_TYPE, CONTEXT_LIMIT, MIN_BRIDGE_TOKEN_LENGTH, buildAttachment, buildBridgeRequestHeaders, clearSessionBridgeToken, clipText, codexThreadResourceKey, createCodexChatState, createCodexThreadSaveCoordinator, extractEditorSelection, formatPrompt, isCodexThreadSaveRequest, loadSessionBridgeToken, mergeStoredCodexThread, normalizeBridgeToken, normalizeThreadInfo, readCodexEventStream, saveSessionBridgeToken, withCodexThread, withoutCodexThread };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusCodexChatUtils = api;
})(typeof window !== "undefined" ? window : globalThis);
