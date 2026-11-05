'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import ConnectGoogle from '@/components/ConnectGoogle';
import { api, useApi, relTime } from '@/lib/client';
import { todayStr } from '@/lib/dates';
import { todayQuery } from '@/lib/mailq';
import { IconArchive, IconStar, IconExt, IconMailUnread, IconTask, IconRefresh } from '@/components/Icons';

// Me is for what's new; older mail lives in Gmail.
const FOLDERS = [
  { key: 'today', label: 'Today', q: () => todayQuery() },
  { key: 'unread', label: 'Unread', q: () => 'in:inbox is:unread newer_than:7d' },
  { key: 'starred', label: 'Starred', q: () => 'is:starred' },
];

export default function Page() { return <Suspense fallback={null}><Mail /></Suspense>; }

function Mail() {
  const { status } = useApp();
  const connected = status?.google?.connected;
  const params = useSearchParams();
  const router = useRouter();
  const [folder, setFolder] = useState('today');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState(() => todayQuery());
  const list = useApi(connected ? `/api/mail?q=${encodeURIComponent(q)}&max=40` : null, { refreshMs: 2 * 60_000 });
  const [extra, setExtra] = useState({ messages: [], next: null });
  const selId = params.get('id');
  useEffect(() => setExtra({ messages: [], next: null }), [q]);

  if (status && !connected) return (<><div className="page-head"><h1>Mail</h1></div><div className="card"><ConnectGoogle what="your email" /></div></>);

  const messages = [...(list.data?.messages || []), ...extra.messages];
  const nextToken = extra.next ?? list.data?.nextPageToken;
  const select = (id) => router.replace(id ? `/mail?id=${id}` : '/mail', { scroll: false });
  const patchLocal = (id, patch) => {
    list.setData((d) => d && { ...d, messages: d.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
    setExtra((x) => ({ ...x, messages: x.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  };
  const removeLocal = (id) => {
    const idx = messages.findIndex((m) => m.id === id);
    const nextMsg = messages[idx + 1] || messages[idx - 1];
    list.setData((d) => d && { ...d, messages: d.messages.filter((m) => m.id !== id) });
    setExtra((x) => ({ ...x, messages: x.messages.filter((m) => m.id !== id) }));
    select(nextMsg?.id || null);
  };
  const loadMore = async () => {
    const r = await api(`/api/mail?q=${encodeURIComponent(q)}&max=40&pageToken=${nextToken}`);
    setExtra((x) => ({ messages: [...x.messages, ...r.messages], next: r.nextPageToken || '' }));
  };

  return (
    <>
      <div className="page-head">
        <div><h1>Mail</h1><div className="sub">{folder === 'today' && !search ? (list.data ? `${messages.length}${nextToken ? '+' : ''} new today` : '') : status?.google?.email}</div></div>
        <div className="row">
          <div className="tabs">
            {FOLDERS.map((f) => <button key={f.key} className={folder === f.key && !search ? 'on' : ''} onClick={() => { setFolder(f.key); setSearch(''); setQ(f.q()); }}>{f.label}</button>)}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); if (search.trim()) setQ(search.trim()); }}>
            <input className="input" style={{ width: 220 }} placeholder="Search mail" value={search} onChange={(e) => setSearch(e.target.value)} />
          </form>
          <button className="icon-btn" title="Refresh" onClick={list.reload}><IconRefresh /></button>
        </div>
      </div>
      {list.error && <div className="error-box" style={{ marginBottom: 12 }}>{list.error.message}</div>}
      <div className="mail-layout">
        <div className="card mail-list">
          {!list.data ? <div className="empty"><span className="spin" /></div> : messages.length === 0 ? <div className="empty">{folder === 'today' && !search ? 'No new email today.' : 'Nothing here.'}<div style={{ marginTop: 10 }}><a className="btn ghost" href="https://mail.google.com/mail/u/0/#inbox" target="_blank" rel="noreferrer">Open Gmail</a></div></div> : (
            <>
              {messages.map((m) => (
                <div key={m.id} className={`mail-item ${m.unread ? 'unread' : ''} ${selId === m.id ? 'sel' : ''}`} onClick={() => select(m.id)}>
                  <span className="from">{m.starred ? '★ ' : ''}{m.from.name}</span>
                  <span className="time">{relTime(m.date)}</span>
                  <span className="subj">{m.subject}</span>
                  <span className="snip">{m.snippet}</span>
                </div>
              ))}
              {nextToken && <div style={{ padding: 12, textAlign: 'center' }}><button className="btn" onClick={loadMore}>Load more</button></div>}
            </>
          )}
        </div>
        <div className="card reader">
          {selId ? <Reader key={selId} id={selId} onPatch={patchLocal} onRemove={removeLocal} /> : <div className="empty" style={{ margin: 'auto' }}>Select an email to read it.</div>}
        </div>
      </div>
    </>
  );
}

function Reader({ id, onPatch, onRemove }) {
  const { addTask } = useApp();
  const msg = useApi(`/api/mail/${id}`);
  const [images, setImages] = useState(false);
  const [starred, setStarred] = useState(null);
  const m = msg.data;

  useEffect(() => {
    if (m?.unread) { api(`/api/mail/${id}`, { method: 'POST', body: { action: 'read' } }); onPatch(id, { unread: false }); }
    if (m) setStarred(m.starred);
  }, [m?.id]); // eslint-disable-line

  if (msg.error) return <div className="error-box" style={{ margin: 16 }}>{msg.error.message}</div>;
  if (!m) return <div className="empty" style={{ margin: 'auto' }}><span className="spin" /></div>;

  const act = async (action) => api(`/api/mail/${id}`, { method: 'POST', body: { action } });
  const gmailUrl = `https://mail.google.com/mail/u/0/#all/${m.threadId}`;
  const hasRemoteImages = m.html && /<img[^>]+src=["']?https?:/i.test(m.html);

  return (
    <>
      <div className="reader-head">
        <h2>{m.subject}</h2>
        <div className="meta"><b style={{ color: 'var(--text)' }}>{m.from.name}</b> &lt;{m.from.email}&gt; · {new Date(m.date).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div>
        {m.to && <div className="meta">to {m.to}{m.cc ? `, cc ${m.cc}` : ''}</div>}
        <div className="reader-tools">
          <button className="btn" onClick={async () => { await act('archive'); onRemove(id); }}><IconArchive style={{ width: 14 }} /> Archive</button>
          <button className="btn" onClick={async () => { await act('unread'); onPatch(id, { unread: true }); }}><IconMailUnread style={{ width: 14 }} /> Unread</button>
          <button className="btn" onClick={async () => { await act(starred ? 'unstar' : 'star'); setStarred(!starred); onPatch(id, { starred: !starred }); }}>
            <IconStar style={{ width: 14, fill: starred ? 'var(--p2)' : 'none', color: starred ? 'var(--p2)' : undefined }} /> {starred ? 'Starred' : 'Star'}
          </button>
          <button className="btn" onClick={() => addTask({ content: `Reply: ${m.subject}`, description: `From ${m.from.name} <${m.from.email}>\n${gmailUrl}`, due_date: todayStr() })}>
            <IconTask style={{ width: 14 }} /> Make task
          </button>
          <a className="btn ghost" href={gmailUrl} target="_blank" rel="noreferrer"><IconExt style={{ width: 14 }} /> Reply in Gmail</a>
          {hasRemoteImages && !images && <button className="btn ghost" onClick={() => setImages(true)}>Show images</button>}
        </div>
        {m.attachments.length > 0 && <div className="row" style={{ marginTop: 8 }}>{m.attachments.map((a, i) => <span key={i} className="chip">📎 {a.name}</span>)}</div>}
      </div>
      {m.html ? <iframe title="Email" sandbox="allow-popups allow-popups-to-escape-sandbox" srcDoc={frame(m.html, images)} /> : <pre>{m.text || '(empty message)'}</pre>}
    </>
  );
}

// Emails render in a sandboxed iframe: no scripts, no access to this app,
// and remote images (tracking pixels) blocked until you click "Show images".
function frame(html, images) {
  const csp = `default-src 'none'; style-src 'unsafe-inline' https:; font-src https: data:; img-src data: cid:${images ? ' https: http:' : ''};`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank">
<style>body{margin:18px;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d1c1a;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`;
}
