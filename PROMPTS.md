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