(function (root) {
  const MAX_IMAGES = 20;
  const EXCLUDED_CONTENT = "script,style,nav,header,footer,aside,noscript,form,[role=banner],[role=navigation],[role=contentinfo],.advertisement,.ads,.sidebar,.related";
  const NOISY_IMAGE_PATTERN = /(?:^|[^a-z0-9])(ad|ads|advert|avatar|badge|banner|brand|emoji|icon|logo|pixel|profile|share|social|spacer|sprite|tracking)(?:[^a-z0-9]|$)/i;

  function absoluteHttpUrl(value, document) {
    try {
      const url = new URL(String(value || "").trim(), document.baseURI);
      url.hash = "";
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (_) { return ""; }
  }

  function srcsetUrl(value, document) {
    return String(value || "").split(",").map((part) => {
      const match = part.trim().match(/^(\S+)(?:\s+([0-9.]+)(w|x))?$/);
      if (!match) return null;
      const weight = match[3] === "w" ? Number(match[2]) : match[3] === "x" ? Number(match[2]) * 10000 : 1;
      return { url: absoluteHttpUrl(match[1], document), weight };
    }).filter((item) => item?.url).sort((a, b) => b.weight - a.weight)[0]?.url || "";
  }

  function imageUrl(image, original, document) {
    const lazy = [original?.currentSrc, image.getAttribute("data-src"), image.getAttribute("data-lazy-src"), image.getAttribute("data-original"), image.getAttribute("data-url")]
      .map((value) => absoluteHttpUrl(value, document)).find(Boolean);
    return lazy || srcsetUrl(image.getAttribute("data-srcset") || image.getAttribute("srcset"), document) || absoluteHttpUrl(image.getAttribute("src"), document);
  }

  function imageCaption(image) {
    const figureCaption = image.closest("figure")?.querySelector("figcaption")?.textContent;
    const nearbyCaption = image.parentElement?.querySelector(":scope > .caption, :scope > [class*=caption]")?.textContent;
    return String(figureCaption || nearbyCaption || image.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function candidateScore(image, width, height, caption) {
    let score = 0;
    if (image.closest("figure")) score += 80;
    if (caption) score += 40;
    if (String(image.getAttribute("alt") || "").trim()) score += 15;
    if (width && height && width * height >= 300000) score += 40;
    else if (width && height && width * height >= 50000) score += 20;
    if (image.closest("a,button,[role=button]")) score -= 30;
    return score;
  }

  function meaningfulCandidate(image, original, document) {
    const url = imageUrl(image, original, document);
    if (!url) return null;
    const declaredWidth = Number(image.getAttribute("width") || 0);
    const declaredHeight = Number(image.getAttribute("height") || 0);
    if ((declaredWidth && declaredWidth <= 2) || (declaredHeight && declaredHeight <= 2)) return null;
    const width = Number(original?.naturalWidth || image.getAttribute("width") || 0);
    const height = Number(original?.naturalHeight || image.getAttribute("height") || 0);
    if ((width && width <= 2) || (height && height <= 2)) return null;
    if (width && height && width * height < 12000 && !image.closest("figure") && !imageCaption(image)) return null;
    const context = [image.className, image.id, image.getAttribute("alt"), url, image.closest("[class],[id]")?.className, image.closest("[class],[id]")?.id].join(" ");
    if (NOISY_IMAGE_PATTERN.test(context)) return null;
    if ((image.getAttribute("role") === "presentation" || image.getAttribute("aria-hidden") === "true") && !String(image.getAttribute("alt") || "").trim()) return null;
    const caption = imageCaption(image);
    return {
      url,
      alt: String(image.getAttribute("alt") || "").replace(/\s+/g, " ").trim().slice(0, 500),
      caption,
      width,
      height,
      score: candidateScore(image, width, height, caption)
    };
  }

  function collectImages(container, document, originals = new Map()) {
    const seenUrls = new Set();
    const candidates = [];
    [...container.querySelectorAll("img")].forEach((image, order) => {
      const candidate = meaningfulCandidate(image, originals.get(image) || image, document);
      if (!candidate || seenUrls.has(candidate.url)) {
        image.remove();
        return;
      }
      seenUrls.add(candidate.url);
      candidates.push({ ...candidate, image, order });
    });
    const selected = new Set(candidates.slice().sort((a, b) => b.score - a.score || a.order - b.order).slice(0, MAX_IMAGES));
    const images = [];
    candidates.sort((a, b) => a.order - b.order).forEach((candidate) => {
      if (!selected.has(candidate)) {
        candidate.image.remove();
        return;
      }
      const token = `web-clip-image-${images.length + 1}`;
      candidate.image.setAttribute("data-memo-nexus-clip-image", token);
      candidate.image.closest("figure")?.querySelector("figcaption")?.remove();
      const { image, order, score, ...metadata } = candidate;
      images.push({ token, ...metadata, priority: score });
    });
    return { images, omittedImageCount: Math.max(0, candidates.length - images.length) };
  }

  function extractPageContent(document = globalThis.document) {
    if (!document?.body) return { html: "", images: [], omittedImageCount: 0 };
    const score = (node) => (node.innerText || "").trim().length - node.querySelectorAll("a").length * 40;
    const roots = [document.querySelector("article"), document.querySelector("main"), document.querySelector('[role="main"]')].filter(Boolean);
    if (!roots.length) roots.push(...[...document.querySelectorAll("section,div")].filter((node) => score(node) > 400));
    const source = roots.sort((a, b) => score(b) - score(a))[0] || document.body;
    if (!source || !(source.innerText || "").trim()) return { html: "", images: [], omittedImageCount: 0 };
    const sourceImages = [...source.querySelectorAll("img")];
    const copy = source.cloneNode(true);
    const cloneImages = [...copy.querySelectorAll("img")];
    const originals = new Map(cloneImages.map((image, index) => [image, sourceImages[index]]));
    copy.querySelectorAll(EXCLUDED_CONTENT).forEach((node) => node.remove());
    const result = collectImages(copy, document, originals);
    if (!(copy.innerText || "").trim() && !result.images.length) return { html: "", images: [], omittedImageCount: 0 };
    return { html: copy.innerHTML, ...result };
  }

  function extractSelectionContent(document = globalThis.document) {
    const selection = document?.defaultView?.getSelection?.();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return { html: "", images: [], omittedImageCount: 0 };
    const wrapper = document.createElement("div");
    wrapper.append(selection.getRangeAt(0).cloneContents());
    const result = collectImages(wrapper, document);
    return { html: wrapper.innerHTML, ...result };
  }

  function extractPageHtml(document = globalThis.document) { return extractPageContent(document).html; }

  const api = { extractPageContent, extractPageHtml, extractSelectionContent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusPageExtractor = api;
})(globalThis);
