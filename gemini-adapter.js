(function initGeminiAdapter(globalScope) {
  "use strict";
  const providerApi = typeof module !== "undefined" && module.exports ? require("./ai-provider") : globalScope.MemoNexusAiProvider;
  const { AiProviderError } = providerApi;
  const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  const GEMINI_MODEL_CANDIDATES = Object.freeze([]);

  function error(code, message, options = {}) { return new AiProviderError(code, message, { ...options, provider: "gemini" }); }
  function modelPath(model) { return String(model || "").replace(/^models\//, ""); }
  function modelId(model) { const name = String(model?.name || "").trim(); return name ? (name.startsWith("models/") ? name : `models/${name}`) : ""; }
  function modelDisplayName(model) { return modelId(model).replace(/^models\//, ""); }

  function createGeminiTimeouts(externalSignal, values = {}) {
    const controller = new AbortController();
    const firstResponseMs = Number(values.firstResponseMs) || 30000;
    const idleMs = Number(values.idleMs) || 60000;
    const totalMs = Number(values.totalMs) || 180000;
    let phase = "first_response";
    let firstTimer = null; let idleTimer = null; let totalTimer = null;
    const abort = (nextPhase) => { phase = nextPhase; controller.abort(); };
    const resetIdle = () => { if (idleTimer) clearTimeout(idleTimer); idleTimer = setTimeout(() => abort("idle"), idleMs); };
    let externallyAborted = false;
    if (externalSignal?.aborted) { externallyAborted = true; controller.abort(); }
    const abortExternal = () => { externallyAborted = true; controller.abort(); };
    externalSignal?.addEventListener("abort", abortExternal, { once: true });
    firstTimer = setTimeout(() => abort("first_response"), firstResponseMs);
    totalTimer = setTimeout(() => abort("total"), totalMs);
    return {
      signal: controller.signal,
      markResponse() { if (firstTimer) clearTimeout(firstTimer); firstTimer = null; resetIdle(); },
      markChunk() { resetIdle(); },
      phase: () => phase,
      didExternalAbort: () => externallyAborted,
      cleanup() { [firstTimer, idleTimer, totalTimer].forEach((timer) => { if (timer) clearTimeout(timer); }); externalSignal?.removeEventListener("abort", abortExternal); }
    };
  }

  function createSseParser() {
    let buffer = "";
    const parseEvent = (source) => {
      const data = source.split("\n").filter((line) => !line.startsWith(":"))
        .filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /, "")).join("\n");
      if (!data || data === "[DONE]") return null;
      try { return JSON.parse(data); } catch (cause) { throw error("stream_parse", "Geminiのストリーム応答を解析できませんでした。", { cause, phase: "sse_parse" }); }
    };
    return {
      push(chunk) {
        buffer += String(chunk || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const events = []; let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) { const parsed = parseEvent(buffer.slice(0, boundary)); buffer = buffer.slice(boundary + 2); if (parsed) events.push(parsed); }
        return events;
      },
      finish() { const tail = buffer; buffer = ""; if (!tail.trim()) return []; const parsed = parseEvent(tail); return parsed ? [parsed] : []; }
    };
  }

  function usageFrom(response) { const usage = response?.usageMetadata || {}; return { inputTokens: Number(usage.promptTokenCount) || 0, outputTokens: Number(usage.candidatesTokenCount) || 0, totalTokens: Number(usage.totalTokenCount) || 0 }; }
  function extractGeminiEvent(response) {
    const candidate = Array.isArray(response?.candidates) ? response.candidates[0] : null;
    if (response?.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") throw error("safety_blocked", "安全性設定によりGeminiの応答が生成されませんでした。", { phase: "text_extract" });
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    return { text: parts.map((part) => typeof part?.text === "string" ? part.text : "").join(""), usage: usageFrom(response), finishReason: candidate?.finishReason || "", hasCandidate: Boolean(candidate) };
  }
  function extractGeminiText(response, options = {}) { const extracted = extractGeminiEvent(response); if (extracted.text || options.allowEmpty) return extracted; throw error("empty_response", "Gemini APIから応答がありませんでした。", { phase: "text_extract" }); }
  function toGeminiRequest(messages, generationConfig) {
    const system = []; const contents = [];
    (Array.isArray(messages) ? messages : []).forEach((message) => { const content = String(message?.content || "").trim(); if (!content) return; if (message.role === "system") system.push(content); else contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: content }] }); });
    if (!contents.some((content) => content.role === "user")) throw error("invalid_request", "Geminiへ送信する質問がありません。", { phase: "request" });
    const request = { contents }; if (system.length) request.systemInstruction = { parts: [{ text: system.join("\n\n") }] }; if (generationConfig) request.generationConfig = generationConfig; return request;
  }
  function isTextGenerationModel(model) { const methods = model?.supportedGenerationMethods; const name = modelDisplayName(model).toLowerCase(); return Array.isArray(methods) && methods.includes("generateContent") && !/(embedding|imagen|image|audio|speech|tts|moderation)/.test(name); }
  function normalizeGeminiModels(payload) {
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return models.filter(isTextGenerationModel).map((model) => { const id = modelId(model); const displayName = modelDisplayName(model); const lower = displayName.toLowerCase(); const channel = lower.includes("experimental") || lower.includes("exp") ? "experimental" : lower.includes("preview") ? "preview" : "stable"; return { id, name: id, displayName, family: "gemini", familyLabel: "Gemini", verified: true, channel }; }).sort((a, b) => ({ stable: 0, preview: 1, experimental: 2 }[a.channel] - { stable: 0, preview: 1, experimental: 2 }[b.channel]) || a.displayName.localeCompare(b.displayName, "ja"));
  }
  function groupGeminiModels(models) { const list = Array.isArray(models) ? models : []; return { stable: list.filter((model) => model.channel === "stable"), preview: list.filter((model) => model.channel === "preview"), experimental: list.filter((model) => model.channel === "experimental") }; }
  async function responseError(response, phase) { let statusCode = ""; let details = ""; try { const payload = await response.json(); statusCode = String(payload?.error?.status || ""); details = String(payload?.error?.message || ""); } catch (_error) {} const status = response.status; let code = "connection"; if (status === 401 || /UNAUTHENTICATED/i.test(statusCode)) code = "authentication"; else if (status === 403 || /PERMISSION_DENIED/i.test(statusCode)) code = "permission"; else if (status === 404 || /NOT_FOUND/i.test(statusCode)) code = "model_missing"; else if (status === 429) code = /quota|limit exceeded/i.test(details) ? "quota_exceeded" : "rate_limit"; else if (status >= 500) code = "server_error"; return error(code, "Gemini APIが要求を処理できませんでした。", { status, phase }); }
  function providerError(cause, timing, phase, model) { if (cause instanceof AiProviderError) return cause; if (cause?.name === "AbortError" || timing?.signal.aborted) { if (timing?.didExternalAbort()) return error("aborted", "生成を停止しました。", { phase, model }); const timeoutPhase = timing?.phase(); return timeoutPhase ? error("timeout", "Geminiからの応答がタイムアウトしました。", { phase: timeoutPhase, model }) : error("aborted", "生成を停止しました。", { phase, model }); } return error("connection", "Gemini APIへ接続できません。", { cause, phase, model }); }

  class GeminiAdapter {
    constructor(options = {}) { this.id = "gemini"; this.apiKey = String(options.apiKey || options.geminiApiKey || "").trim(); this.timeoutMs = Number(options.timeoutMs) || 60000; this.fetchImpl = options.fetchImpl || globalScope.fetch?.bind(globalScope); if (typeof this.fetchImpl !== "function") throw error("connection", "fetchを利用できません。"); }
    assertApiKey() { if (!this.apiKey) throw error("api_key_required", "Gemini APIキーが入力されていません。"); }
    headers(extra = {}) { return { "Content-Type": "application/json", "x-goog-api-key": this.apiKey, ...extra }; }
    timing(options = {}) { return createGeminiTimeouts(options.signal, { firstResponseMs: options.firstResponseMs || this.timeoutMs, idleMs: options.idleMs || this.timeoutMs, totalMs: options.totalMs || Math.max(this.timeoutMs * 3, 180000) }); }
    async listModels(options = {}) { this.assertApiKey(); const timing = this.timing(options); try { const response = await this.fetchImpl(`${GEMINI_API_BASE_URL}/models`, { method: "GET", headers: this.headers(), signal: timing.signal }); timing.markResponse(); if (!response.ok) throw await responseError(response, "model_list"); const payload = await response.json(); if (!payload || !Array.isArray(payload.models)) throw error("invalid_response", "Geminiモデル一覧の形式が不正です。", { phase: "model_list" }); return normalizeGeminiModels(payload); } catch (cause) { throw providerError(cause, timing, "model_list"); } finally { timing.cleanup(); } }
    async generateContent(request) { this.assertApiKey(); const model = modelPath(request?.model); if (!model) throw error("model_missing", "使用モデルが選択されていません。"); const timing = this.timing(request); try { const response = await this.fetchImpl(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`, { method: "POST", headers: this.headers({ Accept: "application/json" }), body: JSON.stringify(toGeminiRequest(request.messages, request.generationConfig)), signal: timing.signal }); timing.markResponse(); if (!response.ok) throw await responseError(response, "generate_content"); const payload = await response.json(); return extractGeminiText(payload); } catch (cause) { throw providerError(cause, timing, "generate_content", request.model); } finally { timing.cleanup(); } }
    async checkConnection(options = {}) { const models = await this.listModels(options); if (!options.model) return { connected: true, models, hasModels: models.length > 0, modelVerified: false }; if (!models.some((model) => model.id === options.model)) throw error("model_missing", "選択したGeminiモデルはテキスト生成に対応していません。", { phase: "model_check", model: options.model, models }); await this.generateContent({ model: options.model, messages: [{ role: "user", content: "OKとだけ答えてください" }], generationConfig: { maxOutputTokens: 8 }, signal: options.signal, firstResponseMs: options.firstResponseMs, idleMs: options.idleMs, totalMs: options.totalMs }); return { connected: true, models, hasModels: true, modelVerified: true, verifiedModelId: options.model }; }
    async *generate(request) { this.assertApiKey(); const model = modelPath(request?.model); if (!model) throw error("model_missing", "使用モデルが選択されていません。"); const timing = this.timing(request); const parser = createSseParser(); const decoder = new TextDecoder(); let reader; let done = false; let receivedText = false; let eventCount = 0; let emitted = ""; const emit = (extracted) => { let text = extracted.text; if (emitted && text.startsWith(emitted)) text = text.slice(emitted.length); if (text) emitted += text; return text; }; try { const response = await this.fetchImpl(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, { method: "POST", headers: this.headers({ Accept: "text/event-stream" }), body: JSON.stringify(toGeminiRequest(request.messages)), signal: timing.signal }); timing.markResponse(); if (!response.ok) throw await responseError(response, "stream_response"); const contentType = String(response.headers?.get?.("content-type") || "").toLowerCase(); if (contentType && !contentType.includes("text/event-stream")) throw error("stream_content_type", "Geminiのストリーム応答形式が不正です。", { phase: "stream_response", model: request.model }); if (!response.body?.getReader) throw error("invalid_response", "Geminiストリーミング応答を利用できません。", { phase: "stream_response", model: request.model }); reader = response.body.getReader(); while (!done) { const result = await reader.read(); done = result.done; if (!done) timing.markChunk(); const source = decoder.decode(result.value || new Uint8Array(), { stream: !done }); for (const event of parser.push(source)) { eventCount += 1; const extracted = extractGeminiEvent(event); const text = emit(extracted); if (text) { receivedText = true; yield { type: "text", content: text, usage: extracted.usage, finishReason: extracted.finishReason }; } } }
      for (const event of parser.push(decoder.decode())) { eventCount += 1; const extracted = extractGeminiEvent(event); const text = emit(extracted); if (text) { receivedText = true; yield { type: "text", content: text, usage: extracted.usage, finishReason: extracted.finishReason }; } }
      for (const event of parser.finish()) { eventCount += 1; const extracted = extractGeminiEvent(event); const text = emit(extracted); if (text) { receivedText = true; yield { type: "text", content: text, usage: extracted.usage, finishReason: extracted.finishReason }; } }
      if (!receivedText) throw error("empty_response", "Gemini APIから応答がありませんでした。", { phase: eventCount ? "text_extract" : "sse_receive", model: request.model }); yield { type: "done", model: request.model };
    } catch (cause) { throw providerError(cause, timing, "stream", request.model); } finally { if (reader && !done) { try { await reader.cancel(); } catch (_error) {} } timing.cleanup(); }
  }
  }
  const api = { GEMINI_API_BASE_URL, GEMINI_MODEL_CANDIDATES, GeminiAdapter, createGeminiTimeouts, createSseParser, extractGeminiEvent, extractGeminiText, groupGeminiModels, normalizeGeminiModels, toGeminiRequest, usageFrom };
  if (typeof module !== "undefined" && module.exports) module.exports = api; if (globalScope) globalScope.MemoNexusGeminiAdapter = api;
})(typeof window !== "undefined" ? window : globalThis);
