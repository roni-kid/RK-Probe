// sessions.js
//
// In-memory session store. Per the plan: no persistence across restarts is
// required — losing state on a server restart is a known, accepted scope
// decision (documented in README), not a bug.

const sessions = new Map();

export function createSession(sessionId, candidate) {
  const session = {
    candidate,
    history: [],          // full Gemini `contents` array: [{ role, parts }, ...]
    questionsAsked: 0,
    daysCovered: new Set(),
    focusPlan: null,      // set by contextBuilder right after creation
    transcript: [],       // human-readable Q&A pairs, used for feedback.js
    done: false,
  };
  sessions.set(sessionId, session);
  return session;
}

export function getSession(sessionId) {
  return sessions.get(sessionId);
}
