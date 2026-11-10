import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, Tray } from 'electron';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { AppSettings, AppState, CaptureResult, TodoItem, WebDavConfig, WindowBoundsState } from '../shared/types';
import {
  LocalizedMessage,
  TranslationKey,
  localizedErrorMessage,
  normalizeLocalePreference,
  resolveLocale,
  translate
} from './i18n';
import { createTaskFromText } from './markdown';
import { getCodexUsage } from './codexUsage';
import { StorageService } from './storage';
import { WebDavSyncService } from './sync';

// Keep this personal build's data independent of an existing ApexTodo installation.
app.setName('LittleTodoCard');
if (process.env.LITTLE_TODO_DATA_DIR) app.setPath('userData', process.env.LITTLE_TODO_DATA_DIR);

const execFileAsync = promisify(execFile);
const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+A';
const DESKTOP_INTERACT_SHORTCUT = 'CommandOrControl+Shift+Z';

let mainWindow: BrowserWindow | null = null;
let shortWindow: BrowserWindow | null = null;
let settings: AppSettings;
let tasks: TodoItem[] = [];
let shortTasks: TodoItem[] = [];
let lastSyncTime: string | undefined;
let statusMessage: LocalizedMessage | undefined;
let saveWindowBoundsTimer: NodeJS.Timeout | null = null;
let saveShortBoundsTimer: NodeJS.Timeout | null = null;
let tray: Tray | null = null;
let showWindowAfterBootstrap = false;

const storage = new StorageService((nextTasks) => {
  tasks = normalizeTaskOrder(nextTasks);
  broadcastState();
});
const shortStorage = new StorageService((nextTasks) => {
  shortTasks = nextTasks;
  broadcastShortState();
});
let shortWriteQueue: Promise<void> = Promise.resolve();
function shortTodoPath() { return path.join(app.getPath('userData'), 'short-todo.md'); }

const syncService = new WebDavSyncService(
  () => settings,
  (status) => {
    lastSyncTime = status.time;
    statusMessage = status.message;
    broadcastState();
  },
  () => getResolvedLocale()
);

function getResolvedLocale() {
  const systemLocale = app.isReady() ? app.getLocale() : Intl.DateTimeFormat().resolvedOptions().locale;
  return resolveLocale(settings?.language ?? 'system', systemLocale);
}

function t(key: TranslationKey, params?: Record<string, string | number>) {
  return translate(getResolvedLocale(), key, params);
}

function mergeWebdav(prev: WebDavConfig, next?: Partial<WebDavConfig>): WebDavConfig {
  return {
    ...prev,
    ...(next || {})
  };
}

function normalizeWebdavConfig(webdav: WebDavConfig): WebDavConfig {
  return {
    ...webdav,
    remotePath: webdav.remotePath || '/todo.md',
    intervalMinutes: Math.max(1, Number(webdav.intervalMinutes) || 60)
  };
}

function normalizeAccelerator(input: string) {
  const raw = (input || '').trim();
  if (!raw) {
    return DEFAULT_SHORTCUT;
  }

  const tokens = raw
    .replace(/\s+/g, '')
    .split('+')
    .filter(Boolean)
    .map((token) => token.toLowerCase());

  const mapped = tokens.map((token) => {
    if (token === 'ctrl' || token === 'control' || token === 'commandorcontrol') {
      return 'CommandOrControl';
    }
    if (token === 'cmd' || token === 'command') {
      return 'Command';
    }
    if (token === 'alt' || token === 'option') {
      return 'Alt';
    }
    if (token === 'shift') {
      return 'Shift';
    }
    if (token === 'super' || token === 'win' || token === 'windows') {
      return 'Super';
    }
    if (/^f\d{1,2}$/i.test(token)) {
      return token.toUpperCase();
    }
    if (token.length === 1) {
      return token.toUpperCase();
    }
    return token.charAt(0).toUpperCase() + token.slice(1);
  });

  return mapped.join('+');
}

function normalizeOpacity(input: number | undefined) {
  if (typeof input !== 'number' || Number.isNaN(input)) {
    return 0.96;
  }
  return Math.min(1, Math.max(0.35, input));
}

function normalizeTaskOrder(allTasks: TodoItem[]) {
  const openTasks = allTasks.filter((task) => !task.completed);
  const completedTasks = allTasks.filter((task) => task.completed);
  return [...openTasks, ...completedTasks];
}

function currentState(): AppState {
  return {
    tasks,
    settings,
    lastSyncTime,
    syncMessage: statusMessage ? translate(getResolvedLocale(), statusMessage.key, statusMessage.params) : undefined,
    resolvedLocale: getResolvedLocale()
  };
}

function currentShortState(): AppState {
  return { ...currentState(), tasks: shortTasks };
}

function broadcastShortState() {
  if (shortWindow && !shortWindow.isDestroyed()) {
    shortWindow.webContents.send('short:state-updated', currentShortState());
  }
}

function updateShortTasks(transform: (current: TodoItem[]) => TodoItem[]): Promise<AppState> {
  const action = shortWriteQueue.then(async () => {
    const next = transform(shortTasks);
    await shortStorage.writeTasks(shortTodoPath(), next);
    shortTasks = next;
    broadcastShortState();
    return currentShortState();
  });
  shortWriteQueue = action.then(() => {}, () => {});
  return action;
}

function broadcastState() {
  updateTrayMenu();
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('state:updated', currentState());
}

async function persistTasksAndBroadcast(showToastKey?: TranslationKey, withSystemNotification = false) {
  tasks = normalizeTaskOrder(tasks);
  await storage.writeTasks(settings.todoFilePath, tasks);
  broadcastState();

  if (showToastKey) {
    const showToastText = t(showToastKey);
    const at = new Date().toISOString();
    mainWindow?.webContents.send('task:saved-toast', { text: showToastText, at });
    if (withSystemNotification) {
      pushNotification(showToastText);
    }
  }
}

function pushNotification(text: string) {
  if (!Notification.isSupported()) {
    return;
  }

  new Notification({
    title: 'ApexTodo',
    body: text,
    silent: true
  }).show();
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }

  mainWindow.focus();
}

async function setCardVisible(card: 'main' | 'short', visible: boolean) {
  const win = card === 'main' ? mainWindow : shortWindow;
  if (!win || win.isDestroyed()) return;
  const key = card === 'main' ? 'mainVisible' : 'shortVisible';
  const previous = settings[key];
  settings[key] = visible;
  try {
    await storage.saveSettings(settings);
  } catch (error) {
    settings[key] = previous;
    throw error;
  }
  if (visible) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  } else {
    win.hide();
  }
  updateTrayMenu();
}

async function setDesktopMouseThrough(nextValue: boolean, openSettingsAfterShow = false) {
  settings.desktopMouseThrough = nextValue;
  await storage.saveSettings(settings);
  applyWindowMode();

  if (!nextValue) {
    showMainWindow();
    if (openSettingsAfterShow) {
      mainWindow?.webContents.send('window:open-settings-panel');
    }
  }

  const text = t(nextValue ? 'desktop.mouseThroughOn' : 'desktop.mouseThroughOff');
  const at = new Date().toISOString();
  mainWindow?.webContents.send('task:saved-toast', { text, at });
  broadcastState();
}

function applyWindowMode() {
  if (!mainWindow) {
    return;
  }

  mainWindow.setOpacity(normalizeOpacity(settings.windowOpacity));
  mainWindow.setIgnoreMouseEvents(false);

  if (settings.desktopPinned) {
    mainWindow.setAlwaysOnTop(false);
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: true
    });
    mainWindow.setSkipTaskbar(true);
    mainWindow.setMinimizable(false);
    mainWindow.setMaximizable(false);
    mainWindow.setResizable(true);
    mainWindow.setMovable(!settings.desktopLockPosition);
    mainWindow.setIgnoreMouseEvents(settings.desktopMouseThrough, { forward: true });
    return;
  }

  mainWindow.setVisibleOnAllWorkspaces(false);
  mainWindow.setSkipTaskbar(true);
  mainWindow.setMinimizable(true);
  mainWindow.setMaximizable(true);
  mainWindow.setResizable(true);
  mainWindow.setMovable(true);
  mainWindow.setAlwaysOnTop(settings.alwaysOnTop, 'screen-saver');
}

function registerGlobalHotkey() {
  globalShortcut.unregisterAll();
  const captureRegistered = globalShortcut.register(settings.globalShortcut, async () => {
    await captureSelectedTextToTask();
  });

  const desktopInteractRegistered = globalShortcut.register(DESKTOP_INTERACT_SHORTCUT, async () => {
    if (!settings.desktopPinned) {
      return;
    }
    await setDesktopMouseThrough(!settings.desktopMouseThrough);
  });

  if (!captureRegistered) {
    statusMessage = { key: 'hotkey.captureFailed', params: { shortcut: settings.globalShortcut } };
    broadcastState();
    return false;
  }

  if (!desktopInteractRegistered) {
    statusMessage = { key: 'hotkey.passthroughFailed', params: { shortcut: DESKTOP_INTERACT_SHORTCUT } };
    broadcastState();
    return false;
  }

  statusMessage = { key: 'hotkey.active', params: { shortcut: settings.globalShortcut } };
  broadcastState();
  return true;
}

function createTrayIcon() {
  // 与 scripts/generate-icons.mjs 同源：字母 A / 尖峰(Apex)，2x 超采样抗锯齿。
  const S = 128;
  const buffer = Buffer.alloc(S * S * 4, 0);

  const setPixel = (x: number, y: number, r: number, g: number, b: number, a: number) => {
    if (x < 0 || y < 0 || x >= S || y >= S || a <= 0) {
      return;
    }
    const offset = (y * S + x) * 4;
    buffer[offset] = b; // B
    buffer[offset + 1] = g; // G
    buffer[offset + 2] = r; // R
    buffer[offset + 3] = Math.round(Math.max(0, Math.min(255, a)));
  };

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const smooth = (e0: number, e1: number, x: number) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const inTri = (px: number, py: number, a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
    const d1 = (px - b.x) * (a.y - b.y) - (a.x - b.x) * (py - b.y);
    const d2 = (px - c.x) * (b.y - c.y) - (b.x - c.x) * (py - c.y);
    const d3 = (px - a.x) * (c.y - a.y) - (c.x - a.x) * (py - a.y);
    return !(d1 < 0 || d2 < 0 || d3 < 0) || !(d1 > 0 || d2 > 0 || d3 > 0);
  };

  const OUTER = [{ x: 64, y: 16 }, { x: 27, y: 108 }, { x: 101, y: 108 }];
  const INNER = [{ x: 64, y: 50 }, { x: 50.5, y: 108 }, { x: 77.5, y: 108 }];
  const BAR = { cx: 64, cy: 75, halfW: 14.5, halfH: 4.3, radius: 2 };

  for (let y = 0; y < S; y += 1) {
    for (let x = 0; x < S; x += 1) {
      let rr = 0;
      let gg = 0;
      let bb = 0;
      let aa = 0;
      for (const sy of [0.25, 0.75]) {
        for (const sx of [0.25, 0.75]) {
          const px = x + sx;
          const py = y + sy;

          const qx = Math.abs(px - 64) - (56 - 30);
          const qy = Math.abs(py - 66) - (56 - 30);
          const boxDist = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - 30;
          const boxCov = 1 - smooth(-0.9, 0.9, boxDist);
          if (boxCov <= 0.002) {
            continue;
          }

          const isA = inTri(px, py, OUTER[0], OUTER[1], OUTER[2]) &&
            !inTri(px, py, INNER[0], INNER[1], INNER[2]);
          const bx = Math.abs(px - BAR.cx) - (BAR.halfW - BAR.radius);
          const by = Math.abs(py - BAR.cy) - (BAR.halfH - BAR.radius);
          const barDist = Math.hypot(Math.max(bx, 0), Math.max(by, 0)) + Math.min(Math.max(bx, by), 0) - BAR.radius;
          const white = isA || barDist < 0 ? 1 : 0;

          const t = clamp(py / S, 0, 1);
          let r = 12 + (6 - 12) * t;
          let g = 208 + (170 - 208) * t;
          let b = 108 + (82 - 108) * t;
          r += (255 - r) * white;
          g += (255 - g) * white;
          b += (255 - b) * white;

          rr += r * boxCov;
          gg += g * boxCov;
          bb += b * boxCov;
          aa += boxCov;
        }
      }
      setPixel(x, y, rr / 4, gg / 4, bb / 4, clamp(aa / 4, 0, 1) * 255);
    }
  }

  return nativeImage.createFromBitmap(buffer, { width: S, height: S }).resize({ width: 16, height: 16, quality: 'good' });
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  const trayMenu = Menu.buildFromTemplate([
    {
      label: settings.mainVisible === false ? '显示倒数日清单' : '隐藏倒数日清单',
      click: () => { void setCardVisible('main', settings.mainVisible === false); }
    },
    {
      label: settings.shortVisible === false ? '显示短期待办' : '隐藏短期待办',
      click: () => { void setCardVisible('short', settings.shortVisible === false); }
    },
    { type: 'separator' },
    {
      label: t('tray.showWindow'),
      click: () => {
        void setCardVisible('main', true);
      }
    },
    {
      label: t('tray.openSettings'),
      click: () => {
        void setDesktopMouseThrough(false, true);
      }
    },
    {
      label: t(settings.desktopMouseThrough ? 'tray.disableMouseThrough' : 'tray.enableMouseThrough'),
      enabled: settings.desktopPinned,
      click: () => {
        if (!settings.desktopPinned) {
          return;
        }
        void setDesktopMouseThrough(!settings.desktopMouseThrough);
      }
    },
    {
      type: 'separator'
    },
    {
      label: t('common.exit'),
      click: () => {
        app.quit();
      }
    }
  ]);

  tray.setToolTip('小小待办');
  tray.setContextMenu(trayMenu);
}

function ensureTray() {

  if (tray) {
    updateTrayMenu();
    return;
  }

  tray = new Tray(createTrayIcon());
  tray.on('click', () => {
    void setCardVisible('main', true);
  });
  updateTrayMenu();
}

async function simulateCopyOnWindows() {
  if (process.platform !== 'win32') {
    return;
  }

  await execFileAsync('powershell.exe', [
    '-NoProfile',
    '-Command',
    "$wshell = New-Object -ComObject WScript.Shell; Start-Sleep -Milliseconds 30; $wshell.SendKeys('^c')"
  ]);
}

async function captureSelectedTextToTask(): Promise<CaptureResult> {
  const previousClipboardText = await clipboard.readText();
  const clipboardMarker = `__APEXTODO_CAPTURE_${randomUUID()}__`;

  try {
    await clipboard.writeText(clipboardMarker);
    await simulateCopyOnWindows();
    await new Promise((resolve) => setTimeout(resolve, 180));
    const text = (await clipboard.readText()).trim();

    if (!text || text === clipboardMarker) {
      return {
        ok: false,
        message: t('task.noSelection')
      };
    }

    const task = createTaskFromText(text);
    tasks = [task, ...tasks];
    await persistTasksAndBroadcast('task.savedToTop', true);

    return {
      ok: true,
      message: t('task.saved')
    };
  } catch (error) {
    return {
      ok: false,
      message: t('task.captureFailed', { message: localizedErrorMessage(getResolvedLocale(), error) })
    };
  } finally {
    await clipboard.writeText(previousClipboardText);
  }
}

function shouldStartHidden() {
  return process.argv.includes('--hidden');
}

function getSafeWindowBounds() {
  const targetWidth = 300;
  const targetHeight = 260;
  const workArea = screen.getPrimaryDisplay().workArea;

  const width = Math.min(targetWidth, workArea.width);
  const height = Math.min(targetHeight, workArea.height);
  const x = workArea.x + Math.max(0, workArea.width - width - 24);
  const y = workArea.y + 40;

  return { x, y, width, height };
}

function normalizeWindowBounds(bounds?: WindowBoundsState) {
  if (!bounds) {
    return null;
  }

  const fallback = getSafeWindowBounds();
  const rawWidth = Number(bounds.width);
  const rawHeight = Number(bounds.height);
  const rawX = Number(bounds.x);
  const rawY = Number(bounds.y);

  if (![rawWidth, rawHeight, rawX, rawY].every(Number.isFinite)) {
    return null;
  }

  const probe = {
    x: Math.round(rawX),
    y: Math.round(rawY),
    width: Math.max(280, Math.round(rawWidth)),
    height: Math.max(220, Math.round(rawHeight))
  };

  const display = screen.getDisplayMatching(probe);
  const workArea = display.workArea;
  const width = Math.min(probe.width, workArea.width);
  const height = Math.min(probe.height, workArea.height);
  const maxX = workArea.x + Math.max(0, workArea.width - width);
  const maxY = workArea.y + Math.max(0, workArea.height - height);

  return {
    x: Math.min(Math.max(probe.x, workArea.x), maxX),
    y: Math.min(Math.max(probe.y, workArea.y), maxY),
    width: width || fallback.width,
    height: height || fallback.height
  };
}

function getLaunchWindowBounds() {
  return normalizeWindowBounds(settings.windowBounds) ?? getSafeWindowBounds();
}

function persistWindowBoundsNow() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) {
    return;
  }

  const nextBounds = normalizeWindowBounds(mainWindow.getBounds());
  if (!nextBounds) {
    return;
  }

  settings.windowBounds = nextBounds;
  void storage.saveSettings(settings);
}

function scheduleSaveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized() || mainWindow.isMaximized()) {
    return;
  }

  if (saveWindowBoundsTimer) {
    clearTimeout(saveWindowBoundsTimer);
  }

  saveWindowBoundsTimer = setTimeout(() => {
    persistWindowBoundsNow();
    saveWindowBoundsTimer = null;
  }, 180);
}

function createWindow(startHidden: boolean) {
  const bounds = getLaunchWindowBounds();
  const enableTransparentWindow = true;

  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 280,
    minHeight: 220,
    frame: false,
    transparent: enableTransparentWindow,
    backgroundColor: enableTransparentWindow ? '#00000000' : '#0f172a',
    autoHideMenuBar: true,
    hasShadow: !enableTransparentWindow,
    skipTaskbar: true,
    show: !startHidden,
    title: '小小待办',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setBounds(bounds, false);

  mainWindow.on('minimize', () => {
    if (settings.desktopPinned) {
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.restore();
        }
      }, 60);
    }
  });

  mainWindow.on('move', () => {
    scheduleSaveWindowBounds();
  });

  mainWindow.on('resize', () => {
    scheduleSaveWindowBounds();
  });

  mainWindow.on('close', () => {
    persistWindowBoundsNow();
  });

  mainWindow.once('ready-to-show', () => {
    if (!startHidden && settings.mainVisible !== false) {
      showMainWindow();
    }
  });

  mainWindow.webContents.on('did-fail-load', () => {
    if (!startHidden && settings.mainVisible !== false) {
      showMainWindow();
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (!startHidden && settings.mainVisible !== false) {
      showMainWindow();
    }
  });

  if (!startHidden) {
    setTimeout(() => {
      if (settings.mainVisible !== false) showMainWindow();
    }, 1200);
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    void mainWindow.loadURL(devServerUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  applyWindowMode();
}

function getShortLaunchBounds(): WindowBoundsState {
  const saved = normalizeWindowBounds(settings.shortWindowBounds);
  if (saved) return saved;
  const main = mainWindow?.getBounds() ?? getLaunchWindowBounds();
  const work = screen.getDisplayMatching(main).workArea;
  const width = Math.min(main.width, work.width);
  const height = Math.min(main.height, work.height);
  const gap = 24;
  const right = main.x + main.width + gap;
  const left = main.x - width - gap;
  const x = right + width <= work.x + work.width ? right : left >= work.x ? left : work.x;
  return normalizeWindowBounds({ x, y: main.y, width, height }) ?? getSafeWindowBounds();
}

function persistShortWindowBoundsNow() {
  if (!shortWindow || shortWindow.isDestroyed() || shortWindow.isMinimized() || shortWindow.isMaximized()) return;
  const bounds = normalizeWindowBounds(shortWindow.getBounds());
  if (!bounds) return;
  settings.shortWindowBounds = bounds;
  void storage.saveSettings(settings);
}

function scheduleSaveShortBounds() {
  if (saveShortBoundsTimer) clearTimeout(saveShortBoundsTimer);
  saveShortBoundsTimer = setTimeout(() => {
    persistShortWindowBoundsNow();
    saveShortBoundsTimer = null;
  }, 180);
}

function createShortWindow(startHidden: boolean) {
  const bounds = getShortLaunchBounds();
  const win = new BrowserWindow({
    ...bounds,
    minWidth: 280,
    minHeight: 220,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: '短期待办',
    icon: app.isPackaged ? undefined : path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  shortWindow = win;
  win.setBounds(bounds, false);
  win.setAlwaysOnTop(false);
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  win.setResizable(true);
  win.setMovable(true);
  win.on('move', scheduleSaveShortBounds);
  win.on('resize', scheduleSaveShortBounds);
  win.on('close', persistShortWindowBoundsNow);
  win.on('minimize', () => {
    if (settings.desktopPinned && settings.shortVisible !== false) {
      setTimeout(() => { if (!win.isDestroyed()) win.restore(); }, 60);
    }
  });
  win.once('ready-to-show', () => { if (!startHidden && settings.shortVisible !== false) win.show(); });
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    url.searchParams.set('list', 'short');
    void win.loadURL(url.toString());
  } else {
    void win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { list: 'short' } });
  }
}

function setupIpcHandlers() {
  ipcMain.handle('app:get-state', async () => currentState());
  ipcMain.handle('short:get-state', async () => currentShortState());
  ipcMain.handle('card:hide', async (event) => {
    const card = shortWindow && event.sender.id === shortWindow.webContents.id ? 'short' : 'main';
    await setCardVisible(card, false);
  });
  ipcMain.handle('card:show', async (_event, card: 'main' | 'short') => {
    if (card !== 'main' && card !== 'short') throw new Error('Unknown card');
    await setCardVisible(card, true);
  });
  ipcMain.handle('short:add', async (_event, text: string) => {
    if (!text?.trim()) return currentShortState();
    const task = createTaskFromText(text);
    return updateShortTasks((current) => [task, ...current]);
  });
  ipcMain.handle('short:update', async (_event, id: string, text: string) => {
    const nextText = (text || '').replace(/\s+/g, ' ').trim();
    if (!nextText) return currentShortState();
    return updateShortTasks((current) => current.map((task) => task.id === id ? { ...task, text: nextText } : task));
  });
  ipcMain.handle('short:toggle', async (_event, id: string, completed: boolean) =>
    updateShortTasks((current) => current.map((task) => task.id === id ? { ...task, completed: !!completed } : task)));
  ipcMain.handle('short:set-pinned', async (_event, id: string, pinned: boolean) =>
    updateShortTasks((current) => current.map((task) => task.id === id ? { ...task, pinned: !!pinned } : task)));
  ipcMain.handle('short:delete', async (_event, id: string) =>
    updateShortTasks((current) => current.filter((task) => task.id !== id)));
  ipcMain.handle('codex:get-usage', async () => getCodexUsage(getResolvedLocale()));
  ipcMain.handle('window:minimize', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('window:close', () => {
    app.quit();
  });

  ipcMain.handle('window:toggle-pin-mode', async () => {
    settings.desktopPinned = !settings.desktopPinned;
    if (settings.desktopPinned) {
      settings.alwaysOnTop = false;
    } else {
      settings.desktopMouseThrough = false;
    }
    await storage.saveSettings(settings);
    applyWindowMode();
    showMainWindow();
    broadcastState();
    return settings;
  });

  ipcMain.handle('window:set-always-on-top', async (_event, value: boolean) => {
    settings.alwaysOnTop = value;
    if (value) {
      settings.desktopPinned = false;
      settings.desktopMouseThrough = false;
    }
    await storage.saveSettings(settings);
    applyWindowMode();
    broadcastState();
    return settings;
  });

  ipcMain.handle('task:add', async (_event, text: string, dueDate?: string) => {
    if (!text || !text.trim()) {
      return currentState();
    }

    const task = createTaskFromText(text);
    if (dueDate && /^\d{4}-\d{2}-\d{2}$/.test(dueDate)) task.dueDate = dueDate;
    const previousTasks = tasks;
    tasks = [task, ...tasks];
    try {
      await persistTasksAndBroadcast();
    } catch (error) {
      tasks = previousTasks;
      throw error;
    }
    return currentState();
  });

  ipcMain.handle('task:toggle', async (_event, taskId: string, completed: boolean) => {
    const target = tasks.find((task) => task.id === taskId);
    if (!target) {
      return currentState();
    }

    target.completed = completed;
    const openTasks = tasks.filter((task) => !task.completed && task.id !== taskId);
    const completedTasks = tasks.filter((task) => task.completed && task.id !== taskId);

    tasks = [...openTasks, target, ...completedTasks];

    await persistTasksAndBroadcast();
    return currentState();
  });

  ipcMain.handle('task:set-pinned', async (_event, taskId: string, pinned: boolean) => {
    const target = tasks.find((task) => task.id === taskId);
    if (!target) return currentState();
    const previous = target.pinned;
    target.pinned = !!pinned;
    try {
      await persistTasksAndBroadcast();
    } catch (error) {
      target.pinned = previous;
      throw error;
    }
    return currentState();
  });

  ipcMain.handle('task:reorder-open', async (_event, orderedOpenIds: string[]) => {
    const openMap = new Map(tasks.filter((task) => !task.completed).map((task) => [task.id, task]));
    const reorderedOpen: TodoItem[] = [];

    for (const id of orderedOpenIds) {
      const item = openMap.get(id);
      if (item) {
        reorderedOpen.push(item);
        openMap.delete(id);
      }
    }

    const restOpen = [...openMap.values()];
    const done = tasks.filter((task) => task.completed);
    tasks = [...reorderedOpen, ...restOpen, ...done];

    await persistTasksAndBroadcast();
    return currentState();
  });

  ipcMain.handle('task:delete', async (_event, taskId: string) => {
    const nextTasks = tasks.filter((task) => task.id !== taskId);
    if (nextTasks.length === tasks.length) {
      return currentState();
    }

    tasks = nextTasks;
    await persistTasksAndBroadcast();
    return currentState();
  });

  ipcMain.handle('task:update-text', async (_event, taskId: string, text: string) => {
    const target = tasks.find((task) => task.id === taskId);
    // 与新建一致，把换行/连续空白压成空格，避免多行文本破坏单行 Markdown 后重载被截断
    const nextText = (text || '').replace(/\s+/g, ' ').trim();

    if (!target || !nextText) {
      return currentState();
    }

    target.text = nextText;
    await persistTasksAndBroadcast();
    return currentState();
  });

  ipcMain.handle('task:update', async (_event, taskId: string, text: string, dueDate: string) => {
    const target = tasks.find((task) => task.id === taskId);
    const nextText = (text || '').replace(/\s+/g, ' ').trim();
    if (!target || !nextText) return currentState();
    const previousText = target.text;
    const previousDueDate = target.dueDate;
    target.text = nextText;
    target.dueDate = /^\d{4}-\d{2}-\d{2}$/.test(dueDate || '') ? dueDate : undefined;
    try {
      await persistTasksAndBroadcast();
    } catch (error) {
      target.text = previousText;
      target.dueDate = previousDueDate;
      throw error;
    }
    return currentState();
  });

  ipcMain.handle('startup:get', () => app.getLoginItemSettings().openAtLogin);
  ipcMain.handle('startup:set', (_event, enabled: boolean) => {
    if (!app.isPackaged) throw new Error('开机自启只在打包版本中可用');
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });

  ipcMain.handle('task:capture', async () => captureSelectedTextToTask());

  ipcMain.handle('settings:pick-todo-folder', async () => {
    if (!mainWindow) {
      return null;
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.selectTodoFolder'),
      properties: ['openDirectory', 'createDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return path.join(result.filePaths[0], 'todo.md');
  });

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    const prevShortcut = settings.globalShortcut;
    const prevTodoPath = settings.todoFilePath;

    const normalizedShortcut =
      typeof partial.globalShortcut === 'string' ? normalizeAccelerator(partial.globalShortcut) : settings.globalShortcut;

    const normalizedOpacity =
      typeof partial.windowOpacity === 'number' ? normalizeOpacity(partial.windowOpacity) : settings.windowOpacity;

    const normalizedWebdav = normalizeWebdavConfig(mergeWebdav(settings.webdav, partial.webdav));
    const normalizedShowCodexUsage =
      typeof partial.showCodexUsage === 'boolean' ? partial.showCodexUsage : settings.showCodexUsage;
    const normalizedLanguage = normalizeLocalePreference(partial.language ?? settings.language);

    settings = {
      ...settings,
      ...partial,
      globalShortcut: normalizedShortcut,
      windowOpacity: normalizedOpacity,
      showCodexUsage: normalizedShowCodexUsage,
      language: normalizedLanguage,
      webdav: normalizedWebdav
    };

    if (settings.desktopPinned) {
      settings.alwaysOnTop = false;
    } else {
      settings.desktopMouseThrough = false;
    }

    const hotkeyOk = registerGlobalHotkey();
    if (!hotkeyOk && settings.globalShortcut !== prevShortcut) {
      settings.globalShortcut = prevShortcut;
      registerGlobalHotkey();
    }

    await storage.saveSettings(settings);

    if (partial.todoFilePath && partial.todoFilePath !== prevTodoPath) {
      await storage.ensureTodoFile(settings.todoFilePath);
      tasks = normalizeTaskOrder(await storage.readTasks(settings.todoFilePath));
      storage.watchTodoFile(settings.todoFilePath);
    }

    applyWindowMode();
    syncService.restartTimer();
    broadcastState();

    return currentState();
  });

  ipcMain.handle('sync:run', async () => {
    try {
      await syncService.sync(settings.todoFilePath);
      tasks = normalizeTaskOrder(await storage.readTasks(settings.todoFilePath));
      broadcastState();
      return {
        ok: true,
        message: t('sync.completed')
      };
    } catch (error) {
      const message = t('sync.failed', { message: localizedErrorMessage(getResolvedLocale(), error) });
      statusMessage = { key: 'sync.failed', params: { message: localizedErrorMessage(getResolvedLocale(), error) } };
      broadcastState();
      return {
        ok: false,
        message
      };
    }
  });
}

async function bootstrap() {
  settings = await storage.initFiles();
  settings.globalShortcut = normalizeAccelerator(settings.globalShortcut);
  settings.windowOpacity = normalizeOpacity(settings.windowOpacity);
  settings.webdav = normalizeWebdavConfig(settings.webdav);
  settings.desktopLockPosition = typeof settings.desktopLockPosition === 'boolean' ? settings.desktopLockPosition : true;
  settings.desktopMouseThrough = typeof settings.desktopMouseThrough === 'boolean' ? settings.desktopMouseThrough : false;
  settings.showCodexUsage = typeof settings.showCodexUsage === 'boolean' ? settings.showCodexUsage : false;
  settings.language = normalizeLocalePreference(settings.language);
  settings.windowBounds = normalizeWindowBounds(settings.windowBounds) ?? undefined;
  settings.shortWindowBounds = normalizeWindowBounds(settings.shortWindowBounds) ?? undefined;
  settings.mainVisible = settings.mainVisible !== false;
  settings.shortVisible = settings.shortVisible !== false;
  if (settings.desktopPinned) {
    settings.alwaysOnTop = false;
  } else {
    settings.desktopMouseThrough = false;
  }
  await storage.saveSettings(settings);
  tasks = normalizeTaskOrder(await storage.readTasks(settings.todoFilePath));
  storage.watchTodoFile(settings.todoFilePath);
  shortTasks = await shortStorage.readTasks(shortTodoPath());
  shortStorage.watchTodoFile(shortTodoPath());

  setupIpcHandlers();

  const startHidden = shouldStartHidden();
  createWindow(startHidden || settings.mainVisible === false);
  createShortWindow(startHidden || settings.shortVisible === false);
  if (showWindowAfterBootstrap) {
    showWindowAfterBootstrap = false;
    void setCardVisible('main', true);
  }
  ensureTray();
  // This personal build intentionally keeps data local and does not register
  // ApexTodo's capture shortcut or start its WebDAV synchronization service.
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      showWindowAfterBootstrap = true;
      return;
    }
    void setCardVisible('main', true);
  });

  void app.whenReady().then(async () => {
    try {
      await bootstrap();
    } catch (error) {
      const message = (error as Error).message || String(error);
      console.error('ApexTodo 启动失败:', error);
      dialog.showErrorBox(t('startup.failedTitle'), t('startup.failedBody', { message }));
      app.quit();
      return;
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow(false);
      } else {
        void setCardVisible('main', true);
      }
    });
  });
}

let finishingQuit = false;
app.on('will-quit', (event) => {
  if (finishingQuit) return;
  finishingQuit = true;
  event.preventDefault();
  if (saveWindowBoundsTimer) {
    clearTimeout(saveWindowBoundsTimer);
    saveWindowBoundsTimer = null;
  }
  persistWindowBoundsNow();
  if (saveShortBoundsTimer) {
    clearTimeout(saveShortBoundsTimer);
    saveShortBoundsTimer = null;
  }
  persistShortWindowBoundsNow();
  globalShortcut.unregisterAll();
  storage.unwatchTodoFile();
  shortStorage.unwatchTodoFile();
  syncService.stop();
  tray?.destroy();
  tray = null;
  void shortWriteQueue.then(() => storage.flushSettings()).finally(() => app.exit(0));
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
