import { Component, OnInit, inject, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { BoardService } from '../../core/services/board.service';
import { AnimationService } from '../../core/services/animation.service';

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
  animationService = inject(AnimationService);
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
        setTimeout(() => {
          this.animationService.animateDashboardEntrance();
        }, 20);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  getPct(count: number, total: number): number {
    if (!total || total <= 0 || !count || count <= 0) return 0;
    return Math.round((count / total) * 100);
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
