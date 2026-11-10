import { app, safeStorage } from 'electron';
import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { watch, FSWatcher } from 'node:fs';
import path from 'node:path';
import { AppSettings, TodoItem } from '../shared/types';
import { normalizeLocalePreference } from './i18n';
import { parseMarkdownTasks, stringifyMarkdownTasks } from './markdown';

const SETTINGS_FILE = 'settings.json';
const TODO_FILE_NAME = 'todo.md';
const ENCRYPTED_PASSWORD_PREFIX = 'safeStorage:';

function getDefaultTodoPath() {
  const baseDir = app.getPath('userData');
  return path.join(baseDir, TODO_FILE_NAME);
}

function defaultSettings(): AppSettings {
  return {
    todoFilePath: getDefaultTodoPath(),
    globalShortcut: 'CommandOrControl+Shift+A',
    alwaysOnTop: false,
    desktopPinned: true,
    desktopLockPosition: false,
    desktopMouseThrough: false,
    showCodexUsage: false,
    windowOpacity: 1,
    theme: 'light',
    language: 'zh-CN',
    windowBounds: undefined,
    webdav: {
      enabled: false,
      url: '',
      username: '',
      password: '',
      remotePath: '/todo.md',
      intervalMinutes: 60
    }
  };
}

function decryptWebDavPassword(password: unknown) {
  if (typeof password !== 'string') {
    return '';
  }

  if (!password.startsWith(ENCRYPTED_PASSWORD_PREFIX)) {
    return password;
  }

  try {
    const encoded = password.slice(ENCRYPTED_PASSWORD_PREFIX.length);
    return safeStorage.decryptString(Buffer.from(encoded, 'base64'));
  } catch {
    return '';
  }
}

function settingsForDisk(settings: AppSettings): AppSettings {
  const password = settings.webdav.password;
  if (!password || !safeStorage.isEncryptionAvailable()) {
    return settings;
  }

  const encrypted = safeStorage.encryptString(password).toString('base64');
  return {
    ...settings,
    webdav: {
      ...settings.webdav,
      password: `${ENCRYPTED_PASSWORD_PREFIX}${encrypted}`
    }
  };
}

export class StorageService {
  private settingsPath: string;
  private watcher: FSWatcher | null = null;
  private writeInProgress = false;
  private settingsWriteQueue: Promise<void> = Promise.resolve();

  constructor(private onExternalTasksChange: (tasks: TodoItem[]) => void) {
    this.settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE);
  }

  async initFiles() {
    const settings = await this.loadSettings();
    await this.ensureTodoFile(settings.todoFilePath);
    return settings;
  }

  async loadSettings(): Promise<AppSettings> {
    let raw: string;

    try {
      raw = await readFile(this.settingsPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }

      const next = defaultSettings();
      await this.saveSettings(next);
      return next;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<AppSettings> & { launchAtStartup?: unknown };
      const { launchAtStartup: _legacyLaunchAtStartup, ...currentSettings } = parsed;
      const webdav = {
        ...defaultSettings().webdav,
        ...currentSettings.webdav
      };
      return {
        ...defaultSettings(),
        ...currentSettings,
        language: normalizeLocalePreference(currentSettings.language),
        webdav: {
          ...webdav,
          password: decryptWebDavPassword(webdav.password)
        }
      };
    } catch (error) {
      const backupPath = `${this.settingsPath}.corrupt-${Date.now()}.bak`;
      await copyFile(this.settingsPath, backupPath);
      console.error(`设置文件损坏，已备份到 ${backupPath}:`, error);
      const next = defaultSettings();
      await this.saveSettings(next);
      return next;
    }
  }

  async saveSettings(settings: AppSettings) {
    const serialized = JSON.stringify(settingsForDisk(settings), null, 2);
    const write = this.settingsWriteQueue.then(async () => {
      await mkdir(path.dirname(this.settingsPath), { recursive: true });
      const tempPath = `${this.settingsPath}.tmp`;
      await writeFile(tempPath, serialized, 'utf-8');
      await rename(tempPath, this.settingsPath);
    });
    this.settingsWriteQueue = write.catch(() => {});
    await write;
  }

  async flushSettings() {
    await this.settingsWriteQueue;
  }

  async ensureTodoFile(todoPath: string) {
    await mkdir(path.dirname(todoPath), { recursive: true });
    try {
      await readFile(todoPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
      await writeFile(todoPath, '', 'utf-8');
    }
  }

  async readTasks(todoPath: string): Promise<TodoItem[]> {
    await this.ensureTodoFile(todoPath);
    const content = await readFile(todoPath, 'utf-8');
    return parseMarkdownTasks(content);
  }

  async writeTasks(todoPath: string, tasks: TodoItem[]) {
    this.writeInProgress = true;
    try {
      const markdown = stringifyMarkdownTasks(tasks);
      await writeFile(todoPath, `${markdown}${markdown ? '\n' : ''}`, 'utf-8');
    } finally {
      setTimeout(() => {
        this.writeInProgress = false;
      }, 120);
    }
  }

  watchTodoFile(todoPath: string) {
    this.unwatchTodoFile();

    let debounceTimer: NodeJS.Timeout | null = null;

    this.watcher = watch(todoPath, () => {
      if (this.writeInProgress) {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(async () => {
        try {
          const tasks = await this.readTasks(todoPath);
          this.onExternalTasksChange(tasks);
        } catch (error) {
          console.error('外部变更读取失败:', error);
        }
      }, 150);
    });
  }

  unwatchTodoFile() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
