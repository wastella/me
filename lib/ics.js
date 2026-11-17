// Minimal iCalendar (RFC 5545) reader: enough for an exported meal plan.
function unfold(text) {
  return text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// Returns { date: 'YYYY-MM-DD', time: 'HH:MM' | null } in your timezone
// (ME_TZ), even though the server runs in UTC.
const TZ = () => process.env.ME_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
function parts(ms, timeZone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
}
function inTZ(ms) {
  const p = parts(ms, TZ());
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function icsDate(value, params = {}) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, , z] = m;
  if (h === undefined || params.VALUE === 'DATE') return { date: `${y}-${mo}-${d}`, time: null };
  if (z) return inTZ(Date.UTC(+y, +mo - 1, +d, +h, +mi));
  if (params.TZID) {
    // Wall-clock time in TZID -> instant -> your timezone.
    const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
    let g;
    try { g = parts(guess, params.TZID.replace(/^"|"$/g, '')); } catch { return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` }; }
    const offset = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute) - guess;
    return inTZ(guess - offset);
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

export function parseICS(text) {
  const events = [];
  let calendarName = null;
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur?.start) events.push(cur); cur = null; continue; }
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [rawName, ...paramParts] = line.slice(0, i).split(';');
    const name = rawName.toUpperCase();
    const value = line.slice(i + 1);
    if (!cur) { if (name === 'X-WR-CALNAME') calendarName = unescape(value).trim(); continue; }
    const params = Object.fromEntries(paramParts.map((p) => { const j = p.indexOf('='); return [p.slice(0, j).toUpperCase(), p.slice(j + 1)]; }));
    switch (name) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescape(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescape(value).trim(); break;
      case 'URL': cur.url = value; break;
      case 'DTSTART': cur.start = icsDate(value, params); break;
      case 'STATUS': cur.status = value; break;
    }
  }
  return { calendarName, events };
}
