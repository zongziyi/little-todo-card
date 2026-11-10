import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { AppState, TodoItem } from '../shared/types';
import { deadlineLabel } from './deadline';
import { sortOpenTasks, sortShortTasks } from './taskOrder';

type Editor = { id?: string; text: string; due: string };
const dragging = { WebkitAppRegion: 'drag' } as CSSProperties;
const isShort = new URLSearchParams(window.location.search).get('list') === 'short';
const api = isShort ? window.shortTodoApi : window.todoApi;

export default function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [settings, setSettings] = useState(false);
  const [startup, setStartup] = useState(false);
  const [message, setMessage] = useState('');
  const [textError, setTextError] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [, setClock] = useState(Date.now());

  useEffect(() => {
    document.title = isShort ? '短期待办' : '小小待办';
    void api.getState().then(setState).catch(() => setMessage('读取待办失败'));
    void api.getStartup().then(setStartup).catch(() => {});
    const off = api.onStateUpdated(setState);
    const offSettings = api.onOpenSettingsPanel(() => setSettings(true));
    const timer = window.setInterval(() => setClock(Date.now()), 30_000);
    const onFocus = () => { setClock(Date.now()); void api.getStartup().then(setStartup).catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => { off(); offSettings(); clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, []);

  async function perform(action: () => Promise<AppState>) {
    try { setState(await action()); setMessage(''); return true; }
    catch { setMessage('保存失败，请重试'); return false; }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!editor?.text.trim()) { setTextError(true); return; }
    const ok = await perform(() => editor.id
      ? api.updateTask(editor.id, editor.text, editor.due)
      : api.addTask(editor.text, editor.due));
    if (ok) setEditor(null);
  }
  const pending = state?.tasks.filter(t => !t.completed) ?? [];
  const open = isShort ? sortShortTasks(pending) : sortOpenTasks(pending);
  const done = state?.tasks.filter(t => t.completed) ?? [];
  function row(task: TodoItem) {
    const label = isShort ? '' : deadlineLabel(task.dueDate);
    return <div className={'task' + (task.completed ? ' is-done' : '')} key={task.id}>
      <button className="check" aria-label={task.completed ? '恢复待办' : '完成待办'} onClick={() => void perform(() => api.toggleTask(task.id, !task.completed))}>{task.completed ? '✓' : ''}</button>
      <button className="task-content" title="编辑待办" onClick={() => { setTextError(false); setMessage(''); setEditor({ id: task.id, text: task.text, due: task.dueDate || '' }); }}>
        <span className="task-title">{task.text}</span>
        {label && !task.completed && <span className={'deadline ' + (label.startsWith('已逾期') ? 'overdue' : label === '今天截止' ? 'today' : '')}>{label}</span>}
      </button>
      <button className={'pin' + (task.pinned ? ' is-pinned' : '')} type="button"
        aria-label={task.pinned ? '取消置顶' : '置顶待办'} aria-pressed={!!task.pinned}
        title={task.pinned ? '取消置顶' : '置顶待办'} disabled={pinBusy}
        onClick={() => { setPinBusy(true); void perform(() => api.setPinned(task.id, !task.pinned)).finally(() => setPinBusy(false)); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16 3l5 5-2 1-3 4v3l-2 2-4-4-5 5-1-1 5-5-4-4 2-2h3l4-3z" /></svg>
      </button>
      <button className="delete" title="删除待办" aria-label="删除待办" onClick={() => { if (window.confirm(`删除「${task.text}」？`)) void perform(() => api.deleteTask(task.id)); }}>×</button>
    </div>;
  }
  return <main className="card">
    <header style={dragging}>
      <div className="brand"><span className="brand-mark">✓</span><span>{isShort ? '短期待办' : '我的待办'}</span></div>
      <div className="header-actions">
        <button className="icon hide-card" title="隐藏此卡片" aria-label="隐藏此卡片" onClick={() => { void api.hideCard().catch(() => setMessage('隐藏失败，请重试')); }}>－</button>
        <button className="icon" title="设置" aria-label="设置" onClick={() => { setSettings(!settings); setEditor(null); setTextError(false); setMessage(''); }}>⚙</button>
        <button className="add" title="添加待办" aria-label="添加待办" onClick={() => { setEditor({ text: '', due: '' }); setSettings(false); setTextError(false); setMessage(''); }}>＋</button>
      </div>
    </header>
    {message && <div className="message" role="alert"><span>{message}</span><button type="button" aria-label="关闭提示" onClick={() => setMessage('')}>×</button></div>}
    {settings ? <section className="panel">
      <div className="panel-heading"><strong>设置</strong><button className="text-button" onClick={() => setSettings(false)}>返回</button></div>
      <label className="startup"><span>开机自动启动</span><input type="checkbox" checked={startup} onChange={e => { void api.setStartup(e.target.checked).then(setStartup).catch(() => setMessage('设置失败，请检查系统权限')); }} /></label>
      <button className="close-app" onClick={() => { void api.showCard(isShort ? 'main' : 'short').catch(() => setMessage('显示卡片失败，请重试')); }}>{isShort ? '显示倒数日清单' : '显示短期待办'}</button>
      <p className="hint">拖动顶部移动卡片，拖动边缘调整大小。</p>
      <p className="hint">关闭后可再次双击程序打开。</p>
      <button className="close-app" onClick={() => void api.closeWindow()}>退出小小待办</button>
    </section> : editor ? <form className="panel" onSubmit={save}>
      <div className="panel-heading"><strong>{editor.id ? '编辑待办' : '添加待办'}</strong><button type="button" className="text-button" onClick={() => { setEditor(null); setMessage(''); setTextError(false); }}>取消</button></div>
      <label className="field-label">待办内容<input autoFocus maxLength={180} placeholder="写下要做的事" value={editor.text} aria-invalid={textError} aria-describedby={textError ? 'task-text-error' : undefined} onChange={e => { const text = e.target.value; setEditor({ ...editor, text }); if (text.trim()) setTextError(false); }} /></label>
      {textError && <div id="task-text-error" className="field-error" role="alert">请输入待办内容</div>}
      {!isShort && <label className="field-label">截止日期 <span>（可不填）</span><input type="date" value={editor.due} onChange={e => setEditor({ ...editor, due: e.target.value })} /></label>}
      <div className="form-actions">{!isShort && editor.due && <button type="button" className="text-button" onClick={() => setEditor({ ...editor, due: '' })}>清除日期</button>}<button className="save" type="submit">保存</button></div>
    </form> : <>
      <div className="subheading"><span>待完成</span><span>{open.length} 项</span></div>
      <section className="task-scroll" aria-label="待办清单">
        {open.length ? open.map(row) : <div className="empty"><span>✦</span><p>暂时没有待办</p><small>点右上角 ＋ 添加一件事</small></div>}
        {done.length > 0 && <><button className="done-header" onClick={() => setShowDone(!showDone)}><span>{showDone ? '⌄' : '›'} &nbsp;已完成</span><span>{done.length}</span></button>{showDone && done.map(row)}</>}
      </section>
      <footer><span className="resize-tip">↘</span></footer>
    </>}
  </main>;
}
