(function initGeminiAdapter(globalScope) {
  "use strict";

  const providerApi = typeof module !== "undefined" && module.exports
    ? require("./ai-provider")
    : globalScope.MemoNexusAiProvider;
  const { AiProviderError, normalizeModels } = providerApi;

  const GEMINI_API_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
  const GEMINI_MODEL_CANDIDATES = Object.freeze(["gemini-3.6-flash"]);

  function combinedAbortSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId = null;
    const resetTimeout = () => {
      if (timeoutId !== null) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
    };
    const abortFromExternal = () => controller.abort();
    if (externalSignal?.aborted) controller.abort();
    else externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    resetTimeout();
    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      markActivity: resetTimeout,
      cleanup() {
        if (timeoutId !== null) clearTimeout(timeoutId);
        externalSignal?.removeEventListener("abort", abortFromExternal);
      }
    };
  }

  function createSseParser() {
    let buffer = "";
    return {
      push(chunk) {
        buffer += String(chunk || "").replace(/\r\n/g, "\n");
        const events = [];
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const event = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = event.split("\n").filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart()).join("\n");
          if (!data || data === "[DONE]") continue;
          try {
            events.push(JSON.parse(data));
          } catch (cause) {
            throw new AiProviderError("invalid_response", "Geminiストリームの形式が不正です。", { cause, provider: "gemini" });
          }
        }
        return events;
      },
      finish() {
        const trailing = buffer.trim();
        buffer = "";
        if (!trailing) return [];
        return this.push(`${trailing}\n\n`);
      }
    };
  }

  function usageFrom(response) {
    const usage = response?.usageMetadata || {};
    return {
      inputTokens: Number(usage.promptTokenCount) || 0,
      outputTokens: Number(usage.candidatesTokenCount) || 0,
      totalTokens: Number(usage.totalTokenCount) || 0
    };
  }

  function extractGeminiText(response, { allowEmpty = false } = {}) {
    const candidate = Array.isArray(response?.candidates) ? response.candidates[0] : null;
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts.map((part) => typeof part?.text === "string" ? part.text : "").join("");
    if (response?.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
      throw new AiProviderError("safety_blocked", "安全性設定によりGeminiの応答が生成されませんでした。", { provider: "gemini" });
    }
    if (text || allowEmpty) return { text, usage: usageFrom(response), finishReason: candidate?.finishReason || "" };
    throw new AiProviderError("invalid_response", "Geminiからテキスト応答がありません。", { provider: "gemini" });
  }

  function toGeminiRequest(messages) {
    const system = [];
    const contents = [];
    (Array.isArray(messages) ? messages : []).forEach((message) => {
      const content = String(message?.content || "").trim();
      if (!content) return;
      if (message.role === "system") {
        system.push(content);
        return;
      }
      contents.push({ role: message.role === "assistant" ? "model" : "user", parts: [{ text: content }] });
    });
    if (!contents.some((content) => content.role === "user")) {
      throw new AiProviderError("invalid_response", "Geminiへ送信する質問がありません。", { provider: "gemini" });
    }
    const request = { contents };
    if (system.length) request.systemInstruction = { parts: [{ text: system.join("\n\n") }] };
    return request;
  }

  function normalizeGeminiModels(payload) {
    const models = Array.isArray(payload?.models) ? payload.models : [];
    return normalizeModels(models.filter((model) => {
      const methods = model?.supportedGenerationMethods || model?.supportedActions || [];
      return !Array.isArray(methods) || methods.length === 0 || methods.includes("generateContent");
    }));
  }

  async function responseError(response) {
    let code = "";
    let details = "";
    try {
      const payload = await response.json();
      code = String(payload?.error?.status || "");
      details = String(payload?.error?.message || "");
    } catch (_error) { /* response details stay private */ }
    const status = response.status;
    let mapped = "connection";
    if (status === 401 || /UNAUTHENTICATED/i.test(code)) mapped = "authentication";
    else if (status === 403 || /PERMISSION_DENIED/i.test(code)) mapped = "permission";
    else if (status === 404 || /NOT_FOUND/i.test(code)) mapped = "model_missing";
    else if (status === 429) mapped = /quota|limit exceeded/i.test(details) ? "quota_exceeded" : "rate_limit";
    else if (status >= 500) mapped = "server_error";
    return new AiProviderError(mapped, "Gemini APIが要求を処理できませんでした。", { status, provider: "gemini" });
  }

  function providerError(error, signalState) {
    if (error instanceof AiProviderError) return error;
    if (signalState?.didTimeout()) return new AiProviderError("timeout", "Geminiの応答がタイムアウトしました。", { cause: error, provider: "gemini" });
    if (error?.name === "AbortError" || signalState?.signal.aborted) return new AiProviderError("aborted", "生成を停止しました。", { cause: error, provider: "gemini" });
    return new AiProviderError("connection", "Gemini APIへ接続できません。", { cause: error, provider: "gemini" });
  }

  class GeminiAdapter {
    constructor(options = {}) {
      this.id = "gemini";
      this.apiKey = String(options.apiKey || options.geminiApiKey || "").trim();
      this.timeoutMs = Number(options.timeoutMs) || 60000;
      this.fetchImpl = options.fetchImpl || globalScope.fetch?.bind(globalScope);
      if (typeof this.fetchImpl !== "function") throw new AiProviderError("connection", "fetchを利用できません。", { provider: "gemini" });
    }

    assertApiKey() {
      if (!this.apiKey) throw new AiProviderError("api_key_required", "Gemini APIキーが入力されていません。", { provider: "gemini" });
    }

    headers() {
      return { "Content-Type": "application/json", "x-goog-api-key": this.apiKey };
    }

    async listModels(options = {}) {
      this.assertApiKey();
      const signalState = combinedAbortSignal(options.signal, options.timeoutMs || this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${GEMINI_API_BASE_URL}/models`, { method: "GET", headers: this.headers(), signal: signalState.signal });
        if (!response.ok) throw await responseError(response);
        const payload = await response.json();
        signalState.markActivity();
        if (!payload || !Array.isArray(payload.models)) throw new AiProviderError("invalid_response", "Geminiモデル一覧の形式が不正です。", { provider: "gemini" });
        return normalizeGeminiModels(payload);
      } catch (error) {
        throw providerError(error, signalState);
      } finally {
        signalState.cleanup();
      }
    }

    async checkConnection(options = {}) {
      const models = await this.listModels(options);
      return { connected: true, models, hasModels: models.length > 0 };
    }

    async *generate(request) {
      this.assertApiKey();
      if (!request?.model) throw new AiProviderError("model_missing", "使用モデルが選択されていません。", { provider: "gemini" });
      const signalState = combinedAbortSignal(request.signal, request.timeoutMs || this.timeoutMs);
      const parser = createSseParser();
      const decoder = new TextDecoder();
      let reader = null;
      let readerDone = false;
      let emitted = "";
      let receivedText = false;
      try {
        const model = String(request.model).replace(/^models\//, "");
        const response = await this.fetchImpl(`${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(toGeminiRequest(request.messages)),
          signal: signalState.signal
        });
        if (!response.ok) throw await responseError(response);
        if (!response.body || typeof response.body.getReader !== "function") throw new AiProviderError("invalid_response", "Geminiストリーミング応答を利用できません。", { provider: "gemini" });
        reader = response.body.getReader();
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          if (!done) signalState.markActivity();
          else readerDone = true;
          for (const event of parser.push(decoder.decode(result.value || new Uint8Array(), { stream: !done }))) {
            const extracted = extractGeminiText(event, { allowEmpty: true });
            let delta = extracted.text;
            if (delta && emitted && delta.startsWith(emitted)) delta = delta.slice(emitted.length);
            if (delta) {
              receivedText = true;
              emitted += delta;
              yield { type: "text", content: delta, usage: extracted.usage };
            }
          }
        }
        for (const event of parser.finish()) {
          const extracted = extractGeminiText(event, { allowEmpty: true });
          let delta = extracted.text;
          if (delta && emitted && delta.startsWith(emitted)) delta = delta.slice(emitted.length);
          if (delta) {
            receivedText = true;
            emitted += delta;
            yield { type: "text", content: delta, usage: extracted.usage };
          }
        }
        if (!receivedText) throw new AiProviderError("invalid_response", "Geminiからテキスト応答がありません。", { provider: "gemini" });
        yield { type: "done", model: request.model };
      } catch (error) {
        throw providerError(error, signalState);
      } finally {
        if (reader && !readerDone) {
          try { await reader.cancel(); } catch (_error) { /* cleanup best effort */ }
        }
        signalState.cleanup();
      }
    }
  }

  const api = { GEMINI_API_BASE_URL, GEMINI_MODEL_CANDIDATES, GeminiAdapter, createSseParser, extractGeminiText, normalizeGeminiModels, toGeminiRequest, usageFrom };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusGeminiAdapter = api;
})(typeof window !== "undefined" ? window : globalThis);
