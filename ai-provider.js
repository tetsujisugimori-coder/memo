(function initAiProvider(globalScope) {
  "use strict";

  const AI_SETTINGS_STORAGE_KEY = "memo-nexus-local-ai-settings";
  const DEFAULT_AI_SETTINGS = Object.freeze({
    enabled: false,
    provider: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    selectedModel: "",
    timeoutMs: 60000,
    systemInstruction: "あなたはメモ整理を支援するアシスタントです。対象メモにない事実を断定せず、生成結果だけを返してください。"
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
    return {
      enabled: source.enabled === true,
      provider: "ollama",
      baseUrl: normalizeBaseUrl(source.baseUrl),
      selectedModel: String(source.selectedModel || "").trim().slice(0, 200),
      timeoutMs: Number.isFinite(timeout) ? Math.min(300000, Math.max(5000, Math.round(timeout))) : DEFAULT_AI_SETTINGS.timeoutMs,
      systemInstruction: String(source.systemInstruction || DEFAULT_AI_SETTINGS.systemInstruction).trim().slice(0, 4000)
        || DEFAULT_AI_SETTINGS.systemInstruction
    };
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
    if (code === "connection") return "Ollamaに接続できません。Ollamaが起動しているか確認してください。";
    if (code === "no_models") return "利用できるモデルがありません。OllamaへQwen、Phi、Graniteなどのモデルを追加してください。";
    if (code === "model_missing") return "選択していたモデルが見つかりません。モデル一覧を更新し、別のモデルを選択してください。";
    if (code === "timeout") return "AIからの応答に時間がかかっています。モデルの状態やPC負荷を確認してください。";
    if (code === "aborted") return "生成を停止しました。";
    if (code === "invalid_response") return "AIからの応答を読み取れませんでした。Ollamaの状態を確認してください。";
    return "AI処理でエラーが発生しました。Ollamaとモデルの状態を確認してください。";
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
    normalizeModels
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAiProvider = api;
})(typeof window !== "undefined" ? window : globalThis);
