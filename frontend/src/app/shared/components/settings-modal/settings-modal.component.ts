import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SettingsService } from '../../../core/services/settings.service';
import { ThemeService, ThemeMode, AmbientTheme } from '../../../core/services/theme.service';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-settings-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './settings-modal.component.html',
  styleUrls: ['./settings-modal.component.css']
})
export class SettingsModalComponent {
  settingsService = inject(SettingsService);
  themeService = inject(ThemeService);
  toastService = inject(ToastService);

  showApiKey = signal<boolean>(false);

  // Editable form state initialized from service
  provider = signal<string>(this.settingsService.aiProvider());
  apiKey = signal<string>(this.settingsService.aiApiKey());
  baseUrl = signal<string>(this.settingsService.aiBaseUrl());
  model = signal<string>(this.settingsService.aiModel());
  ollamaBaseUrl = signal<string>(this.settingsService.aiOllamaBaseUrl());
  ollamaModel = signal<string>(this.settingsService.aiOllamaModel());

  // Ambient themes list
  ambientThemes: { id: AmbientTheme; label: string; desc: string }[] = [
    { id: 'default', label: 'Default Obsidian', desc: 'Minimal clean dark workspace' },
    { id: 'aurora', label: 'Aurora Borealis', desc: 'Gentle emerald & violet mesh gradient' },
    { id: 'nebula', label: 'Cosmic Nebula', desc: 'Deep indigo & starlight purple glow' },
    { id: 'cyberpunk', label: 'Cyberpunk Neon', desc: 'High-contrast cyan & magenta accents' },
    { id: 'blueprint', label: 'Blueprint Grid', desc: 'Architectural tech blueprint matrix' },
  ];

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
