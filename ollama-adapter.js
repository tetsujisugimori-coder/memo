(function initOllamaAdapter(globalScope) {
  "use strict";

  const providerApi = typeof module !== "undefined" && module.exports
    ? require("./ai-provider")
    : globalScope.MemoNexusAiProvider;
  const { AiProviderError, createNdjsonParser, normalizeBaseUrl, normalizeModels } = providerApi;

  function combinedAbortSignal(externalSignal, timeoutMs) {
    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const abortFromExternal = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) controller.abort();
      else externalSignal.addEventListener("abort", abortFromExternal, { once: true });
    }
    return {
      signal: controller.signal,
      didTimeout: () => timedOut,
      cleanup() {
        clearTimeout(timeoutId);
        externalSignal?.removeEventListener("abort", abortFromExternal);
      }
    };
  }

  function providerError(error, signalState) {
    if (error instanceof AiProviderError) return error;
    if (signalState?.didTimeout()) return new AiProviderError("timeout", "Ollamaの応答がタイムアウトしました。", { cause: error });
    if (error?.name === "AbortError" || signalState?.signal.aborted) return new AiProviderError("aborted", "生成を停止しました。", { cause: error });
    return new AiProviderError("connection", "Ollamaへ接続できません。", { cause: error });
  }

  async function responseError(response) {
    let details = "";
    try {
      const payload = await response.json();
      details = String(payload?.error || "");
    } catch (_error) {
      details = "";
    }
    const missing = response.status === 404 || /model.*not found|pull model/i.test(details);
    return new AiProviderError(missing ? "model_missing" : "provider", "Ollamaが生成要求を処理できませんでした。", {
      status: response.status
    });
  }

  class OllamaAdapter {
    constructor(options = {}) {
      this.id = "ollama";
      this.baseUrl = normalizeBaseUrl(options.baseUrl);
      this.timeoutMs = Number(options.timeoutMs) || 60000;
      this.fetchImpl = options.fetchImpl || globalScope.fetch?.bind(globalScope);
      if (typeof this.fetchImpl !== "function") throw new AiProviderError("connection", "fetchを利用できません。");
    }

    async listModels(options = {}) {
      const signalState = combinedAbortSignal(options.signal, options.timeoutMs || this.timeoutMs);
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, { method: "GET", signal: signalState.signal });
        if (!response.ok) throw await responseError(response);
        const payload = await response.json();
        if (!payload || !Array.isArray(payload.models)) throw new AiProviderError("invalid_response", "モデル一覧の形式が不正です。");
        return normalizeModels(payload.models);
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
      if (!request?.model) throw new AiProviderError("model_missing", "使用モデルが選択されていません。");
      const signalState = combinedAbortSignal(request.signal, request.timeoutMs || this.timeoutMs);
      const parser = createNdjsonParser();
      const decoder = new TextDecoder();
      try {
        const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: request.model,
            stream: true,
            messages: request.messages,
            options: request.options || {}
          }),
          signal: signalState.signal
        });
        if (!response.ok) throw await responseError(response);
        if (!response.body || typeof response.body.getReader !== "function") {
          throw new AiProviderError("invalid_response", "ストリーミング応答を利用できません。");
        }
        const reader = response.body.getReader();
        let done = false;
        while (!done) {
          const result = await reader.read();
          done = result.done;
          const events = parser.push(decoder.decode(result.value || new Uint8Array(), { stream: !done }));
          for (const event of events) {
            if (event.error) throw new AiProviderError(/model.*not found/i.test(event.error) ? "model_missing" : "provider", "Ollamaがエラーを返しました。");
            const content = String(event.message?.content || event.response || "");
            if (content) yield { type: "text", content };
            if (event.done) yield { type: "done", model: String(event.model || request.model) };
          }
        }
        for (const event of parser.finish()) {
          if (event.error) throw new AiProviderError("provider", "Ollamaがエラーを返しました。");
          const content = String(event.message?.content || event.response || "");
          if (content) yield { type: "text", content };
          if (event.done) yield { type: "done", model: String(event.model || request.model) };
        }
      } catch (error) {
        throw providerError(error, signalState);
      } finally {
        signalState.cleanup();
      }
    }
  }

  const api = { OllamaAdapter, combinedAbortSignal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusOllamaAdapter = api;
})(typeof window !== "undefined" ? window : globalThis);
