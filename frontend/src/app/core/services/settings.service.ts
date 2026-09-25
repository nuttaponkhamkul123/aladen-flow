import { Injectable, signal, inject } from '@angular/core';
import { ThemeService } from './theme.service';
import { ToastService } from './toast.service';

export interface AladenAiConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
}

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private themeService = inject(ThemeService);
  private toastService = inject(ToastService);

  isOpen = signal<boolean>(false);
  activeTab = signal<'general' | 'ai' | 'canvas' | 'storage'>('general');

  // AI Configuration Signals
  aiProvider = signal<string>(this.loadStorage('aladen_ai_provider', 'opencode'));
  aiApiKey = signal<string>(this.loadStorage('aladen_ai_api_key', ''));
  aiBaseUrl = signal<string>(this.loadStorage('aladen_ai_base_url', 'https://api.groq.com/openai/v1'));
  aiModel = signal<string>(this.loadStorage('aladen_ai_model', 'qwen/qwen3.8-27b'));
  aiOllamaBaseUrl = signal<string>(this.loadStorage('aladen_ai_ollama_base_url', 'http://localhost:11434'));
  aiOllamaModel = signal<string>(this.loadStorage('aladen_ai_ollama_model', 'llama3.2'));

  open(tab: 'general' | 'ai' | 'canvas' | 'storage' = 'general') {
    this.activeTab.set(tab);
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
  }

  saveAiConfig(config: Partial<AladenAiConfig>) {
    if (config.provider !== undefined) {
      this.aiProvider.set(config.provider);
      this.setStorage('aladen_ai_provider', config.provider);
    }
    if (config.apiKey !== undefined) {
      this.aiApiKey.set(config.apiKey);
      this.setStorage('aladen_ai_api_key', config.apiKey);
    }
    if (config.baseUrl !== undefined) {
      this.aiBaseUrl.set(config.baseUrl);
      this.setStorage('aladen_ai_base_url', config.baseUrl);
    }
    if (config.model !== undefined) {
      this.aiModel.set(config.model);
      this.setStorage('aladen_ai_model', config.model);
    }
    if (config.ollamaBaseUrl !== undefined) {
      this.aiOllamaBaseUrl.set(config.ollamaBaseUrl);
      this.setStorage('aladen_ai_ollama_base_url', config.ollamaBaseUrl);
    }
    if (config.ollamaModel !== undefined) {
      this.aiOllamaModel.set(config.ollamaModel);
      this.setStorage('aladen_ai_ollama_model', config.ollamaModel);
    }
    this.toastService.show('Settings saved successfully', 'success');
  }

  clearWorkspaceCache() {
    try {
      const preserveKeys = ['aladen_ai_api_key', 'aladen_ai_provider'];
      const preserved: Record<string, string> = {};
      for (const k of preserveKeys) {
        const val = localStorage.getItem(k);
        if (val) preserved[k] = val;
      }
      localStorage.clear();
      for (const [k, v] of Object.entries(preserved)) {
        localStorage.setItem(k, v);
      }
      this.toastService.show('Workspace cache cleared', 'info');
      setTimeout(() => window.location.reload(), 600);
    } catch (err) {
      console.error(err);
    }
  }

  private loadStorage(key: string, fallback: string): string {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return localStorage.getItem(key) || fallback;
      }
    } catch (_) {}
    return fallback;
  }

  private setStorage(key: string, value: string) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem(key, value);
      }
    } catch (_) {}
  }
}
