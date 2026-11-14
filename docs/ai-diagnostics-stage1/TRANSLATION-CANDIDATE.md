# Translation input candidate (prompt version 2)

Status: PARTIAL / real-model candidate acceptance NOT_TESTED / root cause UNKNOWN / Draft / merge NO.

## Problem and resulting request

In the user's Windows/Ollama manual trial, phi4-mini returned the original English for a Japanese translation task. HTTP/done/EOF were normal and body/final/UI counts agreed. After correcting a separate PowerShell-to-Node encoding problem, one simple direct user instruction returned a Japanese translation; the old standard request, merging its system messages, and moving its reference into user still returned English in one trial each. These bounded observations do not establish a root cause. Pre-correction direct trials are not model-capability evidence. No original user screenshots, private report links or user filesystem paths are published here.

This candidate changes only translation request assembly in buildAiMessages:

- Begin the latest user message with an explicit Japanese/English destination and a request to return the translation only.
- Put the selected target in that same user message under [翻訳対象], after optional extra instructions. Keep the existing intent that embedded instructions are source text, and ask to preserve code/Markdown structure; these words are not a prompt-injection guarantee.
- For selected text/current note/specified note, transmit the selected body without separately sending its note title or ID. App reference snapshots and labels are unchanged. For all-notes/collection, reuse the existing structured reference content so that every selected note and its boundaries/metadata remain represented. Such headers may affect model output and still need real-model evaluation.
- Preserve the caller's system instruction and valid user/assistant history, followed by the new user request. No new default model options, retries, timeout, provider or save behavior.
- Keep question, summarize and organize payloads unchanged. Translation metadata version becomes 2 and index.html loads ai-prompts.js?v=0.5.0-3 to avoid stale script reuse.

For the previously used synthetic sentence and default system instruction, the old request had 3 messages / 260 characters. The candidate has 2 messages / 197 characters. Counts identify this particular fixture and defaults, not semantic correctness. This candidate also retains system and source-format guidance, so it is not identical to the previously successful 65-character one-user-message probe. No real inference was run in the cloud and no successful real-model fix is claimed.

## Validation

Added seven prompt tests covering both target languages and all single-reference modes, exact source preservation, optional instructions, custom system and history, multi-note scope/boundaries, input immutability, missing-reference rejection and unchanged non-translation task wording. The app/adapter diagnostic test checks that the current translation target is in the actual final user request and not in a reference system message. The synthetic real-browser test additionally inspects actual HTTP payload roles, language, target placement and absence of the selected source from system messages, alongside the existing full payload/hash comparison.

Local focused suite: 152/152 PASS, skip0 (existing 145 plus seven new prompt tests). Syntax and diff checks PASS. Dedicated CI runs the same suite and browser flow on Ubuntu Chromium/WebKit and Windows Chromium. CI uses a synthetic HTTP service: success does not prove real translation quality. Refer to the PR for exact submitted HEAD and run results. Historical evidence under browser-audit-evidence continues to identify its original producer HEAD and must not be relabeled as evidence for this candidate.

## First user acceptance check

Once this candidate's exact HEAD is checked out in the existing isolated test copy, reload the local app so the new asset URL is used. Keep the installed model phi4-mini:latest and the app defaults/custom settings previously chosen. Start a fresh conversation, select the same synthetic English sentence, choose translation/Japanese and send once. Retain the visible answer and copied diagnostics before expiry; no success-until-retry. A normal completion with original English is still translation FAIL. Japanese translation plus matching actual response/UI text is the first acceptance observation; it does not establish repeatability or the whole A2/B5/C2/D5/stop/model/language matrix.

Do not run the old ad-hoc non-ASCII PowerShell pipelines without checking transport. For any later direct probe, use source files, ASCII Unicode escapes or an explicit Japanese marker check and preserve the distinction from browser execution. Windows settings from another shell window do not establish this window's pipe encoding. This check is separate from the application prompt candidate.
