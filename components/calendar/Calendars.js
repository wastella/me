'use client';
// Manage the calendars themselves: show/hide, colour, rename, add, remove.
import { useApp } from '@/components/AppProvider';
import { Sheet, Popover, useDialog } from '@/components/ui';
import { api } from '@/lib/client';
import { IconPlus, IconMore } from '@/components/Icons';
import { EVENT_COLORS } from './util';

export default function CalendarsSheet({ calendars, onClose, onChanged }) {
  const { attempt, showToast } = useApp();
  const { confirm, prompt } = useDialog();
  const patch = async (body, done) => { if (await attempt(() => api('/api/calendar/calendars', { method: 'PATCH', body }))) { if (done) showToast(done); onChanged(); } };
  const add = async () => {
    const name = await prompt({ title: 'New calendar', label: 'Calendar name', confirmLabel: 'Create' });
    if (name && await attempt(() => api('/api/calendar/calendars', { method: 'POST', body: { name } }))) { showToast(`Created “${name}”`); onChanged(); }
  };
  const rename = async (c) => {
    const name = await prompt({ title: 'Rename calendar', label: 'Calendar name', initial: c.name, confirmLabel: 'Rename' });
    if (name && name !== c.name) patch({ id: c.id, name }, 'Renamed');
  };
  const remove = async (c) => {
    const ok = await confirm(c.owner
      ? { title: `Delete “${c.name}”?`, body: 'The calendar and every event on it will be deleted from Google Calendar. This can’t be undone.', confirmLabel: 'Delete', danger: true }
      : { title: `Remove “${c.name}”?`, body: 'It disappears from your calendar list. The calendar itself isn’t deleted.', confirmLabel: 'Remove', danger: true });
    if (ok && await attempt(() => api(`/api/calendar/calendars?id=${encodeURIComponent(c.id)}`, { method: 'DELETE' }))) { showToast(c.owner ? 'Calendar deleted' : 'Calendar removed'); onChanged(); }
  };
  return (
    <Sheet title="Calendars" onClose={onClose}>
      <ul className="cal-manage">
        {calendars.map((c) => (
          <li key={c.id}>
            <label className="check-row" style={{ '--c': c.color }}><input type="checkbox" checked={!!c.visible} onChange={() => patch({ id: c.id, visible: !c.visible })} /><span>{c.name}</span></label>
            <Popover label={`Options for ${c.name}`} button={({ toggle, props }) => <button className="icon-btn" onClick={toggle} {...props}><IconMore /></button>}>
              {(close) => (
                <>
                  <div className="swatches" role="group" aria-label="Colour" style={{ padding: '6px 8px' }}>
                    {EVENT_COLORS.map(([id, name, hex]) => <button key={id} type="button" className="sw" aria-label={name} title={name} aria-pressed={c.color?.toLowerCase() === hex} style={{ '--c': hex }} onClick={() => { close(); patch({ id: c.id, color: hex }); }} />)}
                  </div>
                  <div className="pop-sep" />
                  <button className="pop-item" onClick={() => { close(); rename(c); }}>Rename</button>
                  {!c.primary && <button className="pop-item danger" onClick={() => { close(); remove(c); }}>{c.owner ? 'Delete calendar' : 'Remove from my list'}</button>}
                </>
              )}
            </Popover>
          </li>
        ))}
      </ul>
      <div><button className="btn" onClick={add}><IconPlus /> New calendar</button></div>
    </Sheet>
  );
}
