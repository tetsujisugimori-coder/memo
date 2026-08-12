(function (root) {
  async function fetchClipImages(candidates, options = {}) {
    const perImageLimit = Math.max(1, Number(options.perImageLimit) || 5 * 1024 * 1024);
    const totalLimit = Math.max(perImageLimit, Number(options.totalLimit) || 20 * 1024 * 1024);
    const timeoutMs = Math.max(1000, Number(options.timeoutMs) || 15000);
    const supported = new Map([
      ["image/jpeg", "jpg"],
      ["image/png", "png"],
      ["image/webp", "webp"]
    ]);
    const toBase64 = async (blob) => {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    };
    const safeFileName = (candidate, extension) => {
      let base = "web-clip-image";
      try {
        base = decodeURIComponent(new URL(candidate.url).pathname.split("/").pop() || base).replace(/\.[^.]+$/, "") || base;
      } catch (_) {}
      base = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").slice(0, 100) || "web-clip-image";
      return `${base}.${extension}`;
    };
    const fetchOne = async (candidate) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetch(candidate.url, { credentials: "include", signal: controller.signal });
        if (!response.ok) return { ...candidate, status: "failed", error: `HTTP ${response.status}で取得できません` };
        const declaredSize = Number(response.headers.get("content-length") || 0);
        if (declaredSize > perImageLimit) return { ...candidate, status: "too-large", size: declaredSize, error: "1画像5MBの上限を超えています" };
        const blob = await response.blob();
        const mimeType = String(blob.type || response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
        if (!supported.has(mimeType)) return { ...candidate, status: "unsupported", mimeType, size: blob.size, error: "JPEG、PNG、WebP以外の形式です" };
        if (!blob.size) return { ...candidate, status: "failed", mimeType, size: 0, error: "空の画像です" };
        if (blob.size > perImageLimit) return { ...candidate, status: "too-large", mimeType, size: blob.size, error: "1画像5MBの上限を超えています" };
        return {
          ...candidate,
          status: "ready",
          mimeType,
          size: blob.size,
          fileName: safeFileName(candidate, supported.get(mimeType)),
          dataBase64: await toBase64(blob)
        };
      } catch (error) {
        return {
          ...candidate,
          status: "failed",
          error: error?.name === "AbortError"
            ? "画像取得がタイムアウトしました"
            : "認証、期限付きURL、またはCORS制限により取得できません"
        };
      } finally {
        clearTimeout(timer);
      }
    };
    const fetched = await Promise.all((Array.isArray(candidates) ? candidates : []).map(fetchOne));
    let total = 0;
    return fetched.map((image) => {
      if (image.status !== "ready") return image;
      if (total + image.size > totalLimit) {
        return { ...image, status: "too-large", dataBase64: "", error: "クリップ画像合計20MBの上限を超えています" };
      }
      total += image.size;
      return image;
    });
  }

  const api = { fetchClipImages };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipImageFetcher = api;
})(globalThis);
