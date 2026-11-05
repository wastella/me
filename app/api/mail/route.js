import { handle, json } from '@/lib/http';
import { listMessages, unreadCount } from '@/lib/google';
export const GET = handle(async (req) => {
  const u = new URL(req.url);
  const [list, unread] = await Promise.all([
    listMessages({ q: u.searchParams.get('q') || 'in:inbox', max: Number(u.searchParams.get('max') || 30), pageToken: u.searchParams.get('pageToken') }),
    unreadCount(),
  ]);
  return json({ ...list, unread });
});
