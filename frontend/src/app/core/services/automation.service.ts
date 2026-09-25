import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AutomationFlow, AutomationLog, AutomationExecutionResult } from '../models/automation.model';

@Injectable({
  providedIn: 'root'
})
export class AutomationService {
  private http = inject(HttpClient);
  private baseUrl = '/api/automations';

  automations = signal<AutomationFlow[]>([]);
  activeFlow = signal<AutomationFlow | null>(null);
  recentLogs = signal<AutomationLog[]>([]);
  isLoading = signal<boolean>(false);
  isExecuting = signal<boolean>(false);
  lastExecutionResult = signal<AutomationExecutionResult | null>(null);

  getAutomations(): Observable<AutomationFlow[]> {
    this.isLoading.set(true);
    return this.http.get<AutomationFlow[]>(this.baseUrl).pipe(
      tap({
        next: (list) => {
          this.automations.set(list);
          this.isLoading.set(false);
          if (!this.activeFlow() && list.length > 0) {
            this.activeFlow.set(list[0]);
          } else if (this.activeFlow()) {
            const current = list.find(f => f.id === this.activeFlow()?.id);
            if (current) this.activeFlow.set(current);
          }
        },
        error: () => this.isLoading.set(false)
      })
    );
  }

  getAutomation(id: number): Observable<AutomationFlow> {
    return this.http.get<AutomationFlow>(`${this.baseUrl}/${id}`).pipe(
      tap((flow) => this.activeFlow.set(flow))
    );
  }

  createAutomation(data: Partial<AutomationFlow>): Observable<{ id: number; ok: boolean }> {
    return this.http.post<{ id: number; ok: boolean }>(this.baseUrl, data);
  }

  updateAutomation(id: number, data: Partial<AutomationFlow>): Observable<{ ok: boolean }> {
    return this.http.put<{ ok: boolean }>(`${this.baseUrl}/${id}`, data);
  }

  deleteAutomation(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/${id}`);
  }

  toggleAutomation(id: number): Observable<{ ok: boolean; is_active: boolean }> {
    return this.http.post<{ ok: boolean; is_active: boolean }>(`${this.baseUrl}/${id}/toggle`, {}).pipe(
      tap((res) => {
        this.automations.update(list =>
          list.map(f => f.id === id ? { ...f, is_active: res.is_active } : f)
        );
        if (this.activeFlow()?.id === id) {
          this.activeFlow.update(f => f ? { ...f, is_active: res.is_active } : null);
        }
      })
    );
  }

  executeAutomation(id: number, payload: { card_id?: number; page_id?: number; commit?: boolean } = {}): Observable<{ ok: boolean; result: AutomationExecutionResult }> {
    this.isExecuting.set(true);
    return this.http.post<{ ok: boolean; result: AutomationExecutionResult }>(`${this.baseUrl}/${id}/execute`, payload).pipe(
      tap({
        next: (res) => {
          this.isExecuting.set(false);
          this.lastExecutionResult.set(res.result);
          // Update execution count in active flow
          this.activeFlow.update(f => f ? { ...f, execution_count: (f.execution_count || 0) + 1 } : null);
        },
        error: () => this.isExecuting.set(false)
      })
    );
  }

  getRecentLogs(): Observable<AutomationLog[]> {
    return this.http.get<AutomationLog[]>(`${this.baseUrl}/logs/recent`).pipe(
      tap((logs) => this.recentLogs.set(logs))
    );
  }
}
