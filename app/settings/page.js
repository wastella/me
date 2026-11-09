'use client';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { api } from '@/lib/client';

export default function Page() { return <Suspense fallback={null}><Settings /></Suspense>; }

function Settings() {
  const { status, reloadStatus } = useApp();
  const params = useSearchParams();
  const g = status?.google;
  const flash = params.get('google');
  const [name, setName] = useState(null);
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

        {status?.mcpUrl && (
          <section className="card">
            <div className="card-head"><h2>Claude connector</h2></div>
            <div className="card-body">
              <p>Lets Claude (on your Mac, iPhone, or in Claude Code) read and change your tasks, calendar and training, using your Claude plan. In claude.ai open <b style={{ color: 'var(--text)' }}>Settings → Connectors → Add custom connector</b>, name it <b style={{ color: 'var(--text)' }}>Me</b>, and paste this URL. Keep it private: anyone with it can use your Me.</p>
              <CopyField value={status.mcpUrl} />
            </div>
          </section>
        )}

        {status?.hosted && (
          <section className="card">
            <div className="card-head"><h2>This device</h2></div>
            <div className="card-body">
              <p>Signed in as <b style={{ color: 'var(--text)' }}>{status?.google?.email}</b>. Your data syncs between your Mac and phone.</p>
              <button className="btn ghost danger" onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}>Sign out on this device</button>
            </div>
          </section>
        )}

        <section className="card">
          <div className="card-head"><h2>Your data</h2></div>
          <div className="card-body">
            <p>{status?.storage === 'cloud'
              ? 'Your data lives in your own Turso database, so every device you sign in on sees the same thing. Only your Google account can sign in.'
              : 'Your data lives on this Mac in a local SQLite database. Me only listens on localhost.'}</p>
            <p><span className="kbd">Q</span> quick-adds a task from anywhere. Quick add understands <code>tomorrow 5pm</code>, <code>every other sunday</code>, <code>p1</code> and <code>#Project</code>.</p>
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

function CopyField({ value }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); };
  return (
    <div className="row" style={{ flexWrap: 'nowrap' }}>
      <input className="input" readOnly value={shown ? value : value.replace(/[^/]+$/, '••••••••••••')} onFocus={(e) => e.target.select()} style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }} />
      <button className="btn ghost" onClick={() => setShown((v) => !v)}>{shown ? 'Hide' : 'Show'}</button>
      <button className="btn primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}
