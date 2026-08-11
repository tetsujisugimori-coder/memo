(function (root) {
  const EXCLUDE = "script,style,nav,header,footer,aside,noscript,form,[role=banner],[role=navigation],[role=contentinfo],.advertisement,.ads,.sidebar,.related";
  function score(node) { return (node.innerText || "").trim().length - node.querySelectorAll("a").length * 40; }
  function extractPageHtml(document = globalThis.document) {
    const candidates = [document.querySelector("article"), document.querySelector("main"), document.querySelector('[role="main"]')]
      .filter(Boolean);
    if (!candidates.length) candidates.push(...[...document.querySelectorAll("section,div")].filter((node) => score(node) > 400));
    const source = candidates.sort((a, b) => score(b) - score(a))[0] || document.body;
    if (!source || !(source.innerText || "").trim()) throw new Error("page-content-not-found");
    const copy = source.cloneNode(true);
    copy.querySelectorAll(EXCLUDE).forEach((node) => node.remove());
    if (!(copy.innerText || "").trim()) throw new Error("page-content-not-found");
    return copy.innerHTML;
  }
  const api = { extractPageHtml };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusPageExtractor = api;
})(globalThis);
