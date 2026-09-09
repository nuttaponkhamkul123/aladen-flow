import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { ThemeService } from '../../../core/services/theme.service';
import { BoardService } from '../../../core/services/board.service';
import { CmsService } from '../../../core/services/cms.service';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css']
})
export class SidebarComponent {
  themeService = inject(ThemeService);
  boardService = inject(BoardService);
  cmsService = inject(CmsService);
  private router = inject(Router);

  isCollapsed = signal<boolean>(this.loadCollapsedState());

  private loadCollapsedState(): boolean {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return localStorage.getItem('aladen_sidebar_collapsed') === 'true';
      }
    } catch (_) {}
    return false;
  }

  toggleCollapsed() {
    this.isCollapsed.update(v => {
      const next = !v;
      try {
        localStorage.setItem('aladen_sidebar_collapsed', String(next));
      } catch (_) {}
      return next;
    });
  }

  private routeEvent = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      map(() => this.router.url)
    ),
    { initialValue: this.router.url }
  );

  currentRoute = computed(() => {
    const url = this.routeEvent() || '';
    if (url.startsWith('/cms')) return '/cms';
    if (url.startsWith('/kanban')) return '/kanban';
    return '/dashboard';
  });

  boardsCount = computed(() => this.boardService.boards().length);
  pagesCount = computed(() => this.cmsService.pages().length);

  activeBoardName = computed(() => {
    const id = this.boardService.activeBoardId();
    const b = this.boardService.boards().find(item => item.id === id);
    return b ? b.name : 'Main Board';
  });

  activePageTitle = computed(() => {
    return this.cmsService.activePage()?.title || 'Pages';
  });

  activePageStatus = computed(() => {
    return this.cmsService.activePage()?.status || 'draft';
  });
}
