(function initAiReferenceSelection(globalScope) {
  "use strict";

  const UNCLASSIFIED_COLLECTION_ID = "system-unclassified";

  function activeReferenceNotes(notes) {
    return (Array.isArray(notes) ? notes : []).filter((note) => !note?.deletedAt);
  }

  function normalizedReferenceCollectionId(note, collections) {
    return (Array.isArray(collections) ? collections : []).some((collection) => collection.id === note?.collectionId)
      ? note.collectionId
      : UNCLASSIFIED_COLLECTION_ID;
  }

  function descendantReferenceCollectionIds(collections, id) {
    const source = Array.isArray(collections) ? collections : [];
    const result = [];
    const visit = (parentId) => source.filter((collection) => collection.parentId === parentId).forEach((child) => {
      result.push(child.id);
      visit(child.id);
    });
    visit(id);
    return result;
  }

  function selectAllReferenceNotes(notes) {
    return activeReferenceNotes(notes);
  }

  function selectCollectionReferenceNotes(notes, collections, collectionId) {
    const ids = new Set([collectionId, ...descendantReferenceCollectionIds(collections, collectionId)]);
    return activeReferenceNotes(notes).filter((note) => ids.has(normalizedReferenceCollectionId(note, collections)));
  }

  const api = {
    activeReferenceNotes,
    descendantReferenceCollectionIds,
    normalizedReferenceCollectionId,
    selectAllReferenceNotes,
    selectCollectionReferenceNotes
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (globalScope) globalScope.MemoNexusAiReferenceSelection = api;
})(typeof window !== "undefined" ? window : globalThis);
