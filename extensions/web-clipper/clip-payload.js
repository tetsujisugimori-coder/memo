(function (root) {
  const MAX_WEB_CLIP_SELECTION_LENGTH = 100000;
  const MAX_WEB_CLIP_FRAGMENT_LENGTH = 600000;

  function validClip(clip) {
    return clip && typeof clip === "object"
      && typeof clip.title === "string" && Boolean(clip.title.trim())
      && /^https?:\/\//i.test(String(clip.url || ""))
      && typeof clip.host === "string" && Boolean(clip.host.trim())
      && typeof clip.selection === "string" && clip.selection.length <= MAX_WEB_CLIP_SELECTION_LENGTH
      && Number.isFinite(Date.parse(clip.capturedAt));
  }

  function encodeWebClipPayload(clip) {
    if (!validClip(clip)) throw new Error("invalid clip");
    const bytes = new TextEncoder().encode(JSON.stringify(clip));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const payload = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    if (payload.length > MAX_WEB_CLIP_FRAGMENT_LENGTH) throw new Error("clip too large");
    return payload;
  }

  function buildWebClipDestination(destination, clip) {
    const url = new URL(destination);
    url.searchParams.set("web-clip", "1");
    url.hash = `clip=${encodeWebClipPayload(clip)}`;
    return url.toString();
  }

  root.MemoNexusClipPayload = { buildWebClipDestination };
})(globalThis);
