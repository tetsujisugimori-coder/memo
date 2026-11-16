# Translation input candidate (prompt version 2)

Status: PARTIAL / first real-model candidate acceptance PASS (one user-reported trial) / root cause UNKNOWN / Draft / merge NO.

## Problem and resulting request

In the user's Windows/Ollama manual trial, phi4-mini returned the original English for a Japanese translation task. HTTP/done/EOF were normal and body/final/UI counts agreed. After correcting a separate PowerShell-to-Node encoding problem, one simple direct user instruction returned a Japanese translation; the old standard request, merging its system messages, and moving its reference into user still returned English in one trial each. These bounded observations do not establish a root cause. Pre-correction direct trials are not model-capability evidence. No original user screenshots, private report links or user filesystem paths are published here.

This candidate changes only translation request assembly in buildAiMessages:

- Begin the latest user message with an explicit Japanese/English destination and a request to return the translation only.
- Put the selected target in that same user message under [翻訳対象], after optional extra instructions. Keep the existing intent that embedded instructions are source text, and ask to preserve code/Markdown structure; these words are not a prompt-injection guarantee.
- For selected text/current note/specified note, transmit the selected body without separately sending its note title or ID. App reference snapshots and labels are unchanged. For all-notes/collection, reuse the existing structured reference content so that every selected note and its boundaries/metadata remain represented. Such headers may affect model output and still need real-model evaluation.
- Preserve the caller's system instruction and valid user/assistant history, followed by the new user request. No new default model options, retries, timeout, provider or save behavior.
- Keep question, summarize and organize payloads unchanged. Translation metadata version becomes 2 and index.html loads ai-prompts.js?v=0.5.0-3 to avoid stale script reuse.

For the previously used synthetic sentence and default system instruction, the old request had 3 messages / 260 characters. The candidate has 2 messages / 197 characters. Counts identify this particular fixture and defaults, not semantic correctness. This candidate also retains system and source-format guidance, so it is not identical to the previously successful 65-character one-user-message probe. No real inference was run in the cloud. The bounded user-reported acceptance below does not establish a general fix.

## User-reported Windows acceptance, 2026-11-15 JST

Tested code HEAD: `4ba1d625d63d0900bcbd03adf45b04df03d71083`, tree `b7f66dc239cd1209c124f2fa5107a61128067ddd`. The user supplied a successful fetch/detached-checkout transcript, then copied application diagnostics and the displayed answer. These are user-reported observations; this agent did not operate or independently inspect the Windows app or capture its raw HTTP response. The diagnostics themselves do not contain a source HEAD, request hash or answer text.

With `phi4-mini:latest`, translation/Japanese, selected text, history0 and the same synthetic source `The blue bird sits by the window.`, the user reported the displayed answer `青い鳥が窓辺にいる。` (10 JavaScript characters). It is Japanese, conveys the blue bird by the window and meets this first acceptance criterion; the specific sitting posture is not explicit, so this is not a claim of perfect translation fidelity. The reported diagnostic has two messages (`system,user`), input197, HTTP200, done1, normal stream end, body/final/UI10, UI applied and no stale response. Request start: `2026-11-14T20:14:03.390Z` (`2026-11-15T05:14:03.390+09:00`); duration7144ms. The diagnostic importer and answer/count checks pass for the supplied material. See [the bounded evidence record](windows-translation-v2-acceptance-20261115.json).

Result: first acceptance PASS for this one sentence/model/settings/HEAD. The original-English symptom was absent in this trial. Repeatability, other models/languages/reference modes, real stop/reopen and the full real-model A2/B5/C2/D5 matrix remain NOT_TESTED. Root cause remains UNKNOWN and independent review remains outstanding. No retry was requested after this result. The tested code HEAD's [dedicated three-environment CI](https://github.com/tetsujisugimori-coder/memo/actions/runs/43605824053) and [ordinary CI](https://github.com/tetsujisugimori-coder/memo/actions/runs/43605824086) are SUCCESS. The separate historical Track A fixed-source guard is still FAILURE; this is not an all-CI-success claim. Any later documentation commit must keep this exact tested code identity rather than relabeling the manual result as a new inference run.

## Validation

Added seven prompt tests covering both target languages and all single-reference modes, exact source preservation, optional instructions, custom system and history, multi-note scope/boundaries, input immutability, missing-reference rejection and unchanged non-translation task wording. The app/adapter diagnostic test checks that the current translation target is in the actual final user request and not in a reference system message. The synthetic real-browser test additionally inspects actual HTTP payload roles, language, target placement and absence of the selected source from system messages, alongside the existing full payload/hash comparison.

Local focused suite: 152/152 PASS, skip0 (existing 145 plus seven new prompt tests). Syntax and diff checks PASS. Dedicated CI runs the same suite and browser flow on Ubuntu Chromium/WebKit and Windows Chromium. CI uses a synthetic HTTP service: success does not prove real translation quality. Refer to the PR for exact submitted HEAD and run results. Historical evidence under browser-audit-evidence continues to identify its original producer HEAD and must not be relabeled as evidence for this candidate.

## First user acceptance check

Once this candidate's exact HEAD is checked out in the existing isolated test copy, reload the local app so the new asset URL is used. Keep the installed model phi4-mini:latest and the app defaults/custom settings previously chosen. Start a fresh conversation, select the same synthetic English sentence, choose translation/Japanese and send once. Retain the visible answer and copied diagnostics before expiry; no success-until-retry. A normal completion with original English is still translation FAIL. Japanese translation plus matching actual response/UI text is the first acceptance observation; it does not establish repeatability or the whole A2/B5/C2/D5/stop/model/language matrix.

Do not run the old ad-hoc non-ASCII PowerShell pipelines without checking transport. For any later direct probe, use source files, ASCII Unicode escapes or an explicit Japanese marker check and preserve the distinction from browser execution. Windows settings from another shell window do not establish this window's pipe encoding. This check is separate from the application prompt candidate.
