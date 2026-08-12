(function (root) {
  const SUPPORTED_IMAGE_TYPES = new Map([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"]
  ]);

  function normalizedContentType(value) {
    return String(value || "").split(";")[0].trim().toLowerCase();
  }

  function sniffImageType(bytes) {
    if (!(bytes instanceof Uint8Array)) return "";
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
    if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp";
    if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(4, 8)) === "ftyp" && /^(?:avif|avis)$/.test(String.fromCharCode(...bytes.subarray(8, 12)))) return "image/avif";
    return "";
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
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  }

  async function decodeImage(bytes, mimeType, decoder) {
    if (typeof decoder === "function") return decoder(bytes, mimeType);
    if (typeof createImageBitmap !== "function") return;
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mimeType }));
    bitmap.close?.();
  }

  async function fetchClipImages(candidates, options = {}) {
    const perImageLimit = Math.max(1, Number(options.perImageLimit) || 5 * 1024 * 1024);
    const totalLimit = Math.max(perImageLimit, Number(options.totalLimit) || 20 * 1024 * 1024);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
    const fetchImpl = options.fetchImpl || fetch;
    const fetchOne = async (candidate) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(candidate.url, { credentials: "include", signal: controller.signal });
        if (!response.ok) return { ...candidate, status: "failed", selected: false, error: `HTTP ${response.status}で取得できません` };
        const declaredSize = Number(response.headers.get("content-length") || 0);
        if (declaredSize > perImageLimit) return { ...candidate, status: "too-large", selected: false, size: declaredSize, error: "1画像5MBの上限を超えています" };
        const bytes = new Uint8Array(await response.arrayBuffer());
        const declaredType = normalizedContentType(response.headers.get("content-type"));
        const sniffedType = sniffImageType(bytes);
        const mimeType = SUPPORTED_IMAGE_TYPES.has(declaredType) ? declaredType : sniffedType || declaredType;
        if (!bytes.length) return { ...candidate, status: "failed", selected: false, mimeType, size: 0, error: "空の画像です" };
        if (bytes.length > perImageLimit) return { ...candidate, status: "too-large", selected: false, mimeType, size: bytes.length, error: "1画像5MBの上限を超えています" };
        if (!SUPPORTED_IMAGE_TYPES.has(mimeType)) {
          const error = mimeType === "image/avif" ? "AVIFは現在の画像ブロックで未対応です" : "JPEG、PNG、WebP以外の形式です";
          return { ...candidate, status: "unsupported", selected: false, mimeType, size: bytes.length, error };
        }
        try {
          await decodeImage(bytes, mimeType, options.decodeImage);
        } catch (_) {
          return { ...candidate, status: "unsupported", selected: false, mimeType, size: bytes.length, error: "画像としてデコードできません" };
        }
        return {
          ...candidate,
          status: "ready",
          selected: true,
          error: "",
          mimeType,
          size: bytes.length,
          fileName: safeFileName(candidate, SUPPORTED_IMAGE_TYPES.get(mimeType)),
          dataBase64: toBase64(bytes)
        };
      } catch (error) {
        const timedOut = error?.name === "AbortError";
        return {
          ...candidate,
          status: timedOut ? "timeout" : "failed",
          selected: false,
          error: timedOut ? "画像取得がタイムアウトしました" : "画像本体を取得できませんでした"
        };
      } finally {
        clearTimeout(timer);
      }
    };

    const settled = await Promise.allSettled((Array.isArray(candidates) ? candidates : []).map(fetchOne));
    const fetched = settled.map((result, index) => result.status === "fulfilled"
      ? result.value
      : { ...(candidates[index] || {}), status: "failed", selected: false, error: "画像取得処理でエラーが発生しました" });
    let total = 0;
    return fetched.map((image) => {
      if (image.status !== "ready") return image;
      if (total + image.size > totalLimit) {
        return { ...image, status: "too-large", selected: false, dataBase64: "", error: "クリップ画像合計20MBの上限を超えています" };
      }
      total += image.size;
      return image;
    });
  }

  const api = { SUPPORTED_IMAGE_TYPES, fetchClipImages, normalizedContentType, sniffImageType };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipImageFetcher = api;
})(globalThis);
