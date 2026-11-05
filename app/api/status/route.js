import { handle, json } from '@/lib/http';
import { kvGet } from '@/lib/db';
import { todoistToken, ENV_FILE } from '@/lib/env';
import path from 'node:path';
import { googleConfigured, googleConnected, REDIRECT_URI } from '@/lib/google';
export const GET = handle(async () => json({
  name: kvGet('name'),
  desktop: !!process.env.ME_DESKTOP,
  paths: { env: ENV_FILE, db: path.join(process.env.ME_DATA_DIR || path.join(process.cwd(), 'data'), 'me.db') },
  google: { configured: googleConfigured(), connected: googleConnected(), email: kvGet('google_email'), redirectUri: REDIRECT_URI },
  todoist: { token: !!todoistToken(), lastImport: kvGet('todoist_last_import') },
}));
