'use client';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useApp } from '@/components/AppProvider';
import { api, useApi } from '@/lib/client';
import { useDialog } from '@/components/ui';

export default function Page() { return <Suspense fallback={null}><Settings /></Suspense>; }

function Settings() {
  const { status, reloadStatus, attempt, showToast } = useApp();
  const { confirm } = useDialog();
  const params = useSearchParams();
  const g = status?.google;
  const flash = params.get('google');
  const [name, setName] = useState(null);
  const saveName = async (e) => {
    e.preventDefault();
    if (await attempt(() => api('/api/settings', { method: 'PATCH', body: { name } }))) { showToast('Saved'); setName(null); reloadStatus(); }
  };
  const disconnect = async () => {
    if (!(await confirm({ title: 'Disconnect Google?', body: 'Your calendar disappears from Me until you connect again. Nothing in Google is changed.', confirmLabel: 'Disconnect', danger: true }))) return;
    if (await attempt(() => api('/api/google/disconnect', { method: 'POST' }))) reloadStatus();
  };
  const signOut = async () => {
    if (await attempt(() => api('/api/auth/logout', { method: 'POST' }))) window.location.href = '/login';
  };

  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <div className="settings">
        {flash === 'connected' && <div className="ok-box" role="status">Google is connected. Your calendar is live.</div>}
        {flash && flash !== 'connected' && <div className="error-box" role="alert">Google said: {flash === 'missing' ? 'add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local first' : decodeURIComponent(flash)}</div>}

        <section className="card">
          <div className="card-head"><h2>You</h2></div>
          <div className="card-body">
            <form className="row nowrap" onSubmit={saveName}>
              <input className="input" placeholder="Your first name, for the greeting" aria-label="Your first name" value={name ?? status?.name ?? ''} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="given-name" />
              <button className="btn" disabled={name === null || name === (status?.name ?? '')}>Save</button>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-head"><h2><i className={`dot ${g?.connected ? 'on' : ''}`} />Google Calendar</h2></div>
          <div className="card-body">
            {g?.connected ? (
              <>
                <p>Connected as <b>{g.email}</b>. Me can read, create and delete events on your calendars.</p>
                <div className="row"><a className="btn" href="/api/google/connect">Reconnect</a><button className="btn ghost danger" onClick={disconnect}>Disconnect</button></div>
              </>
            ) : g?.configured ? (
              <>
                <p>Your Google client is set up. Click to sign in{status?.desktop ? ' — it opens in your browser, then come back here' : ''}.</p>
                <div className="row">
                  <a className="btn primary" href="/api/google/connect">Connect Google</a>
                  <button className="btn ghost" onClick={reloadStatus}>I’ve approved it — refresh</button>
                  <button className="btn ghost danger" onClick={async () => { if (await attempt(() => api('/api/settings', { method: 'PATCH', body: { googleClientId: '', googleClientSecret: '' } }))) reloadStatus(); }}>Clear keys</button>
                </div>
              </>
            ) : (
              <>
                <p>Google requires every personal app to have its own free OAuth client. One-time setup, about 5 minutes:</p>
                <ol className="steps">
                  <li>Open <a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noreferrer">Google Cloud → New project ↗</a> and create a project called <b>Me</b>.</li>
                  <li>Enable both APIs: <a href="https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" target="_blank" rel="noreferrer">Google Calendar API ↗</a> and <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noreferrer">Gmail API ↗</a> (click <b>Enable</b> on each).</li>
                  <li>Open <a href="https://console.cloud.google.com/auth/overview" target="_blank" rel="noreferrer">Google Auth Platform ↗</a> → <b>Get started</b>. App name <b>Me</b>, your email as support email, audience <b>External</b>, then finish.</li>
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

        <Meals meals={status?.meals} onChange={reloadStatus} />

        {status?.push?.enabled && <Notifications publicKey={status.push.publicKey} />}

        {status?.memento && (
          <section className="card">
            <div className="card-head"><h2>RemindMe</h2></div>
            <div className="card-body">
              <p>Reminders you can’t ignore. Ask Claude “remind me to move the laundry in 40 minutes”: when it goes off, your Macs flash and lock on the reminder for as long as the job takes, then ask if you did it. <a href="/remindme">See your reminders</a>.</p>
              <p><b>On each Mac:</b> install the RemindMe app (in the Me folder, run <code>./RemindMe/build.sh install</code>), click the bell in the menu bar → <b>Set Key…</b>, and paste this key. Turn on <b>Open at Login</b> there too.</p>
              <CopyField value={status.memento.key} secretLabel="Key" />
              <p style={{ marginTop: 12 }}><b>On your iPhone:</b> {status?.push?.enabled
                ? 'you get a notification when a reminder goes off, and it fills the screen when you open Me. Turn on notifications in the card above on the phone itself.'
                : 'the reminder fills the screen whenever Me is open. To also get a notification while the phone is in your pocket, notifications need their one-time setup (scripts/setup-notifications.sh).'} iPhones don’t let any app lock the whole phone, so the hard lock is Mac-only.</p>
            </div>
          </section>
        )}

        {status?.shortcut && (
          <section className="card">
            <div className="card-head"><h2>Siri</h2></div>
            <div className="card-body">
              <p>Say “Hey Siri, add to Me” to add a task (quick-add works: “call mom tomorrow 5pm p1”). Set it up once on your iPhone:</p>
              <ol className="steps">
                <li>Open <b>Shortcuts</b> → <b>+</b>. Name it <b>Add to Me</b>.</li>
                <li>Add <b>Dictate Text</b>.</li>
                <li>Add <b>Get Contents of URL</b> with the URL below. Tap <b>Show More</b>: Method <b>POST</b>; Headers: <code>Authorization</code> = <code>Bearer</code> + a space + the key below; Request Body <b>JSON</b> with key <code>text</code> = <i>Dictated Text</i>.</li>
                <li>Add <b>Get Dictionary Value</b> → key <code>message</code>, then <b>Speak Text</b> (optional).</li>
              </ol>
              <p>For notes, duplicate that shortcut, name it <b>Note to Me</b>, and add a second key to the JSON body: <code>kind</code> = <code>note</code>. Start with a category name to file it (“Ideas: …” or “#Ideas …”); otherwise it lands in Unsorted.</p>
              <div className="stack" style={{ gap: 8 }}>
                <CopyField value={status.shortcut.url} plain />
                <CopyField value={status.shortcut.token} secretLabel="Key" />
              </div>
            </div>
          </section>
        )}

        {status?.mcpUrl && (
          <section className="card">
            <div className="card-head"><h2>Claude connector</h2></div>
            <div className="card-body">
              <p>Lets Claude (on your Mac, iPhone, or in Claude Code) read and change your tasks, calendar, notes and training (and see your meals), using your Claude plan. In claude.ai open <b>Settings → Connectors → Add custom connector</b>, name it <b>Me</b>, and paste this URL. Keep it private: anyone with it can use your Me.</p>
              <CopyField value={status.mcpUrl} />
            </div>
          </section>
        )}

        {status?.hosted && (
          <section className="card">
            <div className="card-head"><h2>This device</h2></div>
            <div className="card-body">
              <p>Signed in as <b>{status?.google?.email}</b>. Your data syncs between your Mac and phone.</p>
              <div><button className="btn danger" onClick={signOut}>Sign out on this device</button></div>
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

function Meals({ meals, onChange }) {
  const { attempt, showToast } = useApp();
  const { confirm } = useDialog();
  const [url, setUrl] = useState('');
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { const r = await api('/api/meals', { method: 'PUT', body: { url } }); showToast(`Connected “${r.name}”`); setUrl(''); onChange(); }
    catch (x) { setErr(x.message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Disconnect meals?', body: 'Meals disappear from Me. Nothing in Mealboard or your calendar changes.', confirmLabel: 'Disconnect', danger: true }))) return;
    if (await attempt(() => api('/api/meals', { method: 'DELETE' }))) onChange();
  };
  return (
    <section className="card">
      <div className="card-head"><h2><i className={`dot ${meals?.connected ? 'on' : ''}`} />Meals (Mealboard)</h2></div>
      <div className="card-body">
        {meals?.connected ? (
          <>
            <p>Reading dinners from your <b>{meals.name}</b> calendar. Each night’s meal shows on your Supper events in the Calendar tab, and Claude can see them through the connector. Plan meals in Mealboard as usual; Me checks for changes every 10 minutes.</p>
            <div><button className="btn ghost danger" onClick={remove}>Disconnect</button></div>
          </>
        ) : (
          <>
            <p>Mealboard exports its meal plan into your iPhone’s Calendar. Share that calendar as a link and Me shows what’s for dinner. One-time setup on your iPhone:</p>
            <ol className="steps">
              <li>In <b>Mealboard</b>, export meals into their own calendar (for example one called <b>Meals</b>), not your main calendar: the next step makes that calendar readable by anyone with the link.</li>
              <li>Open the <b>Calendar</b> app → <b>Calendars</b> → tap <b>ⓘ</b> next to that calendar → turn on <b>Public Calendar</b> → <b>Share Link…</b> → <b>Copy</b>.</li>
              <li>Paste the link below and click <b>Connect</b>.</li>
            </ol>
            <form onSubmit={save} className="stack" style={{ gap: 8 }}>
              <input className="input" aria-label="Meals calendar link" placeholder="webcal://p…-caldav.icloud.com/published/…" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" spellCheck={false} />
              {err && <div className="error-box" role="alert">{err}</div>}
              <div className="row"><button className="btn primary" disabled={!url.trim() || busy}>{busy ? 'Checking…' : 'Connect'}</button></div>
            </form>
          </>
        )}
      </div>
    </section>
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
    <form onSubmit={save} className="stack" style={{ gap: 8 }}>
      <input className="input" aria-label="Client ID" placeholder="Client ID (…apps.googleusercontent.com)" value={id} onChange={(e) => setId(e.target.value)} autoComplete="off" spellCheck={false} />
      <input className="input" type="password" aria-label="Client secret" placeholder="Client secret" value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" />
      {err && <div className="error-box" role="alert">{err}</div>}
      <div className="row"><button className="btn primary" disabled={!id || !secret}>Save</button><span className="muted small">Stored only in Me’s own database.</span></div>
    </form>
  );
}

function CopyField({ value, plain, secretLabel }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!!plain);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { setShown(true); }   // clipboard blocked: show it so it can be copied by hand
  };
  return (
    <div className="row nowrap">
      <input className="input mono" readOnly aria-label={secretLabel || 'Address'} value={shown ? value : secretLabel ? `${secretLabel}: ••••••••••••` : value.replace(/[^/]+$/, '••••••••••••')} onFocus={(e) => e.target.select()} />
      {!plain && <button className="btn ghost" onClick={() => setShown((v) => !v)}>{shown ? 'Hide' : 'Show'}</button>}
      <button className="btn primary" onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
    </div>
  );
}


const b64ToBytes = (b) => { const s = atob((b + '='.repeat((4 - (b.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(s, (c) => c.charCodeAt(0)); };

function Notifications({ publicKey }) {
  const [state, setState] = useState('checking');   // checking | unsupported | needs-home | off | on | denied
  const [msg, setMsg] = useState(null);
  const prefsQ = useApi('/api/settings');
  useEffect(() => {
    (async () => {
      const ios = /iPhone|iPad/.test(navigator.userAgent);
      const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
      if (/Electron/.test(navigator.userAgent)) return setState('unsupported');
      if (ios && !standalone) return setState('needs-home');
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return setState('unsupported');
      if (Notification.permission === 'denied') return setState('denied');
      const reg = await navigator.serviceWorker.ready;
      setState((await reg.pushManager.getSubscription()) ? 'on' : 'off');
    })().catch(() => setState('unsupported'));
  }, []);
  const turnOn = async () => {
    setMsg(null);
    try {
      if ((await Notification.requestPermission()) !== 'granted') return setState('denied');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      await api('/api/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON(), device: /iPhone/.test(navigator.userAgent) ? 'iPhone' : navigator.platform } });
      setState('on');
    } catch (e) { setMsg(e.message); }
  };
  const turnOff = async () => {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) { await api('/api/push/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } }); await sub.unsubscribe(); }
    setState('off');
  };
  const test = async () => { const r = await api('/api/push/test', { method: 'POST' }); setMsg(r.sent ? 'Sent. It should arrive in a few seconds.' : 'No devices are signed up yet.'); };
  const prefs = prefsQ.data?.pushPrefs;
  const setPref = async (k, v) => { const next = { ...prefs, [k]: v }; prefsQ.setData({ pushPrefs: next }); await api('/api/settings', { method: 'PATCH', body: { pushPrefs: next } }); };
  return (
    <section className="card">
      <div className="card-head"><h2><i className={`dot ${state === 'on' ? 'on' : ''}`} />Notifications</h2></div>
      <div className="card-body">
        {state === 'needs-home' && <p>On iPhone, notifications work from the home-screen app: in Safari tap <b>Share → Add to Home Screen</b>, open Me from there, and come back to this page.</p>}
        {state === 'unsupported' && <p>This device can’t receive Me notifications here. Turn them on from the Me app on your iPhone (home-screen version) or in Chrome/Safari on a computer.</p>}
        {state === 'denied' && <p>Notifications are blocked for Me. On iPhone: Settings → Notifications → Me → Allow Notifications, then come back.</p>}
        {state === 'off' && <><p>Get a morning rundown, reminders for tasks with a time, a lift-day nudge and an evening posture reminder.</p><button className="btn primary" onClick={turnOn}>Turn on for this device</button></>}
        {state === 'on' && <div className="row"><span className="muted">On for this device.</span><button className="btn" onClick={test}>Send a test</button><button className="btn ghost danger" onClick={turnOff}>Turn off here</button></div>}
        {msg && <p>{msg}</p>}
        {prefs && (
          <div className="pref-list">
            {[['morning', 'Morning rundown (7am)'], ['tasks', 'Tasks with a time (shortly before)'], ['lift', 'Lift day nudge (4pm if not logged)'], ['posture', 'Posture reminder (8pm if not done)']].map(([k, label]) => (
              <label key={k} className="check-row"><input type="checkbox" checked={prefs[k] !== false} onChange={(e) => setPref(k, e.target.checked)} /> {label}</label>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
