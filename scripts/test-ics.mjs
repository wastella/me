import { parseICS } from '../lib/ics.js';
process.env.ME_TZ = 'America/New_York';
const sample = `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:bb-1\r\nSUMMARY:IWA 10: Conclusion\r\nDESCRIPTION:ENG 102\\, Section 511\r\nDTSTART:20261111T045900Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:d2l-2\r\nSUMMARY:Essay 2 - Due\r\nLOCATION:ENG-1020-012 College Comp\r\nDTSTART;TZID=America/Chicago:20261113T225900\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:x3\r\nSUMMARY:Quiz\r\nDTSTART;VALUE=DATE:20261112\r\nDESCRIPTION:folded \r\n line\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
for (const e of parseICS(sample)) console.log(JSON.stringify({ uid: e.uid, s: e.summary, start: e.start, loc: e.location, d: e.description }));
