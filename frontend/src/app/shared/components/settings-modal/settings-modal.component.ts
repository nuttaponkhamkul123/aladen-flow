import { Component, HostListener, OnInit, AfterViewInit, OnDestroy, computed, inject, signal, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings.service';
import { ThemeService, ThemeMode, AmbientTheme } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';

type TabId = 'general' | 'ai' | 'canvas' | 'storage';

interface TabDef {
  id: TabId;
  label: string;
  icon: 'appearance' | 'ai' | 'layout' | 'storage';
}

interface ThemeModeDef {
  id: ThemeMode;
  label: string;
  icon: 'auto' | 'dark' | 'light';
  preview: string;
}

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-modal.component.html',
  styleUrls: ['./settings-modal.component.css']
})
export class SettingsModalComponent implements OnInit, AfterViewInit, OnDestroy {
  settingsService = inject(SettingsService);
  themeService = inject(ThemeService);
  toastService = inject(ToastService);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  private previouslyFocused: HTMLElement | null = null;

  showApiKey = signal<boolean>(false);

  readonly tabs: TabDef[] = [
    { id: 'general', label: 'Appearance', icon: 'appearance' },
    { id: 'ai', label: 'AI Engine', icon: 'ai' },
    { id: 'canvas', label: 'Sidebars & Layout', icon: 'layout' },
    { id: 'storage', label: 'Storage', icon: 'storage' }
  ];

  readonly themeModes: ThemeModeDef[] = [
    { id: 'auto', label: 'Auto (System)', icon: 'auto', preview: 'auto-preview' },
    { id: 'dark', label: 'Dark Mode', icon: 'dark', preview: 'dark-preview' },
    { id: 'light', label: 'Light Mode', icon: 'light', preview: 'light-preview' }
  ];

  // Editable form state initialized from service
  provider = signal<string>(this.settingsService.aiProvider());
  apiKey = signal<string>(this.settingsService.aiApiKey());
  baseUrl = signal<string>(this.settingsService.aiBaseUrl());
  model = signal<string>(this.settingsService.aiModel());
  ollamaBaseUrl = signal<string>(this.settingsService.aiOllamaBaseUrl());
  ollamaModel = signal<string>(this.settingsService.aiOllamaModel());

  /** True when the form differs from what is persisted, so Save/Revert
      can be disabled until there is actually something to act on. */
  isDirty = computed(
    () =>
      this.provider() !== this.settingsService.aiProvider() ||
      this.apiKey() !== this.settingsService.aiApiKey() ||
      this.baseUrl() !== this.settingsService.aiBaseUrl() ||
      this.model() !== this.settingsService.aiModel() ||
      this.ollamaBaseUrl() !== this.settingsService.aiOllamaBaseUrl() ||
      this.ollamaModel() !== this.settingsService.aiOllamaModel()
  );

  // Ambient themes list. The `id` values are persisted in localStorage and are
  // deliberately left unchanged; only the presentation labels are tuned here.
  ambientThemes: { id: AmbientTheme; label: string; desc: string }[] = [
    { id: 'default', label: 'Paper', desc: 'Plain neutral canvas' },
    { id: 'aurora', label: 'Sage', desc: 'Faint green cast' },
    { id: 'nebula', label: 'Dusk', desc: 'Cool muted indigo cast' },
    { id: 'cyberpunk', label: 'Graphite', desc: 'Grid-lined dark surface' },
    { id: 'blueprint', label: 'Linen', desc: 'Fine dotted texture' }
  ];

  ngOnInit() {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
  }

  ngOnDestroy() {
    this.previouslyFocused?.focus?.();
  }

  /** Move focus to the active tab when the dialog opens. */
  ngAfterViewInit() {
    const active = this.host.nativeElement.querySelector<HTMLElement>('.settings-nav-btn.active');
    active?.focus();
  }

  selectTab(id: TabId) {
    this.settingsService.activeTab.set(id);
  }

  /** Up/Down arrows move between tabs, per the ARIA tabs pattern (vertical). */
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent) {
    const isTabNav = (event.target as HTMLElement)?.classList?.contains('settings-nav-btn');
    if (!isTabNav) return;
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

    event.preventDefault();
    const idx = this.tabs.findIndex(t => t.id === this.settingsService.activeTab());
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const next = this.tabs[(idx + delta + this.tabs.length) % this.tabs.length];
    this.selectTab(next.id);

    queueMicrotask(() => {
      this.host.nativeElement.querySelector<HTMLElement>(`#tab-${next.id}`)?.focus();
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.settingsService.close();
  }

  onProviderChange() {
    const p = this.provider();
    if (p === 'opencode') {
      this.baseUrl.set('https://api.groq.com/openai/v1');
      this.model.set('qwen/qwen3.8-27b');
    } else if (p === 'gemini') {
      this.baseUrl.set('https://generativelanguage.googleapis.com/v1beta');
      this.model.set('gemini-1.5-flash');
    } else if (p === 'ollama') {
      this.ollamaBaseUrl.set('http://localhost:11434');
      this.ollamaModel.set('llama3.2');
    }
  }

  saveAi() {
    this.settingsService.saveAiConfig({
      provider: this.provider(),
      apiKey: this.apiKey(),
      baseUrl: this.baseUrl(),
      model: this.model(),
      ollamaBaseUrl: this.ollamaBaseUrl(),
      ollamaModel: this.ollamaModel()
    });
  }

  /** Discard edits and restore the form from persisted settings. */
  revertAi() {
    this.provider.set(this.settingsService.aiProvider());
    this.apiKey.set(this.settingsService.aiApiKey());
    this.baseUrl.set(this.settingsService.aiBaseUrl());
    this.model.set(this.settingsService.aiModel());
    this.ollamaBaseUrl.set(this.settingsService.aiOllamaBaseUrl());
    this.ollamaModel.set(this.settingsService.aiOllamaModel());
  }

  resetSidebars() {
    try {
      localStorage.removeItem('cms_left_sidebar_w');
      localStorage.removeItem('cms_right_sidebar_w');
      this.toastService.show('Sidebar widths reset to defaults (280px / 300px)', 'success');
      setTimeout(() => window.location.reload(), 500);
    } catch (_) {}
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.settingsService.close();
    }
  }
}
