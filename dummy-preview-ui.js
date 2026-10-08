(function () {
  "use strict";
  const endpoint = "http://127.0.0.1:8791";
  const byId = (id) => document.getElementById(id);
  const dialog = byId("dummyPreviewDialog");
  if (!dialog) return;
  const openButton = byId("dummyPreviewOpenBtn");
  const checkButton = byId("dummyPreviewCheckBtn");
  const rejectButton = byId("dummyPreviewRejectBtn");
  const input = byId("dummyPreviewToken");
  const status = byId("dummyPreviewStatus");
  let token = ""; let current = null; let controller = null; let session = 0;
  function validateRecord(value) {
    const keys = ["formatVersion", "requestId", "dummy", "title", "body", "state", "receivedAt", "expiresAt", "saved"];
    if (!value || typeof value !== "object" || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
      || value.formatVersion !== 1 || value.dummy !== true || value.saved !== false
      || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.requestId)
      || typeof value.title !== "string" || Array.from(value.title).length > 200
      || typeof value.body !== "string" || new TextEncoder().encode(value.body).length > 65536
      || !["queued", "rejected", "expired", "queue_full"].includes(value.state)
      || !Number.isSafeInteger(value.receivedAt) || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt - value.receivedAt !== 600000) throw new Error("invalid_response");
    return value;
  }
  function render(record) {
    current = record;
    byId("dummyPreviewContent").hidden = !record;
    byId("dummyPreviewTitle").textContent = record?.title || "";
    byId("dummyPreviewBody").textContent = record?.body || "";
    byId("dummyPreviewRequestId").textContent = record?.requestId || "";
    byId("dummyPreviewState").textContent = record ? ({ queued: "ブラウザ表示中／一時キュー受信", rejected: "拒否済み", expired: "期限切れ", queue_full: "満杯で受信拒否" })[record.state] : "";
    rejectButton.disabled = record?.state !== "queued";
  }
  function clearConnection() {
    session++;
    controller?.abort(); controller = null;
    token = ""; input.value = ""; render(null);
    checkButton.disabled = false;
    status.textContent = "接続情報を消去しました。トークンを再入力してください。";
  }
  async function request(path, requestId) {
    const localController = new AbortController(); controller = localController;
    const signal = localController.signal;
    const timeout = setTimeout(() => localController.abort(), 5000);
    try {
      const response = await fetch(`${endpoint}${path}`, { method: requestId ? "POST" : "GET", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal,
        headers: { Authorization: `Bearer ${token}`, ...(requestId ? { "Content-Type": "application/json" } : {}) },
        ...(requestId ? { body: JSON.stringify({ requestId }) } : {}) });
      if (response.status === 401) { token = ""; throw new Error("unauthorized"); }
      if (!response.ok) throw new Error("request_failed");
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length;
        if (size > 70000) { await reader.cancel(); throw new Error("invalid_response"); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } finally { clearTimeout(timeout); }
  }
  async function perform(action) {
    if (controller) return;
    const attempt = session;
    if (input.value) { token = input.value; input.value = ""; }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) { token = ""; status.textContent = "受信サービス専用トークンを入力してください。"; input.focus(); return; }
    checkButton.disabled = true; rejectButton.disabled = true;
    status.textContent = action === "reject" ? "拒否を送信しています…" : "受信を確認しています…";
    try {
      if (action === "reject") {
        if (!current || current.state !== "queued") throw new Error("invalid_state");
        const result = await request("/reject", current.requestId);
        if (attempt !== session || !dialog.open) return;
        const record = validateRecord(result.request);
        if (record.requestId !== current.requestId || !["rejected", "expired"].includes(record.state)) throw new Error("invalid_response");
        render(record); status.textContent = record.state === "rejected" ? "拒否が完了しました。未保存。" : "期限切れです。未保存。";
      } else {
        const previous = current;
        const result = await request("/pending");
        if (attempt !== session || !dialog.open) return;
        if (result.pending === null) {
          let record = null;
          if (previous) {
            const detail = await request("/status", previous.requestId);
            if (attempt !== session || !dialog.open) return;
            record = validateRecord(detail.request);
            if (record.requestId !== previous.requestId) throw new Error("invalid_response");
          }
          render(record);
          status.textContent = record?.state === "expired" ? "期限切れです。未保存。" : "保留中の受信はありません。未保存。";
        } else {
          const record = validateRecord(result.pending);
          if (record.state !== "queued") throw new Error("invalid_response");
          render(record); status.textContent = "固定ダミーを表示しました。未保存。";
        }
      }
    } catch (error) {
      if (attempt !== session || !dialog.open) return;
      status.textContent = error.message === "unauthorized" ? "認証に失敗しました。専用トークンを再入力してください。"
        : action === "reject" ? "拒否の完了を確認できません。同じ要求で再試行してください。未保存。"
        : "受信を確認できません。サービス起動、ブラウザのローカルネットワーク権限、CORSを確認してください。未保存。";
    } finally {
      if (attempt === session) { controller = null; checkButton.disabled = false; rejectButton.disabled = current?.state !== "queued"; }
    }
  }
  openButton.addEventListener("click", () => { clearConnection(); dialog.showModal(); status.textContent = "固定ダミー専用です。受信を確認するまで通信しません。未保存。"; input.focus(); });
  checkButton.addEventListener("click", () => perform("check"));
  rejectButton.addEventListener("click", () => perform("reject"));
  byId("dummyPreviewCloseBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { clearConnection(); const menu = openButton.closest("details"); if (menu) menu.open = true; openButton.focus(); });
  window.addEventListener("pagehide", clearConnection);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); perform("check"); } });
})();
