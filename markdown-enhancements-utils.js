const MemoNexusMarkdownEnhancements = (() => {
  function buildCalloutMarkdown(selection, type = "NOTE") {
    const safeType = ["NOTE", "TIP", "IMPORTANT", "WARNING"].includes(type) ? type : "NOTE";
    const text = String(selection || "").replace(/\r\n?/g, "\n");
    if (!text) return `> [!${safeType}]\n> `;
    return `> [!${safeType}]\n${text.split("\n").map((line) => `> ${line}`).join("\n")}`;
  }

  function checklistEntries(body) {
    const entries = [];
    let offset = 0;
    let inFence = false;
    String(body || "").replace(/\r\n?/g, "\n").split("\n").forEach((line) => {
      if (/^```/.test(line.trim())) inFence = !inFence;
      if (!inFence) {
        const match = line.match(/^-\s+\[([ xX])\](?=\s)/);
        if (match) entries.push({ markerStart: offset + match.index + match[0].indexOf("["), checked: match[1].toLowerCase() === "x" });
      }
      offset += line.length + 1;
    });
    return entries;
  }

  function updateChecklistAt(body, markerStart, checked) {
    const text = String(body || "");
    if (!/^\[([ xX])\]/.test(text.slice(markerStart, markerStart + 3))) return text;
    return `${text.slice(0, markerStart)}[${checked ? "x" : " "}]${text.slice(markerStart + 3)}`;
  }

  function visibleTextSegments(body) {
    const segments = [];
    const source = String(body || "").replace(/\r\n?/g, "\n");
    let lineStart = 0;
    let inFence = false;
    source.split("\n").forEach((line) => {
      if (/^```/.test(line.trim())) { inFence = !inFence; lineStart += line.length + 1; return; }
      const prefix = inFence ? 0 : (line.match(/^(?:#{1,3}\s+|[-*]\s+|\d+\.\s+|>\s?)/)?.[0].length || 0);
      collectInlineSegments(line.slice(prefix), lineStart + prefix, segments);
      lineStart += line.length + 1;
    });
    return segments;
  }

  function collectInlineSegments(text, sourceStart, segments) {
    let index = 0;
    const pushPlain = (end) => {
      if (end > index) segments.push({ sourceStart: sourceStart + index, sourceEnd: sourceStart + end, text: text.slice(index, end) });
    };
    while (index < text.length) {
      const token = nextVisibleInlineToken(text, index);
      if (!token) { pushPlain(text.length); break; }
      pushPlain(token.start);
      segments.push({ sourceStart: sourceStart + token.contentStart, sourceEnd: sourceStart + token.contentEnd, text: token.content, ambiguous: token.ambiguous === true });
      index = token.end;
    }
  }

  function nextVisibleInlineToken(text, from) {
    const patterns = [
      { pattern: /!\[([^\]]*)\]\([^)]*\)/g, group: 1, contentOffset: 2 },
      { pattern: /\[([^\]]+)\]\([^)]*\)/g, group: 1, contentOffset: 1 },
      { pattern: /`([^`]+)`/g, group: 1, contentOffset: 1 },
      { pattern: /\*\*([^*]+)\*\*/g, group: 1, contentOffset: 2 },
      { pattern: /~~([^~]+)~~/g, group: 1, contentOffset: 2 },
      { pattern: /(?<!\*)\*([^*]+)\*(?!\*)/g, group: 1, contentOffset: 1 },
      { pattern: /(?<![\p{L}\p{N}])_([^_]+)_(?![\p{L}\p{N}])/gu, group: 1, contentOffset: 1 }
    ];
    const matches = patterns.map(({ pattern, group, contentOffset }) => {
      pattern.lastIndex = from;
      const match = pattern.exec(text);
      return match ? {
        start: match.index,
        end: pattern.lastIndex,
        content: match[group],
        contentStart: match.index + contentOffset,
        contentEnd: match.index + contentOffset + match[group].length,
        ambiguous: /!?\[[^\]]*\]\([^)]*\)|`|\*\*|~~|(?<!\\)[*_]/.test(match[group])
      } : null;
    }).filter(Boolean);
    return matches.sort((a, b) => a.start - b.start || a.end - b.end)[0] || null;
  }

  function visibleTargetOrdinal(body, target, start, end) {
    if (!target || start < 0 || end !== start + target.length) return -1;
    let ordinal = 0;
    for (const segment of visibleTextSegments(body)) {
      if (segment.ambiguous) return -1;
      let offset = segment.text.indexOf(target);
      while (offset !== -1) {
        const sourceMatchStart = segment.sourceStart + offset;
        if (sourceMatchStart === start && sourceMatchStart + target.length === end) return ordinal;
        ordinal += 1;
        offset = segment.text.indexOf(target, offset + target.length);
      }
    }
    return -1;
  }

  function visibleTargetForSourceRange(body, start, end) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
      return { displayText: "", ordinal: -1, matched: false };
    }
    const overlaps = visibleTextSegments(body).map((segment) => {
      const overlapStart = Math.max(start, segment.sourceStart);
      const overlapEnd = Math.min(end, segment.sourceEnd);
      if (overlapEnd <= overlapStart) return null;
      return {
        displayText: segment.text.slice(overlapStart - segment.sourceStart, overlapEnd - segment.sourceStart),
        start: overlapStart,
        end: overlapEnd
      };
    }).filter(Boolean);
    const overlappingSegments = visibleTextSegments(body).filter((segment) => segment.sourceEnd > start && segment.sourceStart < end);
    if (overlaps.length !== 1 || overlappingSegments.some((segment) => segment.ambiguous) || !overlaps[0].displayText) {
      return { displayText: "", ordinal: -1, matched: false };
    }
    const match = overlaps[0];
    const ordinal = visibleTargetOrdinal(body, match.displayText, match.start, match.end);
    return { displayText: match.displayText, ordinal, matched: ordinal >= 0 };
  }

  function insertExplanationMarkerIntoDom(root, options = {}) {
    const target = String(options.displayText || "");
    const ordinal = Number(options.ordinal);
    const documentRef = root?.ownerDocument;
    if (!documentRef || !target || !Number.isInteger(ordinal) || ordinal < 0) return null;
    const walker = documentRef.createTreeWalker(root, 4);
    let occurrences = 0;
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest(".explanation-cards,.explanation-marker")) continue;
      let offset = String(node.nodeValue || "").indexOf(target);
      while (offset !== -1) {
        if (occurrences === ordinal) break;
        occurrences += 1;
        offset = node.nodeValue.indexOf(target, offset + target.length);
      }
      if (offset === -1 || occurrences !== ordinal) continue;
      const marker = documentRef.createElement("button");
      marker.type = "button";
      marker.className = "explanation-marker";
      marker.textContent = String(options.number || "");
      marker.setAttribute("aria-label", `解説カード${options.number}を表示`);
      if (typeof options.onActivate === "function") marker.addEventListener("click", options.onActivate);
      const after = node.splitText(offset + target.length);
      node.splitText(offset);
      node.parentNode.insertBefore(marker, after);
      return marker;
    }
    return null;
  }

  function resolveExplanationTarget(body, explanation) {
    const text = String(body || "");
    const target = String(explanation?.target || "");
    const start = Number(explanation?.start);
    const end = Number(explanation?.end);
    if (!target) return { start: -1, end: -1, matched: false };
    if (Number.isInteger(start) && Number.isInteger(end) && text.slice(start, end) === target) return { start, end, matched: true };
    const candidates = [];
    for (let cursor = text.indexOf(target); cursor !== -1; cursor = text.indexOf(target, cursor + target.length)) candidates.push(cursor);
    if (candidates.length === 1) return { start: candidates[0], end: candidates[0] + target.length, matched: true };
    const before = String(explanation?.before || "");
    const after = String(explanation?.after || "");
    const contextual = candidates.filter((candidate) => (
      (!before || text.slice(Math.max(0, candidate - before.length), candidate) === before)
      && (!after || text.slice(candidate + target.length, candidate + target.length + after.length) === after)
    ));
    if (contextual.length === 1) return { start: contextual[0], end: contextual[0] + target.length, matched: true };
    return { start: -1, end: -1, matched: false };
  }

  function shouldPersistCollapsedState(previous, next, userInitiated) {
    return userInitiated === true && previous !== next;
  }

  function createExplanationCollapsedStateSaver(options = {}) {
    let queue = Promise.resolve();
    const save = (noteId, explanationId, collapsed) => {
      const operation = queue.then(async () => {
        const note = options.getNote?.(noteId);
        if (!note || note.id !== noteId || !Array.isArray(note.explanations)) return false;
        const explanation = note.explanations.find((item) => item.id === explanationId);
        if (!explanation || explanation.collapsed === collapsed) return false;
        const timestamp = options.now?.() ?? Date.now();
        explanation.collapsed = collapsed;
        explanation.updatedAt = timestamp;
        note.updatedAt = timestamp;
        await options.putNote?.(note);
        await options.afterSave?.(noteId);
        return true;
      });
      queue = operation.catch(() => {});
      return operation;
    };
    save.whenIdle = () => queue;
    return save;
  }

  function bindExplanationCollapseInteractions(details, summary, explanation, onPersist) {
    let renderedCollapsed = explanation.collapsed;
    let expectedUserOpen = null;
    details.open = explanation.collapsed !== true;
    summary.addEventListener("click", () => { expectedUserOpen = !details.open; });
    details.addEventListener("toggle", () => {
      const nextCollapsed = !details.open;
      const userInitiated = expectedUserOpen === details.open;
      expectedUserOpen = null;
      if (shouldPersistCollapsedState(renderedCollapsed, nextCollapsed, userInitiated)) {
        renderedCollapsed = nextCollapsed;
        onPersist?.(nextCollapsed);
      }
    });
  }

  function createExplanationCardElement(documentRef, explanation, number, options = {}) {
    const article = documentRef.createElement("article");
    article.id = `explanation-card-${explanation.id}`;
    article.className = `explanation-card${options.orphaned ? " explanation-orphaned" : ""}`;
    const details = documentRef.createElement("details");
    const summary = documentRef.createElement("summary");
    summary.textContent = `解説カード${number}：${explanation.type || "補足"}`;
    bindExplanationCollapseInteractions(details, summary, explanation, (collapsed) => options.onPersistCollapsed?.(explanation, collapsed));
    const target = documentRef.createElement("p");
    target.className = "explanation-card-target";
    target.textContent = `対象：${explanation.target || "（対象なし）"}`;
    const body = documentRef.createElement("p");
    body.className = "explanation-card-body";
    body.textContent = explanation.body || "";
    const status = documentRef.createElement("p");
    status.className = "explanation-card-status";
    status.textContent = options.orphaned ? "対象箇所を確認してください。カードは保持されています。" : "";
    const actions = documentRef.createElement("div");
    actions.className = "explanation-card-actions";
    const edit = documentRef.createElement("button");
    edit.type = "button";
    edit.textContent = "編集";
    edit.addEventListener("click", () => options.onEdit?.(explanation));
    const remove = documentRef.createElement("button");
    remove.type = "button";
    remove.textContent = "削除";
    remove.addEventListener("click", () => options.onDelete?.(explanation.id));
    actions.append(edit, remove);
    details.append(summary, target, body, status, actions);
    article.append(details);
    return article;
  }

  function resolveExplanationInsertAfterNode(node) {
    if (!node) return null;
    if (!node.parentElement) return null;
    let pointer = node.parentElement;
    while (pointer && pointer.parentElement && !/^(?:P|LI|UL|OL|BLOCKQUOTE|H[1-6]|FIGURE|TABLE|TBODY|THEAD|TR|TD|TH|PRE|SECTION|ARTICLE|DIV)$/.test(pointer.tagName)) {
      pointer = pointer.parentElement;
    }
    return pointer;
  }

  function insertAfter(referenceNode, node) {
    if (!referenceNode?.parentNode) return false;
    referenceNode.parentNode.insertBefore(node, referenceNode.nextSibling);
    return true;
  }

  function hydrateExplanationCardsIntoDom(root, body, explanations, options = {}) {
    const documentRef = root?.ownerDocument;
    if (!documentRef || !Array.isArray(explanations) || !explanations.length) return [];
    const enriched = explanations.map((explanation, index) => {
      const resolved = resolveExplanationTarget(body, explanation);
      const visibleTarget = resolved.matched ? visibleTargetForSourceRange(body, resolved.start, resolved.end) : { matched: false };
      const position = resolved.matched && Number.isInteger(resolved.start) && resolved.start >= 0 ? resolved.start : Number.POSITIVE_INFINITY;
      return {
        explanation,
        index,
        resolved,
        visibleTarget,
        position,
        insertionFallback: Number.isFinite(position) ? position : Number.POSITIVE_INFINITY
      };
    });
    const ordered = enriched
      .slice()
      .sort((a, b) => {
        if (a.position !== b.position) return a.position - b.position;
        return a.index - b.index;
      })
      .map((item, displayIndex) => ({ ...item, displayIndex }));

    let fallbackCards = null;
    const results = ordered.map((item) => {
      const { explanation, resolved, visibleTarget, displayIndex } = item;
      const number = displayIndex + 1;
      const marker = visibleTarget.matched ? insertExplanationMarkerIntoDom(root, {
        displayText: visibleTarget.displayText,
        ordinal: visibleTarget.ordinal,
        number,
        onActivate: () => options.onMarkerActivate?.(explanation)
      }) : null;
      const markerInserted = Boolean(marker);
      const orphaned = !markerInserted;
      const card = createExplanationCardElement(documentRef, explanation, number, {
        orphaned,
        onPersistCollapsed: options.onPersistCollapsed,
        onEdit: options.onEdit,
        onDelete: options.onDelete
      });
      const insertAfterNode = resolveExplanationInsertAfterNode(marker);
      if (insertAfterNode) {
        insertAfter(insertAfterNode, card);
      } else {
        if (!fallbackCards) {
          fallbackCards = documentRef.createElement("section");
          fallbackCards.className = "explanation-cards";
          fallbackCards.setAttribute("aria-label", "解説カード");
        }
        fallbackCards.append(card);
      }
      return { explanation, resolved, visibleTarget, markerInserted, orphaned, displayIndex };
    });
    if (fallbackCards) root.append(fallbackCards);
    return results.sort((a, b) => a.index - b.index);
  }

  return { buildCalloutMarkdown, checklistEntries, updateChecklistAt, visibleTextSegments, visibleTargetOrdinal, visibleTargetForSourceRange, insertExplanationMarkerIntoDom, resolveExplanationTarget, shouldPersistCollapsedState, createExplanationCollapsedStateSaver, bindExplanationCollapseInteractions, createExplanationCardElement, hydrateExplanationCardsIntoDom };
})();

if (typeof window !== "undefined") window.MemoNexusMarkdownEnhancements = MemoNexusMarkdownEnhancements;
if (typeof module !== "undefined") module.exports = MemoNexusMarkdownEnhancements;
