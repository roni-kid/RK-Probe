// transcribe.js
//
// Fallback voice-input path for browsers without native SpeechRecognition
// (e.g. Firefox). The client records audio with MediaRecorder and POSTs it
// here as base64; we hand it to Gemini as inline audio data and ask for a
// plain transcript back. Same one-function-per-file pattern as feedback.js.
//
// This is a separate, isolated feature from the interview conversation
// itself — it doesn't touch session state, sessions.js, or the
// /api/interview contract at all. If it's ripped out entirely, nothing
// about the core interview logic changes.

import { GoogleGenAI } from '@google/genai';

const MODEL = 'gemini-3.5-flash';
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Gemini's documented supported audio formats: WAV, MP3, AIFF, AAC, OGG, FLAC.
// We only ever accept mime types from this list — the client is responsible
// for recording in one of these formats (see public/app.js, which requests
// 'audio/ogg;codecs=opus' from MediaRecorder when available).
const SUPPORTED_MIME_PREFIXES = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/aiff', 'audio/aac', 'audio/ogg', 'audio/flac'];

export async function transcribeAudio(base64Audio, mimeType) {
  if (!base64Audio) {
    throw new Error('No audio data provided');
  }
  if (!mimeType || !SUPPORTED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix))) {
    throw new Error(`Unsupported audio format: ${mimeType}`);
  }

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { text: 'Transcribe this audio clip. Return ONLY the spoken words as plain text, with no preamble, no labels, and no punctuation commentary — just the transcript itself. If no speech is audible, return an empty string.' },
      { inlineData: { mimeType, data: base64Audio } },
    ],
  });

  const transcript = (response.text ?? '').trim();
  return transcript;
}