import { handle, json, body } from '@/lib/http';
import { togglePosture, upsertPostureStep } from '@/lib/training';
// POST { date, step_id, done } toggles a step; PUT { id?, name, archived? } edits the routine.
export const POST = handle(async (req) => { const b = await body(req); togglePosture(b.date, b.step_id, !!b.done); return json({ ok: true }); });
export const PUT = handle(async (req) => json({ id: upsertPostureStep(await body(req)) }));
