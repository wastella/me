'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi, relTime } from '@/lib/client';
import { colorHex } from '@/lib/colors';
import { IconPin, IconTrash, IconX } from '@/components/Icons';
import { useDictation, joinSpoken, MicButton } from '@/components/Dictate';

const ALL = 'all';
const UNSORTED = 'unsorted';
const PALETTE = ['blue', 'green', 'orange', 'grape', 'teal', 'magenta', 'yellow', 'salmon', 'mint_green', 'violet'];
const titleOf = (body) => body.split('\n')[0].trim();
const restOf = (body) => body.split('\n').slice(1).join('\n').trim();
const catKey = (n, catById) => (n.category_id && catById[n.category_id] ? n.category_id : UNSORTED);

export default function Notes() {
  const q = useApi('/api/notes', { refreshMs: 30_000 });
  const [view, setView] = useState(ALL);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
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

  if (!d) return <><div className="page-head"><h1>Notes</h1></div><div className="empty"><span className="spin" /></div></>;

  const term = search.trim().toLowerCase();
  const shown = d.notes.filter((n) => {
    if (view !== ALL && catKey(n, catById) !== view) return false;
    return !term || n.body.toLowerCase().includes(term) || (catById[n.category_id]?.name || '').toLowerCase().includes(term);
  });
  const current = view === ALL ? null : view === UNSORTED ? { id: UNSORTED, name: 'Unsorted' } : catById[view];

  const addCategory = async (name) => {
    const cat = await api('/api/notes/categories', { method: 'POST', body: { name, color: PALETTE[cats.length % PALETTE.length] } });
    await q.reload();
    setView(cat.id);
  };
  const renameCategory = async () => {
    const name = prompt('Rename category', current.name);
    if (!name?.trim() || name.trim() === current.name) return;
    await api(`/api/notes/categories/${current.id}`, { method: 'PATCH', body: { name } });
    q.reload();
  };
  const removeCategory = async () => {
    if (!confirm(`Delete “${current.name}”? Its ${counts[current.id] || 0} notes move to Unsorted.`)) return;
    await api(`/api/notes/categories/${current.id}`, { method: 'DELETE' });
    setView(ALL);
    q.reload();
  };

  return (
    <>
      <div className="page-head">
        <div><h1>{current ? current.name : 'Notes'}</h1><div className="sub">{shown.length} {shown.length === 1 ? 'note' : 'notes'}</div></div>
        <div className="notes-tools">
          {current && current.id !== UNSORTED && <>
            <button className="btn ghost" onClick={renameCategory}>Rename</button>
            <button className="btn ghost danger" onClick={removeCategory}>Delete</button>
          </>}
          <input className="input notes-search" type="search" placeholder="Search notes" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="notes-layout">
        <CategoryRail cats={cats} counts={counts} view={view} setView={setView} onAdd={addCategory} adding={adding} setAdding={setAdding} />
        <div className="stack">
          <Composer cats={cats} defaultCat={current && current.id !== UNSORTED ? current.id : ''} onSaved={q.reload} />
          {shown.length ? (
            <div className="notes-grid">
              {shown.map((n) => <NoteCard key={n.id} note={n} cat={catById[n.category_id]} showCat={view === ALL} onOpen={() => setOpen(n)} />)}
            </div>
          ) : (
            <div className="empty">{term ? 'No notes match.' : current ? `Nothing in ${current.name} yet.` : 'No notes yet. Type or tap the mic above.'}</div>
          )}
        </div>
      </div>
      {open && <NoteEditor note={open} cats={cats} onClose={() => { setOpen(null); q.reload(); }} />}
    </>
  );
}

function CategoryRail({ cats, counts, view, setView, onAdd, adding, setAdding }) {
  const [name, setName] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) { setAdding(false); return; }
    await onAdd(name.trim());
    setName(''); setAdding(false);
  };
  const item = (id, label, color) => (
    <button key={id} className={`cat ${view === id ? 'on' : ''}`} onClick={() => setView(id)}>
      {color && <i style={{ background: colorHex(color) }} />}<span>{label}</span><em>{counts[id] || ''}</em>
    </button>
  );
  return (
    <nav className="cat-rail">
      {item(ALL, 'All notes')}
      {cats.map((c) => item(c.id, c.name, c.color))}
      {counts[UNSORTED] > 0 && item(UNSORTED, 'Unsorted', 'grey')}
      {adding ? (
        <form onSubmit={submit} className="cat-new">
          <input className="input" autoFocus placeholder="Category name" value={name} onChange={(e) => setName(e.target.value)}
            onBlur={submit} onKeyDown={(e) => { if (e.key === 'Escape') { setName(''); setAdding(false); } }} />
        </form>
      ) : (
        <button className="cat add" onClick={() => setAdding(true)}><span>+ New category</span></button>
      )}
    </nav>
  );
}

function useSpokenText(initial) {
  const [text, setText] = useState(initial);
  const ref = useRef(null);
  const dictation = useDictation({ fieldRef: ref, append: (p) => setText((t) => joinSpoken(t, p)) });
  return { text, setText, ref, dictation };
}

function CategorySelect({ cats, value, onChange }) {
  return (
    <select className="input cat-select" value={value || ''} onChange={(e) => onChange(e.target.value)}>
      <option value="">Unsorted</option>
      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );
}

function Composer({ cats, defaultCat, onSaved }) {
  const { text, setText, ref, dictation } = useSpokenText('');
  const [cat, setCat] = useState(defaultCat);
  const [busy, setBusy] = useState(false);
  useEffect(() => setCat(defaultCat), [defaultCat]);
  useAutoGrow(ref, text + dictation.interim);

  const save = async () => {
    if (!text.trim() || busy) return;
    dictation.stop();
    setBusy(true);
    try {
      await api('/api/notes', { method: 'POST', body: { body: text, category_id: cat || null } });
      setText('');
      await onSaved();
    } finally { setBusy(false); }
  };
  return (
    <section className={`card composer ${dictation.listening ? 'listening' : ''}`}>
      <textarea ref={ref} className="composer-text" rows={2} placeholder="Write a note… (first line is the title)"
        value={dictation.interim ? joinSpoken(text, dictation.interim) : text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }} />
      <div className="composer-bar">
        <CategorySelect cats={cats} value={cat} onChange={setCat} />
        {dictation.listening && <span className="listening-dot">Listening…</span>}
        {dictation.hint && !dictation.listening && <span className="hint">{dictation.hint}</span>}
        <div className="spacer" />
        <MicButton dictation={dictation} />
        <button className="btn primary" disabled={!text.trim() || busy} onClick={save} title="⌘↩">Save</button>
      </div>
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
        {showCat && cat && <span className="proj"><i style={{ background: colorHex(cat.color) }} />{cat.name}</span>}
        <span>{relTime(new Date(note.updated_at).getTime())}</span>
      </div>
    </button>
  );
}

function NoteEditor({ note, cats, onClose }) {
  const { text, setText, ref, dictation } = useSpokenText(note.body);
  const [cat, setCat] = useState(note.category_id || '');
  const [pinned, setPinned] = useState(!!note.pinned);
  const [error, setError] = useState('');
  useAutoGrow(ref, text + dictation.interim, 140);
  // Open with the cursor at the end, ready to keep writing.
  useEffect(() => { const el = ref.current; if (el && !matchMedia('(hover: none)').matches) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } }, [ref]);

  const close = async () => {
    dictation.stop();
    const patch = {};
    if (text.trim() !== note.body) patch.body = text;
    if ((cat || null) !== (note.category_id || null)) patch.category_id = cat || null;
    if (pinned !== !!note.pinned) patch.pinned = pinned;
    if (!text.trim()) { setError('A note needs some text. Delete it instead?'); return; }
    if (Object.keys(patch).length) {
      try { await api(`/api/notes/${note.id}`, { method: 'PATCH', body: patch }); }
      catch (e) { setError(e.message); return; }
    }
    onClose();
  };
  const remove = async () => {
    if (!confirm('Delete this note?')) return;
    await api(`/api/notes/${note.id}`, { method: 'DELETE' });
    onClose();
  };
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) { e.preventDefault(); close(); } };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  return (
    <div className="modal-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal wide note-editor">
        <div className="note-editor-head">
          <CategorySelect cats={cats} value={cat} onChange={setCat} />
          <div className="spacer" />
          <button className={`icon-btn ${pinned ? 'on' : ''}`} title={pinned ? 'Unpin' : 'Pin to top'} onClick={() => setPinned(!pinned)}><IconPin /></button>
          <MicButton dictation={dictation} />
          <button className="icon-btn" title="Delete" onClick={remove}><IconTrash /></button>
          <button className="icon-btn" title="Close" onClick={close}><IconX /></button>
        </div>
        <textarea ref={ref} className="composer-text big"
          value={dictation.interim ? joinSpoken(text, dictation.interim) : text}
          onChange={(e) => { setText(e.target.value); setError(''); }} />
        {(error || dictation.hint) && <div className="hint">{error || dictation.hint}</div>}
        <div className="note-foot">Created {new Date(note.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
      </div>
    </div>
  );
}

function useAutoGrow(ref, value, min = 0) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(min, el.scrollHeight)}px`;
  }, [ref, value, min]);
}
