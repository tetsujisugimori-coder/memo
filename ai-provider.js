(function initAiProvider(globalScope) {
  "use strict";

  const AI_SETTINGS_STORAGE_KEY = "memo-nexus-local-ai-settings";
  const DEFAULT_AI_SETTINGS = Object.freeze({
    enabled: false,
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    selectedModel: "",
    geminiApiKey: "",
    timeoutMs: 60000,
    systemInstruction: "あなたは利用者の質問や文章作成を支援するアシスタントです。参照コンテキストがある場合だけ、その内容を資料として使用してください。"
  });

  const AI_CONNECTION_STATES = Object.freeze({
    UNCHECKED: "unchecked",
    CHECKING: "checking",
    CONNECTED: "connected",
    UNAVAILABLE: "unavailable",
    NO_MODELS: "no-models",
    ERROR: "error"
  });

  const AI_GENERATION_STATES = Object.freeze({
    DISABLED: "disabled",
    DISCONNECTED: "disconnected",
    MODEL_REQUIRED: "model-required",
    IDLE: "idle",
    STREAMING: "streaming",
    STOPPED: "stopped",
    COMPLETED: "completed",
    ERROR: "error"
  });

  class AiProviderError extends Error {
    constructor(code, message, options = {}) {
      super(message);
      this.name = "AiProviderError";
      this.code = code;
      this.status = options.status || null;
      this.provider = options.provider || null;
      this.cause = options.cause;
    }
  }

  function normalizeBaseUrl(value) {
    const fallback = DEFAULT_AI_SETTINGS.baseUrl;
    const source = String(value || fallback).trim().replace(/\/+$/, "");
    try {
      const parsed = new URL(source);
      if (!/^https?:$/.test(parsed.protocol)) return fallback;
      return parsed.href.replace(/\/+$/, "");
    } catch (_error) {
      return fallback;
    }
  }

  function normalizeAiSettings(value) {
    const source = value && typeof value === "object" ? value : {};
    const timeout = Number(source.timeoutMs);
    const provider = source.provider === "gemini" ? "gemini" : "ollama";
    const sourceProviders = source.providers && typeof source.providers === "object" ? source.providers : {};
    const ollamaSource = sourceProviders.ollama && typeof sourceProviders.ollama === "object" ? sourceProviders.ollama : {};
    const geminiSource = sourceProviders.gemini && typeof sourceProviders.gemini === "object" ? sourceProviders.gemini : {};
    const legacySelectedModel = String(source.selectedModel || "").trim().slice(0, 200);
    const providerModel = (settings, fallback) => Object.prototype.hasOwnProperty.call(settings, "selectedModel")
      ? settings.selectedModel
      : fallback;
    const ollama = {
      baseUrl: normalizeBaseUrl(ollamaSource.baseUrl || source.baseUrl),
      selectedModel: String(providerModel(ollamaSource, provider === "ollama" ? legacySelectedModel : "")).trim().slice(0, 200)
    };
    const gemini = {
      apiKey: String(geminiSource.apiKey ?? source.geminiApiKey ?? "").trim().slice(0, 500),
      selectedModel: String(providerModel(geminiSource, provider === "gemini" ? legacySelectedModel : "")).trim().slice(0, 200)
    };
    const active = provider === "gemini" ? gemini : ollama;
    return {
      enabled: source.enabled === true,
      provider,
      baseUrl: ollama.baseUrl,
      selectedModel: active.selectedModel,
      geminiApiKey: gemini.apiKey,
      providers: { ollama, gemini },
      timeoutMs: Number.isFinite(timeout) ? Math.min(300000, Math.max(5000, Math.round(timeout))) : DEFAULT_AI_SETTINGS.timeoutMs,
      systemInstruction: String(source.systemInstruction || DEFAULT_AI_SETTINGS.systemInstruction).trim().slice(0, 4000)
        || DEFAULT_AI_SETTINGS.systemInstruction
    };
  }

  function withAiProviderSettings(value, provider, patch = {}) {
    const settings = normalizeAiSettings(value);
    const nextProvider = provider === "gemini" ? "gemini" : "ollama";
    const providers = {
      ollama: { ...settings.providers.ollama },
      gemini: { ...settings.providers.gemini }
    };
    if (nextProvider === "ollama") {
      if (patch.baseUrl !== undefined) providers.ollama.baseUrl = patch.baseUrl;
      if (patch.selectedModel !== undefined) providers.ollama.selectedModel = patch.selectedModel;
    } else {
      if (patch.apiKey !== undefined) providers.gemini.apiKey = patch.apiKey;
      if (patch.selectedModel !== undefined) providers.gemini.selectedModel = patch.selectedModel;
    }
    return normalizeAiSettings({ ...settings, provider: nextProvider, providers });
  }

  function isLoopbackBaseUrl(value) {
    try {
      const hostname = new URL(normalizeBaseUrl(value)).hostname.toLowerCase();
      return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    } catch (_error) {
      return false;
    }
  }

  function classifyModelFamily(modelId) {
    const normalized = String(modelId || "").toLowerCase();
    if (normalized.includes("qwen")) return { id: "qwen", label: "Qwen", verified: true };
    if (normalized.includes("phi")) return { id: "phi", label: "Phi", verified: true };
    if (normalized.includes("granite")) return { id: "granite", label: "Granite", verified: true };
    return { id: "other", label: "その他", verified: false };
  }

  function normalizeModel(model) {
    const id = String(model?.name || model?.model || model?.id || "").trim();
    if (!id) return null;
    const family = classifyModelFamily(id);
    return {
      id,
      name: id,
      displayName: id,
      family: family.id,
      familyLabel: family.label,
      verified: family.verified,
      size: Number(model?.size) || null,
      modifiedAt: String(model?.modified_at || model?.modifiedAt || "")
    };
  }

  function normalizeModels(models) {
    if (!Array.isArray(models)) return [];
    const unique = new Map();
    models.forEach((model) => {
      const normalized = normalizeModel(model);
      if (normalized && !unique.has(normalized.id)) unique.set(normalized.id, normalized);
    });
    return [...unique.values()].sort((first, second) => {
      if (first.verified !== second.verified) return first.verified ? -1 : 1;
      return first.displayName.localeCompare(second.displayName, "ja");
    });
  }

  function groupModels(models) {
    const normalized = normalizeModels(models);
    return {
      verified: normalized.filter((model) => model.verified),
      other: normalized.filter((model) => !model.verified)
    };
  }

  function createNdjsonParser() {
    let buffer = "";

    function parseLine(line) {
      const value = line.trim();
      if (!value) return null;
      try {
        return JSON.parse(value);
      } catch (error) {
        throw new AiProviderError("invalid_response", "AIからの応答を読み取れませんでした。", { cause: error });
      }
    }

    return {
      push(chunk) {
        buffer += String(chunk || "");
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        return lines.map(parseLine).filter(Boolean);
      },
      finish() {
        const event = parseLine(buffer);
        buffer = "";
        return event ? [event] : [];
      }
    };
  }

  function friendlyAiError(error) {
    const code = error?.code;
    if (error?.provider === "gemini") {
      if (code === "api_key_required") return "Gemini APIキーが入力されていません。";
      if (code === "authentication") return "Gemini APIキーを確認してください。";
      if (code === "permission") return "このAPIキーではGemini APIを利用できません。";
      if (code === "model_missing") return "選択したGeminiモデルを利用できません。";
      if (code === "rate_limit") return "Gemini APIの利用回数制限に達しました。";
      if (code === "quota_exceeded") return "Gemini APIの割り当て上限に達しました。";
      if (code === "timeout") return "Geminiからの応答がタイムアウトしました。";
      if (code === "aborted") return "生成を停止しました。";
      if (code === "safety_blocked") return "安全性設定によりGeminiの応答が生成されませんでした。";
      if (code === "invalid_response") return "Geminiからの応答を読み取れませんでした。";
      if (code === "server_error") return "Gemini APIで一時的なエラーが発生しました。";
      return "Gemini APIへ接続できません。接続状態を確認してください。";
    }
    if (code === "connection") return "Ollamaに接続できません。Ollamaが起動しているか確認してください。";
    if (code === "no_models") return "利用できるモデルがありません。OllamaへQwen、Phi、Graniteなどのモデルを追加してください。";
    if (code === "model_missing") return "選択していたモデルが見つかりません。モデル一覧を更新し、別のモデルを選択してください。";
    if (code === "timeout") return "AIからの応答に時間がかかっています。モデルの状態やPC負荷を確認してください。";
    if (code === "aborted") return "生成を停止しました。";
    if (code === "invalid_response") return "AIからの応答を読み取れませんでした。Ollamaの状態を確認してください。";
    return "AI処理でエラーが発生しました。Ollamaとモデルの状態を確認してください。";
  }

  function resolveSavedAiState({ draftSettings, modelsEndpoint, draftConnection, models } = {}) {
    const settings = normalizeAiSettings(draftSettings);
    const verifiedModels = normalizeModels(models);
    const endpointVerified = settings.provider === "gemini"
      ? String(modelsEndpoint || "") === "gemini"
      : String(modelsEndpoint || "") === settings.baseUrl;
    const connectionVerified = draftConnection === AI_CONNECTION_STATES.CONNECTED;
    const hasModels = verifiedModels.length > 0;
    const selectedModelVerified = Boolean(settings.selectedModel)
      && verifiedModels.some((model) => model.id === settings.selectedModel);
    const preserveModels = settings.enabled && endpointVerified && connectionVerified && hasModels;
    if (!settings.enabled) {
      return { preserveModels: false, connection: AI_CONNECTION_STATES.UNCHECKED, generation: AI_GENERATION_STATES.DISABLED };
    }
    if (!preserveModels) {
      return { preserveModels: false, connection: AI_CONNECTION_STATES.UNCHECKED, generation: AI_GENERATION_STATES.DISCONNECTED };
    }
    return {
      preserveModels: true,
      connection: AI_CONNECTION_STATES.CONNECTED,
      generation: selectedModelVerified ? AI_GENERATION_STATES.IDLE : AI_GENERATION_STATES.MODEL_REQUIRED
    };
  }

  const api = {
    AI_CONNECTION_STATES,
    AI_GENERATION_STATES,
    AI_SETTINGS_STORAGE_KEY,
    AiProviderError,
    DEFAULT_AI_SETTINGS,
    classifyModelFamily,
    createNdjsonParser,
    friendlyAiError,
    groupModels,
    isLoopbackBaseUrl,
    normalizeAiSettings,
    normalizeBaseUrl,
    normalizeModel,
    normalizeModels,
    resolveSavedAiState,
    withAiProviderSettings
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAiProvider = api;
})(typeof window !== "undefined" ? window : globalThis);
