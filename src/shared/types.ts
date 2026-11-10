import { LocalePreference, SupportedLocale } from '../main/i18n';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  dueDate?: string;
  pinned?: boolean;
}

export interface WebDavConfig {
  enabled: boolean;
  url: string;
  username: string;
  password: string;
  remotePath: string;
  intervalMinutes: number;
}

export interface WindowBoundsState {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppSettings {
  todoFilePath: string;
  globalShortcut: string;
  alwaysOnTop: boolean;
  desktopPinned: boolean;
  desktopLockPosition: boolean;
  desktopMouseThrough: boolean;
  showCodexUsage: boolean;
  windowOpacity: number;
  theme: ThemeMode;
  language: LocalePreference;
  windowBounds?: WindowBoundsState;
  shortWindowBounds?: WindowBoundsState;
  mainVisible?: boolean;
  shortVisible?: boolean;
  webdav: WebDavConfig;
}

export interface AppState {
  tasks: TodoItem[];
  settings: AppSettings;
  lastSyncTime?: string;
  syncMessage?: string;
  resolvedLocale: SupportedLocale;
}

export interface SaveToastPayload {
  text: string;
  at: string;
}

export type ReorderPayload = {
  activeId: string;
  overId: string;
};

export interface CaptureResult {
  ok: boolean;
  message: string;
}

export interface CodexUsageWindow {
  usedPercent: number;
  resetAt: string;
  windowSeconds: number;
}

export interface CodexUsage {
  status: 'ready' | 'unavailable' | 'error';
  planType?: string;
  fiveHour?: CodexUsageWindow;
  weekly?: CodexUsageWindow;
  fetchedAt?: string;
  message?: string;
}
