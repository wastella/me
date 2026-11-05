import { importTodoist } from '../lib/todoist.js';
importTodoist({ log: console.log }).catch((e) => { console.error(e.message); process.exit(1); });
