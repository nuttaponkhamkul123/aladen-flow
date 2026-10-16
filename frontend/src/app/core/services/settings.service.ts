import { Injectable, signal, inject } from '@angular/core';
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
  private toastService = inject(ToastService);

  isOpen = signal<boolean>(false);
  activeTab = signal<'general' | 'ai' | 'canvas' | 'storage' | 'account'>('general');
  activeUserId = signal<number | null>(null);

  // Callback to sync setting changes to authenticated user's profile
  onSettingsChange?: (patch: Record<string, any>) => void;

  // AI Configuration Signals (Isolated per active user)
  aiProvider = signal<string>('opencode');
  aiApiKey = signal<string>('');
  aiBaseUrl = signal<string>('https://api.groq.com/openai/v1');
  aiModel = signal<string>('qwen/qwen3.8-27b');
  aiOllamaBaseUrl = signal<string>('http://localhost:11434');
  aiOllamaModel = signal<string>('llama3.2');

  open(tab: 'general' | 'ai' | 'canvas' | 'storage' | 'account' = 'general') {
    this.activeTab.set(tab);
    this.isOpen.set(true);
  }

  close() {
    this.isOpen.set(false);
  }

  keyFor(key: string): string {
    const uid = this.activeUserId();
    return uid ? `u_${uid}_${key}` : key;
  }

  setUser(userId: number | null, settings?: any) {
    this.activeUserId.set(userId);
    if (!userId) {
      this.resetToDefaults();
      return;
    }

    if (settings) {
      if (settings.ai_provider !== undefined) {
        this.aiProvider.set(settings.ai_provider || 'opencode');
        this.setStorage(this.keyFor('aladen_ai_provider'), this.aiProvider());
      }
      if (settings.ai_api_key !== undefined) {
        this.aiApiKey.set(settings.ai_api_key || '');
        this.setStorage(this.keyFor('aladen_ai_api_key'), this.aiApiKey());
      }
      if (settings.ai_base_url !== undefined) {
        this.aiBaseUrl.set(settings.ai_base_url || 'https://api.groq.com/openai/v1');
        this.setStorage(this.keyFor('aladen_ai_base_url'), this.aiBaseUrl());
      }
      if (settings.ai_model !== undefined) {
        this.aiModel.set(settings.ai_model || 'qwen/qwen3.8-27b');
        this.setStorage(this.keyFor('aladen_ai_model'), this.aiModel());
      }
      if (settings.ai_ollama_base_url !== undefined) {
        this.aiOllamaBaseUrl.set(settings.ai_ollama_base_url || 'http://localhost:11434');
        this.setStorage(this.keyFor('aladen_ai_ollama_base_url'), this.aiOllamaBaseUrl());
      }
      if (settings.ai_ollama_model !== undefined) {
        this.aiOllamaModel.set(settings.ai_ollama_model || 'llama3.2');
        this.setStorage(this.keyFor('aladen_ai_ollama_model'), this.aiOllamaModel());
      }
    } else {
      // Load user-namespaced storage
      this.aiProvider.set(this.loadStorage(this.keyFor('aladen_ai_provider'), 'opencode'));
      this.aiApiKey.set(this.loadStorage(this.keyFor('aladen_ai_api_key'), ''));
      this.aiBaseUrl.set(this.loadStorage(this.keyFor('aladen_ai_base_url'), 'https://api.groq.com/openai/v1'));
      this.aiModel.set(this.loadStorage(this.keyFor('aladen_ai_model'), 'qwen/qwen3.8-27b'));
      this.aiOllamaBaseUrl.set(this.loadStorage(this.keyFor('aladen_ai_ollama_base_url'), 'http://localhost:11434'));
      this.aiOllamaModel.set(this.loadStorage(this.keyFor('aladen_ai_ollama_model'), 'llama3.2'));
    }
  }

  resetToDefaults() {
    this.activeUserId.set(null);
    this.aiProvider.set('opencode');
    this.aiApiKey.set('');
    this.aiBaseUrl.set('https://api.groq.com/openai/v1');
    this.aiModel.set('qwen/qwen3.8-27b');
    this.aiOllamaBaseUrl.set('http://localhost:11434');
    this.aiOllamaModel.set('llama3.2');
  }

  saveAiConfig(config: Partial<AladenAiConfig>) {
    const userPatch: Record<string, any> = {};
    if (config.provider !== undefined) {
      this.aiProvider.set(config.provider);
      this.setStorage(this.keyFor('aladen_ai_provider'), config.provider);
      userPatch['ai_provider'] = config.provider;
    }
    if (config.apiKey !== undefined) {
      this.aiApiKey.set(config.apiKey);
      this.setStorage(this.keyFor('aladen_ai_api_key'), config.apiKey);
      userPatch['ai_api_key'] = config.apiKey;
    }
    if (config.baseUrl !== undefined) {
      this.aiBaseUrl.set(config.baseUrl);
      this.setStorage(this.keyFor('aladen_ai_base_url'), config.baseUrl);
      userPatch['ai_base_url'] = config.baseUrl;
    }
    if (config.model !== undefined) {
      this.aiModel.set(config.model);
      this.setStorage(this.keyFor('aladen_ai_model'), config.model);
      userPatch['ai_model'] = config.model;
    }
    if (config.ollamaBaseUrl !== undefined) {
      this.aiOllamaBaseUrl.set(config.ollamaBaseUrl);
      this.setStorage(this.keyFor('aladen_ai_ollama_base_url'), config.ollamaBaseUrl);
      userPatch['ai_ollama_base_url'] = config.ollamaBaseUrl;
    }
    if (config.ollamaModel !== undefined) {
      this.aiOllamaModel.set(config.ollamaModel);
      this.setStorage(this.keyFor('aladen_ai_ollama_model'), config.ollamaModel);
      userPatch['ai_ollama_model'] = config.ollamaModel;
    }

    if (Object.keys(userPatch).length > 0 && this.onSettingsChange) {
      this.onSettingsChange(userPatch);
    }
    this.toastService.show('User settings saved successfully', 'success');
  }

  clearWorkspaceCache() {
    try {
      const uid = this.activeUserId();
      if (uid) {
        // Clear only this user's keys
        const prefix = `u_${uid}_`;
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const key = localStorage.key(i);
          if (key && key.startsWith(prefix)) {
            localStorage.removeItem(key);
          }
        }
      }
      this.toastService.show('User workspace cache cleared', 'info');
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
