(function () {
  "use strict";
  const byId = id => document.getElementById(id), dialog = byId("memoSearchDialog");
  if (!dialog) return;
  const status = byId("memoSearchStatus"), tokenInput = byId("memoSearchToken"), codeInput = byId("memoSearchCode");
  const selection = byId("memoSearchScope"), inspectButton = byId("memoSearchInspect"), grantButton = byId("memoSearchGrant");
  const revokeButton = byId("memoSearchRevoke"), refreshButton = byId("memoSearchRefresh"), readInput = byId("memoSearchAllowRead");
  const reconnect = "外部AIに「prepare_memo_searchを実行して新しい連携コードを発行してください」と依頼し、この画面でコード・認証主体・対象範囲を確認して改めて許可してください。";
  let token = "", inspected = null, session = null, stopped = true, timer = null, generation = 0, busy = false, reconnectable = false;
  const messages = {
    unauthorized: "受信サービスの認証に失敗しました。受信サービス専用トークンを確認し、Memo-Nexusを再読み込みして新しいコードで連携してください。OAuthの状態はこの画面では確認できません。",
    permission_expired: "検索許可の期限が切れました。" + reconnect,
    permission_revoked: "検索許可は取り消されています。" + reconnect,
    browser_disconnected: "ブラウザ未接続で検索できません。受信サービスとこのタブを確認し、「検索許可を取り消す」で停止を確定してください。" + reconnect,
    tab_forbidden: "許可したタブを確認できません。Memo-Nexusを再読み込みしてください。" + reconnect,
    pairing_invalid_or_expired: "連携コードが不正または期限切れです（コードの有効時間は2分）。" + reconnect,
    network_failed: "状態確認失敗：受信サービスとの通信に失敗しました。許可の失効・取消・OAuth接続の状態は確認できません。受信サービス8791、MCPサービス8792とTunnelの稼働を確認し、状態を再確認してください。",
    permission_required: "このセッションの検索許可を確認できません。サービス再起動などでも許可は失われます。" + reconnect,
    rate_limit: "通信回数の上限です。少し待って状態を再確認してください。",
    storage_unavailable: "保存領域を読み取れません。Memo-Nexusを再読み込みして確認してください。",
    invalid_response: "状態確認失敗：応答を検証できません。状態を再確認してください。"
  };
  function report(error) { status.textContent = messages[error?.code] || "検索状態を確認できません。受信サービスと保存領域を確認し、状態を再確認してください。"; }
  async function request(route, body, bearer = token, keepalive = false) {
    let response, raw;
    try {
      response = await fetch(`http://127.0.0.1:8791/search/${route}`, { method: "POST", mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "error", keepalive, signal: AbortSignal.timeout(8000),
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
      raw = await response.text();
    } catch { throw { code: "network_failed" }; }
    if (new TextEncoder().encode(raw).length > 12288) throw { code: "invalid_response" };
    let value; try { value = JSON.parse(raw); } catch { throw { code: "invalid_response" }; }
    if (!response.ok || value.error) throw { code: value.error || "invalid_response" };
    return value;
  }
  const credentials = value => ({ sessionId: value.sessionId, capability: value.capability });
  function controls() {
    const locked = busy || !!session;
    tokenInput.disabled = codeInput.disabled = selection.disabled = readInput.disabled = locked;
    inspectButton.disabled = locked;
    grantButton.disabled = locked || !inspected || !selection.value;
    revokeButton.disabled = busy || !session;
    refreshButton.disabled = busy || !session;
  }
  function resetInputs() {
    inspected = null; codeInput.value = tokenInput.value = ""; selection.value = ""; readInput.checked = false;
    byId("memoSearchPrincipal").textContent = "";
  }
  function halt() { generation++; clearTimeout(timer); timer = null; stopped = true; busy = false; controls(); }
  function showScope(value) {
    const name = value.scope.type === "all" ? "全コレクション許可：あり（今後作成するコレクションも含む）" : `全コレクション許可：なし。許可先：${value.collectionName || value.scope.collectionId}（許可時の名称、ID：${value.scope.collectionId}、指定先直下のみ）`;
    byId("memoSearchGrantedScope").textContent = `最後に確認した許可範囲（現在の有効性は上の状態表示を確認）：${name}。全文取得：${value.allowRead ? "許可" : "未許可"}。検索許可期限：${new Date(value.expiresAt).toLocaleString("ja-JP")}。`;
  }
  function validateState(reply) {
    if (!["active", "permission_revoked", "permission_expired", "browser_disconnected"].includes(reply.state)
      || !Number.isFinite(reply.expiresAt) || typeof reply.allowRead !== "boolean") throw { code: "invalid_response" };
    window.MemoNexusSearch.scope(reply.scope);
  }
  async function confirm(epoch = generation) {
    if (!session) return;
    const current = session;
    status.textContent = "検索状態を確認中です。";
    try {
      const reply = await request("status", credentials(current)); validateState(reply);
      if (epoch !== generation || current !== session) return;
      // A stale heartbeat never cancels the server grant; poll re-establishes liveness.
      if (["active", "browser_disconnected"].includes(reply.state) && (!stopped || reconnectable)) {
        stopped = false; reconnectable = false; controls(); showScope(current); await poll(epoch); return;
      }
      if (["permission_revoked", "permission_expired"].includes(reply.state)) {
        halt(); reconnectable = false; session = null; token = ""; resetInputs(); controls();
        report({ code: reply.state });
      } else if (stopped) {
        status.textContent = "このタブの検索処理は停止中ですが、サーバーでの検索許可取り消しは未確認です。「検索許可を取り消す」で再試行してください。";
      } else { halt(); report({ code: reply.state }); }
    } catch (error) {
      if (epoch === generation && current === session) {
        halt(); reconnectable = error.code === "network_failed";
        if (error.code === "permission_required") { reconnectable = false; session = null; token = ""; resetInputs(); controls(); }
        report(error);
      }
    }
  }
  async function revoke(keepalive = false) {
    reconnectable = false; halt(); resetInputs();
    if (!session) { token = ""; controls(); return; }
    const current = session, epoch = generation;
    busy = true; controls(); status.textContent = "検索許可を取り消し中です。サーバーの応答を確認しています。";
    try {
      const reply = await request("revoke", credentials(current), token, keepalive);
      if (epoch !== generation || current !== session) return;
      if (!((reply.revoked === true && reply.state === "permission_revoked") || (reply.revoked === false && reply.state === "permission_expired"))) throw { code: "invalid_response" };
      session = null; token = "";
      report({ code: reply.state });
    } catch (error) {
      if (epoch === generation && current === session) {
        report(error); status.textContent += " このタブの検索処理は停止済みですが、取り消し結果は未確認です。状態を再確認するか取り消しを再試行してください。";
      }
    } finally { if (epoch === generation) { busy = false; controls(); } }
  }
  async function poll(epoch) {
    if (!session || stopped || epoch !== generation) return;
    const current = session;
    try {
      // Local time can stop delivery early, but only a server response establishes expiry.
      if (Date.now() >= current.expiresAt) {
        const expirationEpoch = generation + 1;
        await revoke();
        if (generation === expirationEpoch) status.textContent = "検索許可の期限が切れた可能性があるため停止しました。" + status.textContent;
        return;
      }
      const auth = credentials(current), response = await request("poll", auth);
      if (current !== session || stopped || epoch !== generation) return;
      if (document.visibilityState !== "visible") { status.textContent = "バックグラウンドです。検索状態は復帰時に再確認します。"; }
      else status.textContent = `検索可能（検索許可中）：このタブの許可と受信サービスの通信を確認しました。残り ${response.remaining.requests}要求／${response.remaining.rows}件／${response.remaining.bytes}バイト。OAuth・8792・Tunnelの到達は外部AI側で確認してください。`;
      showScope(current);
      if (response.request) {
        const work = response.request;
        let payload;
        try {
          const conditions = window.MemoNexusSearch.conditions(work.conditions);
          if (current.scope.type === "collection" && (conditions.scope.type !== "collection" || conditions.scope.collectionId !== current.scope.collectionId)) throw new Error();
          let result;
          if (work.operation === "read") {
            if (!current.allowRead) throw new Error();
            result = await window.MemoNexusSavedSearch.read(work.readConditions, current.scope);
          } else if (work.operation === undefined) result = await window.MemoNexusSavedSearch.search(conditions, work.afterId);
          else throw new Error();
          payload = { result };
        } catch (error) { payload = { error: ["storage_unavailable", "collection_unavailable", "memo_unavailable", "memo_too_large", "invalid_offset"].includes(error.code) ? error.code : "search_failed" }; }
        if (current !== session || stopped || epoch !== generation) return;
        await request("result", { ...auth, requestId: work.requestId, ...payload });
      }
      if (current === session && !stopped && epoch === generation) timer = setTimeout(() => poll(epoch), 2000);
    } catch (error) {
      if (epoch === generation && current === session) {
        halt(); reconnectable = error.code === "network_failed";
        if (["permission_expired", "permission_revoked", "permission_required"].includes(error.code)) { reconnectable = false; session = null; token = ""; resetInputs(); controls(); }
        report(error);
      }
    }
  }
  byId("memoSearchOpen").addEventListener("click", async () => {
    dialog.showModal(); controls();
    if (session) { await confirm(); return; }
    status.textContent = "未設定：このタブで有効な検索許可を確認していません。" + reconnect;
    selection.replaceChildren(new Option("許可する対象を選択してください", ""), new Option("全メモ（今後作成するコレクションを含む）", "all"));
    try {
      for (const collection of await window.MemoNexusSavedSearch.collections()) selection.add(new Option(collection.name, `collection:${collection.id}`));
    } catch { report({ code: "storage_unavailable" }); }
  });
  function invalidateInspection() { inspected = null; grantButton.disabled = true; byId("memoSearchPrincipal").textContent = ""; }
  codeInput.addEventListener("input", invalidateInspection); tokenInput.addEventListener("input", invalidateInspection);
  selection.addEventListener("change", controls);
  inspectButton.addEventListener("click", async () => {
    if (busy || session) return;
    inspected = null; busy = true; controls();
    const epoch = generation;
    try {
      const candidate = tokenInput.value.trim(), code = codeInput.value.trim();
      const reply = await request("inspect", { pairingCode: code }, candidate);
      if (epoch !== generation) return;
      if (!Number.isFinite(reply.expiresAt) || !reply.principal?.issuer || !reply.principal?.sub) throw { code: "invalid_response" };
      inspected = { code, expiresAt: reply.expiresAt }; token = candidate;
      byId("memoSearchPrincipal").textContent = `認証主体：${reply.principal.issuer} / ${reply.principal.sub}`;
      status.textContent = `pairing待ち：連携コード期限 ${new Date(reply.expiresAt).toLocaleString("ja-JP")}（発行から2分）。まだ検索許可はありません。対象範囲を選び、許可してください。`;
    } catch (error) { if (epoch === generation) report(error); }
    finally { if (epoch === generation) { busy = false; controls(); } }
  });
  grantButton.addEventListener("click", async () => {
    if (busy || !inspected || session || !selection.value) return;
    busy = true; controls();
    const epoch = generation, bearer = token, collectionName = selection.selectedOptions[0].textContent;
    try {
      const granted = await request("grant", { pairingCode: inspected.code, scope: selection.value === "all" ? { type: "all" } : { type: "collection", collectionId: selection.value.slice(11) }, allowRead: readInput.checked }, bearer);
      if (epoch !== generation) { await request("revoke", credentials(granted), bearer, true); return; }
      validateState({ ...granted, state: "active" });
      session = { ...granted, collectionName }; stopped = false; reconnectable = false; resetInputs(); controls(); await poll(epoch);
    } catch (error) { if (epoch === generation) { halt(); report(error); } }
    finally { if (epoch === generation) { busy = false; controls(); } }
  });
  revokeButton.addEventListener("click", () => revoke());
  refreshButton.addEventListener("click", () => {
    if (busy || !session) return;
    generation++; clearTimeout(timer); timer = null; confirm();
  });
  byId("memoSearchClose").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => revoke());
  window.addEventListener("pagehide", () => revoke(true));
  window.addEventListener("pageshow", event => { if (event.persisted && session) confirm(); });
  document.addEventListener("visibilitychange", () => {
    if (!session || stopped || busy) return;
    if (document.visibilityState !== "visible") {
      // Tab switching must not intentionally stop request delivery; the browser may still throttle timers.
      status.textContent = "バックグラウンドです。検索状態は復帰時に再確認します。";
      return;
    }
    generation++; clearTimeout(timer); timer = null;
    status.textContent = "検索状態は未確認です。復帰時に再確認します。";
    confirm();
  });
  controls();
})();
