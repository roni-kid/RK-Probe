// retry.js
//
// Wraps a single async call with one retry after a short delay. Used around
// Gemini API calls so a transient error/rate-limit blip doesn't immediately
// surface as a 500 mid-interview.

export async function withRetry(fn, { retries = 1, delayMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, delayMs));
      }
    }
  }
  throw lastError;
}