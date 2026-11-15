'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi } from '@/lib/client';
import { humanDate, todayStr } from '@/lib/dates';
import { quickAdd } from '@/lib/quickadd';
import TaskEditor from './TaskEditor';
import QuickAdd from './QuickAdd';
import { Sheet, useDialog } from './ui';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// A stand-in row for a task that is still being saved, worked out the same
// way the server will (dates, priority and #Project read from the text).
let drafts = 0;
function draftTask(input, projects) {
  const p = quickAdd(input.text, { projects });
  return {
    id: `tmp-${Date.now()}-${drafts++}`, content: p.content, description: '', priority: p.priority,
    due_date: p.due_date || input.due_date || null, due_time: p.due_time, due_string: p.due_string, recurring: p.recurring, deadline: null,
    project_id: input.project_id || p.project_id || projects.find((x) => x.is_inbox)?.id, section_id: input.section_id || null, parent_id: input.parent_id || null,
    sort: 1e9, day_order: 1e9, created_at: new Date().toISOString(),
  };
}

// A thin strip at the top of the page while the device has no connection.
export function OfflineBanner() {
  const app = useApp();
  return app?.offline ? <div className="banner" role="status">You’re offline. Changes won’t save until you’re back online.</div> : null;
}

export default function AppProvider({ children }) {
  const tasksQ = useApi('/api/tasks');
  const status = useApi('/api/status');
  const { confirm } = useDialog();
  const [toast, setToast] = useState(null);
  const [offline, setOffline] = useState(false);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding] = useState(false);
  const [drag, setDrag] = useState(null);          // { id, title, x, y, target: { list, index } }
  const lists = useRef(new Map());                 // list key -> { order, reorder }
  const draggedAt = useRef(0);
  const toastTimer = useRef();

  // In the Mac app, leave room for the window buttons (top-left).
  useEffect(() => {
    if (/Electron/.test(navigator.userAgent)) document.documentElement.classList.add('desktop');
    // Service worker for notifications (not needed inside the Mac app).
    else if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => {
    const sync = () => setOffline(!navigator.onLine);
    sync();
    window.addEventListener('online', sync); window.addEventListener('offline', sync);
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync); };
  }, []);

  // showToast('Saved') · showToast('Done', { action: { label: 'Undo', run } }) · showToast(msg, { error: true })
  const showToast = useCallback((msg, { action, error } = {}) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, action, error, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), error ? 7000 : 5000);
  }, []);

  // Runs a change; if it fails, says so and reloads so the screen matches what was really saved.
  const attempt = useCallback(async (fn) => {
    try { return await fn(); }
    catch (e) { showToast(e.message || 'That didn’t save. Try again.', { error: true }); tasksQ.reload(); return undefined; }
  }, [showToast, tasksQ.reload]); // eslint-disable-line

  const data = tasksQ.data || { projects: [], sections: [], labels: [], tasks: [] };
  const projectById = useMemo(() => Object.fromEntries(data.projects.map((p) => [p.id, p])), [data.projects]);

  // The new task shows in the list at once; the saved version replaces it a moment later.
  const addTask = useCallback((input) => attempt(async () => {
    const draft = input.text ? draftTask(input, data.projects) : null;
    if (draft) tasksQ.setData((d) => d && { ...d, tasks: [...d.tasks, draft] });
    let t;
    try { t = await api('/api/tasks', { method: 'POST', body: input }); }
    catch (e) { if (draft) tasksQ.setData((d) => d && { ...d, tasks: d.tasks.filter((x) => x.id !== draft.id) }); throw e; }
    if (draft) tasksQ.setData((d) => d && { ...d, tasks: d.tasks.map((x) => (x.id === draft.id ? { ...draft, ...t } : x)) });
    tasksQ.reload();
    showToast(`Added “${t.content}”${t.due_date ? ` · ${humanDate(t.due_date)}` : ''}`);
    return t;
  }), [attempt, tasksQ, showToast, data.projects]);

  // Q (or ⌘N in the Mac app) adds a task from any screen. Screens with their
  // own add box handle the key themselves.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'q' || e.metaKey || e.ctrlKey || e.altKey || window.location.pathname === '/login') return;
      const a = document.activeElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(a?.tagName) || a?.isContentEditable || document.body.classList.contains('sheet-open')) return;
      if (document.querySelector('input[data-qa-hotkey]')) return;
      e.preventDefault(); setAdding(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const updateTask = useCallback((id, patch) => attempt(async () => {
    tasksQ.setData((d) => d && { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: patch });
    tasksQ.reload();
    return true;
  }), [attempt, tasksQ]);

  const completeTask = useCallback((task) => attempt(async () => {
    if (!task.recurring) tasksQ.setData((d) => d && { ...d, tasks: d.tasks.filter((t) => t.id !== task.id && t.parent_id !== task.id) });
    const r = await api(`/api/tasks/${task.id}`, { method: 'POST', body: { action: 'complete' } });
    tasksQ.reload();
    const undo = () => attempt(async () => {
      setToast(null);
      await api(`/api/tasks/${task.id}`, { method: 'POST', body: { action: 'uncomplete', previousDue: task.due_date } });
      tasksQ.reload();
    });
    showToast(r.rescheduled ? `Done · next ${humanDate(r.rescheduled).toLowerCase()}` : `Completed “${task.content}”`, { action: { label: 'Undo', run: undo } });
    return r;
  }), [attempt, tasksQ, showToast]);

  // Drag-and-drop: apply locally first so the list doesn't jump, then save.
  const reorderTasks = useCallback(async ({ ids, field, moved, patch }) => {
    const pos = Object.fromEntries(ids.map((id, i) => [id, i]));
    tasksQ.setData((d) => d && { ...d, tasks: d.tasks.map((t) => {
      let n = t.id in pos ? { ...t, [field]: pos[t.id] } : t;
      if (patch && t.id === moved) n = { ...n, ...patch, ...('due_date' in patch && !patch.due_date ? { due_time: null, recurring: false } : {}) };
      return n;
    }) });
    await attempt(() => api('/api/tasks/reorder', { method: 'POST', body: { ids, field, moved, patch } }));
    tasksQ.reload();
  }, [tasksQ, attempt]);

  const registerList = useCallback((key, info) => {
    lists.current.set(key, info);
    return () => lists.current.delete(key);
  }, []);

  // Pointer-based drag: press on a task and move 5px to pick it up; a line
  // shows where it will land; release to drop. Works across days/sections.
  const startDrag = useCallback((e, task) => {
    if (e.button !== 0 || e.target.closest('button, a, input, textarea, select')) return;
    const sx = e.clientX, sy = e.clientY;
    let live = false;
    // Touch: press and hold to pick a task up, so swiping still scrolls.
    const touch = e.pointerType === 'touch';
    let armed = !touch, holdTimer = null;
    const stopScroll = (ev) => { if (live) ev.preventDefault(); };
    if (touch) {
      holdTimer = setTimeout(() => { armed = true; navigator.vibrate?.(10); setDrag({ id: task.id, title: task.content, x: sx, y: sy, target: null }); live = true; document.body.classList.add('is-dragging'); }, 350);
      window.addEventListener('touchmove', stopScroll, { passive: false });
    }
    const hit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const row = el?.closest('[data-list]');
      if (row) {
        let index = Number(row.dataset.index);
        if (row.dataset.kid) index += 1;
        else { const r = row.getBoundingClientRect(); if (y > r.top + r.height / 2) index += 1; }
        return { list: row.dataset.list, index };
      }
      const zone = el?.closest('[data-drop-list]');
      if (zone) return { list: zone.dataset.dropList, index: lists.current.get(zone.dataset.dropList)?.order.length ?? 0 };
      // Just above or below a list counts as its start or end.
      for (const node of document.querySelectorAll('[data-drop-list]')) {
        const r = node.getBoundingClientRect();
        if (x < r.left || x > r.right) continue;
        if (y >= r.bottom && y <= r.bottom + 40) return { list: node.dataset.dropList, index: lists.current.get(node.dataset.dropList)?.order.length ?? 0 };
        if (y <= r.top && y >= r.top - 24) return { list: node.dataset.dropList, index: 0 };
      }
      return null;
    };
    const move = (ev) => {
      if (!armed) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cleanup(); return; }
      if (!live) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
        live = true;
        document.body.classList.add('is-dragging');
      }
      ev.preventDefault();
      if (ev.clientY < 50) window.scrollBy(0, -14);
      else if (ev.clientY > window.innerHeight - 50) window.scrollBy(0, 14);
      setDrag({ id: task.id, title: task.content, x: ev.clientX, y: ev.clientY, target: hit(ev.clientX, ev.clientY) });
    };
    const cleanup = () => {
      clearTimeout(holdTimer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cleanup);
      window.removeEventListener('touchmove', stopScroll);
      document.body.classList.remove('is-dragging');
      if (live) setDrag(null);
    };
    const up = (ev) => {
      const wasLive = live;
      cleanup();
      if (!wasLive) return;
      draggedAt.current = Date.now();
      const target = hit(ev.clientX, ev.clientY);
      setDrag(null);
      const reg = target && lists.current.get(target.list);
      if (!reg) return;
      const from = reg.order.indexOf(task.id);
      const next = reg.order.filter((x) => x !== task.id);
      next.splice(from !== -1 && from < target.index ? target.index - 1 : target.index, 0, task.id);
      if (from !== -1 && next.join() === reg.order.join()) return;
      reorderTasks({ ids: next, field: reg.reorder.field, moved: task.id, patch: from === -1 ? reg.reorder.patch : undefined });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cleanup);
  }, [reorderTasks]);

  const deleteTask = useCallback(async (task) => {
    const kids = data.tasks.filter((t) => t.parent_id === task.id).length;
    const ok = await confirm({ title: 'Delete this task?', body: `“${task.content}”${kids ? ` and its ${kids} subtask${kids === 1 ? '' : 's'}` : ''} will be removed for good.`, confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    setEditing(null);
    await attempt(async () => {
      tasksQ.setData((d) => d && { ...d, tasks: d.tasks.filter((t) => t.id !== task.id && t.parent_id !== task.id) });
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      tasksQ.reload();
    });
  }, [tasksQ, attempt, confirm, data.tasks]);

  const value = {
    ...data, projectById, tasksLoading: tasksQ.loading && !tasksQ.data, tasksError: tasksQ.data ? null : tasksQ.error, reloadTasks: tasksQ.reload,
    status: status.data, reloadStatus: status.reload,
    addTask, updateTask, completeTask, deleteTask, showToast, reorderTasks, attempt, offline,
    drag, startDrag, registerList, justDragged: () => Date.now() - draggedAt.current < 250,
    openTask: (t) => { if (!String(t.id).startsWith('tmp-')) setEditing(t.id); },
  };
  const editingTask = editing && data.tasks.find((t) => t.id === editing);

  return (
    <Ctx.Provider value={value}>
      {children}
      {editingTask && <TaskEditor task={editingTask} onClose={() => setEditing(null)} />}
      {adding && (
        <Sheet title="Add a task" onClose={() => setAdding(false)}>
          <QuickAdd hotkey={false} autoFocus defaults={{ due_date: todayStr() }} placeholder="Add a task for today" onAdded={() => setAdding(false)} />
        </Sheet>
      )}
      {drag && <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>{drag.title}</div>}
      {toast && (
        <div key={toast.key} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>
          <span>{toast.msg}</span>
          {toast.action && <button onClick={toast.action.run}>{toast.action.label}</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}
