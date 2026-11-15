'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

export async function api(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw Object.assign(new Error('Can’t reach Me. Check your connection and try again.'), { status: 0, offline: true });
  }
  const data = await res.json().catch(() => ({}));
  // Hosted session expired: go sign in again.
  if (res.status === 401 && data.error === 'Signed out' && typeof window !== 'undefined' && window.location.pathname !== '/login') window.location.href = '/login';
  if (!res.ok) throw Object.assign(new Error(data.error || `Something went wrong (${res.status}).`), { status: res.status });
  return data;
}

// The last answer for each address, kept while the app is open, so a screen
// you've already seen shows straight away and then quietly refreshes.
const seen = new Map();

// Tiny fetch hook: { data, error, loading, reload }. Re-fetches on window focus.
export function useApi(path, { refreshMs } = {}) {
  const [state, setState] = useState(() => ({ data: seen.get(path) ?? null, error: null, loading: !!path }));
  const pathRef = useRef(path);
  pathRef.current = path;
  const load = useCallback(async () => {
    if (!pathRef.current) return;
    const p = pathRef.current;
    try {
      const data = await api(p);
      seen.set(p, data);
      if (p === pathRef.current) setState({ data, error: null, loading: false });
    } catch (error) {
      if (p === pathRef.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);
  useEffect(() => { setState((s) => ({ ...s, data: seen.get(path) ?? s.data, loading: true })); load(); }, [path, load]);
  useEffect(() => {
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    const t = refreshMs ? setInterval(load, refreshMs) : null;
    return () => { window.removeEventListener('focus', onFocus); if (t) clearInterval(t); };
  }, [load, refreshMs]);
  return { ...state, reload: load, setData: (fn) => setState((s) => { const data = typeof fn === 'function' ? fn(s.data) : fn; if (pathRef.current) seen.set(pathRef.current, data); return { ...s, data }; }) };
}

export function relTime(ms) {
  const d = new Date(ms); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const diff = (now - d) / 86400000;
  if (diff < 6) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: '2-digit' } : {}) });
}

export const clockTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(' ', '').toLowerCase();
