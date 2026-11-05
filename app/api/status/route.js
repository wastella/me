import { handle, json } from '@/lib/http';
import { kvGet } from '@/lib/db';
import { todoistToken } from '@/lib/env';
import { googleConfigured, googleConnected, REDIRECT_URI } from '@/lib/google';
export const GET = handle(async () => json({
  name: kvGet('name'),
  google: { configured: googleConfigured(), connected: googleConnected(), email: kvGet('google_email'), redirectUri: REDIRECT_URI },
  todoist: { token: !!todoistToken(), lastImport: kvGet('todoist_last_import') },
}));
