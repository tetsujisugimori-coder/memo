(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusTermLinkUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const TERM_PATTERN = /\[\[([^\]]+)\]\]/g;
  const TERM_COLORS = ["#287c88", "#5e6db8", "#9b5f9a", "#a66b1f", "#497346", "#17728d", "#8a5d19", "#7a3e9d"];

  function extractExplicitTerms(body) {
    return [...String(body || "").matchAll(TERM_PATTERN)].map((match) => match[1].trim()).filter(Boolean);
  }

  function uniqueTerms(terms) {
    return [...new Set(terms.map((term) => String(term || "").trim()).filter(Boolean))];
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function bodyContainsRegisteredTerm(body, term) {
    const source = String(body || "");
    const phrase = String(term || "").trim();
    if (!phrase) return false;

    // 英数字だけの短い語句は、他の英数字・アンダースコアの一部を拾わない。
    if (/^[A-Za-z0-9]+$/.test(phrase)) {
      return new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(phrase)}(?=$|[^A-Za-z0-9_])`).test(source);
    }
    return source.includes(phrase);
  }

  function stableHash(value) {
    let hash = 0;
    for (const character of String(value || "")) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return hash;
  }

  function kanaRowIndex(character) {
    const code = character.codePointAt(0);
    const hiragana = code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character;
    const rows = ["あいうえおぁぃぅぇぉ", "かきくけこがぎぐげご", "さしすせそざじずぜぞ", "たちつてとだぢづでど", "なにぬねの", "はひふへほばびぶべぼぱぴぷぺぽ", "まみむめも", "やゆよゃゅょ", "らりるれろ", "わをん"];
    return rows.findIndex((row) => row.includes(hiragana));
  }

  function termColor(term) {
    const normalized = String(term || "").trim().normalize("NFKC");
    const first = normalized[0] || "";
    if (/^[A-Za-z]$/.test(first)) {
      const code = first.toUpperCase().charCodeAt(0) - 65;
      return TERM_COLORS[Math.floor(code / 4) % TERM_COLORS.length];
    }
    if (/^\d$/.test(first)) return TERM_COLORS[4];
    const kanaIndex = kanaRowIndex(first);
    if (kanaIndex !== -1) return TERM_COLORS[kanaIndex % TERM_COLORS.length];
    return TERM_COLORS[stableHash(normalized) % TERM_COLORS.length];
  }

  function buildTermRelationIndex(notes) {
    const usableNotes = Array.isArray(notes) ? notes : [];
    const registeredTerms = uniqueTerms(usableNotes.flatMap((note) => extractExplicitTerms(note.body)));
    const byNoteId = new Map();

    usableNotes.forEach((note) => {
      const explicitTerms = uniqueTerms(extractExplicitTerms(note.body));
      const explicitSet = new Set(explicitTerms);
      const automaticTerms = registeredTerms.filter((term) => !explicitSet.has(term) && bodyContainsRegisteredTerm(note.body, term));
      const terms = [
        ...explicitTerms.map((term) => ({ term, source: "explicit", color: termColor(term) })),
        ...automaticTerms.map((term) => ({ term, source: "automatic", color: termColor(term) }))
      ];
      byNoteId.set(note.id, { explicitTerms, automaticTerms, terms });
    });

    return { registeredTerms, byNoteId };
  }

  return { bodyContainsRegisteredTerm, buildTermRelationIndex, extractExplicitTerms, termColor };
});
