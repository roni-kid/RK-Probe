# AI Usage Log — RK Probe

Maintained throughout the build, one entry per real prompt used, in the order
used. Cross-checkable against commit history per hackathon Stage 2 rules.

---

### 1. Context builder scoring logic (`contextBuilder.js`)

**Prompt used:**
"Using the file structure and design in section 6 of the build plan, design and
refine the context builder scoring logic — takes candidate mission signals
(skipped/attempts/passed) and produces a prioritized focusPlan of curriculum
days. Don't just accept the plan's pseudocode — refine the scoring weights and
edge cases together first."

**What actually happened / what changed from the plan's draft:**
- Replaced the plan's formula-based scoring (`50 + attempts * 5`) with four
  flat tiers: 100 skipped / 90 failed-but-attempted / 60 passed-after-4+-attempts
  / 30 passed-after-2–3-attempts / 10 first-try pass. The formula version could
  theoretically let a high-attempt pass outscore a skip; flat tiers can't.
- Added a 4th tier (plan only had 3) to separate "clearly struggled" (4+
  attempts) from "some friction" (2-3 attempts) — the original data has a lot
  of candidates in the 2-3 attempt range who shouldn't be lumped in with
  first-try passes.
- Added fallback handling in case a mission's `day` isn't found in
  `curriculum.json` (falls back to the mission's own title, empty objectives
  array) so the system prompt never receives `undefined`.
- Verified output against 3 real candidate profiles from `candidates.json`
  (strong: CAND-018, weak: CAND-011, mixed: CAND-016) before accepting.

**Tool:** Claude (Sonnet)
**Files touched:** `contextBuilder.js`

---

### 2. Session store, interviewer turn logic, feedback generation, server wiring

**Prompt used:**
"Continue to build — implement sessions.js, interviewer.js, feedback.js, and
server.js per sections 5, 7, 8, and 9 of the build plan, in that order (server.js
depends on the others). Keep the turn-handling and completion-detection logic
exactly as specified: code-side minimums (8 questions, 4 days) must gate
completion independently of the model's self-reported [INTERVIEW_COMPLETE]
token — don't trust the model alone."

**What actually happened:**
- `sessions.js` — copied near-verbatim from the plan's section 5, no changes;
  it was already minimal.
- `interviewer.js` — implemented the two-part completion gate: the model must
  BOTH emit `[INTERVIEW_COMPLETE]` AND have met the 8-question/4-day minimums
  in code. If the model tries to finish early, the token is stripped and the
  turn is treated as a normal question instead of trusting the model's claim.
  Implemented the `[DAY:N]` marker system from the plan (model tags each
  question, server parses it out with a regex and strips it before the
  candidate sees the reply).
- `feedback.js` — added a `stripCodeFences()` fallback in case Gemini ignores
  the "no markdown fences" instruction, plus a try/catch around `JSON.parse`
  that returns a safe placeholder feedback object instead of crashing the
  request if the model returns malformed JSON.
- `server.js` — used the plan's section 9 snippet almost as-is; added three
  small explicit guards not to expand scope but to avoid confusing 500s:
  missing `sessionId` → 400, calling into an already-`done` session → 400,
  missing `message` on an ongoing turn → 400.
- Verified the full import chain (`server.js` → `sessions.js` +
  `contextBuilder.js` + `interviewer.js` → `feedback.js`) boots without
  errors and correctly returns the expected 400 for a missing-candidate
  request. Did not test a live Gemini call in this environment (no network
  access to Google's API) — that needs verification with the real API key.

**Tool:** Claude (Sonnet)
**Files touched:** `sessions.js`, `interviewer.js`, `feedback.js`, `server.js`

---

### 3. Fix: candidate shape mismatch crashing `/api/interview` on start

**What happened:**
Local testing (curl against a real candidate payload shaped like the
`candidates.json` schema: `{ member: {...}, missions: [...], signals: {...} }`)
returned `{"error":"internal error","details":"Cannot read properties of
undefined (reading 'map')"}` on the very first start-interview request.

**Root cause:**
`server.js` was calling `buildFocusPlan(candidate.member ?? candidate)`.
`candidate.member` is only the `{id, name, jobRole, ...}` sub-object — it has
no `.missions` key, since `missions` is a sibling of `member`, not nested
inside it. `contextBuilder.js`'s `buildFocusPlan` does `candidate.missions.map(...)`
internally, so passing it `candidate.member` handed it an object with no
`.missions` at all, and `.map` threw on `undefined`.

**Fix:**
Changed the call in `server.js` to `buildFocusPlan(candidate)` — pass the
whole candidate object through, since that's what `contextBuilder.js` actually
expects. Confirmed `interviewer.js` and `feedback.js`'s own `candidate.member
?? candidate` destructuring (used only to pull `name`/`jobRole`/`yearsExperience`)
was correct as-is and did not need the same fix.

**Prompt used:**
"[pasted the exact curl error output] — debug this."

**Tool:** Claude (Sonnet)
**Files touched:** `server.js`

---

### 4. Fix: "contents are required" crash on opening interview turn

**What happened:**
After fixing the candidate-shape bug, the very first live call to Gemini
failed with `Error: contents are required` from `@google/genai`, surfaced as
a 500 from `/api/interview`.

**Root cause:**
On the opening turn, `handleTurn(session, null)` is called with no candidate
message yet (this is the "generate the first question" call). Since
`message === null`, the code correctly skipped pushing a user turn into
`session.history` — but that left `session.history` as `[]`, and Gemini's
API rejects an empty `contents` array outright.

**Fix:**
On the first-turn branch, seed `session.history` with a generic kickoff
instruction (`"Begin the interview with your opening question."`) before
calling Gemini. This is never shown to the candidate — it just gives the
model a first turn to respond to, satisfying the API's requirement that
`contents` is non-empty.

**Prompt used:**
"[pasted the exact server crash + curl error output] — debug this."

**Tool:** Claude (Sonnet)
**Files touched:** `interviewer.js`

---

### 5. Real end-to-end test against live Gemini API

**What happened:**
Ran a full multi-turn conversation locally against a real candidate
(CAND-011, Mia Alvarez — skip-heavy profile) using `curl.exe` with file-based
JSON payloads (`test-candidate.json`, `test-turn.json`) to avoid PowerShell's
quoting/escaping issues with inline JSON.

**What was verified:**
- Opening question correctly targeted a skipped focus-plan day (embeddings)
  and referenced the candidate's actual background.
- Strong/detailed answers correctly caused the interviewer to move on to a
  new topic rather than digging deeper.
- A weak answer ("idk, not really sure") was handled gracefully without
  crashing, and the model moved to a related but simpler follow-up.
- The model correctly identified an answer as describing multi-agent
  orchestration even though the candidate never used that term — confirms
  follow-ups are grounded in actual answer content, not a static script.
- No `[DAY:N]` tag or `[INTERVIEW_COMPLETE]` token ever leaked into a reply
  shown to the candidate across ~8 turns.
- Noted one soft limitation: the model isn't always perfectly linear about
  which question is "current" (re-raised an earlier half-answered question
  once after a topic switch) — not a bug, a known LLM-history-following
  limitation, documented in README.

**Tool:** Manual testing (curl), no additional AI prompt for this step —
debugging/observation only.
**Files touched:** none (validation only)

---

### 6. Deployment prep + real README

**Prompt used:**
"Add a start script to package.json for Render. Then write the real README —
what RK Probe does, architecture, how to run locally, curl API examples, known
limitations — replacing GitHub's auto-generated placeholder."

**What actually happened:**
- Added `"scripts": { "start": "node server.js" }` to `package.json` so
  Render's default Node build/start flow (`npm install` → `npm start`) works
  without extra Render-side configuration.
- Wrote README.md covering: what RK Probe does and why the context-builder
  scoring matters, full architecture/file breakdown, local run instructions,
  a real curl example matching the actual API contract (start interview +
  continue conversation + completed-interview feedback shape), and known
  limitations (in-memory sessions, no auth — both deliberate per spec, plus
  the soft model-linearity limitation found in testing).
- Also resolved a git history snag: an early abandoned push attempt had left
  two orphan commits on the GitHub remote (`Initial commit` + a first
  `chore: init project + express skeleton`) before the real build sequence
  existed locally. Rather than force-pushing over them (deleting real, if
  early, history), merged with `git pull --allow-unrelated-histories`, then
  manually resolved the resulting add/add conflicts by keeping the local
  (correct, tested) version of every conflicted file. Preserved every real
  commit rather than discarding any — important given the hackathon's stated
  disqualification risk for sparse/non-incremental commit history.

**Tool:** Claude (Sonnet)
**Files touched:** `package.json`, `README.md`

---

### 7. Edge-case testing round (section 10 of build plan)

**What was tested, all against the live local server with a real Gemini key:**

- **Unknown `sessionId` sent with a `message` (no `candidate`)** — confirmed
  clean `400 {"error":"candidate required to start a new session"}` response,
  no crash, no 500. First attempt via inline PowerShell JSON hit a false
  alarm (a `SyntaxError` from body-parser) caused by PowerShell's JSON
  escaping mangling the request body itself — not a real bug, confirmed by
  re-running the same test via a file-based `-d "@file.json"` payload
  instead, which passed cleanly.
- **Off-topic candidate answer** ("do you think pineapple belongs on
  pizza?") — confirmed the interviewer briefly acknowledged the tangent
  without engaging with it, then redirected immediately back to the pending
  technical question. Matches the plan's requirement to handle off-topic
  answers gracefully.
- **Server restart mid-conversation** — started a real interview, restarted
  the Node process, then sent a follow-up message to the now-defunct
  `sessionId`. Confirmed it fails cleanly with the same
  `{"error":"candidate required to start a new session"}` response rather
  than hanging or crashing. This is the accepted, documented in-memory-only
  scope limitation from the plan — verified it degrades safely rather than
  silently corrupting state.

All three edge cases from section 10 of the build plan now verified.

**Tool:** Manual testing (curl) — no new AI-authored code this round, only
diagnosis of one false-alarm error along the way.
**Files touched:** none (validation only)

---

### 8. Render deployment

**What was done:**
Deployed to Render's free web service tier per plan section 3. Configured:
- Runtime: Node
- Branch: `main`
- Build Command: `npm install`
- Start Command: `npm run start`
- `GEMINI_API_KEY` set as a Render environment variable (never committed to
  git — set directly in Render's dashboard)

**Verification:**
Build succeeded on first attempt (`npm install` — 94 packages, no errors).
Ran the same start-interview curl test used for local testing, but against
the live URL (`https://rk-probe.onrender.com/api/interview`) instead of
localhost. Got back a real Gemini-generated opening question correctly
targeting the candidate's skipped focus area (embeddings) — confirms the
`GEMINI_API_KEY` environment variable is correctly wired on Render's side and
the full request pipeline (Express → sessions → contextBuilder → interviewer
→ Gemini) works identically in production as it did locally.

Live demo URL: https://rk-probe.onrender.com

**Tool:** Manual deployment via Render dashboard (no AI-authored code this
step — infrastructure/config only).
**Files touched:** none (deployment config, not committed code)

---

### 9. Minimal Render-hosted chat frontend

**Session log:** 2026-08-08 | Frontend and Render static hosting | Codex

**Prompt used:**
"Build a minimal, single-page chat UI for RK Probe. Use only plain HTML, CSS,
and vanilla JavaScript; load `candidates.json`, call the existing
`POST /api/interview` endpoint, display messages, loading, errors, and final
feedback. Keep it a thin client with no interview logic. We will use Render."

**What actually happened:**
- Added `public/index.html`, `public/style.css`, and `public/app.js` with no
  framework, packages, build step, local storage, retries, or client-side
  interview decisions.
- Added static-file serving to `server.js` so the existing Render web service
  serves the UI and the supplied `candidates.json` from the same origin. This
  keeps the frontend's single `fetch('/api/interview')` call free of CORS
  configuration while preserving the API contract.
- Added clear network/API error banners, disabled controls while a request is
  in flight, auto-scrolling chat bubbles, and structured completion feedback.
- Documented the UI and a browser limitation: `file://` pages cannot fetch a
  neighbouring JSON file due to normal browser security, so use the Render
  URL or local Express server.

**Tool:** Codex
**Files touched:** `server.js`, `public/index.html`, `public/style.css`,
`public/app.js`, `README.md`, `PROMPTS.md`

---

### 10. Visual redesign of the browser UI

**Session log:** 2026-08-08 | Interview workspace redesign | Codex

**Prompt used:**
"Redesign the working RK Probe UI based on the supplied screenshot while
keeping the existing API behavior and thin-client architecture."

**What actually happened:**
- Reworked the page into a focused interview workspace with a compact brand
  header, online status, stronger hero copy, setup/conversation step labels,
  and a dedicated interview-room frame.
- Added clearer responsive spacing, accessible labels, empty-state guidance,
  polished message bubbles, textarea composer styling, status chips, and
  structured feedback presentation without adding dependencies or client-side
  interview logic.
- Verified the redesigned page in the local browser at desktop width, including
  candidate loading and the empty interview state.

**Tool:** Codex
**Files touched:** `public/index.html`, `public/style.css`, `public/app.js`,
`PROMPTS.md`

---
### 11. Frontend visual redesign (design tokens + accessibility pass)

**Prompt used:**
"Use the ui-styling and ui-ux-pro-max skills to redesign the UI of the
frontend. Keep the existing plain HTML/CSS/JS architecture — no new
libraries, no build step, no framework — since I need to be able to read
and modify every line under Stage 4 time pressure."

**What actually happened:**
- Rewrote `public/style.css` around a CSS custom-property token system
  (color, spacing, radius, motion) instead of the original flat hardcoded
  values — makes re-theming a one-line change per token, not a hunt-and-replace.
- Added a Space Grotesk / Inter font pairing (previously system-font only).
- Ran the new styling against the ui-ux-pro-max accessibility/touch/typography
  checklists: confirmed 4.5:1 contrast, 48px minimum touch targets on all
  buttons/inputs, visible focus rings preserved (not stripped), and added a
  `prefers-reduced-motion` override for the new message/typing animations.
- Added a small status indicator (dot + text) to `index.html`'s chat panel
  header, wired up in `app.js` via one new `setStatus()` helper called at the
  three points interview state changes (start / live / complete). No other
  logic in `app.js` was touched — same fetch calls, same session handling,
  same error handling as before.
- Deliberately did NOT introduce Tailwind, React, or any build tooling despite
  ui-ux-pro-max's default stack recommendations leaning that direction — chose
  the plain-CSS design-token approach from ui-styling instead, to keep the
  file structure and everything explainable under Stage 4 pressure.

**Tool:** Claude (Sonnet)
**Files touched:** `public/index.html`, `public/style.css`, `public/app.js`

---

### 12. Push-to-talk voice input

**Prompt used:**
"Add voice input — push-to-talk (hold to record, release to transcribe)."

**What actually happened:**
- Added a mic button to `public/index.html` inside the existing answer form,
  using the browser's native `SpeechRecognition` API (feature-detected via
  `window.SpeechRecognition || window.webkitSpeechRecognition`) — no new
  dependencies.
- Implemented as push-to-talk: `mousedown`/`touchstart` starts recognition,
  `mouseup`/`mouseleave`/`touchend`/`touchcancel` stops it. Chose push-to-talk
  over auto-send-on-silence to avoid premature cutoffs and keep the candidate
  in control of when their answer is actually sent — matches the existing
  "type, then hit Send" pattern rather than replacing it.
- Voice input only ever writes into the existing `answerInput` textarea; it
  never calls the API directly. The existing submit handler, session logic,
  and API contract are completely untouched.
- Feature-detected gracefully: if `SpeechRecognition` isn't supported (e.g.
  Firefox), the mic button stays `hidden` and the candidate types as before
  — no broken UI, no console errors.
- Handled three failure states with inline, non-blocking status messages:
  permission denied, no speech detected, and generic recognition errors —
  all fall back to "you can still type your answer."
- Wired mic-button disabled state into the existing `setWaiting()` function
  so it's disabled/stopped at the same points the textarea and send button
  already are (during an in-flight request, or once the interview is done).
- Verified: `node --check` on the updated `app.js` (syntax), and a manual
  brace-balance check on the CSS additions. Did not have live-microphone
  access in this environment — needs a real click-through test on your end,
  in at least Chrome and one browser without SpeechRecognition support
  (e.g. Firefox) to confirm the graceful-hide fallback.

**Tool:** Claude (Sonnet)
**Files touched:** `public/index.html`, `public/style.css`, `public/app.js`

---

### 13. Fix: form/typing-indicator visible before interview start, and silent mic failures

**What happened:**
Screenshot review showed the typing indicator and answer form visible on the
initial "waiting to start" screen, and holding the mic button pulsed red but
never produced a transcript, with no visible error.

**Root cause 1 (CSS):**
`.typing-indicator` and `.answer-form` both set `display: flex` unconditionally.
A class selector's `display` value beats the browser's low-specificity
`[hidden] { display: none }` default, so the `hidden` attribute was silently
losing to these rules despite being correctly present in the HTML.

**Root cause 2 (voice UX):**
`SpeechRecognition.stop()` only attempts to return a result from audio
captured so far — if released too quickly (a tap rather than a genuine hold),
there may be too little audio for any result, and no error event fires either.
This is a known rough edge of the API (Chromium implementations sometimes cut
off before delivering final results on short recordings), not a logic bug —
but it read as "silently broken" without feedback.

**Fix:**
- Added `[hidden] { display: none !important; }` as a global override so
  `hidden` always wins regardless of what else targets the element.
- Added a minimum-hold threshold (350ms) with an explicit "hold a little
  longer" nudge if released too fast.
- Added a "Finishing up…" status the instant the mic is released, and a
  fallback "didn't catch that" message if recognition ends with no
  transcript — so there's never silent, unexplained failure.

**Prompt used:**
"[pasted screenshot + description: mic button turns red/pulses but doesn't
transcribe] — the mic icon is there but doesn't work."

**Tool:** Claude (Sonnet)
**Files touched:** `public/index.html` (unchanged, verified only),
`public/style.css`, `public/app.js`

---

### 14. Three-column workspace redesign + real progress data from the API

**Prompt used:**
"Redesign the UI toward a dark glassy/gradient three-column layout (candidate
context left, conversation center, progress right), styled like a set of
reference mockups, but only borrow the layout/visual pattern — never fabricate
data the backend doesn't actually produce. Extend the API response to include
real focusPlan/daysCovered data for the right panel."

**What actually happened:**
- Reviewed 8 AI-generated UI mockups the user supplied. Explicitly declined to
  copy their content (camera feeds, sentiment scores, "fit scores," cartoon
  avatars) since RK Probe's API doesn't generate any of that — only borrowed
  the three-column structural pattern several of them shared.
- **Backend change (`interviewer.js`):** `handleTurn()` now returns a
  `progress` object on every non-final turn: `questionsAsked`, `minQuestions`,
  `minDays`, `daysCovered` (array, converted from the session's `Set`), and a
  **redacted** `focusPlan` (day + title only — `reason` is deliberately
  stripped, since the system prompt already tells the model not to reveal
  *why* each day was chosen to the candidate; exposing it via the API would
  leak the same information through a side channel). `server.js` needed no
  changes since it already passes through whatever `handleTurn` returns.
- **Frontend (`index.html`/`style.css`/`app.js`):** restructured the page into
  a `.workspace` grid with three siblings — a candidate-context `aside`
  (avatar initials, name, role, experience, education), the existing chat
  `section` (internals untouched), and a progress `aside` (question count,
  animated coverage bar, focus-day list with a "covered" highlight state).
  Added a dark glass surface treatment (subtle gradient + backdrop blur)
  across all panels to match the chosen reference style.
- Explicitly kept the focus-day list in **priority order** (skipped → failed
  → struggled → first-try), not day-number order, on the user's explicit
  instruction — the out-of-sequence order is the context-builder's scoring
  logic made visible, not a bug.
- Verified: `node --check` on `interviewer.js` and `app.js`, manual brace-
  balance check on `style.css`, traced `sessions.js`/`server.js` to confirm
  `session.focusPlan` is always populated before `handleTurn` first runs.

**Tool:** Claude (Sonnet)
**Files touched:** `interviewer.js`, `public/index.html`, `public/style.css`,
`public/app.js`

---

### 15. Fix: chat panel not filling its grid column when side panels are hidden

**What happened:**
Screenshot showed the chat panel rendering at roughly 1/5 the container width
before the interview started, with visible dead space on both sides, even
though the candidate/progress panels were correctly `hidden`.

**Root cause:**
`grid-template-columns: 240px minmax(0, 1fr) 280px` reserves all three column
tracks regardless of whether the grid items inside them are `display: none`.
Hiding an item removes it from layout, but does not collapse the column track
it would have occupied — so the chat panel's `1fr` was only ever splitting
whatever space was left after 240px + 280px of empty column were already
claimed.

**Fix:**
`.workspace` now starts as a single column (`minmax(0, 1fr)`). JS adds a
`.workspace--active` class (via `workspace.classList.add(...)` in the start-
interview handler) the moment both side panels are actually populated and
revealed, which is the only point the three-column template applies. Also
had to raise the specificity of the existing `@media (max-width: 960px)`
mobile-stacking rule (`.workspace, .workspace.workspace--active { ... }`) so
it would still correctly override the active three-column state on narrow
screens — a plain `.workspace` media-query selector would otherwise lose to
the more specific `.workspace.workspace--active` rule.

**Prompt used:**
"[pasted screenshot showing the narrow chat panel with dead space on both
sides]"

**Tool:** Claude (Sonnet)
**Files touched:** `public/style.css`, `public/app.js`

---

### 16. Firefox voice input via server-side Gemini transcription

**What happened:**
User asked why the mic button was missing in a Firefox screenshot. Root cause
(confirmed, not assumed): Firefox has no native `SpeechRecognition` support,
so the existing feature-detection correctly left the button hidden — not a
regression. User was shown a third-party doc proposing a "vanilla JS voice
command router" as a fix; this was rejected after review, since its only real
Firefox-support suggestion was asking the *candidate* to manually enable an
experimental `about:config` flag, which is unusable for a hackathon demo where
judges use their own default-configured browsers. Chose real cross-browser
support instead: record locally, transcribe server-side via Gemini.

**Prompt used:**
"nah let's find a way" (in response to being shown the about:config-flag
workaround) → confirmed via follow-up: "Yes, build it — I accept the added
latency/complexity for real cross-browser voice" after being told this adds a
new endpoint, real network latency, and more Stage-4 surface area to explain.

**What actually happened:**
- **New file `transcribe.js`:** one exported function, same one-function-
  per-file pattern as `feedback.js`. Sends base64 audio to Gemini via
  `inlineData: { mimeType, data }` (verified against Gemini's actual
  documented JS SDK contract via web search before writing any code, rather
  than guessing at the shape). Validates the mime type against Gemini's
  documented supported list (WAV/MP3/AIFF/AAC/OGG/FLAC) before calling the
  API, so an unsupported format fails fast with a clear error.
- **`server.js`:** added `POST /api/transcribe`, a route fully separate from
  `/api/interview` — no changes to the interview contract. Raised the JSON
  body size limit from Express's 100kb default to 10mb, since base64-encoded
  audio (even a few seconds) exceeds 100kb easily.
- **`public/app.js`:** restructured the voice-input block so `startRecording`/
  `stopRecording` are chosen once at load time based on feature detection:
  native `SpeechRecognition` where available (unchanged behavior), otherwise
  `MediaRecorder` + `POST /api/transcribe` if `MediaRecorder` and
  `getUserMedia` exist. Both paths converge on the same `showVoiceStatus`/
  `clearVoiceStatus` UI feedback functions, so the mic button's event
  listeners don't need to know which implementation is active.
- Specifically requests `'audio/ogg;codecs=opus'` from `MediaRecorder`
  (verified via web search that Firefox has supported this combination since
  version 29, and that OGG is on Gemini's documented supported list —
  `audio/webm`, Chromium's default, is NOT documented as Gemini-supported,
  so it was deliberately avoided rather than gambled on).
- Verified: `node --check` on `server.js`, `transcribe.js`, and the full
  restructured `app.js`; manually traced the `micButton.hidden` branch logic
  across all three cases (SpeechRecognition available / MediaRecorder-only /
  neither) with a small standalone script to confirm listeners attach
  correctly in exactly the two cases they should. Did not have live-
  microphone access in this environment to test an actual Firefox recording
  round-trip — needs real end-to-end verification (hold mic → speak →
  release → confirm transcript lands in the textarea) on the user's machine
  in Firefox specifically, plus a regression check that Chrome/Edge behavior
  is unchanged.

**Tool:** Claude (Sonnet)
**Files touched:** `transcribe.js` (new), `server.js`, `public/app.js`

---

### 17. Ambient CSS-only background motion

**Prompt used:**
"[background-motion-handoff.md spec, pasted in full] — implement CSS-only
ambient background motion behind the workspace UI, pure CSS/keyframes only,
no JS, no new files, respecting prefers-reduced-motion."

**What was actually implemented:**
- Used a `body::before` pseudo-element rather than a dedicated `<div>` —
  avoids touching `public/index.html` entirely, per the spec's stated
  preference for the simpler option.
- Two low-opacity (0.12) radial gradients using the existing palette's
  accent blue (`#5b8cff`) and teal (`#2c6657`), positioned at opposite
  corners.
- Single `@keyframes bg-drift` animates `background-position` back and
  forth over a 40s `ease-in-out infinite` loop — no transform, no opacity
  animation, nothing beyond one property.
- `z-index: -1` and `pointer-events: none` so it never intercepts clicks
  or affects layout/stacking of any existing element.

**Files touched:** `public/style.css` only (no HTML changes).

**prefers-reduced-motion handling:** confirmed via a
`@media (prefers-reduced-motion: reduce)` block that sets
`animation: none` on `body::before`, leaving the static gradient in place
(not removing the gradient itself — just the motion).

**Tool:** Claude (Sonnet)

---

---

### 18. Ambient CSS-only sound-wave bars

**Prompt used:**
"[sound-wave-handoff.md spec, pasted in full] — implement a minimalist
CSS-only ambient sound-wave bar animation, decorative only, no JS, no real
audio/mic wiring, coexisting with the existing background-motion CSS."

**What actually implemented:**
- 7 thin bar `<span>` elements inside one `.sound-wave` wrapper `<div>`,
  added directly after `<body>` opens in `public/index.html`. Tried the
  no-HTML-change route first (per the spec's stated preference) but a
  single pseudo-element can't independently stagger multiple bars without
  JS — the spec's own fallback explicitly allows a small markup block in
  that case, so used one.
- Each bar animates `transform: scaleY()` (not `height`, to avoid layout
  recalculation) via one shared `@keyframes wave-bar`, alternating from
  1x to 2.6x scale over a 2.4s ease-in-out loop.
- Staggered via seven `nth-child` `animation-delay` rules (0s/0.3s/0.6s/
  0.9s, mirrored back down) so bars ripple rather than pulse in lockstep.
- Colors: `var(--accent)` on odd bars, `var(--candidate-accent)` on even
  bars — the two existing accent tokens already used for interviewer/
  candidate message bubbles elsewhere in the UI. No new hex values
  introduced, matching the spec's palette-reuse requirement (adjusted for
  the fact the spec's listed hex values were from an earlier version of
  the stylesheet — the current file uses CSS custom properties instead,
  so pulled from those tokens rather than the spec's literal hex codes).
- Positioned as a fixed strip along the bottom of the viewport, `z-index:
  -1`, `pointer-events: none`, `opacity: 0.1` — same opacity range as the
  existing background-motion gradient, so neither competes with the other
  or with foreground text.
- Confirmed it coexists with the prior background-motion `body::before`
  layer rather than conflicting: used `.sound-wave` as a separate fixed
  element instead of `body::after`, so both can be independently edited
  or deleted without touching the other.

**prefers-reduced-motion handling:** no new media query added — confirmed
the stylesheet's existing blanket rule (`*, *::before, *::after {
animation-duration: 0.001ms !important; ... }`) already applies to
`.sound-wave span`, since it's a plain element covered by the universal
selector.

**Confirmation this is ambient-only:** verified no JS file was touched and
no event listener, Web Audio API call, or state read was added anywhere —
the bars run purely on CSS `@keyframes` timing, entirely decoupled from
mic input, message arrival, or any other app/conversation state.

**Files touched:** `public/style.css`, `public/index.html`.

**Tool:** Claude (Sonnet)

---

### 19. Hard safety cap on question count

**Prompt used:**
"[rk-probe-reliability-polish-plan.md, item 1] — add a hard
`MAX_QUESTIONS` fallback so an interview can't run indefinitely if a
candidate gives short/evasive answers and the model never reaches
`[INTERVIEW_COMPLETE]` with minimums met."

**What was actually implemented:**
- Added `MAX_QUESTIONS = 15` to `interviewer.js`, with a comment explaining
  it's a fallback safety net, not the primary completion mechanism — the
  existing two-part gate (`[INTERVIEW_COMPLETE]` token + `minimumsMet`)
  still runs first and is unaffected.
- In `handleTurn`, after `session.questionsAsked` is incremented and the
  transcript entry is pushed, added a forced-completion branch: if the
  count has reached `MAX_QUESTIONS`, call `generateFeedback`, set
  `session.done = true`, and return the same completion shape as a genuine
  finish — **regardless of `daysCovered.size`**, per the plan's explicit
  instruction not to gate the forced path on the days minimum.
- Added a `console.warn` when the forced path fires, logging
  `questionsAsked` and `daysCovered.size` so it's easy to tell during
  testing whether it's firing more than expected.

**Companion fix in `feedback.js`:** added a thin-transcript check —
counted `answeredTurns` (transcript entries with a non-null answer) and,
when fewer than 2, appended an explicit note to the feedback prompt
instructing the model to acknowledge the interview was cut short rather
than produce confident-sounding feedback from sparse data. This only
changes the prompt text; the JSON shape returned is unchanged.

**Verification:**
- Wrote a standalone test harness (`run.mjs`) with a stubbed
  `@google/genai` module that always returns a short, non-completing
  reply (never emits `[INTERVIEW_COMPLETE]`), simulating a candidate who
  gives evasive answers ("idk") every turn. Ran `handleTurn` in a loop:
  confirmed the interview forcibly concluded at exactly
  `questionsAsked === 15` with `done: true`, even though `daysCovered.size`
  was only 1 (well under `MIN_DAYS = 4`) — confirming the forced path does
  **not** wait on the days minimum, as specified.
- Confirmed `generateFeedback` was still called and returned a normal
  feedback shape (`summary`/`strengths`/`gaps`/`next`) even on the thin,
  forced-completion transcript (14 answered questions in the stub run,
  which is well above the "explicitly note it was cut short" threshold of
  2 answered turns).
- Separately verified the redaction boundary the plan flagged as most
  worth double-checking (see item 23 below) is untouched by this change —
  every non-final `progress` object still contains only `day`/`title`
  per focus entry.

**Files touched:** `interviewer.js`, `feedback.js`.

**Tool:** Claude (Sonnet)

---

### 20. `GET /health` endpoint

**Prompt used:**
"[rk-probe-reliability-polish-plan.md, item 2] — add a fast, cheap health
check so the live Render deployment can be checked/woken before a demo
without spending a real interview session."

**What was actually implemented:**
- Added `app.get('/health', ...)` to `server.js`, returning
  `{ status: 'ok', service: 'rk-probe', timestamp: <ISO string> }`.
- Placed it immediately before the existing `/candidates.json` and
  `/api/interview` routes, per the plan's note that it reads clearly as
  "check this first" even though Express route order doesn't functionally
  require it.

**Verification:**
- `node --check server.js` confirms no syntax errors from the edit.
- `curl http://localhost:3000/health` (documented as the local check in
  the plan) returns the expected JSON shape; the live-deployment
  cold-start check is a manual post-deploy step, not something testable
  from this environment.

**Files touched:** `server.js`.

**Tool:** Claude (Sonnet)

---

### 21. Retry-once on a failed Gemini call

**Prompt used:**
"[rk-probe-reliability-polish-plan.md, item 3] — add one shared retry
helper and wrap the Gemini calls in `interviewer.js` and `feedback.js` so
a single transient blip doesn't immediately surface as a 500 mid-interview."

**What was actually implemented:**
- Created `retry.js` with a single exported `withRetry(fn, { retries = 1,
  delayMs = 500 })` helper, matching the plan's spec exactly — one retry
  (two attempts total) after a fixed delay, re-throwing the last error if
  every attempt fails.
- Wrapped the `ai.models.generateContent(...)` call in `interviewer.js`
  with `withRetry(() => ...)`, and did the same in `feedback.js`.
  `transcribe.js` was left unwrapped, matching the plan's "optional, lower
  priority" note for that file.
- Left the existing `server.js` error handling untouched — if `withRetry`
  exhausts its retry, the error still propagates up to the existing
  try/catch in the `/api/interview` route and returns a normal 500. No
  silent failure was added anywhere.

**Verification:**
- Wrote a standalone test script exercising `withRetry` directly with
  three cases: (1) a function that throws once then succeeds — confirmed
  it resolved to the success value after exactly 2 calls; (2) a function
  that always succeeds — confirmed it was called exactly once with ~0ms
  added latency (no delay incurred when there's no failure); (3) a
  function that always throws — confirmed it was called exactly 2 times
  (1 retry) and the original error was re-thrown to the caller rather than
  swallowed. All three cases passed.
- Confirmed via `node --check` that `interviewer.js` and `feedback.js`
  still parse correctly with the wrapped calls.

**Files touched:** `retry.js` (new), `interviewer.js`, `feedback.js`.

**Tool:** Claude (Sonnet)

---

### 22. Restart / new-candidate action in the UI

**Prompt used:**
"[rk-probe-reliability-polish-plan.md, item 4] — add a way back to the
candidate picker once an interview has started or completed, without a
page refresh."

**What was actually implemented:**
- Added a "New candidate" button (`#restart-button`) to the
  `chat-panel-header` in `public/index.html`, next to the status dot,
  hidden by default and pushed to the right edge of the header via
  `margin-left: auto`.
- Shown it as soon as an interview successfully starts (in the existing
  `startButton` click handler), so it's visible for both in-progress and
  completed interviews, per the plan.
- Added a `resetToStart()` function in `public/app.js` that clears all
  client-side state: `sessionId` and `interviewComplete` reset, messages
  list cleared back to the original empty-state message, the answer form
  hidden and cleared, feedback section hidden and emptied, candidate/
  progress side panels hidden and cleared, the `workspace--active` class
  removed, in-progress voice recording stopped if active, and the
  candidate `<select>` / `start-button` re-enabled to match their
  page-load state. Deliberately does **not** call the backend to delete
  the session — per the plan, the old session is simply left orphaned in
  the server's in-memory `Map`, consistent with the documented
  no-persistence scope in `sessions.js`.

**Verification:**
- Read through the full reset path against every piece of state the app
  tracks (`sessionId`, `interviewComplete`, DOM content of `#messages`,
  `#feedback`, `#focus-list`, panel `hidden` attributes, `workspace`
  class list, button `disabled` state) and confirmed each one is restored
  to its exact page-load value, matching the plan's verification
  checklist item-for-item.
- `node --check app.js` confirms no syntax errors from the edit; confirmed
  button/DOM tag counts in `index.html` remain balanced.

**Files touched:** `public/index.html`, `public/app.js`, `public/style.css`
(secondary/ghost `.button-secondary` variant + `.restart-button`
positioning, reused for item 24's copy button too).

**Tool:** Claude (Sonnet)

---

### 23. Post-interview reasoning reveal

**Prompt used:**
"[rk-probe-reliability-polish-plan.md, item 5] — reveal the un-redacted
`focusPlan` (with `reason`) once the interview is done, since that's what
demonstrates RK Probe's editorial decision-making, while making sure the
redaction during the interview is untouched."

**What was actually implemented:**
- Server-side: both completion paths in `interviewer.js` — the genuine
  `[INTERVIEW_COMPLETE]` + `minimumsMet` path and the `MAX_QUESTIONS`
  forced-cap path added in item 19 — now include `focusPlan:
  session.focusPlan` (the full objects, with `reason`) alongside
  `feedback` in the returned `done: true` response.
- `buildProgressSummary`, which runs on every non-final turn, was left
  completely untouched — it still maps `focusPlan` down to only `{ day,
  title }` per entry, exactly as before.
- Client-side: added `renderFocusReasoning(focusPlan)` in `public/app.js`,
  rendering a collapsed `<details>`/`<summary>` block titled "Why these
  focus areas" beneath the existing summary/strengths/gaps/next content,
  listing `day`, `title`, and `reason` for each focus entry. Styled in
  `public/style.css` as visually secondary (smaller, muted text, a
  top border separating it from the main feedback) so it doesn't compete
  with the primary feedback content.
- `renderFeedback` now takes a second `focusPlan` argument; the call site
  in the `answerForm` submit handler passes `result.focusPlan` through.

**Verification (the item the plan flagged as most worth double-checking):**
- Wrote a standalone test harness reusing the item-19 stub setup. Ran one
  non-final turn and confirmed `progress.focusPlan` contained only
  `day`/`title` — no `reason` key present at all (checked via
  `JSON.stringify(...).includes('reason')` returning `false`).
- Ran the same session through to forced completion and confirmed the
  final `focusPlan` on the `done: true` response **did** include the
  `reason` field, with its value matching what `contextBuilder.js` would
  have produced for that entry.
- This confirms the redaction boundary is exactly where it should be:
  hidden on every turn before `done: true`, revealed only once.

**Files touched:** `interviewer.js`, `public/index.html` (no structural
change needed — feedback section already existed), `public/app.js`,
`public/style.css`.

**Tool:** Claude (Sonnet)

---

### 24. Feedback export/copy button

**Prompt used:**
"[rk-probe-reliability-polish-plan.md, item 6] — add a copy-to-clipboard
button for the completed feedback, formatted as clean plain text."

**What was actually implemented:**
- Added `formatFeedbackAsText(feedback)` in `public/app.js`, converting
  the feedback object into plain-text lines (a title, the summary, then
  `Strengths:`/`Gaps:`/`Next steps:` sections with `-`-prefixed bullets,
  skipping any section that's empty) — no JSON braces or quotes in the
  output.
- Added `createCopyFeedbackButton(feedback)`, rendered inside a new
  `.feedback-header` flex row next to the "Interview feedback" heading
  (rather than as a separate button elsewhere), using
  `navigator.clipboard.writeText(...)`. On success the label swaps to
  "Copied!" for 2 seconds before reverting, matching the transient-status
  pattern already used for `#voice-status` elsewhere in the app; on
  failure it shows "Copy failed" for 2 seconds instead of throwing.
- The button only exists once `renderFeedback` runs (i.e. only after
  `done: true`), so it can't appear before feedback exists. Clicking it
  twice in a row is safe — the click handler clears any pending reset
  timer before scheduling a new one, so rapid double-clicks can't leave
  the label stuck on "Copied!".
- No file-download version was added, per the plan's explicit instruction
  to skip that unless there was spare time.

**Verification:**
- Traced `formatFeedbackAsText` against a sample feedback object by hand
  and confirmed the output reads as clean plain text with no stray
  JSON syntax.
- Confirmed in the code path that the button is only ever constructed
  inside `renderFeedback`, which is only ever called from the `done: true`
  branch of the answer-submit handler — it cannot render before feedback
  exists.
- `node --check app.js` confirms no syntax errors; visually re-checked
  the `.feedback-header` / `.copy-feedback-button` CSS reuses existing
  tokens only (`--text-secondary`, `--success`, `--border-strong`, spacing
  scale) — no new colors introduced.

**Files touched:** `public/app.js`, `public/style.css`.

**Tool:** Claude (Sonnet)

---
