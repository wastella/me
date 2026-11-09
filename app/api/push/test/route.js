import { handle, json } from '@/lib/http';
import { send } from '@/lib/push';
export const POST = handle(async () => json({ sent: await send({ title: 'Me', body: 'Notifications are working.', url: '/settings', tag: 'test' }) }));
