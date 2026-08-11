(function (root) {
  const MAX_WEB_CLIP_SELECTION_LENGTH = 100000;
  const MAX_WEB_CLIP_FRAGMENT_LENGTH = 600000;

  function clipPayloadError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
  }

  function validClip(clip) {
    return clip && typeof clip === "object"
      && typeof clip.title === "string" && Boolean(clip.title.trim())
      && /^https?:\/\//i.test(String(clip.url || ""))
      && typeof clip.host === "string" && Boolean(clip.host.trim())
      && typeof clip.selection === "string" && (clip.clipMode === "page" || clip.selection.length <= MAX_WEB_CLIP_SELECTION_LENGTH)
      && Number.isFinite(Date.parse(clip.capturedAt));
  }

  function encodeWebClipPayload(clip) {
    if (typeof clip?.selection === "string" && clip.selection.length > MAX_WEB_CLIP_SELECTION_LENGTH) {
      throw clipPayloadError("clip-too-large");
    }
    if (!validClip(clip)) throw clipPayloadError("invalid-clip");
    const bytes = new TextEncoder().encode(JSON.stringify(clip));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (payload.length > MAX_WEB_CLIP_FRAGMENT_LENGTH) throw clipPayloadError("clip-too-large");
    return payload;
  }

  function buildWebClipDestination(destination, clip, options = {}) {
    const url = new URL(destination);
    url.searchParams.set("web-clip", "1");
    url.hash = options.transfer ? "clip-transfer=1" : `clip=${encodeWebClipPayload(clip)}`;
    return url.toString();
  }

  const api = { buildWebClipDestination, encodeWebClipPayload };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusClipPayload = api;
})(globalThis);
