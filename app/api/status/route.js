import { handle, json } from '@/lib/http';
import { kvGet } from '@/lib/db';
import { googleConfigured, googleConnected, REDIRECT_URI } from '@/lib/google';
import { authRequired } from '@/lib/session';
import { APP_URL } from '@/lib/env';
import { derived } from '@/lib/tokens';
import { pushConfigured, deviceCount } from '@/lib/push';
export const GET = handle(async () => {
  const [name, configured, connected, email] = await Promise.all([kvGet('name'), googleConfigured(), googleConnected(), kvGet('google_email')]);
  return json({
    name,
    desktop: !!process.env.ME_DESKTOP,
    hosted: authRequired(),
    storage: process.env.TURSO_DATABASE_URL ? 'cloud' : 'local',
    // Only reachable when signed in (middleware), so it's safe to show here.
    mcpUrl: process.env.MCP_TOKEN ? `${APP_URL}/api/mcp/${process.env.MCP_TOKEN}` : null,
    shortcut: derived('shortcut') ? { url: `${APP_URL}/api/quick`, token: derived('shortcut') } : null,
    push: { publicKey: process.env.VAPID_PUBLIC_KEY || null, enabled: pushConfigured(), devices: pushConfigured() ? await deviceCount() : 0 },
    google: { configured, connected, email, redirectUri: REDIRECT_URI },
  });
});
