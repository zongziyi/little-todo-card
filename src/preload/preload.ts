import { contextBridge, ipcRenderer } from 'electron';
import { AppSettings, AppState, CaptureResult, CodexUsage, SaveToastPayload } from '../shared/types';

const api = {
  getState: () => ipcRenderer.invoke('app:get-state') as Promise<AppState>,
  getCodexUsage: () => ipcRenderer.invoke('codex:get-usage') as Promise<CodexUsage>,
  addTask: (text: string, dueDate?: string) => ipcRenderer.invoke('task:add', text, dueDate) as Promise<AppState>,
  updateTask: (id: string, text: string, dueDate: string) => ipcRenderer.invoke('task:update', id, text, dueDate) as Promise<AppState>,
  getStartup: () => ipcRenderer.invoke('startup:get') as Promise<boolean>,
  setStartup: (enabled: boolean) => ipcRenderer.invoke('startup:set', enabled) as Promise<boolean>,
  toggleTask: (taskId: string, completed: boolean) => ipcRenderer.invoke('task:toggle', taskId, completed) as Promise<AppState>,
  setPinned: (taskId: string, pinned: boolean) => ipcRenderer.invoke('task:set-pinned', taskId, pinned) as Promise<AppState>,
  deleteTask: (taskId: string) => ipcRenderer.invoke('task:delete', taskId) as Promise<AppState>,
  updateTaskText: (taskId: string, text: string) =>
    ipcRenderer.invoke('task:update-text', taskId, text) as Promise<AppState>,
  reorderOpenTasks: (orderedOpenIds: string[]) =>
    ipcRenderer.invoke('task:reorder-open', orderedOpenIds) as Promise<AppState>,
  captureTask: () => ipcRenderer.invoke('task:capture') as Promise<CaptureResult>,
  updateSettings: (partial: Partial<AppSettings>) =>
    ipcRenderer.invoke('settings:update', partial) as Promise<AppState>,
  pickTodoFolder: () => ipcRenderer.invoke('settings:pick-todo-folder') as Promise<string | null>,
  togglePinMode: () => ipcRenderer.invoke('window:toggle-pin-mode') as Promise<AppSettings>,
  setAlwaysOnTop: (value: boolean) => ipcRenderer.invoke('window:set-always-on-top', value) as Promise<AppSettings>,
  runSync: () => ipcRenderer.invoke('sync:run') as Promise<{ ok: boolean; message: string }>,
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  hideCard: () => ipcRenderer.invoke('card:hide') as Promise<void>,
  showCard: (card: 'main' | 'short') => ipcRenderer.invoke('card:show', card) as Promise<void>,
  onStateUpdated: (handler: (state: AppState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: AppState) => handler(state);
    ipcRenderer.on('state:updated', wrapped);
    return () => ipcRenderer.removeListener('state:updated', wrapped);
  },
  onSavedToast: (handler: (payload: SaveToastPayload) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: SaveToastPayload) => handler(payload);
    ipcRenderer.on('task:saved-toast', wrapped);
    return () => ipcRenderer.removeListener('task:saved-toast', wrapped);
  },
  onOpenSettingsPanel: (handler: () => void) => {
    const wrapped = () => handler();
    ipcRenderer.on('window:open-settings-panel', wrapped);
    return () => ipcRenderer.removeListener('window:open-settings-panel', wrapped);
  }
};

contextBridge.exposeInMainWorld('todoApi', api);
contextBridge.exposeInMainWorld('shortTodoApi', {
  ...api,
  getState: () => ipcRenderer.invoke('short:get-state') as Promise<AppState>,
  addTask: (text: string) => ipcRenderer.invoke('short:add', text) as Promise<AppState>,
  updateTask: (id: string, text: string) => ipcRenderer.invoke('short:update', id, text) as Promise<AppState>,
  toggleTask: (id: string, completed: boolean) => ipcRenderer.invoke('short:toggle', id, completed) as Promise<AppState>,
  setPinned: (id: string, pinned: boolean) => ipcRenderer.invoke('short:set-pinned', id, pinned) as Promise<AppState>,
  deleteTask: (id: string) => ipcRenderer.invoke('short:delete', id) as Promise<AppState>,
  onStateUpdated: (handler: (state: AppState) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, state: AppState) => handler(state);
    ipcRenderer.on('short:state-updated', wrapped);
    return () => ipcRenderer.removeListener('short:state-updated', wrapped);
  }
});
