(function () {
  function fromBase64(value) {
    const binary = atob(String(value || ""));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function toBase64(blob) {
    return blob.arrayBuffer().then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
      return btoa(binary);
    });
  }

  function sanitizeSvg(bytes) {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    if (document.querySelector("parsererror") || document.documentElement?.localName !== "svg") throw new Error("SVGの構造を確認できません");
    document.querySelectorAll("script,foreignObject,iframe,object,embed,audio,video,style,animate,animateMotion,animateTransform,set,mpath").forEach((node) => node.remove());
    document.querySelectorAll("*").forEach((node) => {
      [...node.attributes].forEach((attribute) => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim();
        if (name.startsWith("on") || /(?:javascript:|@import|url\s*\()/i.test(value)) node.removeAttribute(attribute.name);
        if ((name === "href" || name === "xlink:href") && value && !value.startsWith("#")) node.removeAttribute(attribute.name);
      });
    });
    return new XMLSerializer().serializeToString(document.documentElement);
  }

  function loadImage(blob) {
    return new Promise((resolve, reject) => {
      const objectUrl = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(objectUrl); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("画像としてデコードできません")); };
      image.src = objectUrl;
    });
  }

  async function canvasBlob(canvas) {
    const webp = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
    if (webp?.type === "image/webp") return webp;
    const png = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("画像の変換結果を生成できません");
    return png;
  }

  async function convert(message) {
    const bytes = fromBase64(message.dataBase64);
    let sourceBlob;
    if (message.mimeType === "image/svg+xml") sourceBlob = new Blob([sanitizeSvg(bytes)], { type: "image/svg+xml" });
    else if (message.mimeType === "image/avif") sourceBlob = new Blob([bytes], { type: "image/avif" });
    else throw new Error("変換対象外の画像形式です");
    const image = await loadImage(sourceBlob);
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    if (!naturalWidth || !naturalHeight) throw new Error("画像サイズを確認できません");
    const maximumSide = 4096;
    const scale = Math.min(1, maximumSide / Math.max(naturalWidth, naturalHeight), Math.sqrt(16_000_000 / (naturalWidth * naturalHeight)));
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: true });
    if (!context) throw new Error("画像変換用Canvasを作成できません");
    context.drawImage(image, 0, 0, width, height);
    const blob = await canvasBlob(canvas);
    return { mimeType: blob.type, size: blob.size, width, height, dataBase64: await toBase64(blob) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "memo-nexus-convert-clip-image") return undefined;
    convert(message)
      .then((result) => sendResponse({ ok: true, requestId: message.requestId, ...result }))
      .catch((error) => sendResponse({ ok: false, requestId: message.requestId, errorCode: "CONVERSION_FAILED", error: error?.message || "画像を変換できません" }));
    return true;
  });
})();
