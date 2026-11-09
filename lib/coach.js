// Training coach: suggests the next weight from how the last sessions went.
// Rules (linear progression): hit every rep -> add weight; missed -> repeat;
// missed twice in a row at the same weight -> drop ~10%.

export const targetReps = (e) => { const n = parseInt(e.reps, 10); return Number.isFinite(n) ? n : null; };
export const restSeconds = (e) => ((targetReps(e) ?? 8) <= 5 ? 180 : 90);
const step = (w) => (w >= 50 ? 5 : 2.5);
const round = (w, s) => Math.max(0, Math.round(w / s) * s);

// sessions: newest first, each { weight, reps: number[] | null }
export function hitAll(s, e) {
  const t = targetReps(e);
  if (!s?.reps || !t || !e.sets) return null;            // unknown (older log)
  const done = s.reps.filter((r) => r !== null && r !== undefined);
  return done.length >= e.sets && done.every((r) => r >= t);
}

export function suggest(e, sessions) {
  const [last, prev] = sessions;
  if (!last || last.weight === null || last.weight === undefined) return null;
  if (last.weight === 0) return { weight: 0, why: 'bodyweight' };
  const hit = hitAll(last, e);
  if (hit === null) return { weight: last.weight, why: 'same as last time' };
  if (hit) { const w = last.weight + step(last.weight); return { weight: w, why: `+${step(last.weight)} lb: you hit every rep last time`, up: true }; }
  if (prev && prev.weight === last.weight && hitAll(prev, e) === false) {
    const w = round(last.weight * 0.9, step(last.weight));
    return { weight: w, why: 'missed reps twice: drop ~10% and build back', down: true };
  }
  return { weight: last.weight, why: 'missed reps last time: repeat this weight' };
}

// Heaviest weight ever logged for an exercise (for PRs).
export function best(sessions) {
  return sessions.reduce((m, s) => (s.weight !== null && s.weight > m ? s.weight : m), -Infinity);
}
