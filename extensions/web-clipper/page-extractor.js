(function (root) {
  function extractPageHtml(document = globalThis.document) {
    const exclude = "script,style,nav,header,footer,aside,noscript,form,[role=banner],[role=navigation],[role=contentinfo],.advertisement,.ads,.sidebar,.related";
    const score = (node) => (node.innerText || "").trim().length - node.querySelectorAll("a").length * 40;
    if (!document?.body) return "";
    const candidates = [document.querySelector("article"), document.querySelector("main"), document.querySelector('[role="main"]')]
      .filter(Boolean);
    if (!candidates.length) candidates.push(...[...document.querySelectorAll("section,div")].filter((node) => score(node) > 400));
    const source = candidates.sort((a, b) => score(b) - score(a))[0] || document.body;
    if (!source || !(source.innerText || "").trim()) return "";
    const copy = source.cloneNode(true);
    copy.querySelectorAll(exclude).forEach((node) => node.remove());
    if (!(copy.innerText || "").trim()) return "";
    return copy.innerHTML;
  }
  const api = { extractPageHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusPageExtractor = api;
})(globalThis);
