import { Injectable, signal, computed } from '@angular/core';

export type AmbientTheme = 'default' | 'aurora' | 'nebula' | 'cyberpunk' | 'blueprint';
export type ThemeMode = 'auto' | 'dark' | 'light';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  themeMode = signal<ThemeMode>('auto');
  systemIsDark = signal<boolean>(true);
  ambientTheme = signal<AmbientTheme>('default');
  activeUserId = signal<number | null>(null);

  // Callback to sync setting changes to authenticated user's profile
  onSettingsChange?: (patch: Record<string, any>) => void;

  // Resolved boolean whether dark theme is effectively active
  isDark = computed<boolean>(() => {
    const mode = this.themeMode();
    if (mode === 'dark') return true;
    if (mode === 'light') return false;
    return this.systemIsDark();
  });

  private mediaQuery: MediaQueryList | null = null;

  constructor() {
    this.initTheme();
  }

  keyFor(key: string): string {
    const uid = this.activeUserId();
    return uid ? `u_${uid}_${key}` : key;
  }

  private initTheme() {
    // 1. Detect system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      this.systemIsDark.set(this.mediaQuery.matches);
      this.mediaQuery.addEventListener('change', (e) => {
        this.systemIsDark.set(e.matches);
        if (this.themeMode() === 'auto') {
          this.applyGlobalTheme();
        }
      });
    }

    this.applyGlobalTheme();
  }

  setUser(userId: number | null, settings?: any) {
    this.activeUserId.set(userId);
    if (!userId) {
      this.resetToDefaults();
      return;
    }

    if (settings) {
      const mode = (settings.theme_mode as ThemeMode) || 'dark';
      const ambient = (settings.ambient_theme as AmbientTheme) || 'default';
      this.themeMode.set(mode);
      this.ambientTheme.set(ambient);
      try {
        localStorage.setItem(this.keyFor('app-theme-mode'), mode);
        localStorage.setItem(this.keyFor('board-ambient-theme'), ambient);
      } catch (_) {}
      this.applyGlobalTheme();
    } else {
      let savedMode: ThemeMode = 'dark';
      try {
        const stored = localStorage.getItem(this.keyFor('app-theme-mode'));
        if (stored === 'dark' || stored === 'light' || stored === 'auto') {
          savedMode = stored;
        }
      } catch (_) {}
      this.themeMode.set(savedMode);

      let savedAmbient: AmbientTheme = 'default';
      try {
        const stored = localStorage.getItem(this.keyFor('board-ambient-theme')) as AmbientTheme;
        if (stored) savedAmbient = stored;
      } catch (_) {}
      this.ambientTheme.set(savedAmbient);
      this.applyGlobalTheme();
    }
  }

  resetToDefaults() {
    this.activeUserId.set(null);
    this.themeMode.set('dark');
    this.ambientTheme.set('default');
    this.applyGlobalTheme();
  }

  setThemeMode(mode: ThemeMode, syncToUser = true) {
    this.themeMode.set(mode);
    try {
      localStorage.setItem(this.keyFor('app-theme-mode'), mode);
    } catch (_) {}
    this.applyGlobalTheme();
    if (syncToUser && this.onSettingsChange) {
      this.onSettingsChange({ theme_mode: mode });
    }
  }

  toggleThemeMode() {
    const current = this.themeMode();
    if (current === 'auto') {
      this.setThemeMode(this.systemIsDark() ? 'light' : 'dark');
    } else if (current === 'dark') {
      this.setThemeMode('light');
    } else {
      this.setThemeMode('auto');
    }
  }

  toggleDark() {
    this.toggleLightDark();
  }

  toggleLightDark() {
    const currentlyDark = this.isDark();
    this.setThemeMode(currentlyDark ? 'light' : 'dark');
  }

  setAmbientTheme(theme: AmbientTheme, syncToUser = true) {
    this.ambientTheme.set(theme);
    try {
      localStorage.setItem(this.keyFor('board-ambient-theme'), theme);
    } catch (_) {}
    this.applyGlobalTheme();
    if (syncToUser && this.onSettingsChange) {
      this.onSettingsChange({ ambient_theme: theme });
    }
  }

  private applyGlobalTheme() {
    const dark = this.isDark();
    const themeClass = dark ? 'theme-dark' : 'theme-light';
    const themeAttr = dark ? 'dark' : 'light';
    const ambient = this.ambientTheme();

    if (typeof document !== 'undefined') {
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(themeClass);
      document.documentElement.classList.remove('theme-dark', 'theme-light');
      document.documentElement.classList.add(themeClass);
      document.documentElement.setAttribute('data-theme', themeAttr);

      document.documentElement.setAttribute('data-ambient-theme', ambient);
      document.body.setAttribute('data-ambient-theme', ambient);
      const allAmbients: AmbientTheme[] = ['default', 'aurora', 'nebula', 'cyberpunk', 'blueprint'];
      allAmbients.forEach(a => {
        document.body.classList.remove(`ambient-theme-${a}`, `board-theme-${a}`);
        document.documentElement.classList.remove(`ambient-theme-${a}`, `board-theme-${a}`);
      });
      document.body.classList.add(`ambient-theme-${ambient}`, `board-theme-${ambient}`);
      document.documentElement.classList.add(`ambient-theme-${ambient}`);
    }
  }
}
