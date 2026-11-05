// Gmail query for "arrived since midnight", using epoch seconds so the
// cutoff is local midnight rather than Gmail's server timezone.
export function todayQuery(extra = '') {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return `in:inbox after:${Math.floor(d.getTime() / 1000)}${extra ? ' ' + extra : ''}`;
}
