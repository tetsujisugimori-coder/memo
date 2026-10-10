(function () {
  "use strict";
  const endpoint = "http://127.0.0.1:8791";
  const byId = (id) => document.getElementById(id);
  const dialog = byId("dummyPreviewDialog");
  if (!dialog) return;
  const openButton = byId("dummyPreviewOpenBtn");
  const checkButton = byId("dummyPreviewCheckBtn");
  const rejectButton = byId("dummyPreviewRejectBtn");
  const saveButton = byId("dummyPreviewSaveBtn");
  const input = byId("dummyPreviewToken");
  const status = byId("dummyPreviewStatus");
  let batch = null;
  const verifiedSaves = new Set();
  const verificationKey = (record) => JSON.stringify([record.requestId, record.itemId || "single", record.attemptId]);
  const isVerified = (record) => Boolean(record && !record.recoveryRequired && record.bodyAvailable !== false && verifiedSaves.has(verificationKey(record)));
  const canSave = (record) => Boolean(record && !record.dummy && record.bodyAvailable !== false && (["queued", "saving", "save_failed"].includes(record.state) || (record.state === "saved" && (needsDestinationConfirmation || !isVerified(record)))));
  const diagnostics = Object.freeze({
    history_write_failed: "履歴の書き込みに失敗したため停止しています。保存結果は未確認です。サービスを止め、履歴を保全して状態とアクセス権限を確認してください。",
    history_unavailable: "履歴を利用できないため停止しています。保存結果は未確認です。履歴を保全し、サービスと元のブラウザのメモを確認してください。",
    replay_required: "原文の再送が必要です。同じrequestId・同じ順序・同じ原文で再送し、状態と保存先を確認してください。保存結果は未確認です。",
    history_full: "受信履歴が128要求の上限に達しました。新規受信は拒否されます。履歴を保全し、既知requestIdの照会・再送と未完了要求の処理を行ってください。履歴を削除・切替しないでください。",
    history_capacity: "受信履歴が容量上限に達しました。この操作は確定していません。履歴を保全し、既知requestIdの状態を確認してください。履歴を削除・切替しないでください。",
    unauthorized: "認証に失敗しました。専用トークンを再入力してください。保存結果は未確認です。",
    network_failed: "通信を確認できません。サービス起動、ブラウザのローカルネットワーク権限、CORSを確認してください。保存結果は未確認です。"
  });
  const localMessages = new Set([
    "保存操作の排他制御を利用できません。",
    "保存領域を利用できません。再読み込みして再試行してください。",
    "保存計画が不正です。",
    "保存先がなくなりました。メモと保存先を確認してください。",
    "保存先が変更されています。メモと保存先を確認してください。",
    "既存メモが競合しています。メモを確認してください。",
    "保存証跡が一致しません。保存に使ったブラウザでメモを確認してください。",
    "保存結果が受信内容と一致しません。メモを確認してください。",
    "この保存領域では復旧情報を確認できません。保存に使ったブラウザでメモを確認してください。",
    "削除済みまたは既存メモとの競合です。メモを確認してください。"
  ]);
  function diagnosis(error) {
    if (Object.hasOwn(diagnostics, error?.code)) return diagnostics[error.code];
    if (localMessages.has(error?.message)) return error.message;
    return "操作の結果を確認できません。保存結果は未確認です。サービスの状態と元のブラウザのメモを確認してください。";
  }
  function stateLabel(record) {
    return ({ queued: "未保存プレビュー", saving: saving && record === current ? "保存処理中" : "保存結果不明", save_failed: "保存失敗・結果未確認", saved: isVerified(record) ? "保存済み（ブラウザ内・照合済み）" : "保存完了通知済み／この保存領域は未照合", rejected: "破棄済み", expired: "期限切れ", queue_full: "受信拒否" })[record?.state] || "未保存プレビュー";
  }
  let token = ""; let current = null; let controller = null; let session = 0; let saving = false; let displayedDestination = null;
  let operationController = null; let needsDestinationConfirmation = false;
  function validateRecord(value) {
    const keys = ["formatVersion", "requestId", "dummy", "title", "body", "state", "receivedAt", "expiresAt", "saved"];
    if (value && Object.hasOwn(value, "itemId")) keys.push("itemId");
    if (value && Object.hasOwn(value, "bodyAvailable")) { keys.push("bodyAvailable"); if (value.bodyAvailable !== false) throw new Error("invalid_response"); }
    if (value && Object.hasOwn(value, "recoveryRequired")) { keys.push("recoveryRequired"); if (value.recoveryRequired !== true) throw new Error("invalid_response"); }
    if (value?.dummy === false) keys.push("savePlan", "attemptId");
    if (!value || typeof value !== "object" || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
      || value.formatVersion !== 1 || typeof value.dummy !== "boolean" || value.saved !== (value.state === "saved")
      || typeof value.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.requestId)
      || typeof value.title !== "string" || Array.from(value.title).length > 200
      || typeof value.body !== "string" || new TextEncoder().encode(value.body).length > 65536
      || !["queued", "saving", "save_failed", "saved", "rejected", "expired", "queue_full"].includes(value.state)
      || !Number.isSafeInteger(value.receivedAt) || !Number.isSafeInteger(value.expiresAt)
      || value.expiresAt - value.receivedAt !== 600000) throw new Error("invalid_response");
    if (!value.dummy && value.savePlan !== null && (!value.savePlan || Object.keys(value.savePlan).length !== 2
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.savePlan.noteId)
      || typeof value.savePlan.collectionId !== "string" || !value.savePlan.collectionId)) throw new Error("invalid_response");
    if (["saving", "save_failed", "saved"].includes(value.state) && (value.dummy || !value.savePlan)) throw new Error("invalid_response");
    if (!value.dummy && (value.attemptId !== null && (typeof value.attemptId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.attemptId)))) throw new Error("invalid_response");
    if (!value.dummy && Boolean(value.savePlan) !== Boolean(value.attemptId)) throw new Error("invalid_response");
    if (value.itemId !== undefined && (typeof value.itemId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.itemId))) throw new Error("invalid_response");
    return value;
  }
  const pendingItem = (record) => ["queued", "saving", "save_failed"].includes(record.state);
  function validateBatch(value) {
    const keys = ["formatVersion", "requestId", "notes", "state", "receivedAt", "expiresAt", "saved"];
    if (!value || Object.keys(value).length !== keys.length || keys.some((key) => !Object.hasOwn(value, key))
      || value.formatVersion !== 1 || !Array.isArray(value.notes) || value.notes.length < 1 || value.notes.length > 5
      || !["queued", "completed", "queue_full"].includes(value.state)) throw new Error("invalid_response");
    const ids = new Set();
    for (const note of value.notes) {
      validateRecord(note);
      if (!note.itemId || ids.has(note.itemId) || note.requestId !== value.requestId || note.receivedAt !== value.receivedAt || note.expiresAt !== value.expiresAt || note.dummy) throw new Error("invalid_response");
      ids.add(note.itemId);
    }
    if (value.saved !== value.notes.every((note) => note.saved)
      || (value.state === "queued") !== value.notes.some(pendingItem)) throw new Error("invalid_response");
    return value;
  }
  function renderList() {
    const container = byId("receivedNotesList"); container.hidden = !batch;
    byId("receivedNotesPending").replaceChildren(); byId("receivedNotesProcessed").replaceChildren();
    if (!batch) return;
    for (const note of batch.notes) {
      const button = document.createElement("button"); button.type = "button";
      button.dataset.itemId = note.itemId;
      button.textContent = (note.bodyAvailable === false ? "原文なし" : note.title) + " — " + stateLabel(note);
      button.disabled = saving || Boolean(operationController) || Boolean(controller);
      button.setAttribute("aria-pressed", String(current?.itemId === note.itemId));
      button.addEventListener("click", () => { if (!saving && !controller && !operationController) render(note); });
      const row = document.createElement("li"); row.append(button);
      byId(pendingItem(note) ? "receivedNotesPending" : "receivedNotesProcessed").append(row);
    }
  }
  function renderBatch(value) {
    const selectedId = current?.itemId;
    batch = validateBatch(value);
    const selected = batch.notes.find((note) => note.itemId === selectedId) || batch.notes.find(pendingItem) || batch.notes[0];
    render(selected);
  }
  function render(record) {
    if (record?.requestId !== current?.requestId || record?.itemId !== current?.itemId) needsDestinationConfirmation = false;
    current = record;
    if (record?.recoveryRequired) verifiedSaves.delete(verificationKey(record));
    if (record?.itemId && batch?.requestId === record.requestId) {
      batch.notes = batch.notes.map((note) => note.itemId === record.itemId ? record : note);
    }
    renderList();
    byId("dummyPreviewContent").hidden = !record;
    byId("dummyPreviewTitle").textContent = record?.title || "";
    byId("dummyPreviewBody").textContent = record?.bodyAvailable === false ? (["queued", "saving", "save_failed", "saved"].includes(record.state) ? "原文なし／再送待ち。同じrequestId・同じ順序・同じ原文で再送してください。再送だけでは保存しません。" : "原文は保持していません。再送しても破棄・期限切れ・受信拒否の状態は変わりません。") : record?.body || "";
    byId("dummyPreviewRequestId").textContent = record?.requestId || "";
    byId("dummyPreviewBadge").textContent = stateLabel(record);
    byId("dummyPreviewState").textContent = record ? `${stateLabel(record)}／${record.bodyAvailable === false ? "原文なし" : "原文あり"}` : "";
    const destination = window.MemoNexusReceivedPreview?.destination(record?.savePlan?.collectionId);
    displayedDestination = destination;
    byId("dummyPreviewDestination").textContent = `${record?.savePlan ? "固定済み：" : ""}${destination?.label || "保存領域未準備"}`;
    byId("dummyPreviewStorageWarning").textContent = destination?.warning || "";
    rejectButton.disabled = saving || Boolean(operationController) || !["queued", "save_failed"].includes(record?.state);
    saveButton.disabled = saving || Boolean(operationController) || Boolean(controller) || !canSave(record);
  }
  function clearConnection() {
    session++;
    controller?.abort(); controller = null;
    operationController?.abort(); operationController = null; saving = false;
    token = ""; input.value = ""; batch = null; verifiedSaves.clear(); byId("receivedRequestLookup").value = ""; render(null);
    checkButton.disabled = false;
    byId("dummyPreviewCloseBtn").disabled = false;
    status.textContent = "接続情報を消去しました。トークンを再入力してください。";
  }
  async function withRequestLock(requestId, task) {
    if (!navigator.locks) throw Object.assign(new Error("保存操作の排他制御を利用できません。"), { userMessage: true });
    const localOperation = new AbortController(); operationController = localOperation;
    try { return await navigator.locks.request(`memo-received-request:${requestId}`, { signal: localOperation.signal }, task); }
    finally { if (operationController === localOperation) operationController = null; }
  }
  function matchingRecord(value, expected) {
    const record = validateRecord(value);
    if (record.requestId !== expected.requestId || record.itemId !== expected.itemId || record.title !== expected.title || record.body !== expected.body) throw new Error("保存応答が一致しません。");
    return record;
  }
  async function request(path, requestId, extra = {}, whole = false) {
    const localController = new AbortController(); controller = localController;
    const signal = localController.signal;
    const timeout = setTimeout(() => localController.abort(), 5000);
    try {
      const response = await fetch(`${endpoint}${path}`, { method: requestId ? "POST" : "GET", mode: "cors", credentials: "omit", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer", signal,
        headers: { Authorization: `Bearer ${token}`, ...(requestId ? { "Content-Type": "application/json" } : {}) },
        ...(requestId ? { body: JSON.stringify({ requestId, ...(!whole && current?.itemId && current.requestId === requestId ? { itemId: current.itemId } : {}), ...extra }) } : {}) }).catch(() => { throw Object.assign(new Error("network_failed"), { code: "network_failed" }); });
      if (response.status === 401) { token = ""; throw Object.assign(new Error("unauthorized"), { code: "unauthorized" }); }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      while (true) {
        const { done, value } = await reader.read().catch(() => { throw Object.assign(new Error("network_failed"), { code: "network_failed" }); }); if (done) break;
        size += value.length;
        if (size > 2052096) { await reader.cancel(); throw new Error("invalid_response"); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      if (!response.ok) {
        throw Object.assign(new Error("request_failed"), { code: Object.hasOwn(diagnostics, result.error) ? result.error : "request_failed" });
      }
      return result;
    } finally { clearTimeout(timeout); }
  }
  async function perform(action) {
    if (controller || saving || operationController) return;
    const attempt = session;
    if (input.value) { token = input.value; input.value = ""; }
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) { token = ""; status.textContent = "受信サービス専用トークンを入力してください。"; input.focus(); return; }
    checkButton.disabled = true; rejectButton.disabled = true;
    status.textContent = action === "reject" ? "拒否を送信しています…" : "受信を確認しています…";
    try {
      if (action === "reject") {
        if (!current || !["queued", "save_failed"].includes(current.state)) throw new Error("invalid_state");
        const expected = current;
        saveButton.disabled = true;
        status.textContent = "ほかのタブの保存操作を待ち、最新状態を確認しています…";
        await withRequestLock(expected.requestId, async () => {
          if (attempt !== session || !dialog.open) return;
          const latest = matchingRecord((await request("/status", expected.requestId)).request, expected);
          if (attempt !== session || !dialog.open) return;
          render(latest);
          if (latest.state === "saving" || latest.state === "saved") {
            status.textContent = latest.state === "saved" ? "別タブから保存完了の通知を受信済みです。作成済みメモは取り消しません。"
              : "保存完了は未確認です。破棄せず、同じ要求の保存を再試行して結果を確認してください。";
            return;
          }
          const record = matchingRecord((await request("/reject", expected.requestId)).request, expected);
          if (attempt !== session || !dialog.open) return;
          if (!["rejected", "expired"].includes(record.state)) throw new Error("invalid_response");
          render(record); status.textContent = record.state === "rejected" ? record.dummy ? "拒否が完了しました。未保存。" : "受信内容を破棄しました。作成済みメモは取り消しません。保存結果が不明な場合はメモ一覧を確認してください。" : "期限切れです。未保存。";
        });
      } else {
        const previous = current;
        const lookup = byId("receivedRequestLookup").value.trim();
        const result = lookup ? { pending: (await request("/status", lookup, {}, true)).request } : await request("/pending");
        if (attempt !== session || !dialog.open) return;
        if (result.pending === null) {
          let record = null;
          if (batch) {
            const detail = await request("/status", batch.requestId, {}, true);
            if (attempt !== session || !dialog.open) return;
            renderBatch(detail.request); status.textContent = "要求内の各メモの状態を確認しました。受信・確認だけでは保存しません。"; return;
          }
          if (previous) {
            const detail = await request("/status", previous.requestId);
            if (attempt !== session || !dialog.open) return;
            record = validateRecord(detail.request);
            if (record.requestId !== previous.requestId) throw new Error("invalid_response");
          }
          render(record);
          status.textContent = record?.state === "saved" ? "ブラウザから保存完了の通知を受信済みです。"
            : record?.state === "rejected" && !record.dummy ? "受信内容は破棄済みです。作成済みメモは取り消しません。"
            : record?.state === "expired" ? "期限切れです。未保存。" : "保留中の受信はありません。未保存。";
        } else {
          if (result.pending.notes) {
            renderBatch(result.pending);
            status.textContent = "複数メモを表示しました。各メモを選び、原文と保存先を確認して個別に保存・破棄してください。"; return;
          }
          batch = null;
          const record = validateRecord(result.pending);
          if (!lookup && !["queued", "saving", "save_failed"].includes(record.state)) throw new Error("invalid_response");
          render(record); status.textContent = record.dummy ? "固定ダミーを表示しました。未保存。" : record.state === "queued" ? "受信文章を表示しました。未保存。" : `${stateLabel(record)}。原文と保存先、必要な確認操作を確認してください。`;
        }
      }
    } catch (error) {
      if (attempt !== session || !dialog.open) return;
      status.textContent = `${action === "reject" ? current?.dummy ? "拒否の完了を確認できません。" : "破棄の完了を確認できません。" : "受信を確認できません。"}${diagnosis(error)}`;
    } finally {
      if (attempt === session) { controller = null; checkButton.disabled = false; render(current); }
    }
  }
  async function saveReceived(event) {
    if (!event.isTrusted || saving || controller || operationController || !canSave(current)) return;
    if (current.bodyAvailable === false) return;
    const expected = current, destination = displayedDestination, attempt = session;
    let saveStage = "最新状態の確認";
    saving = true; saveButton.disabled = true; rejectButton.disabled = true; checkButton.disabled = true;
    byId("dummyPreviewCloseBtn").disabled = true;
    status.textContent = "ほかのタブの保存操作を待ち、保存先を確認しています…";
    try {
      if (!destination) throw new Error("保存先を確認できません。");
      await withRequestLock(expected.requestId, async () => {
        if (attempt !== session || !dialog.open) return;
        const latest = matchingRecord((await request("/status", expected.requestId)).request, expected);
        if (attempt !== session || !dialog.open) return;
        if (!["queued", "saving", "save_failed", "saved"].includes(latest.state)) {
          render(latest); status.textContent = "受信要求は保存できる状態ではありません。新しいメモは作成していません。"; return;
        }
        function confirmDestination(record) {
          if (!record.savePlan || record.savePlan.collectionId === destination.collectionId) return true;
          render(record); needsDestinationConfirmation = true;
          status.textContent = "別タブが先に保存先を固定しました。このクリックではDB保存を行いません。変更後の保存先を確認し、もう一度「新規メモとして保存」を押してください。";
          return false;
        }
        if (!confirmDestination(latest)) return;
        // One request lock covers destination, begin, DB transaction and completion/failure.
        saveStage = "保存計画の記録";
        const record = matchingRecord((await request("/begin", expected.requestId, { collectionId: destination.collectionId, previousAttemptId: latest.attemptId })).request, expected);
        if (attempt !== session || !dialog.open) return;
        if (!["saving", "saved"].includes(record.state)) throw new Error("保存応答が一致しません。");
        if (!confirmDestination(record)) return;
        needsDestinationConfirmation = false; render(record);
        status.textContent = "新規メモを保存しています…";
        saveStage = "ブラウザ保存と照合";
        try { await window.MemoNexusReceivedPreview.save(record); }
        catch (saveError) {
          if (record.state === "saving" && attempt === session && dialog.open) {
            try { render(matchingRecord((await request("/failed", record.requestId, { attemptId: record.attemptId })).request, expected)); } catch { /* keep uncertain plan for recovery */ }
          }
          throw saveError;
        }
        if (attempt !== session || !dialog.open) return;
        saveStage = "保存完了通知の記録";
        const complete = matchingRecord((await request("/complete", record.requestId, { attemptId: record.attemptId })).request, expected);
        if (attempt !== session || !dialog.open) return;
        if (complete.state !== "saved") throw new Error("保存完了通知を確認できません。");
        verifiedSaves.add(verificationKey(complete));
        render(complete); status.textContent = "新規メモをブラウザ内に保存しました。";
      });
    } catch (error) {
      if (attempt === session && dialog.open) {
        if (error?.code === "recovery_blocked") {
          byId("dummyPreviewBadge").textContent = "復旧不能・要確認";
          byId("dummyPreviewState").textContent = "復旧不能・要確認";
          status.textContent = `${diagnosis(error)} requestId: ${expected.requestId}${expected.itemId ? ` / itemId: ${expected.itemId}` : ""}`;
        } else status.textContent = `保存完了を確認できません。保存結果不明／保存失敗。確認段階：${saveStage}。${diagnosis(error)} requestId: ${expected.requestId}${expected.itemId ? ` / itemId: ${expected.itemId}` : ""}`;
      }
    } finally {
      if (attempt === session) {
        saving = false; controller = null; checkButton.disabled = false; byId("dummyPreviewCloseBtn").disabled = false;
        const blocked = byId("dummyPreviewBadge").textContent === "復旧不能・要確認";
        render(current);
        if (blocked) { byId("dummyPreviewBadge").textContent = "復旧不能・要確認"; byId("dummyPreviewState").textContent = "復旧不能・要確認"; }
      }
    }
  }
  saveButton.addEventListener("click", saveReceived);
  dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
  openButton.addEventListener("click", () => { clearConnection(); dialog.showModal(); status.textContent = "受信を確認するまで通信しません。未保存。固定ダミーは保存対象外です。"; input.focus(); });
  checkButton.addEventListener("click", () => perform("check"));
  rejectButton.addEventListener("click", () => perform("reject"));
  byId("dummyPreviewCloseBtn").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => { if (dialog.open) return; clearConnection(); const menu = openButton.closest("details"); if (menu) menu.open = true; openButton.focus(); });
  window.addEventListener("pagehide", clearConnection);
  input.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); perform("check"); } });
})();
