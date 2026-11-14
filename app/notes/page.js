'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '@/components/AppProvider';
import { Sheet, Skeleton, LoadError, Empty, Popover, useDialog, useAutoGrow } from '@/components/ui';
import { api, useApi, relTime } from '@/lib/client';
import { colorHex, PALETTE } from '@/lib/colors';
import { IconPin, IconTrash, IconMore, IconPlus } from '@/components/Icons';

const ALL = 'all';
const UNSORTED = 'unsorted';
const titleOf = (body) => body.split('\n')[0].trim();
const restOf = (body) => body.split('\n').slice(1).join('\n').trim();
const catKey = (n, catById) => (n.category_id && catById[n.category_id] ? n.category_id : UNSORTED);

export default function Notes() {
  const { attempt } = useApp();
  const { confirm, prompt } = useDialog();
  const q = useApi('/api/notes', { refreshMs: 30_000 });
  const [view, setView] = useState(ALL);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const d = q.data;
  // A category deleted on another device: fall back to All.
  useEffect(() => { if (d && view !== ALL && view !== UNSORTED && !d.categories.some((c) => c.id === view)) setView(ALL); }, [d, view]);

  const cats = d?.categories || [];
  const catById = useMemo(() => Object.fromEntries(cats.map((c) => [c.id, c])), [cats]);
  const counts = useMemo(() => {
    const c = { [ALL]: 0, [UNSORTED]: 0 };
    for (const n of d?.notes || []) { const k = catKey(n, catById); c[ALL]++; c[k] = (c[k] || 0) + 1; }
    return c;
  }, [d, catById]);

  if (q.error && !d) return <><div className="page-head"><h1>Notes</h1></div><LoadError error={q.error} onRetry={q.reload} /></>;
  if (!d) return <><div className="page-head"><h1>Notes</h1></div><Skeleton rows={6} /></>;

  const term = search.trim().toLowerCase();
  const shown = d.notes.filter((n) => {
    if (view !== ALL && catKey(n, catById) !== view) return false;
    return !term || n.body.toLowerCase().includes(term) || (catById[n.category_id]?.name || '').toLowerCase().includes(term);
  });
  const current = view === ALL ? null : view === UNSORTED ? { id: UNSORTED, name: 'Unsorted' } : catById[view];

  const addCategory = async () => {
    const name = await prompt({ title: 'New category', label: 'Category name', confirmLabel: 'Create', maxLength: 60 });
    if (!name) return;
    const cat = await attempt(() => api('/api/notes/categories', { method: 'POST', body: { name, color: PALETTE[cats.length % PALETTE.length] } }));
    if (cat) { await q.reload(); setView(cat.id); }
  };
  const renameCategory = async () => {
    const name = await prompt({ title: 'Rename category', label: 'Category name', initial: current.name, confirmLabel: 'Rename', maxLength: 60 });
    if (name && name !== current.name && await attempt(() => api(`/api/notes/categories/${current.id}`, { method: 'PATCH', body: { name } }))) q.reload();
  };
  const removeCategory = async () => {
    const n = counts[current.id] || 0;
    const ok = await confirm({ title: `Delete “${current.name}”?`, body: n ? `Its ${n} note${n === 1 ? '' : 's'} will move to Unsorted.` : 'The category is empty.', confirmLabel: 'Delete category', danger: true });
    if (ok && await attempt(() => api(`/api/notes/categories/${current.id}`, { method: 'DELETE' }))) { setView(ALL); q.reload(); }
  };
  const item = (id, label, color) => (
    <button key={id} className={`view-link ${view === id ? 'active' : ''}`} aria-current={view === id ? 'page' : undefined} onClick={() => setView(id)}>
      <span className="name row nowrap">{color && <i className="swatch" style={{ background: colorHex(color) }} />}{label}</span>{counts[id] ? <span className="n">{counts[id]}</span> : null}
    </button>
  );

  return (
    <>
      <div className="page-head">
        <div><h1>{current ? current.name : 'Notes'}</h1><div className="sub">{shown.length} {shown.length === 1 ? 'note' : 'notes'}{term ? ' found' : ''}</div></div>
        <div className="head-tools notes-tools">
          <input className="input notes-search" type="search" placeholder="Search notes" aria-label="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
          {current && current.id !== UNSORTED && (
            <Popover label="Category options" button={({ toggle, open: on, props }) => <button className={`icon-btn ${on ? 'on' : ''}`} onClick={toggle} {...props}><IconMore /></button>}>
              {(close) => (
                <>
                  <button className="pop-item" role="menuitem" onClick={() => { close(); renameCategory(); }}>Rename category</button>
                  <button className="pop-item danger" role="menuitem" onClick={() => { close(); removeCategory(); }}>Delete category</button>
                </>
              )}
            </Popover>
          )}
        </div>
      </div>

      <div className="notes-layout">
        <nav className="cat-rail" aria-label="Note categories">
          {item(ALL, 'All notes')}
          {cats.map((c) => item(c.id, c.name, c.color))}
          {counts[UNSORTED] > 0 && cats.length > 0 && item(UNSORTED, 'Unsorted', 'grey')}
          <button className="view-link" aria-label="New category" onClick={addCategory}><IconPlus style={{ width: 14, height: 14 }} /><span className="name">Category</span></button>
        </nav>
        <div className="stack">
          <Composer cats={cats} defaultCat={current && current.id !== UNSORTED ? current.id : ''} onSaved={q.reload} />
          {shown.length ? (
            <div className="notes-grid">
              {shown.map((n) => <NoteCard key={n.id} note={n} cat={catById[n.category_id]} showCat={view === ALL} onOpen={() => setOpen(n)} />)}
            </div>
          ) : term ? <Empty title="No notes match">Try a different word.</Empty>
            : <Empty title={current ? `Nothing in ${current.name} yet` : 'No notes yet'}>Write one above. The first line becomes its title.</Empty>}
        </div>
      </div>
      {open && <NoteEditor note={open} cats={cats} onClose={() => { setOpen(null); q.reload(); }} />}
    </>
  );
}

function CategorySelect({ cats, value, onChange }) {
  if (!cats.length) return null;
  return (
    <select className="input auto" aria-label="Category" style={{ height: 30, fontSize: 12.5 }} value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unsorted</option>
      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function Composer({ cats, defaultCat, onSaved }) {
  const { attempt } = useApp();
  const [text, setText] = useState('');
  const ref = useRef(null);
  const [cat, setCat] = useState(defaultCat);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCat(defaultCat), [defaultCat]);
  useAutoGrow(ref, text, 44);

  const save = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    const ok = await attempt(() => api('/api/notes', { method: 'POST', body: { body: text, category_id: cat || null } }));
    if (ok) { setText(''); await onSaved(); }
    setBusy(false);
  };
  return (
    <section className="card composer">
      <textarea ref={ref} className="composer-text" rows={2} placeholder="Write a note…" aria-label="New note"
        value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }} />
      {(text.trim() || cats.length > 0) && (
        <div className="composer-bar">
          <CategorySelect cats={cats} value={cat} onChange={setCat} />
          <span className="grow" />
          <button className="btn primary sm" disabled={!text.trim() || busy} onClick={save} title="Save (⌘↩)">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      )}
    </section>
  );
}

function NoteCard({ note, cat, showCat, onOpen }) {
  const rest = restOf(note.body);
  return (
    <button className="note-card card" onClick={onOpen}>
      <div className="note-title">{note.pinned ? <IconPin className="pin" /> : null}{titleOf(note.body)}</div>
      {rest && <div className="note-rest">{rest}</div>}
      <div className="note-meta">
        {showCat && cat && <span className="proj"><i className="swatch" style={{ background: colorHex(cat.color) }} />{cat.name}</span>}
        <span>{relTime(new Date(note.updated_at).getTime())}</span>
      </div>
    </button>
  );
}

// Opens a note for editing. Closing it (Esc, ⌘↩, the ✕ or a click outside) saves.
function NoteEditor({ note, cats, onClose }) {
  const { showToast } = useApp();
  const { confirm } = useDialog();
  const [text, setText] = useState(note.body);
  const ref = useRef(null);
  const [cat, setCat] = useState(note.category_id || '');
  const [pinned, setPinned] = useState(!!note.pinned);
  const [error, setError] = useState('');
  useAutoGrow(ref, text, 180);
  // On a computer, open with the cursor at the end, ready to keep writing.
  useEffect(() => { const el = ref.current; if (el && !matchMedia('(hover: none)').matches) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, []);

  const close = async () => {
    const patch = {};
    if (text.trim() !== note.body) patch.body = text;
    if ((cat || null) !== (note.category_id || null)) patch.category_id = cat || null;
    if (pinned !== !!note.pinned) patch.pinned = pinned;
    if (!text.trim()) { setError('A note needs some text. To get rid of it, use the bin.'); return; }
    if (Object.keys(patch).length) {
      try { await api(`/api/notes/${note.id}`, { method: 'PATCH', body: patch }); }
      catch (e) { setError(`${e.message} Your changes are still here.`); return; }
    }
    onClose();
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this note?', body: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return;
    try { await api(`/api/notes/${note.id}`, { method: 'DELETE' }); showToast('Note deleted'); onClose(); }
    catch (e) { setError(e.message); }
  };

  return (
    <Sheet wide label="Edit note" onClose={close}
      title={<CategorySelect cats={cats} value={cat} onChange={setCat} />}
      tools={(
        <>
          <button className={`icon-btn ${pinned ? 'on' : ''}`} aria-pressed={pinned} title={pinned ? 'Unpin' : 'Pin to top'} aria-label={pinned ? 'Unpin' : 'Pin to top'} onClick={() => setPinned(!pinned)}><IconPin /></button>
          <button className="icon-btn" title="Delete note" aria-label="Delete note" onClick={remove}><IconTrash /></button>
        </>
      )}>
      <textarea ref={ref} className="composer-text big" aria-label="Note" value={text}
        onChange={(e) => { setText(e.target.value); setError(''); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); close(); } }} />
      {error && <div className="error-box" role="alert">{error}</div>}
      <div className="sheet-foot">
        <span>Created {new Date(note.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
        <button className="btn primary sm" onClick={close}>Done</button>
      </div>
    </Sheet>
  );
}
