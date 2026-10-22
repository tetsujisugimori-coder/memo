(function () {
  "use strict";
  const byId = id => document.getElementById(id), dialog = byId("memoSearchDialog");
  if (!dialog) return;
  const status = byId("memoSearchStatus"), tokenInput = byId("memoSearchToken"), codeInput = byId("memoSearchCode");
  const selection = byId("memoSearchScope"), inspectButton = byId("memoSearchInspect"), grantButton = byId("memoSearchGrant");
  let token = "", inspected = null, session = null, timer = null, generation = 0, busy = false;
  const messages = { unauthorized: "受信サービスの認証に失敗しました。", permission_expired: "検索許可の期限が切れました。", permission_revoked: "検索許可は取り消されています。",
    tab_forbidden: "許可したタブと一致しません。", pairing_invalid_or_expired: "連携コードが不正または期限切れです。", network_failed: "受信サービスとの通信に失敗しました。",
    permission_required: "検索許可がありません。", rate_limit: "通信回数の上限です。検索許可を停止しました。", storage_unavailable: "保存領域を読み取れません。", invalid_response: "応答を検証できません。" };
  function report(error) { status.textContent = messages[error?.code] || "検索連携を停止しました。サービスと保存領域を確認してください。"; }
  async function request(route, body, bearer = token) {
    let response;
    try { response = await fetch(`http://127.0.0.1:8791/search/${route}`, { method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
      headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
    catch { throw { code: "network_failed" }; }
    const raw = await response.text();
    if (new TextEncoder().encode(raw).length > 12288) throw { code: "invalid_response" };
    let value; try { value = JSON.parse(raw); } catch { throw { code: "invalid_response" }; }
    if (!response.ok || value.error) throw { code: value.error || "invalid_response" };
    return value;
  }
  function credentials() { return { sessionId: session.sessionId, capability: session.capability }; }
  function stop(message) {
    generation++; clearTimeout(timer); timer = null;
    const previous = session, previousToken = token;
    session = null; inspected = null; token = ""; tokenInput.value = ""; codeInput.value = "";
    grantButton.disabled = true; inspectButton.disabled = false; selection.disabled = false; byId("memoSearchAllowRead").disabled = false; byId("memoSearchAllowRead").checked = false; busy = false;
    if (previous) {
      // Best effort on unload. Stopping heartbeats also fails closed within 5 seconds.
      fetch("http://127.0.0.1:8791/search/revoke", { method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", keepalive: true, redirect: "error", cache: "no-store",
        headers: { Authorization: `Bearer ${previousToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: previous.sessionId, capability: previous.capability }) }).catch(() => {});
    }
    if (message) status.textContent = message;
  }
  function selectedScope() { return selection.value === "all" ? { type: "all" } : { type: "collection", collectionId: selection.value.slice(11) }; }
  async function poll(epoch) {
    if (!session || epoch !== generation) return;
    try {
      if (Date.now() >= session.expiresAt) throw { code: "permission_expired" };
      const auth = credentials(), response = await request("poll", auth);
      if (!session || epoch !== generation) return;
      status.textContent = `検索許可中：${session.scope.type === "all" ? "全メモ" : "選択コレクション直下"}。期限 ${new Date(session.expiresAt).toLocaleString("ja-JP")}。残り ${response.remaining.requests}要求／${response.remaining.rows}件／${response.remaining.bytes}バイト。`;
      if (response.request) {
        const work = response.request;
        let payload;
        try {
          const conditions = window.MemoNexusSearch.conditions(work.conditions);
          if (session.scope.type === "collection" && (conditions.scope.type !== "collection" || conditions.scope.collectionId !== session.scope.collectionId)) throw new Error();
          let result;
          if (work.operation === "read") {
            if (!session.allowRead) throw new Error();
            result = await window.MemoNexusSavedSearch.read(work.readConditions, session.scope);
          } else if (work.operation === undefined) result = await window.MemoNexusSavedSearch.search(conditions, work.afterId);
          else throw new Error();
          payload = { result };
        } catch (error) { payload = { error: ["storage_unavailable", "collection_unavailable", "memo_unavailable", "memo_too_large", "invalid_offset"].includes(error.code) ? error.code : "search_failed" }; }
        if (!session || epoch !== generation) return;
        await request("result", { ...auth, requestId: work.requestId, ...payload });
      }
      if (session && epoch === generation) timer = setTimeout(() => poll(epoch), 2000);
    } catch (error) { if (epoch === generation) { stop(); report(error); } }
  }
  byId("memoSearchOpen").addEventListener("click", async () => {
    stop("未許可。連携コードを確認してから許可してください。"); dialog.showModal(); selection.replaceChildren(new Option("全メモ", "all"));
    try {
      for (const collection of await window.MemoNexusSavedSearch.collections()) selection.add(new Option(collection.name, `collection:${collection.id}`));
    } catch { report({ code: "storage_unavailable" }); }
  });
  codeInput.addEventListener("input", () => { inspected = null; grantButton.disabled = true; byId("memoSearchPrincipal").textContent = ""; });
  tokenInput.addEventListener("input", () => { inspected = null; grantButton.disabled = true; });
  inspectButton.addEventListener("click", async () => {
    if (busy || session) return; busy = true; inspectButton.disabled = true;
    const epoch = generation;
    try {
      const candidate = tokenInput.value.trim(), code = codeInput.value.trim();
      const reply = await request("inspect", { pairingCode: code }, candidate);
      if (epoch !== generation) return;
      if (code !== codeInput.value.trim() || candidate !== tokenInput.value.trim()) return;
      inspected = code; token = candidate;
      byId("memoSearchPrincipal").textContent = `認証主体：${reply.principal.issuer} / ${reply.principal.sub}`;
      status.textContent = "この主体と対象範囲を確認して「検索を10分間許可」を押してください。"; grantButton.disabled = false;
    } catch (error) { if (epoch === generation) report(error); }
    finally { if (epoch === generation) { busy = false; inspectButton.disabled = false; } }
  });
  grantButton.addEventListener("click", async () => {
    if (busy || !inspected || session) return; busy = true; grantButton.disabled = true;
    const epoch = generation;
    try {
      const granted = await request("grant", { pairingCode: inspected, scope: selectedScope(), allowRead: byId("memoSearchAllowRead").checked });
      if (epoch !== generation) return;
      session = granted; codeInput.value = ""; tokenInput.value = ""; inspected = null;
      selection.disabled = true; byId("memoSearchAllowRead").disabled = true; inspectButton.disabled = true; poll(epoch);
    } catch (error) { if (epoch === generation) { stop(); report(error); } }
    finally { if (epoch === generation) busy = false; }
  });
  byId("memoSearchRevoke").addEventListener("click", () => stop("このタブの検索を停止しました。取消通知が届かない場合も5秒でブラウザ未接続になります。"));
  byId("memoSearchClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => stop("検索を停止しました。"));
  window.addEventListener("pagehide", () => stop());
})();
