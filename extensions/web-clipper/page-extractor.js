(function (root) {
  function extractPageContent(document = globalThis.document) {
    const exclude = "script,style,nav,header,footer,aside,noscript,form,[role=banner],[role=navigation],[role=contentinfo],.advertisement,.ads,.sidebar,.related";
    const score = (node) => (node.innerText || "").trim().length - node.querySelectorAll("a").length * 40;
    const noisyImagePattern = /(?:^|[^a-z0-9])(ad|ads|advert|avatar|badge|banner|brand|emoji|icon|logo|pixel|profile|share|social|spacer|sprite|tracking)(?:[^a-z0-9]|$)/i;
    const absoluteHttpUrl = (value) => {
      try {
        const url = new URL(String(value || "").trim(), document.baseURI);
        return /^https?:$/.test(url.protocol) ? url.href : "";
      } catch (_) {
        return "";
      }
    };
    const srcsetUrl = (value) => String(value || "").split(",").map((part) => {
      const match = part.trim().match(/^(\S+)(?:\s+([0-9.]+)(w|x))?$/);
      if (!match) return null;
      const weight = match[3] === "w" ? Number(match[2]) : match[3] === "x" ? Number(match[2]) * 10000 : 1;
      return { url: absoluteHttpUrl(match[1]), weight };
    }).filter((item) => item?.url).sort((a, b) => b.weight - a.weight)[0]?.url || "";
    const imageUrl = (image, original = image) => {
      const direct = [
        original?.currentSrc,
        image.getAttribute("data-src"),
        image.getAttribute("data-lazy-src"),
        image.getAttribute("data-original"),
        image.getAttribute("data-url")
      ].map(absoluteHttpUrl).find(Boolean);
      return direct || srcsetUrl(image.getAttribute("data-srcset") || image.getAttribute("srcset")) || absoluteHttpUrl(image.getAttribute("src"));
    };
    const imageCaption = (image) => {
      const figureCaption = image.closest("figure")?.querySelector("figcaption")?.textContent;
      const nearbyCaption = image.parentElement?.querySelector(":scope > .caption, :scope > [class*=caption]")?.textContent;
      return String(figureCaption || nearbyCaption || image.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 500);
    };
    const isMeaningfulImage = (image, original, url) => {
      if (!url) return false;
      const width = Number(original?.naturalWidth || image.getAttribute("width") || 0);
      const height = Number(original?.naturalHeight || image.getAttribute("height") || 0);
      if ((width && width <= 2) || (height && height <= 2)) return false;
      if (width && height && width * height < 12000) return false;
      const context = [image.className, image.id, image.getAttribute("alt"), url, image.closest("[class],[id]")?.className, image.closest("[class],[id]")?.id].join(" ");
      if (noisyImagePattern.test(context)) return false;
      if ((image.getAttribute("role") === "presentation" || image.getAttribute("aria-hidden") === "true") && !String(image.getAttribute("alt") || "").trim()) return false;
      return true;
    };
    if (!document?.body) return { html: "", images: [], omittedImageCount: 0 };
    const candidates = [document.querySelector("article"), document.querySelector("main"), document.querySelector('[role="main"]')].filter(Boolean);
    if (!candidates.length) candidates.push(...[...document.querySelectorAll("section,div")].filter((node) => score(node) > 400));
    const source = candidates.sort((a, b) => score(b) - score(a))[0] || document.body;
    if (!source || !(source.innerText || "").trim()) return { html: "", images: [], omittedImageCount: 0 };
    const sourceImages = [...source.querySelectorAll("img")];
    const copy = source.cloneNode(true);
    const cloneImages = [...copy.querySelectorAll("img")];
    const originals = new Map(cloneImages.map((image, index) => [image, sourceImages[index]]));
    copy.querySelectorAll(exclude).forEach((node) => node.remove());
    const images = [];
    [...copy.querySelectorAll("img")].forEach((image) => {
      const original = originals.get(image) || image;
      const url = imageUrl(image, original);
      if (!isMeaningfulImage(image, original, url)) {
        image.remove();
        return;
      }
      const token = `web-clip-image-${images.length + 1}`;
      image.setAttribute("data-memo-nexus-clip-image", token);
      const caption = imageCaption(image);
      images.push({
        token,
        url,
        alt: String(image.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 500),
        caption,
        width: Number(original.naturalWidth || image.getAttribute("width") || 0),
        height: Number(original.naturalHeight || image.getAttribute("height") || 0)
      });
      image.closest("figure")?.querySelector("figcaption")?.remove();
    });
    if (!(copy.innerText || "").trim() && !images.length) return { html: "", images: [], omittedImageCount: 0 };
    const maximum = 20;
    images.slice(maximum).forEach((candidate) => copy.querySelector(`[data-memo-nexus-clip-image="${candidate.token}"]`)?.remove());
    return { html: copy.innerHTML, images: images.slice(0, maximum), omittedImageCount: Math.max(0, images.length - maximum) };
  }

  function extractSelectionContent(document = globalThis.document) {
    const selection = document?.defaultView?.getSelection?.();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return { html: "", images: [], omittedImageCount: 0 };
    const wrapper = document.createElement("div");
    wrapper.append(selection.getRangeAt(0).cloneContents());
    const noisyImagePattern = /(?:^|[^a-z0-9])(ad|ads|advert|avatar|badge|banner|brand|emoji|icon|logo|pixel|profile|share|social|spacer|sprite|tracking)(?:[^a-z0-9]|$)/i;
    const absoluteHttpUrl = (value) => {
      try {
        const url = new URL(String(value || "").trim(), document.baseURI);
        return /^https?:$/.test(url.protocol) ? url.href : "";
      } catch (_) {
        return "";
      }
    };
    const srcsetUrl = (value) => String(value || "").split(",").map((part) => {
      const match = part.trim().match(/^(\S+)(?:\s+([0-9.]+)(w|x))?$/);
      if (!match) return null;
      const weight = match[3] === "w" ? Number(match[2]) : match[3] === "x" ? Number(match[2]) * 10000 : 1;
      return { url: absoluteHttpUrl(match[1]), weight };
    }).filter((item) => item?.url).sort((a, b) => b.weight - a.weight)[0]?.url || "";
    const images = [];
    [...wrapper.querySelectorAll("img")].forEach((image) => {
      const url = [image.getAttribute("data-src"), image.getAttribute("data-lazy-src"), image.getAttribute("data-original")]
        .map(absoluteHttpUrl).find(Boolean) || srcsetUrl(image.getAttribute("data-srcset") || image.getAttribute("srcset")) || absoluteHttpUrl(image.getAttribute("src"));
      const width = Number(image.getAttribute("width") || 0);
      const height = Number(image.getAttribute("height") || 0);
      const context = [image.className, image.id, image.getAttribute("alt"), url].join(" ");
      if (!url || (width && width <= 2) || (height && height <= 2) || (width && height && width * height < 12000) || noisyImagePattern.test(context)) {
        image.remove();
        return;
      }
      const token = `web-clip-image-${images.length + 1}`;
      image.setAttribute("data-memo-nexus-clip-image", token);
      const figureCaption = image.closest("figure")?.querySelector("figcaption")?.textContent;
      const caption = String(figureCaption || image.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 500);
      images.push({
        token,
        url,
        alt: String(image.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 500),
        caption,
        width,
        height
      });
      image.closest("figure")?.querySelector("figcaption")?.remove();
    });
    const maximum = 20;
    images.slice(maximum).forEach((candidate) => wrapper.querySelector(`[data-memo-nexus-clip-image="${candidate.token}"]`)?.remove());
    return { html: wrapper.innerHTML, images: images.slice(0, maximum), omittedImageCount: Math.max(0, images.length - maximum) };
  }

  function extractPageHtml(document = globalThis.document) {
    return extractPageContent(document).html;
  }

  const api = { extractPageContent, extractPageHtml, extractSelectionContent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusPageExtractor = api;
})(globalThis);
