import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { CmsPage, ReusableBlock, Block } from '../models/cms.model';

@Injectable({
  providedIn: 'root'
})
export class CmsService {
  private http = inject(HttpClient);
  private baseUrl = '/api';

  pages = signal<CmsPage[]>([]);
  activePage = signal<CmsPage | null>(null);

  getPages(): Observable<CmsPage[]> {
    return this.http.get<CmsPage[]>(`${this.baseUrl}/pages`);
  }

  getTags(): Observable<{ tag: string; c: number }[]> {
    return this.http.get<{ tag: string; c: number }[]>(`${this.baseUrl}/tags`);
  }

  getPage(id: number): Observable<CmsPage> {
    return this.http.get<CmsPage>(`${this.baseUrl}/pages/${id}`);
  }

  getPageBySlug(slug: string): Observable<CmsPage> {
    return this.http.get<CmsPage>(`${this.baseUrl}/pages/by-slug/${slug}`);
  }

  createPage(data: { title: string; slug: string; status?: string; tags?: string[] }): Observable<{ id: number; slug: string; is_first_page: number }> {
    return this.http.post<{ id: number; slug: string; is_first_page: number }>(`${this.baseUrl}/pages`, data);
  }

  updatePage(id: number, data: Partial<CmsPage> & { blocks?: Block[] | string; tags?: string[] }): Observable<CmsPage> {
    return this.http.patch<CmsPage>(`${this.baseUrl}/pages/${id}`, data);
  }

  setFirstPage(id: number): Observable<{ ok: boolean; id: number }> {
    return this.http.post<{ ok: boolean; id: number }>(`${this.baseUrl}/pages/${id}/set-first`, {});
  }

  reorderPages(items: { id: number; position: number; parent_id: number | null }[]): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${this.baseUrl}/pages/reorder`, { items });
  }

  deletePage(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/pages/${id}`);
  }

  getReusableBlocks(): Observable<ReusableBlock[]> {
    return this.http.get<ReusableBlock[]>(`${this.baseUrl}/reusable-blocks`);
  }

  createReusableBlock(name: string, block_data: Block, category = 'custom'): Observable<ReusableBlock> {
    return this.http.post<ReusableBlock>(`${this.baseUrl}/reusable-blocks`, { name, block_data, category });
  }

  deleteReusableBlock(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${this.baseUrl}/reusable-blocks/${id}`);
  }
}
