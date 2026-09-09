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

    // 2. Load stored preferences
    let savedMode: ThemeMode = 'auto';
    try {
      const stored = localStorage.getItem('app-theme-mode');
      if (stored === 'dark' || stored === 'light' || stored === 'auto') {
        savedMode = stored;
      } else {
        // Migration from legacy app-theme key
        const legacy = localStorage.getItem('app-theme');
        if (legacy === 'theme-light') savedMode = 'light';
        else if (legacy === 'theme-dark') savedMode = 'dark';
      }
    } catch (_) {}

    this.themeMode.set(savedMode);

    const savedAmbient = (localStorage.getItem('board-ambient-theme') as AmbientTheme) || 'default';
    this.ambientTheme.set(savedAmbient);

    this.applyGlobalTheme();
  }

  setThemeMode(mode: ThemeMode) {
    this.themeMode.set(mode);
    try {
      localStorage.setItem('app-theme-mode', mode);
    } catch (_) {}
    this.applyGlobalTheme();
  }

  toggleThemeMode() {
    const current = this.themeMode();
    const next: ThemeMode = current === 'auto' ? 'dark' : current === 'dark' ? 'light' : 'auto';
    this.setThemeMode(next);
  }

  toggleDark() {
    this.toggleThemeMode();
  }

  setAmbientTheme(theme: AmbientTheme) {
    this.ambientTheme.set(theme);
    try {
      localStorage.setItem('board-ambient-theme', theme);
    } catch (_) {}
  }

  private applyGlobalTheme() {
    const dark = this.isDark();
    const themeClass = dark ? 'theme-dark' : 'theme-light';
    const themeAttr = dark ? 'dark' : 'light';

    try {
      localStorage.setItem('app-theme', themeClass);
    } catch (_) {}

    if (typeof document !== 'undefined') {
      document.body.classList.remove('theme-dark', 'theme-light');
      document.body.classList.add(themeClass);
      document.documentElement.classList.remove('theme-dark', 'theme-light');
      document.documentElement.classList.add(themeClass);
      document.documentElement.setAttribute('data-theme', themeAttr);
    }
  }
}
