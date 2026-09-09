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
  boardService = inject(BoardService);
  private destroyRef = inject(DestroyRef);

  overview = signal<any>(null);
  loading = signal(true);

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
