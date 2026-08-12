(function (root) {
  const BLOCKED = new Set(["SCRIPT", "STYLE", "NAV", "HEADER", "FOOTER", "ASIDE", "NOSCRIPT", "FORM"]);
  const text = (node) => String(node?.textContent || "").replace(/\s+/g, " ").trim();

  function escapeMarkdown(value) { return String(value || "").replace(/([\\`])/g, "\\$1"); }
  function imageMarker(token) {
    const normalized = String(token || "").trim();
    return /^web-clip-image-[1-9][0-9]*$/.test(normalized) ? `\n\n<!-- memo-nexus:web-clip-image:${normalized} -->\n\n` : "";
  }
  function nodeToMarkdown(node, depth = 0) {
    if (!node) return "";
    if (node.nodeType === 3) return escapeMarkdown(node.nodeValue);
    const tag = node.tagName;
    if (!tag || BLOCKED.has(tag)) return "";
    const children = [...node.childNodes].map((child) => nodeToMarkdown(child, depth)).join("");
    if (/^H[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${text(node)}\n\n`;
    if (tag === "P") return `\n\n${children.trim()}\n\n`;
    if (tag === "BR") return "\n";
    if (tag === "HR") return "\n\n---\n\n";
    if (tag === "STRONG" || tag === "B") return `**${children.trim()}**`;
    if (tag === "EM" || tag === "I") return `*${children.trim()}*`;
    if (tag === "CODE" && node.parentElement?.tagName !== "PRE") return `\`${text(node).replace(/`/g, "\\`")}\``;
    if (tag === "PRE") return `\n\n\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
    if (tag === "IMG") return imageMarker(node.getAttribute("data-memo-nexus-clip-image"));
    if (tag === "A") { const href = /^https?:/i.test(node.getAttribute("href") || "") ? node.href : ""; return href ? `[${children.trim() || href}](${href})` : children; }
    if (tag === "BLOCKQUOTE") return `\n\n${text(node).split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    if (tag === "LI") return `\n${"  ".repeat(depth)}- ${children.trim()}`;
    if (tag === "UL" || tag === "OL") return `\n${[...node.children].map((child, index) => `${tag === "OL" ? `${index + 1}.` : "-"} ${nodeToMarkdown(child, depth + 1).trim().replace(/^-\s*/, "")}`).join("\n")}\n`;
    return children;
  }
  function fallbackHtmlToMarkdown(html) {
    return String(html || "").replace(/<(script|style|nav|header|footer|aside)[^>]*>[\s\S]*?<\/\1>/gi, "")
      .replace(/<img\b[^>]*data-memo-nexus-clip-image=["']web-clip-image-([1-9][0-9]*)["'][^>]*>/gi, (_, number) => `\n\nMEMO_NEXUS_WEB_CLIP_IMAGE_${number}\n\n`)
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n").replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, v) => `\n\n${"#".repeat(Number(n))} ${v.replace(/<[^>]+>/g, "").trim()}\n\n`)
      .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**").replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
      .replace(/<a[^>]*href=["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
      .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, v) => `\n\n\`\`\`\n${v.replace(/<[^>]+>/g, "").trim()}\n\`\`\`\n\n`)
      .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, v) => `\n> ${v.replace(/<[^>]+>/g, "").trim()}\n`)
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, v) => `\n- ${v.replace(/<[^>]+>/g, "").trim()}`)
      .replace(/<(p|div)[^>]*>([\s\S]*?)<\/\1>/gi, (_, _tag, v) => `\n\n${v.replace(/<[^>]+>/g, "").trim()}\n\n`)
      .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/MEMO_NEXUS_WEB_CLIP_IMAGE_([1-9][0-9]*)/g, (_, number) => imageMarker(`web-clip-image-${number}`).trim())
      .replace(/\n{3,}/g, "\n\n").trim();
  }
  function htmlToMarkdown(htmlOrNode) {
    if (typeof htmlOrNode === "string" && typeof DOMParser === "undefined") return fallbackHtmlToMarkdown(htmlOrNode);
    const rootNode = typeof htmlOrNode === "string" ? new DOMParser().parseFromString(htmlOrNode, "text/html").body : htmlOrNode;
    return nodeToMarkdown(rootNode).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }
  const api = { htmlToMarkdown, fallbackHtmlToMarkdown, imageMarker };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusHtmlToMarkdown = api;
})(globalThis);
