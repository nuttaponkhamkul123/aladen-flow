export interface User {
  id: number;
  username: string;
  email: string | null;
  display_name: string;
  avatar_url?: string;
  created_at?: string;
}

export interface UserSettings {
  user_id: number;
  theme_mode: 'auto' | 'dark' | 'light';
  ambient_theme: 'default' | 'aurora' | 'nebula' | 'cyberpunk' | 'blueprint';
  ai_provider: string;
  ai_api_key: string;
  ai_base_url: string;
  ai_model: string;
  ai_ollama_base_url: string;
  ai_ollama_model: string;
  sidebar_collapsed: number;
  settings_json?: string;
  extra?: Record<string, any>;
  updated_at?: string;
}

export interface AuthResponse {
  user: User;
  token: string;
  expiresAt?: string;
  settings?: UserSettings;
}
