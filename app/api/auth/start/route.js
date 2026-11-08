import { handle, json } from '@/lib/http';
import { startLogin } from '@/lib/login';
import { googleConfigured } from '@/lib/google';
export const POST = handle(async () => {
  if (!(await googleConfigured())) return json({ error: 'Google sign-in is not configured on the server yet.' }, 503);
  return json(await startLogin());
});
