# Windows comparison automation (Stage 1, diagnostic-only)

Scope: explicit-launch, synthetic-only **direct Ollama vs production adapter** comparison. This is NOT automatic application/DOM/real-screen acceptance. Production scripts, prompts, model settings and Track A guards are unchanged. Root cause remains UNKNOWN and merge recommendation NO.

## Before execution

Windows and PowerShell 7 execution have not yet been verified. Existing Windows checkout differences are UNKNOWN while disconnected. Preserve those files; use a separately verified checkout of this PR. Node 20+ is required (fetch, statfsSync, AbortSignal.timeout). No package install is needed for the command. A service probe cannot establish where Ollama is installed: missing CLI reports NOT_FOUND, service availability is separate. Playwright package availability is not proof of installed browsers or browser execution.

Choose an existing, dedicated local output directory with at least 32 MiB free. Outputs use a new UUID leaf; no overwrite or cleanup. CLI `plan` performs no network or inference. `probe` only requests fixed localhost /api/version and /api/tags and reads CLI version; it never starts a service or downloads models. Each request has a 5 second timeout. Private custom model names can appear in local metadata: review before sharing.

```powershell
pwsh -File scripts/ai-stage1-validation.ps1 -Mode plan
pwsh -File scripts/ai-stage1-validation.ps1 -Mode probe
# Only this deliberate command begins model inference:
pwsh -File scripts/ai-stage1-validation.ps1 -Mode run -Model 'existing-model-id' -OutputDirectory 'D:\dedicated-output' -Execute
```

Run starts only for an ID from the service's installed-model list. No download, remote endpoint, API key, external data or storage access. The fixed 14 trials are A2/B5/C2/D5 in MANUAL.md order, each direct then adapter: **maximum 28 generation requests, no retries**, 60 seconds absolute per request and 1 MiB response bound. Stop at a communication/error/incomplete trial; no success-until-retry. Ctrl+C can leave a partial run; retain saved per-trial raw files. A missing final manifest/report means INCOMPLETE, not PASS. Output contains metadata only, never input/answer/thinking text or exception strings. Responses/history exist in memory while running; no screenshots collected.

Both lanes use the same buildAiMessages output, defaults, reference, model, options and prior direct-lane synthetic answers. B/D share successive history, A/C reset. Translation history excludes empty user input just like the app. The direct and adapter responses may differ because inference is nondeterministic; exact answer equality is not an assertion. This paired-history design controls lane input, but does not reproduce two independently evolving app sessions. Browser adapter streaming differs from Node fetch; diagnose, do not generalize.

## Evidence and comparison

`raw/` contains source-file SHA-256, fixed plan, environment and separate per-trial diagnostics. `analysis/` contains Markdown/JSON comparisons. `manifest.json` lists size and full-byte SHA-256 for saved files except itself. Source hashes identify working bytes, not a verified Git commit; record the checked out HEAD/tree separately. A new process must verify the manifest before claiming archival completeness. A filesystem write alone is not independent archival verification.

Evidence pairing requires unique request IDs and identical model/purpose/reference/history/input counts. `PAIR_OBSERVED` means only this pairing check passed; it does not prove authenticity, completeness, correctness, or app acceptance. Error categories distinguish thinking-only, empty, done missing, timeout, interruption, communication errors and missing data. Model/prompt/Ollama, transport/adapter and finalization labels are candidates only, never roots.

## Application / screen work still required

Use MANUAL.md with an empty isolated browser profile and synthetic note only. Keep app defaults identical, capture each request's diagnostic JSON before 20 records / 30 minutes expire. Match trial ID manually to requestId, history count, model and purpose. App and harness independently generated histories are not automatically equivalent: if message-level identity is not established, mark comparison NOT_COMPARABLE. Do not infer visibility from uiCharacters.

The harness does not import arbitrary diagnostic files: no unsafe raw-log copying or automatic acceptance. Manual comparison must distinguish body received / final text / DOM count / actual visibility; mismatched or missing logs are UNKNOWN. Language ja→en→ja, stop, panel close/reopen/new request, alternate installed model, diagnostics ON/OFF and delayed old/new app response are still **PENDING_MANUAL**. Existing mocks test some contracts, not real browser behavior. Never call Node adapter tests real application tests.

## Verification

`node --test ai-stage1-validation.test.cjs` adds bounded mocked transport comparisons. Run the existing AI suite listed in README.md unchanged. Real Ollama, Windows PS7, actual UI and visual correctness are NOT_TESTED until performed; basis construction and real-model acceptance are separate. Track A historical guard failure and Track B skip are not fixed by this work.
