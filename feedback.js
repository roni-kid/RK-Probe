// feedback.js
//
// Called once per interview, at completion. Takes the full transcript (not
// just the last answer) and asks Gemini for structured JSON feedback matching
// the exact shape the API contract requires.

import { GoogleGenAI } from '@google/genai';
import { withRetry } from './retry.js';

const MODEL = 'gemini-3.5-flash';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function generateFeedback(session) {
  const { candidate, transcript } = session;
  const { name, jobRole } = candidate.member ?? candidate;

  const answeredTurns = transcript.filter(t => t.answer !== null); // skip the opening turn, which has no answer yet
  const formattedTranscript = answeredTurns
    .map((t, i) => `Q${i + 1}: ${t.question}\nA${i + 1}: ${t.answer}`)
    .join('\n\n');

  // If the interview was cut short (e.g. the MAX_QUESTIONS safety cap fired
  // on a stuck/evasive candidate), the transcript can be very thin. Tell the
  // model explicitly rather than letting it produce confident-sounding
  // feedback from a couple of answers.
  const cutShortNote = answeredTurns.length < 2
    ? '\n\nNOTE: This interview was cut short and only has a very limited number of answered questions. Explicitly acknowledge in the summary that there was not enough material to fully assess the candidate, rather than producing confident-sounding feedback from this thin data.'
    : '';

  const prompt = `You are reviewing a completed technical interview transcript for feedback purposes.

CANDIDATE: ${name}, ${jobRole}
FULL TRANSCRIPT:
${formattedTranscript}
${cutShortNote}

Produce structured feedback as JSON with these exact fields:
- summary: 2-3 sentence overview of performance
- strengths: array of specific things the candidate demonstrated well, citing what they actually said
- gaps: array of specific weak points, citing what they actually said or failed to address
- next: array of concrete, actionable study recommendations tied to the identified gaps

Ground every point in something specific from the transcript. Do not give generic advice.
Return ONLY valid JSON, no markdown code fences, no extra text before or after.`;

  const response = await withRetry(() => ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  }));

  const rawText = (response.text ?? '').trim();

  try {
    return JSON.parse(stripCodeFences(rawText));
  } catch (err) {
    // Fallback so a malformed model response can never crash the interview.
    console.error('Failed to parse feedback JSON:', err.message, '\nRaw text:', rawText);
    return {
      summary: 'Feedback generation encountered a parsing error. See server logs for the raw model output.',
      strengths: [],
      gaps: [],
      next: [],
    };
  }
}

// In case the model ignores the "no markdown fences" instruction anyway.
function stripCodeFences(text) {
  return text.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
}