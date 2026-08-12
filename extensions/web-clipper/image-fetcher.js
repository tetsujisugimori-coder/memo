(function (root) {
  const STORED_IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
    ["image/gif", "gif"]
  ]);
  const CONVERTIBLE_IMAGE_TYPES = new Set(["image/svg+xml", "image/avif"]);

  function normalizedContentType(value) {
    return String(value || "").split(";")[0].trim().toLowerCase();
  }

  function ascii(bytes, start, length) {
    return String.fromCharCode(...bytes.subarray(start, start + length));
  }

  function sniffImageType(bytes) {
    if (!(bytes instanceof Uint8Array)) return "";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
    if (bytes.length >= 6 && /^(?:GIF87a|GIF89a)$/.test(ascii(bytes, 0, 6))) return "image/gif";
    if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
      const brands = ascii(bytes, 8, Math.min(24, bytes.length - 8));
      if (/(?:avif|avis)/.test(brands)) return "image/avif";
    }
    if (bytes.length) {
      const prefix = new TextDecoder("utf-8", { fatal: false }).decode(bytes.subarray(0, Math.min(bytes.length, 1024)))
        .replace(/^\uFEFF/, "").replace(/^\s*<\?xml[^>]*>\s*/i, "").trimStart();
      if (/^<svg(?:\s|>)/i.test(prefix)) return "image/svg+xml";
    }
    return "";
  }

  function gifDimensions(bytes) {
    if (sniffImageType(bytes) !== "image/gif" || bytes.length < 10) return null;
    const width = bytes[6] | (bytes[7] << 8);
    const height = bytes[8] | (bytes[9] << 8);
    return width > 0 && height > 0 && width <= 16384 && height <= 16384 ? { width, height } : null;
  }

  function safeFileName(candidate, extension) {
    let base = "web-clip-image";
    try {
      base = decodeURIComponent(new URL(candidate.url).pathname.split("/").pop() || base).replace(/\.[^.]+$/, "") || base;
    } catch (_) {}
    base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "web-clip-image";
    return `${base}.${extension}`;
  }

  function toBase64(bytes) {
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    return btoa(binary);
  }

  function fromBase64(value) {
    const binary = atob(String(value || ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function failed(candidate, status, errorCode, error, extra = {}) {
    return { ...candidate, ...extra, status, selected: false, dataBase64: "", errorCode, error };
  }

  async function decodeImage(bytes, mimeType, decoder) {
    if (typeof decoder === "function") return await decoder(bytes, mimeType) || {};
    if (typeof createImageBitmap !== "function") return {};
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    const dimensions = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return dimensions;
  }

  async function mapWithConcurrency(values, limit, task) {
    const source = Array.isArray(values) ? values : [];
    const results = new Array(source.length);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < source.length) {
        const index = nextIndex;
        nextIndex += 1;
        try { results[index] = await task(source[index], index); }
        catch (error) { results[index] = failed(source[index], "failed", "UNEXPECTED_ERROR", error?.message || "画像取得処理でエラーが発生しました"); }
      }
    }
    await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), source.length) }, () => worker()));
    return results;
  }

  async function fetchClipImages(candidates, options = {}) {
    const perImageLimit = Math.max(1, Number(options.perImageLimit) || 5 * 1024 * 1024);
    const totalLimit = Math.max(perImageLimit, Number(options.totalLimit) || 20 * 1024 * 1024);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
    const concurrency = Math.min(3, Math.max(1, Number(options.concurrency) || 3));
    const fetchImpl = options.fetchImpl || fetch;
    const fetchOne = async (candidate) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(candidate.url, { credentials: "include", signal: controller.signal, cache: "no-store" });
        if (!response.ok) return failed(candidate, "failed", "HTTP_ERROR", `HTTP ${response.status}で取得できません`);
        const declaredSize = Number(response.headers.get("content-length") || 0);
        if (declaredSize > perImageLimit) return failed(candidate, "too-large", "TOO_LARGE", "1画像5MBの上限を超えています", { size: declaredSize });
        const bytes = new Uint8Array(await response.arrayBuffer());
        const declaredType = normalizedContentType(response.headers.get("content-type"));
        const sniffedType = sniffImageType(bytes);
        const sourceMimeType = sniffedType || declaredType;
        if (!bytes.length) return failed(candidate, "failed", "EMPTY_RESPONSE", "空の画像です", { mimeType: sourceMimeType, size: 0 });
        if (bytes.length > perImageLimit) return failed(candidate, "too-large", "TOO_LARGE", "1画像5MBの上限を超えています", { mimeType: sourceMimeType, size: bytes.length });
        if (!STORED_IMAGE_TYPES.has(sourceMimeType) && !CONVERTIBLE_IMAGE_TYPES.has(sourceMimeType)) {
          return failed(candidate, "unsupported", sourceMimeType ? "UNSUPPORTED_FORMAT" : "MIME_UNKNOWN", sourceMimeType ? "対応していない画像形式です" : "画像のMIME形式を判定できません", { mimeType: sourceMimeType, size: bytes.length });
        }

        let storedBytes = bytes;
        let mimeType = sourceMimeType;
        let converted = false;
        let dimensions = {};
        if (sourceMimeType === "image/gif") {
          const gif = gifDimensions(bytes);
          if (!gif) return failed(candidate, "unsupported", "DECODE_FAILED", "GIF画像の構造を確認できません", { mimeType: sourceMimeType, size: bytes.length });
          try {
            const decoded = await decodeImage(bytes, sourceMimeType, options.decodeImage);
            dimensions = { width: Number(decoded?.width) || gif.width, height: Number(decoded?.height) || gif.height };
          } catch (_) {
            return failed(candidate, "unsupported", "DECODE_FAILED", "GIF画像としてデコードできません", { mimeType: sourceMimeType, size: bytes.length });
          }
        } else if (CONVERTIBLE_IMAGE_TYPES.has(sourceMimeType)) {
          if (typeof options.convertImage !== "function") {
            return failed(candidate, "unsupported", "CONVERSION_UNAVAILABLE", `${sourceMimeType === "image/avif" ? "AVIF" : "SVG"}を安全に変換できません`, { mimeType: sourceMimeType, size: bytes.length });
          }
          try {
            const conversion = await options.convertImage({ bytes, mimeType: sourceMimeType, candidate });
            storedBytes = conversion?.bytes instanceof Uint8Array ? conversion.bytes : fromBase64(conversion?.dataBase64);
            mimeType = STORED_IMAGE_TYPES.has(conversion?.mimeType) ? conversion.mimeType : "";
            dimensions = { width: Number(conversion?.width) || 0, height: Number(conversion?.height) || 0 };
            converted = true;
            if (!storedBytes.length || !mimeType) throw new Error("変換結果が不正です");
          } catch (error) {
            return failed(candidate, "unsupported", "CONVERSION_FAILED", error?.message || "画像を安全な形式へ変換できません", { mimeType: sourceMimeType, size: bytes.length });
          }
        } else {
          try { dimensions = await decodeImage(bytes, sourceMimeType, options.decodeImage); }
          catch (_) { return failed(candidate, "unsupported", "DECODE_FAILED", "画像としてデコードできません", { mimeType: sourceMimeType, size: bytes.length }); }
        }

        if (storedBytes.length > perImageLimit) return failed(candidate, "too-large", "TOO_LARGE_AFTER_CONVERSION", "変換後の画像が1画像5MBの上限を超えています", { mimeType, sourceMimeType, size: storedBytes.length });
        return {
          ...candidate,
          width: Number(dimensions?.width) || Number(candidate.width) || 0,
          height: Number(dimensions?.height) || Number(candidate.height) || 0,
          status: "ready",
          selected: true,
          errorCode: "",
          error: "",
          mimeType,
          sourceMimeType,
          converted,
          size: storedBytes.length,
          fileName: safeFileName(candidate, STORED_IMAGE_TYPES.get(mimeType)),
          dataBase64: toBase64(storedBytes)
        };
      } catch (error) {
        const timedOut = error?.name === "AbortError";
        return failed(candidate, timedOut ? "timeout" : "failed", timedOut ? "TIMEOUT" : "NETWORK_ERROR", timedOut ? "画像取得がタイムアウトしました" : "画像本体を取得できませんでした");
      } finally {
        clearTimeout(timer);
      }
    };

    const fetched = await mapWithConcurrency(candidates, concurrency, fetchOne);
    let total = 0;
    return fetched.map((image) => {
      if (image.status !== "ready") return image;
      if (total + image.size > totalLimit) return failed(image, "too-large", "TOTAL_LIMIT_EXCEEDED", "クリップ画像合計20MBの上限を超えています", { size: image.size });
      total += image.size;
      return image;
    });
  }

  const api = { SUPPORTED_IMAGE_TYPES: STORED_IMAGE_TYPES, STORED_IMAGE_TYPES, CONVERTIBLE_IMAGE_TYPES, fetchClipImages, normalizedContentType, sniffImageType, gifDimensions, mapWithConcurrency };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipImageFetcher = api;
})(globalThis);
