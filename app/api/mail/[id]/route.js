import { handle, json, body } from '@/lib/http';
import { getMessage, modifyMessage } from '@/lib/google';
export const GET = handle(async (_, { params }) => json(await getMessage(params.id)));
const ACTIONS = {
  read: { remove: ['UNREAD'] }, unread: { add: ['UNREAD'] },
  archive: { remove: ['INBOX'] }, unarchive: { add: ['INBOX'] },
  star: { add: ['STARRED'] }, unstar: { remove: ['STARRED'] },
};
export const POST = handle(async (req, { params }) => {
  const { action } = await body(req);
  if (!ACTIONS[action]) return json({ error: 'unknown action' }, 400);
  await modifyMessage(params.id, ACTIONS[action]);
  return json({ ok: true });
});
