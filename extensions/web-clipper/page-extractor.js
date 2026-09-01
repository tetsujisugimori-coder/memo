(function (root) {
  const MAX_IMAGES = 20;
  const EXCLUDED_CONTENT = "script,style,nav,header,footer,aside,noscript,form,[role=banner],[role=navigation],[role=contentinfo],.advertisement,.ads,.sidebar,.related";
  const NOISY_IMAGE_PATTERN = /(?:^|[^a-z0-9])(ad|ads|advert|avatar|badge|banner|brand|emoji|icon|logo|pixel|profile|share|social|spacer|sprite|tracking)(?:[^a-z0-9]|$)/i;

  function cleanText(value, limit) {
    return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
  }

  function metaContent(document, selectors) {
    for (const selector of selectors) {
      const content = cleanText(document.querySelector(selector)?.getAttribute("content"), 2000);
      if (content) return content;
    }
    return "";
  }

  function jsonLdArticleBody(document) {
    const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 20);
    const candidates = [];
    function visit(value) {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) { value.slice(0, 50).forEach(visit); return; }
      const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
      if (types.some((type) => /(?:^|\/)(?:Article|NewsArticle|BlogPosting|ReportageNewsArticle)$/i.test(String(type || "")))) {
        const body = typeof value.articleBody === "string" ? cleanText(value.articleBody, 500000) : "";
        if (body) candidates.push(body);
      }
      if (value["@graph"]) visit(value["@graph"]);
      if (value.mainEntity) visit(value.mainEntity);
    }
    scripts.forEach((script) => {
      const source = String(script.textContent || "");
      if (!source || source.length > 1000000) return;
      try { visit(JSON.parse(source)); } catch (_) {}
    });
    return candidates.sort((left, right) => right.length - left.length)[0] || "";
  }

  function extractMetadata(document = globalThis.document) {
    if (!document) return { title: "", description: "", siteName: "", articleBody: "" };
    return {
      title: cleanText(metaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']) || document.title, 300),
      description: cleanText(metaContent(document, ['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']), 2000),
      siteName: cleanText(metaContent(document, ['meta[property="og:site_name"]', 'meta[name="application-name"]']), 255),
      articleBody: jsonLdArticleBody(document)
    };
  }

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
    const metadata = extractMetadata(document);
    if (!document?.body) return { html: "", images: [], omittedImageCount: 0, metadata, strategy: "none" };
    const score = (node) => (node.innerText || "").trim().length - node.querySelectorAll("a").length * 40;
    const roots = [document.querySelector("article"), document.querySelector("main"), document.querySelector('[role="main"]')].filter(Boolean);
    let strategy = roots.length ? "semantic_root" : "scored_candidate";
    if (!roots.length) roots.push(...[...document.querySelectorAll("section,div")].filter((node) => score(node) > 400 && node.querySelectorAll("p").length >= 2));
    if (!roots.length && score(document.body) > 800 && document.body.querySelectorAll("p").length >= 3) {
      roots.push(document.body);
      strategy = "document_body_candidate";
    }
    const source = roots.sort((a, b) => score(b) - score(a))[0] || null;
    if (!source || !(source.innerText || "").trim()) return { html: "", images: [], omittedImageCount: 0, metadata, strategy: "metadata_only" };
    const sourceImages = [...source.querySelectorAll("img")];
    const copy = source.cloneNode(true);
    const cloneImages = [...copy.querySelectorAll("img")];
    const originals = new Map(cloneImages.map((image, index) => [image, sourceImages[index]]));
    copy.querySelectorAll(EXCLUDED_CONTENT).forEach((node) => node.remove());
    const result = collectImages(copy, document, originals);
    if (!(copy.innerText || "").trim() && !result.images.length) return { html: "", images: [], omittedImageCount: 0, metadata, strategy: "metadata_only" };
    return { html: copy.innerHTML, ...result, metadata, strategy };
  }

  function extractSelectionContent(document = globalThis.document) {
    const selection = document?.defaultView?.getSelection?.();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return { html: "", images: [], omittedImageCount: 0, metadata: extractMetadata(document), strategy: "selection_empty" };
    const wrapper = document.createElement("div");
    wrapper.append(selection.getRangeAt(0).cloneContents());
    const result = collectImages(wrapper, document);
    return { html: wrapper.innerHTML, ...result, metadata: extractMetadata(document), strategy: "selection" };
  }

  function extractPageHtml(document = globalThis.document) { return extractPageContent(document).html; }

  const api = { extractMetadata, extractPageContent, extractPageHtml, extractSelectionContent };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusPageExtractor = api;
})(globalThis);
