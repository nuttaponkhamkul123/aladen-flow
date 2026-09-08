import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface OllamaModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
  details?: any;
}

export interface GeneratePageRequest {
  prompt: string;
  preset?: string;
  theme?: string;
  boardId?: number | null;
  provider?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface GeneratePageResponse {
  page: any;
  source: string;
  warning?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AiService {
  private http = inject(HttpClient);
  private baseUrl = '/api/ai';

  getOllamaModels(customBaseUrl?: string): Observable<{ ok: boolean; models: OllamaModelInfo[]; error?: string }> {
    const url = customBaseUrl ? `${this.baseUrl}/ollama/models?baseUrl=${encodeURIComponent(customBaseUrl)}` : `${this.baseUrl}/ollama/models`;
    return this.http.get<{ ok: boolean; models: OllamaModelInfo[]; error?: string }>(url);
  }

  generatePage(payload: GeneratePageRequest): Observable<GeneratePageResponse> {
    return this.http.post<GeneratePageResponse>(`${this.baseUrl}/generate-page`, payload);
  }
}
