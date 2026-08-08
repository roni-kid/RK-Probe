// server.js
//
// Express entrypoint. Two routes:
//   POST /api/interview   — the interview conversation (unchanged contract)
//   POST /api/transcribe  — fallback voice transcription for browsers without
//                            native SpeechRecognition (e.g. Firefox)
// No session yet + candidate provided -> start a new interview.
// Session exists -> treat the request as a conversation turn.

import 'dotenv/config';
import express from 'express';
import { createSession, getSession } from './sessions.js';
import { buildFocusPlan } from './contextBuilder.js';
import { handleTurn } from './interviewer.js';
import { transcribeAudio } from './transcribe.js';

const app = express();
// Raised from Express's 100kb default: a few seconds of base64-encoded audio
// easily exceeds that. 10mb comfortably covers a single push-to-talk answer
// (typically well under 1MB) with headroom, without opening the door to
// arbitrarily large uploads.
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// The browser UI reads the supplied demo candidates from this static file.
app.get('/candidates.json', (req, res) => {
  res.sendFile('candidates.json', { root: process.cwd() });
});

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

app.post('/api/transcribe', async (req, res) => {
  const { audio, mimeType } = req.body;

  if (!audio || !mimeType) {
    return res.status(400).json({ error: 'audio (base64) and mimeType are required' });
  }

  try {
    const transcript = await transcribeAudio(audio, mimeType);
    return res.json({ transcript });
  } catch (err) {
    console.error('Transcription error:', err.message);
    res.status(500).json({ error: 'transcription failed', details: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Interview agent running on port ${PORT}`));
