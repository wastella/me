// Todoist-style quick add: "Call mom tomorrow 5pm p1 #Family @phone every sunday"
import * as chrono from 'chrono-node';
import { fmt, todayStr, firstDue, parseRecurrence } from './dates.js';

const pad = (n) => String(n).padStart(2, '0');

export function quickAdd(text, { projects = [], labels = [] } = {}) {
  let s = ` ${text} `;
  const out = { priority: 4, labels: [], project_id: null, due_date: null, due_time: null, due_string: null, recurring: 0 };

  s = s.replace(/\s!?p([1-4])(?=\s)/i, (_, p) => { out.priority = Number(p); return ' '; });

  // #Project (longest matching name wins so "#Side Projects" works)
  const sorted = [...projects].sort((a, b) => b.name.length - a.name.length);
  for (const p of sorted) {
    const re = new RegExp(`\\s#${escapeRe(p.name)}(?=\\s|$)`, 'i');
    if (re.test(s)) { out.project_id = p.id; s = s.replace(re, ' '); break; }
  }
  if (!out.project_id) s = s.replace(/\s#(\S+)/, (_, name) => { out.newProject = name; return ' '; });

  for (const l of [...labels].sort((a, b) => b.name.length - a.name.length)) {
    const re = new RegExp(`\\s@${escapeRe(l.name)}(?=\\s|$)`, 'i');
    if (re.test(s)) { out.labels.push(l.name); s = s.replace(re, ' '); }
  }
  s = s.replace(/\s@(\S+)/g, (_, name) => { out.labels.push(name); return ' '; });

  const rec = s.match(/\s((?:every|ev)!?\s+.+?)(?=\s*$)/i);
  if (rec && parseRecurrence(rec[1])) {
    out.due_string = rec[1].trim();
    out.recurring = 1;
    s = s.replace(rec[0], ' ');
    const t = rec[1].match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
    if (t) out.due_time = to24(t);
    out.due_date = firstDue(out.due_string);
  }

  if (!out.due_date) {
    const results = chrono.parse(s, new Date(), { forwardDate: true });
    const r = results[0];
    if (r) {
      const d = r.start.date();
      out.due_date = fmt(d);
      if (r.start.isCertain('hour')) out.due_time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      out.due_string = r.text;
      s = s.slice(0, r.index) + ' ' + s.slice(r.index + r.text.length);
    }
  }

  out.content = s.replace(/\s+/g, ' ').trim() || text.trim();
  return out;
}

function to24(m) {
  let h = Number(m[1]) % 12; if (m[3].toLowerCase() === 'pm') h += 12;
  return `${pad(h)}:${m[2] || '00'}`;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export { todayStr };
