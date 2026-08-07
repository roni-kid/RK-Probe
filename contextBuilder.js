// contextBuilder.js
//
// Turns a candidate's mission signals into a prioritized `focusPlan` —
// the ordered list of curriculum days RK Probe should interview on.
//
// Scoring tiers (highest priority first):
//   100 - skipped entirely        -> biggest unknown, must probe
//    90 - attempted but failed    -> known weak spot, probe directly
//    60 - passed after 4+ attempts -> passed, but clearly struggled
//    30 - passed after 2-3 attempts -> some friction, worth a real question
//    10 - passed on first try     -> confirm understanding wasn't luck, light touch
//
// These are flat tier constants, not a formula (no `attempts * N`), so there's
// no risk of a high-attempt pass ever outscoring a skip. If you want to shift
// the boundary between "struggled" and "some friction," just move the >= number.

import curriculum from './curriculum.json' with { type: 'json' };

const dayLookup = Object.fromEntries(curriculum.days.map(d => [d.day, d]));

export function buildFocusPlan(candidate, count = 6) {
  const scored = candidate.missions.map(m => ({
    day: m.day,
    title: m.title,
    score: scoreMission(m),
    reason: explainReason(m),
  }));

  // Sort highest priority first. Node's Array.sort is stable, so missions
  // with equal scores keep their original curriculum order.
  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, count);

  return top.map(m => {
    const dayData = dayLookup[m.day];
    return {
      day: m.day,
      // Fall back to the mission's own title if the day is somehow missing
      // from curriculum.json, so the system prompt never gets `undefined`.
      title: dayData?.title ?? m.title ?? `Day ${m.day}`,
      objectives: dayData?.objectives ?? [],
      reason: m.reason,
    };
  });
}

function scoreMission(m) {
  if (m.skipped) return 100;
  if (m.passed === false) return 90;
  if (m.attempts >= 4) return 60;
  if (m.attempts >= 2) return 30;
  return 10;
}

function explainReason(m) {
  if (m.skipped) return 'skipped this topic entirely';
  if (m.passed === false) return `attempted but did not pass (${m.attempts} attempts)`;
  if (m.attempts >= 4) return `passed, but required ${m.attempts} attempts — likely shaky understanding`;
  if (m.attempts >= 2) return `passed with some friction (${m.attempts} attempts)`;
  return 'passed on first try — worth a light confirmation question';
}
