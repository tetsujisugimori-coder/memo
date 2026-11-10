(function initNoteConflictUi(globalScope) {
  "use strict";
  function create({ host, onChoose, onResume, onSave, onError }) {
    const section = document.createElement("section");
    section.className = "note-conflict-panel";
    section.hidden = true;
    section.setAttribute("aria-label", "保存競合と回復原稿");
    host.append(section);
    const run = (operation) => { Promise.resolve().then(operation).catch(onError); };
    function render({ noteId, state, drafts = [], committed, editing = false }) {
      section.replaceChildren();
      section.hidden = !state && !drafts.length;
      section.removeAttribute("data-memo-conflict");
      if (section.hidden) return;
      const heading = document.createElement("h2");
      heading.textContent = state ? "保存競合：回復操作待ち" : "回復待ちの原稿があります";
      section.append(heading);
      if (!state) {
        const hint = document.createElement("p");
        hint.textContent = "保存内容はそのままです。保全した原稿を選んで比較・書出しできます。";
        section.append(hint);
        if (editing) {
          const save = document.createElement("button");
          save.type = "button"; save.setAttribute("data-memo-conflict-save", "");
          save.textContent = "確認した編集内容を保存する";
          save.onclick = () => run(() => onSave(noteId));
          section.append(save);
        }
      } else {
        const draft = state.recovery.draft;
        section.setAttribute("data-memo-conflict", "");
        section.dataset.noteId = noteId;
        section.dataset.requestId = draft.requestId;
        const notice = document.createElement("p");
        notice.setAttribute("role", "alert");
        notice.textContent = state.preserved
          ? "別のタブでこのメモが更新されました。通常保存を停止しました。原稿はブラウザ内に保全済みです。再読込後もここから回復できます。"
          : "保存競合：原稿の保全に失敗しました。原稿はこのタブだけにあります。タブを閉じずに書き出してください。";
        section.append(notice);
        const columns = document.createElement("div");
        columns.className = "note-conflict-comparison";
        for (const [label, attribute, body] of [
          ["現在の保存内容（全文）", "data-conflict-committed-body", committed?.body ?? state.recovery.receipt.committedBody],
          ["保存できなかった原稿（全文・未保存）", "data-conflict-draft-body", draft.body]
        ]) {
          const column = document.createElement("div"), title = document.createElement("h3"), pre = document.createElement("pre");
          title.textContent = label;
          pre.setAttribute(attribute, "");
          pre.tabIndex = 0;
          pre.textContent = body;
          column.append(title, pre); columns.append(column);
        }
        section.append(columns);
        const actions = document.createElement("div");
        actions.className = "note-conflict-actions";
        const exportButton = document.createElement("button");
        exportButton.type = "button";
        exportButton.setAttribute("data-memo-conflict-export", "");
        exportButton.textContent = "原稿全文を書き出す";
        exportButton.onclick = () => {
          const url = URL.createObjectURL(new Blob([draft.body], { type: "text/plain;charset=utf-8" }));
          const anchor = document.createElement("a");
          anchor.href = url; anchor.download = `memo-recovery-${draft.requestId}.txt`;
          anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        };
        const resume = document.createElement("button");
        resume.type = "button";
        resume.setAttribute("data-memo-conflict-resume", "");
        resume.textContent = "この原稿を再編集する";
        resume.disabled = !state.preserved;
        resume.onclick = () => run(() => onResume(draft));
        const hint = document.createElement("p");
        hint.textContent = state.preserved
          ? "再編集は最新の保存内容を基準に開始します。自動統合は行いません。内容を確認して保存してください。再び更新があれば保存を停止します。保全した原稿は自動削除しません。"
          : "保全が完了していません。このタブを閉じると原稿を失うおそれがあります。先に原稿全文を書き出してください。";
        actions.append(exportButton, resume); section.append(actions, hint);
        const backupNotice = document.createElement("p");
        backupNotice.textContent = "保全原稿は通常のバックアップZIPには含まれません。ブラウザの初期化や端末の移動前に、この画面から原稿を書き出してください。";
        section.append(backupNotice);
      }
      if (drafts.length) {
        const list = document.createElement("details"), summary = document.createElement("summary");
        summary.textContent = `保全した原稿を選ぶ（${drafts.length}件）`;
        list.append(summary);
        drafts.forEach((draft) => {
          const button = document.createElement("button");
          button.type = "button"; button.setAttribute("data-conflict-open", draft.requestId);
          button.textContent = `${new Date(draft.createdAt).toLocaleString()} ${draft.title || "無題"}：原稿を確認`;
          button.onclick = () => run(() => onChoose(draft));
          list.append(button);
        });
        section.append(list);
      }
    }
    return { render };
  }
  globalScope.MemoNexusNoteConflictUi = { create };
})(typeof window !== "undefined" ? window : globalThis);
