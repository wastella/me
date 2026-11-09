// Minimal iCalendar (RFC 5545) reader: enough for Blackboard/Canvas feeds.
const pad = (n) => String(n).padStart(2, '0');

function unfold(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
}
const unescape = (v) => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');

// Returns { date: 'YYYY-MM-DD', time: 'HH:MM' | null } in your timezone
// (ME_TZ), even though the server runs in UTC.
const TZ = () => globalThis.process?.env?.ME_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
function inTZ(ms) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
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
    const g = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: params.TZID, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
    const offset = Date.UTC(+g.year, +g.month - 1, +g.day, +g.hour, +g.minute) - guess;
    return inTZ(guess - offset);
  }
  return { date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

export function parseICS(text) {
  const events = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur?.uid) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const [name, ...paramParts] = line.slice(0, i).split(';');
    const params = Object.fromEntries(paramParts.map((p) => p.split('=')));
    const value = line.slice(i + 1);
    switch (name.toUpperCase()) {
      case 'UID': cur.uid = value; break;
      case 'SUMMARY': cur.summary = unescape(value).trim(); break;
      case 'DESCRIPTION': cur.description = unescape(value).trim(); break;
      case 'URL': cur.url = value; break;
      case 'CATEGORIES': cur.categories = unescape(value); break;
      case 'LOCATION': cur.location = unescape(value); break;
      case 'DTSTART': cur.start = icsDate(value, params); break;
      case 'DUE': cur.due = icsDate(value, params); break;
      case 'STATUS': cur.status = value; break;
    }
  }
  return events;
}
