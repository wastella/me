'use client';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
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
  const toastTimer = useRef();

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
    addTask, updateTask, completeTask, deleteTask, showToast,
    openTask: (t) => setEditing(t.id),
  };
  const editingTask = editing && data.tasks.find((t) => t.id === editing);

  return (
    <Ctx.Provider value={value}>
      {children}
      {editingTask && <TaskEditor task={editingTask} onClose={() => setEditing(null)} />}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.action && <button onClick={toast.action.run}>{toast.action.label}</button>}
        </div>
      )}
    </Ctx.Provider>
  );
}
