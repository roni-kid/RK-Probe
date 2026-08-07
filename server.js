// server.js
//
// Express entrypoint. Single route: POST /api/interview.
// No session yet + candidate provided -> start a new interview.
// Session exists -> treat the request as a conversation turn.

import 'dotenv/config';
import express from 'express';
import { createSession, getSession } from './sessions.js';
import { buildFocusPlan } from './contextBuilder.js';
import { handleTurn } from './interviewer.js';

const app = express();
app.use(express.json());

app.post('/api/interview', async (req, res) => {
  const { sessionId, candidate, message } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'sessionId is required' });
  }

  try {
    let session = getSession(sessionId);

    if (!session) {
      // Starting a new interview.
      if (!candidate) {
        return res.status(400).json({ error: 'candidate required to start a new session' });
      }
      session = createSession(sessionId, candidate);
      session.focusPlan = buildFocusPlan(candidate);
      const result = await handleTurn(session, null); // null = generate opening question
      return res.json(result);
    }

    // Ongoing turn on an existing session.
    if (session.done) {
      return res.status(400).json({ error: 'this interview has already completed' });
    }
    if (message === undefined) {
      return res.status(400).json({ error: 'message is required for an ongoing turn' });
    }

    const result = await handleTurn(session, message);
    return res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'internal error', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Interview agent running on port ${PORT}`));