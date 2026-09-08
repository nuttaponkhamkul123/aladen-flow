import { Injectable, signal } from '@angular/core';

export type AmbientTheme = 'default' | 'aurora' | 'nebula' | 'cyberpunk' | 'blueprint';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  isDark = signal<boolean>(true);
  ambientTheme = signal<AmbientTheme>('default');

  constructor() {
    this.initTheme();
  }

  private initTheme() {
    const savedTheme = localStorage.getItem('app-theme') || 'theme-dark';
    const savedAmbient = (localStorage.getItem('board-ambient-theme') as AmbientTheme) || 'default';
    this.isDark.set(savedTheme === 'theme-dark');
    this.ambientTheme.set(savedAmbient);
    this.applyGlobalTheme();
  }

  toggleDark() {
    this.isDark.set(!this.isDark());
    this.applyGlobalTheme();
  }

  setAmbientTheme(theme: AmbientTheme) {
    this.ambientTheme.set(theme);
    localStorage.setItem('board-ambient-theme', theme);
  }

  private applyGlobalTheme() {
    const themeClass = this.isDark() ? 'theme-dark' : 'theme-light';
    localStorage.setItem('app-theme', themeClass);
    document.body.classList.remove('theme-dark', 'theme-light');
    document.body.classList.add(themeClass);
  }
}
