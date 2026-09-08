import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, Router, NavigationEnd } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { ThemeService, AmbientTheme } from '../../../core/services/theme.service';
import { BoardService } from '../../../core/services/board.service';
import { CmsService } from '../../../core/services/cms.service';
import { CmsPage } from '../../../core/models/cms.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, RouterLinkActive],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  boardService = inject(BoardService);
  cmsService = inject(CmsService);
  private router = inject(Router);

  showPagesPopup = false;

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
    return '/kanban';
  });

  onBoardSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.boardService.activeBoardId.set(Number(select.value));
  }

  createBoard() {
    const name = prompt('Enter new board name:');
    if (!name || !name.trim()) return;
    this.boardService.createBoard(name.trim()).subscribe({
      next: (b) => {
        this.boardService.getBoards().subscribe(list => {
          this.boardService.boards.set(list);
          this.boardService.activeBoardId.set(b.id);
        });
      },
      error: (err) => console.error(err)
    });
  }

  deleteBoard() {
    const currentId = this.boardService.activeBoardId();
    if (!currentId) return;
    if (!confirm('Delete this board and all its data?')) return;
    this.boardService.deleteBoard(currentId).subscribe({
      next: () => {
        this.boardService.getBoards().subscribe(list => {
          this.boardService.boards.set(list);
          if (list.length > 0) this.boardService.activeBoardId.set(list[0].id);
        });
      },
      error: (err) => console.error(err)
    });
  }

  onAmbientChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.themeService.setAmbientTheme(select.value as AmbientTheme);
  }

  onSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.boardService.searchQuery.set(input.value);
  }

  togglePagesPopup() {
    this.showPagesPopup = !this.showPagesPopup;
  }

  switchPage(id: number) {
    this.cmsService.getPage(id).subscribe({
      next: (page) => {
        this.cmsService.activePage.set(page);
        this.showPagesPopup = false;
      },
      error: (err) => console.error(err)
    });
  }

  toggleFirstPage(page: CmsPage) {
    this.cmsService.setFirstPage(page.id).subscribe({
      next: () => {
        this.cmsService.getPages().subscribe(list => {
          this.cmsService.pages.set(list);
          const updated = list.find(p => p.id === page.id);
          if (updated) this.cmsService.activePage.set(updated);
        });
      },
      error: (err) => console.error(err)
    });
  }

  updatePageSlug(page: CmsPage, event: Event) {
    const input = event.target as HTMLInputElement;
    const slug = input.value.trim();
    if (!slug) return;
    this.cmsService.updatePage(page.id, { slug }).subscribe({
      next: (updated) => {
        this.cmsService.activePage.set(updated);
        this.cmsService.getPages().subscribe(list => this.cmsService.pages.set(list));
      },
      error: (err) => console.error(err)
    });
  }

  updatePageStatus(page: CmsPage, event: Event) {
    const select = event.target as HTMLSelectElement;
    const status = select.value as 'draft' | 'published';
    this.cmsService.updatePage(page.id, { status }).subscribe({
      next: (updated) => {
        this.cmsService.activePage.set(updated);
        this.cmsService.getPages().subscribe(list => this.cmsService.pages.set(list));
      },
      error: (err) => console.error(err)
    });
  }

  createPage() {
    const title = prompt('New Page Title:');
    if (!title || !title.trim()) return;
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    this.cmsService.createPage({ title: title.trim(), slug }).subscribe({
      next: (newPage) => {
        this.cmsService.getPages().subscribe(list => {
          this.cmsService.pages.set(list);
          this.cmsService.getPage(newPage.id).subscribe({
            next: (fullPage) => {
              this.cmsService.activePage.set(fullPage);
              this.showPagesPopup = false;
            },
            error: (err) => console.error(err)
          });
        });
      },
      error: (err) => console.error(err)
    });
  }
}
