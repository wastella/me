import { handle, json } from '@/lib/http';
import { kvGet } from '@/lib/db';
import { googleConfigured, googleConnected, REDIRECT_URI } from '@/lib/google';
import { authRequired } from '@/lib/session';
export const GET = handle(async () => {
  const [name, configured, connected, email] = await Promise.all([kvGet('name'), googleConfigured(), googleConnected(), kvGet('google_email')]);
  return json({
    name,
    desktop: !!process.env.ME_DESKTOP,
    hosted: authRequired(),
    storage: process.env.TURSO_DATABASE_URL ? 'cloud' : 'local',
    google: { configured, connected, email, redirectUri: REDIRECT_URI },
  });
});
