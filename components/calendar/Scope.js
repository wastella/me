'use client';
// "This event / This and following / All events" for repeating events.
//   const [askScope, scopeDialog] = useScope();
//   const scope = await askScope({ title: 'Change repeating event' });   // null when cancelled
import { useState } from 'react';
import { Sheet } from '@/components/ui';

const CHOICES = [['this', 'This event'], ['following', 'This and following events'], ['all', 'All events']];

export function useScope() {
  const [d, setD] = useState(null);
  const [value, setValue] = useState('this');
  const ask = ({ title, confirmLabel = 'OK', danger = false, without = [] }) => new Promise((resolve) => {
    const choices = CHOICES.filter(([k]) => !without.includes(k));
    setValue(choices[0][0]);
    setD({ title, confirmLabel, danger, choices, resolve });
  });
  const finish = (v) => { d.resolve(v); setD(null); };
  const dialog = d && (
    <Sheet className="dialog" title={d.title} onClose={() => finish(null)}>
      <form onSubmit={(e) => { e.preventDefault(); finish(value); }} style={{ display: 'contents' }}>
        <div role="radiogroup" aria-label={d.title} className="stack" style={{ gap: 2 }}>
          {d.choices.map(([k, label], i) => (
            <label key={k} className="check-row"><input type="radio" name="scope" value={k} checked={value === k} onChange={() => setValue(k)} data-autofocus={i === 0 ? '' : undefined} /> {label}</label>
          ))}
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => finish(null)}>Cancel</button>
          <button className={`btn ${d.danger ? 'danger-fill' : 'primary'}`}>{d.confirmLabel}</button>
        </div>
      </form>
    </Sheet>
  );
  return [ask, dialog];
}
