import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BoardService } from '../../core/services/board.service';

@Component({
  selector: 'app-dashboard-view',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './dashboard-view.component.html',
  styleUrls: ['./dashboard-view.component.css']
})
export class DashboardViewComponent implements OnInit {
  Math = Math;
  boardService = inject(BoardService);
  private destroyRef = inject(DestroyRef);

  overview = signal<any>(null);
  loading = signal(true);
  hoveredSegment = signal<string | null>(null);

  readonly DONUT_CIRCUMFERENCE = 2 * Math.PI * 65; // ~408.4

  ngOnInit() {
    this.boardService.getOverview().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (data) => {
        this.overview.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  // 3D Card Interactive Tilt
  onCardMouseMove(e: MouseEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left - rect.width / 2;
    const y = e.clientY - rect.top - rect.height / 2;
    const rotateX = -(y / (rect.height / 2)) * 7;
    const rotateY = (x / (rect.width / 2)) * 7;
    el.style.transform = `perspective(1000px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateY(-4px) translateZ(8px)`;
  }

  onCardMouseLeave(el: HTMLElement) {
    el.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0) translateZ(0)';
  }

  // Calculate SVG Donut stroke-dasharray
  getSegmentDash(count: number, total: number): string {
    if (!total || total <= 0 || !count || count <= 0) {
      return `0 ${this.DONUT_CIRCUMFERENCE}`;
    }
    const len = (count / total) * this.DONUT_CIRCUMFERENCE;
    return `${len.toFixed(1)} ${(this.DONUT_CIRCUMFERENCE - len).toFixed(1)}`;
  }

  // Calculate SVG Donut stroke-dashoffset
  getSegmentOffset(prevCount: number, total: number): number {
    if (!total || total <= 0 || !prevCount || prevCount <= 0) {
      return 0;
    }
    const offset = (prevCount / total) * this.DONUT_CIRCUMFERENCE;
    return -offset;
  }

  // Isometric 3D Pillar Height (in pixels)
  getPillarHeight(count: number, total: number): number {
    if (!total || total <= 0 || !count || count <= 0) return 30;
    const ratio = count / total;
    return Math.max(34, Math.round(ratio * 130));
  }

  getTimeAgo(dateStr: string): string {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    const diff = Math.floor((now - then) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return new Date(dateStr).toLocaleDateString();
  }
}
