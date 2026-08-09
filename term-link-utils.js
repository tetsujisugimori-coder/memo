(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.MemoNexusTermLinkUtils = api;
})(typeof window !== "undefined" ? window : globalThis, () => {
  const TERM_PATTERN = /\[\[([^\]]+)\]\]/g;
  // 0-3は英字、4は数字、5-14は五十音行用の固定パレットです。
  const TERM_COLORS = ["#287c88", "#5e6db8", "#9b5f9a", "#a66b1f", "#497346", "#17728d", "#8a5d19", "#7a3e9d", "#a44b57", "#427b59", "#4c6f9e", "#9a6c2d", "#6e599b", "#3d7d73", "#9b5d7b"];

  function extractExplicitTerms(body) {
    return [...String(body || "").matchAll(TERM_PATTERN)].map((match) => match[1].trim()).filter(Boolean);
  }

  function uniqueTerms(terms) {
    return [...new Set(Array.from(terms || [], (term) => String(term || "").trim()).filter(Boolean))];
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // "C" は一般的な英字境界だけでは CSS や C++ まで拾うため、
  // 登録済み語句としての自動検出に限り、メモで使う自然な文脈へ絞る。
  function findSpecialCTermMatches(source) {
    const matches = [];
    const pattern = /(^|[\s　、。．，！!？?：:；;（(\[\]{}「」『』【】〈〉《》“”"'`をのはがにとへもで])C(?=言語|について|$|[\s　、。．，！!？?：:；;）)\]}`〉》」』】\"'`]|[をのはがにとへもで])/g;
    let match;
    while ((match = pattern.exec(source))) {
      matches.push({ start: match.index + match[1].length, end: match.index + match[1].length + 1, term: "C" });
    }
    return matches;
  }

  function matchesSpecialCTerm(body) {
    return findSpecialCTermMatches(String(body || "")).length > 0;
  }

  function findTermMatches(source, term) {
    const phrase = String(term || "").trim();
    if (!phrase) return [];
    if (phrase === "C") return findSpecialCTermMatches(source);

    const matches = [];
    const pattern = /^[A-Za-z0-9]+$/.test(phrase)
      ? new RegExp(`(^|[^A-Za-z0-9_])(${escapeRegExp(phrase)})(?=$|[^A-Za-z0-9_])`, "g")
      : new RegExp(escapeRegExp(phrase), "g");
    let match;
    while ((match = pattern.exec(source))) {
      const text = match[2] || match[0];
      const start = match[2] ? match.index + match[1].length : match.index;
      matches.push({ start, end: start + text.length, term: phrase });
    }
    return matches;
  }

  // 重なった候補は長い語句を優先し、同一位置の二重リンクを作らない。
  function findAutomaticTermMatches(text, terms) {
    const source = String(text || "");
    const candidates = uniqueTerms(terms).flatMap((term) => findTermMatches(source, term));
    candidates.sort((a, b) => a.start - b.start || b.end - a.end || a.term.localeCompare(b.term));
    const matches = [];
    let end = -1;
    candidates.forEach((candidate) => {
      if (candidate.start >= end) {
        matches.push(candidate);
        end = candidate.end;
      }
    });
    return matches;
  }

  // 集計は表示と異なり、登録済みの長い語句に含まれる短い語句も数える。
  // ただし、任意の単純部分一致には戻さず、長い語句自体は共通の境界判定を通す。
  function findTermCountMatches(text, term, registeredTerms) {
    const source = String(text || "");
    const phrase = String(term || "").trim();
    if (!phrase) return [];

    const matches = findTermMatches(source, phrase);
    if (phrase === "C") return matches;

    uniqueTerms(registeredTerms)
      .filter((registeredTerm) => registeredTerm !== phrase && registeredTerm.includes(phrase))
      .forEach((registeredTerm) => {
        findTermMatches(source, registeredTerm).forEach((container) => {
          let offset = container.term.indexOf(phrase);
          while (offset !== -1) {
            matches.push({ start: container.start + offset, end: container.start + offset + phrase.length, term: phrase });
            offset = container.term.indexOf(phrase, offset + phrase.length);
          }
        });
      });

    const seen = new Set();
    return matches.filter((match) => {
      const key = `${match.start}:${match.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function bodyContainsRegisteredTerm(body, term) {
    const source = String(body || "");
    const phrase = String(term || "").trim();
    if (!phrase) return false;

    return findTermMatches(source, phrase).length > 0;
  }

  function stableHash(value) {
    let hash = 0;
    for (const character of String(value || "")) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return hash;
  }

  function kanaRowIndex(character) {
    const code = character.codePointAt(0);
    const hiragana = code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character;
    if (hiragana === "ゔ") return 0;
    const rows = ["あいうえおぁぃぅぇぉ", "かきくけこがぎぐげご", "さしすせそざじずぜぞ", "たちつてとだぢづでどっ", "なにぬねの", "はひふへほばびぶべぼぱぴぷぺぽ", "まみむめも", "やゆよゃゅょ", "らりるれろ", "わをん"];
    return rows.findIndex((row) => row.includes(hiragana));
  }

  function termColor(term) {
    const normalized = String(term || "").trim().normalize("NFKC");
    const first = normalized[0] || "";
    if (/^[A-Za-z]$/.test(first)) {
      const code = first.toUpperCase().charCodeAt(0) - 65;
      if (code <= 6) return TERM_COLORS[0];
      if (code <= 13) return TERM_COLORS[1];
      if (code <= 19) return TERM_COLORS[2];
      return TERM_COLORS[3];
    }
    if (/^\d$/.test(first)) return TERM_COLORS[4];
    const kanaIndex = kanaRowIndex(first);
    if (kanaIndex !== -1) return TERM_COLORS[5 + kanaIndex];
    return TERM_COLORS[stableHash(normalized) % TERM_COLORS.length];
  }

  function buildTermRelationIndex(notes) {
    const usableNotes = Array.isArray(notes) ? notes : [];
    const registeredTerms = uniqueTerms(usableNotes.flatMap((note) => extractExplicitTerms(note.body)));
    const byNoteId = new Map();

    usableNotes.forEach((note) => {
      const explicitTerms = uniqueTerms(extractExplicitTerms(note.body));
      const explicitSet = new Set(explicitTerms);
      const automaticCandidates = registeredTerms.filter((term) => !explicitSet.has(term) && bodyContainsRegisteredTerm(note.body, term));
      const automaticTerms = uniqueTerms(findAutomaticTermMatches(note.body, automaticCandidates).map((match) => match.term));
      const terms = [
        ...explicitTerms.map((term) => ({ term, source: "explicit", color: termColor(term) })),
        ...automaticTerms.map((term) => ({ term, source: "automatic", color: termColor(term) }))
      ];
      byNoteId.set(note.id, { explicitTerms, automaticTerms, terms });
    });

    return { registeredTerms, byNoteId };
  }

  function createTermRelationCache() {
    let index = null;
    return {
      get(notes) {
        if (!index) index = buildTermRelationIndex(notes);
        return index;
      },
      invalidate() {
        index = null;
      }
    };
  }

  return { bodyContainsRegisteredTerm, buildTermRelationIndex, createTermRelationCache, extractExplicitTerms, findAutomaticTermMatches, findTermCountMatches, matchesSpecialCTerm, termColor };
});
