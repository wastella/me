'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api, useApi } from '@/lib/client';
import { humanDate } from '@/lib/dates';
import TaskEditor from './TaskEditor';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export default function AppProvider({ children }) {
  const tasksQ = useApi('/api/tasks');
  const status = useApi('/api/status');
  const [toast, setToast] = useState(null);
  const [editing, setEditing] = useState(null);
  const [drag, setDrag] = useState(null);          // { id, title, x, y, target: { list, index } }
  const lists = useRef(new Map());                 // list key -> { order, reorder }
  const draggedAt = useRef(0);
  const toastTimer = useRef();

  // In the Mac app, leave room for the window buttons (top-left).
  useEffect(() => {
    if (/Electron/.test(navigator.userAgent)) document.documentElement.classList.add('desktop');
  }, []);

  const showToast = useCallback((msg, action) => {
    clearTimeout(toastTimer.current);
    setToast({ msg, action });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  const data = tasksQ.data || { projects: [], sections: [], labels: [], tasks: [] };
  const projectById = useMemo(() => Object.fromEntries(data.projects.map((p) => [p.id, p])), [data.projects]);

  const addTask = useCallback(async (input) => {
    const t = await api('/api/tasks', { method: 'POST', body: input });
    tasksQ.reload();
    showToast(`Added “${t.content}”${t.due_date ? ` · ${humanDate(t.due_date)}` : ''}`);
    return t;
  }, [tasksQ, showToast]);

  const updateTask = useCallback(async (id, patch) => {
    tasksQ.setData((d) => d && { ...d, tasks: d.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) });
    await api(`/api/tasks/${id}`, { method: 'PATCH', body: patch });
    tasksQ.reload();
  }, [tasksQ]);

  const completeTask = useCallback(async (task) => {
    if (!task.recurring) tasksQ.setData((d) => d && { ...d, tasks: d.tasks.filter((t) => t.id !== task.id && t.parent_id !== task.id) });
    const r = await api(`/api/tasks/${task.id}`, { method: 'POST', body: { action: 'complete' } });
    tasksQ.reload();
    const undo = async () => {
      await api(`/api/tasks/${task.id}`, { method: 'POST', body: { action: 'uncomplete', previousDue: task.due_date } });
      tasksQ.reload(); setToast(null);
    };
    showToast(r.rescheduled ? `Done · next: ${humanDate(r.rescheduled)}` : `Completed “${task.content}”`, { label: 'Undo', run: undo });
  }, [tasksQ, showToast]);

  // Drag-and-drop: apply locally first so the list doesn't jump, then save.
  const reorderTasks = useCallback(async ({ ids, field, moved, patch }) => {
    const pos = Object.fromEntries(ids.map((id, i) => [id, i]));
    tasksQ.setData((d) => d && { ...d, tasks: d.tasks.map((t) => {
      let n = t.id in pos ? { ...t, [field]: pos[t.id] } : t;
      if (patch && t.id === moved) n = { ...n, ...patch, ...('due_date' in patch && !patch.due_date ? { due_time: null, recurring: false } : {}) };
      return n;
    }) });
    try { await api('/api/tasks/reorder', { method: 'POST', body: { ids, field, moved, patch } }); }
    finally { tasksQ.reload(); }
  }, [tasksQ]);

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
    if (!confirm(`Delete “${task.content}”? This can't be undone.`)) return;
    tasksQ.setData((d) => d && { ...d, tasks: d.tasks.filter((t) => t.id !== task.id) });
    await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
    setEditing(null);
    tasksQ.reload();
  }, [tasksQ]);

  const value = {
    ...data, projectById, tasksLoading: tasksQ.loading, reloadTasks: tasksQ.reload,
    status: status.data, reloadStatus: status.reload,
    addTask, updateTask, completeTask, deleteTask, showToast, reorderTasks,
    drag, startDrag, registerList, justDragged: () => Date.now() - draggedAt.current < 250,
    openTask: (t) => setEditing(t.id),
  };
  const editingTask = editing && data.tasks.find((t) => t.id === editing);

  return (
    <Ctx.Provider value={value}>
      {children}
      {editingTask && <TaskEditor task={editingTask} onClose={() => setEditing(null)} />}
      {drag && <div className="drag-ghost" style={{ left: drag.x + 12, top: drag.y + 8 }}>{drag.title}</div>}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.action && <button onClick={toast.action.run}>{toast.action.label}</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}
