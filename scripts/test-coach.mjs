import { suggest } from '../lib/coach.js';
const squat = { sets: 3, reps: '5' }, curl = { sets: 3, reps: '8' };
const cases = [
  ['hit all', squat, [{ weight: 120, reps: [5, 5, 5] }], 125],
  ['missed once', squat, [{ weight: 125, reps: [5, 5, 3] }, { weight: 120, reps: [5, 5, 5] }], 125],
  ['missed twice', squat, [{ weight: 125, reps: [5, 4, 3] }, { weight: 125, reps: [5, 5, 4] }], 115],
  ['legacy', squat, [{ weight: 120, reps: null }], 120],
  ['light DB', curl, [{ weight: 20, reps: [8, 8, 8] }], 22.5],
  ['bodyweight', curl, [{ weight: 0, reps: [8, 8, 8] }], 0],
  ['set skipped', squat, [{ weight: 120, reps: [5, 5, null] }], 120],
];
let bad = 0;
for (const [n, e, s, want] of cases) { const r = suggest(e, s); if (r?.weight !== want) { bad++; console.log('FAIL', n, r); } }
console.log(bad ? `${bad} failed` : 'coach rules: all pass');
