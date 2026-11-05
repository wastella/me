'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { api } from '@/lib/client';

export default function Page() { return <Suspense fallback={null}><Settings /></Suspense>; }

function Settings() {
  const { status, reloadStatus, reloadTasks } = useApp();
  const params = useSearchParams();
  const g = status?.google;
  const flash = params.get('google');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState(null);
  const [name, setName] = useState(null);

  const runImport = async () => {
    setImporting(true); setImportMsg(null);
    try {
      const c = await api('/api/todoist/import', { method: 'POST' });
      setImportMsg(`Imported ${c.tasks} tasks, ${c.projects} projects, ${c.sections} sections, ${c.labels} labels and ${c.completed} completed items.`);
      reloadTasks(); reloadStatus();
    } catch (e) { setImportMsg(e.message); }
    setImporting(false);
  };
  const saveName = async () => { await api('/api/settings', { method: 'PATCH', body: { name } }); reloadStatus(); };
  const disconnect = async () => { if (confirm('Disconnect Google?')) { await api('/api/google/disconnect', { method: 'POST' }); reloadStatus(); } };

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <div className="settings">
        {flash === 'connected' && <div className="card card-body" style={{ padding: 14, color: 'var(--ok)' }}>✓ Google connected. Your calendar and inbox are live.</div>}
        {flash && flash !== 'connected' && <div className="error-box">Google said: {flash === 'missing' ? 'add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local first' : decodeURIComponent(flash)}</div>}

        <section className="card">
          <div className="card-head"><h2>You</h2></div>
          <div className="card-body">
            <div className="row" style={{ flexWrap: 'nowrap' }}>
              <input className="input" placeholder="Your first name (for the greeting)" value={name ?? status?.name ?? ''} onChange={(e) => setName(e.target.value)} />
              <button className="btn" onClick={saveName} disabled={name === null}>Save</button>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2><span className={`status-dot ${g?.connected ? 'on' : ''}`} />Google Calendar &amp; Gmail</h2></div>
          <div className="card-body">
            {g?.connected ? (
              <>
                <p>Connected as <b style={{ color: 'var(--text)' }}>{g.email}</b>. Me can read and create calendar events, and read, star, mark read and archive email. It cannot delete or send email.</p>
                <div className="row"><a className="btn" href="/api/google/connect">Reconnect</a><button className="btn ghost danger" onClick={disconnect}>Disconnect</button></div>
              </>
            ) : g?.configured ? (
              <>
                <p>Your Google client is set up. Click to sign in{status?.desktop ? ' — it opens in your browser, then come back here' : ''}.</p>
                <div className="row">
                  <a className="btn primary" href="/api/google/connect">Connect Google</a>
                  <button className="btn ghost" onClick={reloadStatus}>I’ve approved it — refresh</button>
                  <button className="btn ghost danger" onClick={async () => { await api('/api/settings', { method: 'PATCH', body: { googleClientId: '', googleClientSecret: '' } }); reloadStatus(); }}>Clear keys</button>
                </div>
              </>
            ) : (
              <>
                <p>Google requires every personal app to have its own free OAuth client. One-time setup, about 5 minutes:</p>
                <ol className="steps">
                  <li>Open <a className="btn ghost" style={{ padding: '1px 6px' }} href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud → New project ↗</a> and create a project called <b>Me</b>.</li>
                  <li>Enable both APIs: <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer" style={{ color: 'var(--link)' }}>Google Calendar API ↗</a> and <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer" style={{ color: 'var(--link)' }}>Gmail API ↗</a> (click <b>Enable</b> on each).</li>
                  <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer" style={{ color: 'var(--link)' }}>Google Auth Platform ↗</a> → <b>Get started</b>. App name <b>Me</b>, your email as support email, audience <b>External</b>, then finish.</li>
                  <li>In <b>Audience</b>, click <b>Publish app</b> → confirm. (If you leave it in “Testing”, Google logs you out every 7 days.)</li>
                  <li>In <b>Clients</b> → <b>Create client</b> → type <b>Web application</b>. Under <i>Authorized redirect URIs</i> add <code>{g?.redirectUri || 'http://localhost:3737/api/google/callback'}</code> → <b>Create</b>.</li>
                  <li>Paste the Client ID and Client secret below and click <b>Save</b>.</li>
                  <li>Click <b>Connect Google</b>. It opens in your browser. When Google warns the app is unverified, click <b>Advanced → Go to Me</b> (it’s your own app), approve, then come back here.</li>
                </ol>
                <GoogleKeys onSaved={reloadStatus} />
              </>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2><span className={`status-dot ${status?.todoist?.lastImport ? 'on' : ''}`} />Todoist import</h2></div>
          <div className="card-body">
            <p>
              {status?.todoist?.lastImport
                ? <>Last imported {new Date(status.todoist.lastImport.at).toLocaleString()} — {status.todoist.lastImport.counts.tasks} tasks, {status.todoist.lastImport.counts.completed} completed.</>
                : 'Not imported yet.'}
              {' '}Re-importing updates matching tasks instead of duplicating them. Tasks you’ve created in Me are left alone.
            </p>
            <div className="row">
              <button className="btn" onClick={runImport} disabled={importing || !status?.todoist?.token}>{importing ? <><span className="spin" /> Importing…</> : 'Re-import from Todoist'}</button>
              {!status?.todoist?.token && <span className="muted">Add TODOIST_API_TOKEN to .env.local</span>}
            </div>
            {importMsg && <p style={{ marginTop: 10 }}>{importMsg}</p>}
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2>Your data</h2></div>
          <div className="card-body">
            <p>Everything lives on this Mac in <code>{status?.paths?.db || 'me.db'}</code> (SQLite). Google tokens are stored there too and never leave your machine. Me only listens on localhost.</p>
            <p><span className="kbd">Q</span> quick-adds a task from anywhere. Quick add understands <code>tomorrow 5pm</code>, <code>every other sunday</code>, <code>p1</code>, <code>#Project</code>, <code>@label</code>.</p>
          </div>
        </section>
      </div>
    </>
  );
}

function GoogleKeys({ onSaved }) {
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [err, setErr] = useState(null);
  const save = async (e) => {
    e.preventDefault(); setErr(null);
    try { await api('/api/settings', { method: 'PATCH', body: { googleClientId: id, googleClientSecret: secret } }); onSaved(); }
    catch (x) { setErr(x.message); }
  };
  return (
    <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input className="input" placeholder="Client ID (…apps.googleusercontent.com)" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
      <input className="input" type="password" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
      {err && <div className="error-box">{err}</div>}
      <div className="row"><button className="btn primary" disabled={!id || !secret}>Save</button><span className="muted" style={{ fontSize: 12 }}>Stored only in Me’s local database.</span></div>
    </form>
  );
}
