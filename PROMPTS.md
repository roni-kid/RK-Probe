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
