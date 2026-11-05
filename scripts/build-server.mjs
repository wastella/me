// Builds the Next.js server bundle the desktop app ships with.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const sh = (c) => execSync(c, { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
sh('next build');
const out = '.next/standalone';
fs.cpSync('.next/static', `${out}/.next/static`, { recursive: true });
fs.cpSync('public', `${out}/public`, { recursive: true });
// Never ship personal data or secrets inside the app bundle.
for (const p of ['.env.local', '.env', 'data', '.claude', 'electron', 'dist', 'build', 'README.md', 'Start Me.command']) fs.rmSync(`${out}/${p}`, { recursive: true, force: true });
console.log('Server bundle ready in', out);
