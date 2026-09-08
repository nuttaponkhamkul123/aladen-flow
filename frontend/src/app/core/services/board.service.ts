import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { Board, Column, Card, Label, ChecklistItem, Activity } from '../models/board.model';

@Injectable({
  providedIn: 'root'
})
export class BoardService {
  private http = inject(HttpClient);
  private baseUrl = '/api';

  boards = signal<Board[]>([]);
  activeBoardId = signal<number>(1);
  searchQuery = signal<string>('');

  getBoards(): Observable<Board[]> {
    return this.http.get<Board[]>(`${this.baseUrl}/boards`);
  }

  getBoard(id: number): Observable<Board> {
    return this.http.get<Board>(`${this.baseUrl}/boards/${id}`);
  }

  createBoard(name: string): Observable<{ id: number; name: string }> {
    return this.http.post<{ id: number; name: string }>(`${this.baseUrl}/boards`, { name });
  }

  deleteBoard(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/boards/${id}`);
  }

  createColumn(boardId: number, name: string): Observable<Column> {
    return this.http.post<Column>(`${this.baseUrl}/boards/${boardId}/columns`, { name });
  }

  updateColumn(id: number, name: string): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${this.baseUrl}/columns/${id}`, { name });
  }

  deleteColumn(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/columns/${id}`);
  }

  moveColumns(columnId: number, boardId: number, orderedIds: number[]): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.baseUrl}/columns/${columnId}/move`, {
      board_id: boardId,
      orderedIds
    });
  }

  createCard(columnId: number, data: { title: string; description?: string; due_date?: string | null; priority?: string; labelIds?: number[] }): Observable<{ id: number }> {
    return this.http.post<{ id: number }>(`${this.baseUrl}/columns/${columnId}/cards`, data);
  }

  updateCard(id: number, data: Partial<Card> & { labelIds?: number[] }): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${this.baseUrl}/cards/${id}`, data);
  }

  deleteCard(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/cards/${id}`);
  }

  moveCards(cardId: number, targetColumnId: number, orderedIds: number[]): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.baseUrl}/cards/${cardId}/move`, {
      target_column_id: targetColumnId,
      orderedIds
    });
  }

  getCardActivity(cardId: number): Observable<Activity[]> {
    return this.http.get<Activity[]>(`${this.baseUrl}/cards/${cardId}/activity`);
  }

  getBoardActivity(boardId: number): Observable<Activity[]> {
    return this.http.get<Activity[]>(`${this.baseUrl}/boards/${boardId}/activity`);
  }

  addLabel(boardId: number, name: string, color: string): Observable<Label> {
    return this.http.post<Label>(`${this.baseUrl}/boards/${boardId}/labels`, { name, color });
  }

  deleteLabel(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/labels/${id}`);
  }

  addChecklistItem(cardId: number, text: string): Observable<ChecklistItem> {
    return this.http.post<ChecklistItem>(`${this.baseUrl}/cards/${cardId}/checklist`, { text });
  }

  updateChecklistItem(id: number, data: { text?: string; checked?: boolean }): Observable<{ ok: boolean }> {
    return this.http.patch<{ ok: boolean }>(`${this.baseUrl}/checklist/${id}`, data);
  }

  deleteChecklistItem(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/checklist/${id}`);
  }

  search(q: string): Observable<Card[]> {
    return this.http.get<Card[]>(`${this.baseUrl}/search?q=${encodeURIComponent(q)}`);
  }
}
