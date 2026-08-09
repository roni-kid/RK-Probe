# RK Probe

An AI technical interviewer that adapts its questions to each candidate's actual
learning signals. Built for ABTalks Vibe Code Hackathon (Track 2), solo, by RK
(RoniKid).

RK Probe reads a candidate's cohort progress data — which topics they skipped,
which they struggled with (multiple attempts), which they passed on the first
try — and uses that to decide what to probe deeper on in a live conversational
interview. It doesn't ask the same fixed question list to everyone: a candidate
who skipped vector databases gets asked about vector databases; a candidate who
breezed through everything gets lighter confirmation questions across the board
instead.

## What it does

1. **Reads candidate signals** (`contextBuilder.js`) — scores each curriculum
   day the candidate touched, prioritizing skipped topics highest, then
   attempted-but-failed missions, then passed-but-struggled (many attempts),
   then first-try passes last. Produces a `focusPlan`: an ordered list of the
   4-6 days most worth probing, each with a reason.
2. **Runs the interview** (`interviewer.js`) — feeds that focus plan into a
   Gemini-powered conversational loop. Each question is generated based on the
   candidate's previous answer: vague or weak answers get follow-up probing,
   strong answers move the interview on to the next focus area. The interview
   only ends once at least 8 questions have been asked covering at least 4
   distinct curriculum days — enforced in code, not just trusted from the
   model's own judgment.
3. **Generates structured feedback** (`feedback.js`) — once the interview
   concludes, a separate call reviews the full transcript and produces JSON
   feedback: a summary, specific strengths, specific gaps, and concrete next
   steps, all grounded in what the candidate actually said.

## Architecture

```
rk-probe/
├── server.js           Express app, exposes POST /api/interview
├── sessions.js          In-memory session state (Map: sessionId -> session)
├── contextBuilder.js    Candidate signals -> prioritized focusPlan
├── interviewer.js       Gemini turn logic, completion gate, day tracking
├── feedback.js          Gemini call -> structured JSON feedback
├── retry.js              Shared retry-once wrapper around Gemini calls
├── transcribe.js         Fallback voice transcription (non-Firefox-native browsers)
├── curriculum.json      Provided course data (31 days, 8 modules)
├── candidates.json      Provided sample candidates, used for local testing
├── public/              Vanilla browser UI served by Express
│   ├── index.html       Candidate selector and chat layout
│   ├── style.css        Responsive dark styling
│   └── app.js           Thin fetch client and response renderer
├── PROMPTS.md           AI usage log — one entry per real prompt used
└── package.json
```

Each file has one job. Session state (per `sessionId`) is kept in-memory only
— no database — which is a deliberate scope decision, not an oversight (see
Known Limitations below).

The Gemini conversation is driven by manually passing the full message history
in the `contents` array on every call, rather than using SDK-managed chat
sessions. This is intentional: full transparency into exactly what's being
sent to the model at every turn, which matters for being able to explain and
extend the code under time pressure.

## Running locally

**Requirements:** Node.js 18+, a free Gemini API key from
[Google AI Studio](https://aistudio.google.com).

```bash
npm install
```

Create a `.env` file in the project root:
```
GEMINI_API_KEY=your_key_here
```

Start the server:
```bash
npm start
```

You should see `Interview agent running on port 3000`.

Then open [http://localhost:3000](http://localhost:3000). The UI loads the
provided sample candidates, creates a browser-tab-only session ID, and calls
the same `POST /api/interview` endpoint documented below. It contains no
interview, scoring, or model logic.

## API usage example

**Health check** — confirms the server is up (useful for waking a Render
free-tier deployment from a cold start before a demo, without spending a
real interview session on it):

```bash
curl -s http://localhost:3000/health
```
Response: `{ "status": "ok", "service": "rk-probe", "timestamp": "..." }`

**Start an interview** — pass a full candidate object matching the
`candidates.json` schema:

```bash
curl -s -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "abc-123",
    "candidate": {
      "member": { "id": "CAND-011", "name": "Mia Alvarez", "jobRole": "UX Researcher", "yearsExperience": 6, "education": "MA HCI", "status": "COMPLETED" },
      "missions": [
        { "day": 7, "title": "Embeddings Explained", "skipped": true },
        { "day": 8, "title": "Vector Databases Overview", "skipped": true }
      ],
      "signals": { "commitDays": 9, "missionsCompleted": 14, "missionsFirstTry": 5 }
    }
  }'
```

Response:
```json
{ "reply": "Hi Mia, welcome to the interview...", "done": false }
```

**Continue the conversation** — same `sessionId`, send the candidate's answer:

```bash
curl -s -X POST http://localhost:3000/api/interview \
  -H "Content-Type: application/json" \
  -d '{ "sessionId": "abc-123", "message": "Embeddings turn text into vectors..." }'
```

**When the interview concludes**, the response includes structured feedback
and the un-redacted focus plan RK Probe used to guide the interview — safe to
reveal now that the interview is over:

```json
{
  "reply": "Interview completed.",
  "done": true,
  "feedback": {
    "summary": "...",
    "strengths": ["..."],
    "gaps": ["..."],
    "next": ["..."]
  },
  "focusPlan": [
    {
      "day": 7,
      "title": "Embeddings Explained",
      "objectives": ["..."],
      "reason": "skipped this topic entirely"
    }
  ]
}
```

`focusPlan` is deliberately withheld from every response *before* `done: true`
— only `day` and `title` are exposed mid-interview (see `progress` on
in-progress turns), never `reason`. This stops the candidate (or the model
itself, mid-conversation) from ever seeing why a topic was chosen while the
interview is still running.

## Known limitations

- **Sessions are in-memory only.** Restarting the server loses all
  in-progress interviews. This is a deliberate scope decision matching the
  spec (no database requirement), not a bug.
- **No authentication.** Matches the spec — the endpoint is intentionally
  open, as specified in `technical-spec.md`.
- **The UI is served by this Express app.** Opening `public/index.html`
  directly with a `file://` URL prevents browsers from fetching
  `candidates.json`; use the Render URL or `npm start` instead.
- **The model isn't perfectly linear** about which question it's currently
  following up on in rare cases (e.g. re-raising an earlier half-finished
  question after a topic switch). Completion, question count, and day
  coverage are all still enforced correctly in code regardless.
- **A hard question-count safety cap (`MAX_QUESTIONS = 15`) can override the
  4-day minimum.** Completion is normally gated on the model emitting
  `[INTERVIEW_COMPLETE]` *and* the 8-question/4-day minimums being met. If a
  candidate gives short or evasive answers and the model can't naturally
  reach those minimums, the interview is still forced to conclude at 15
  questions rather than run indefinitely — even if fewer than 4 days were
  covered. When this fires, the feedback prompt is told the interview was
  cut short so it doesn't produce overconfident feedback from thin data.
- **Gemini calls retry once automatically** on a transient failure (network
  blip, rate limit) before surfacing an error to the client, via a shared
  `retry.js` wrapper used in both `interviewer.js` and `feedback.js`.

## AI usage

See `PROMPTS.md` for the full AI usage log — every real prompt used to build
this, in the order used, matched against the commit history above.