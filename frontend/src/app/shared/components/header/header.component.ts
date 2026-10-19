import { Component, inject, computed, signal, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, NavigationEnd } from '@angular/router';
import { toSignal, takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs/operators';
import { ThemeService, AmbientTheme } from '../../../core/services/theme.service';
import { BoardService } from '../../../core/services/board.service';
import { CmsService } from '../../../core/services/cms.service';
import { AuthService } from '../../../core/services/auth.service';
import { SettingsService } from '../../../core/services/settings.service';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { AnimationService } from '../../../core/services/animation.service';
import { CmsPage } from '../../../core/models/cms.model';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.css']
})
export class HeaderComponent {
  themeService = inject(ThemeService);
  boardService = inject(BoardService);
  cmsService = inject(CmsService);
  authService = inject(AuthService);
  settingsService = inject(SettingsService);
  commandPalette = inject(CommandPaletteService);
  animationService = inject(AnimationService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  showPagesPopup = false;
  showUserMenu = signal<boolean>(false);

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
    if (url.startsWith('/automations')) return '/automations';
    return '/dashboard';
  });

  onBoardSelect(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.boardService.activeBoardId.set(Number(select.value));
  }

  createBoard() {
    const name = prompt('Enter new board name:');
    if (!name || !name.trim()) return;
    this.boardService.createBoard(name.trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (b) => {
        this.boardService.getBoards().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
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
    this.boardService.deleteBoard(currentId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.boardService.getBoards().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
          this.boardService.boards.set(list);
          if (list.length > 0) this.boardService.activeBoardId.set(list[0].id);
        });
      },
      error: (err) => console.error(err)
    });
  }

  ambientThemes: { id: AmbientTheme; label: string; desc: string; previewClass: string }[] = [
    { id: 'nebula', label: 'Nebula', desc: 'Cobalt indigo', previewClass: 'swatch-nebula' },
    { id: 'aurora', label: 'Aurora', desc: 'Subtle emerald', previewClass: 'swatch-aurora' },
    { id: 'default', label: 'Default Slate', desc: 'Neutral slate', previewClass: 'swatch-default' },
    { id: 'cyberpunk', label: 'Cyberpunk', desc: 'Obsidian grid', previewClass: 'swatch-cyberpunk' },
    { id: 'blueprint', label: 'Blueprint', desc: 'Blueprint matrix', previewClass: 'swatch-blueprint' }
  ];

  onAmbientChange(event: Event) {
    const select = event.target as HTMLSelectElement;
    this.themeService.setAmbientTheme(select.value as AmbientTheme);
  }

  setAmbient(theme: AmbientTheme) {
    this.themeService.setAmbientTheme(theme);
  }

  cycleAmbientTheme() {
    const list: AmbientTheme[] = ['default', 'aurora', 'nebula', 'cyberpunk', 'blueprint'];
    const idx = list.indexOf(this.themeService.ambientTheme());
    const next = list[(idx + 1) % list.length];
    this.themeService.setAmbientTheme(next);
  }

  onSearchInput(event: Event) {
    const input = event.target as HTMLInputElement;
    this.boardService.searchQuery.set(input.value);
  }

  togglePagesPopup() {
    this.showPagesPopup = !this.showPagesPopup;
  }

  switchPage(id: number) {
    this.cmsService.getPage(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (page) => {
        this.cmsService.activePage.set(page);
        this.showPagesPopup = false;
      },
      error: (err) => console.error(err)
    });
  }

  toggleFirstPage(page: CmsPage) {
    this.cmsService.setFirstPage(page.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
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
    this.cmsService.updatePage(page.id, { slug }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.cmsService.activePage.set(updated);
        this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => this.cmsService.pages.set(list));
      },
      error: (err) => console.error(err)
    });
  }

  updatePageStatus(page: CmsPage, event: Event) {
    const select = event.target as HTMLSelectElement;
    const status = select.value as 'draft' | 'published';
    this.cmsService.updatePage(page.id, { status }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (updated) => {
        this.cmsService.activePage.set(updated);
        this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => this.cmsService.pages.set(list));
      },
      error: (err) => console.error(err)
    });
  }

  createPage() {
    const title = prompt('New Page Title:');
    if (!title || !title.trim()) return;
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    this.cmsService.createPage({ title: title.trim(), slug }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (newPage) => {
        this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
          this.cmsService.pages.set(list);
          this.cmsService.getPage(newPage.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

  toggleUserMenu(event?: MouseEvent) {
    if (event?.currentTarget) {
      this.animationService.animateClick(event.currentTarget as HTMLElement);
    }
    const next = !this.showUserMenu();
    this.showUserMenu.set(next);
    if (next) {
      setTimeout(() => {
        const menuEl = document.querySelector('.user-dropdown-menu') as HTMLElement;
        if (menuEl) {
          this.animationService.animateUserMenu(menuEl);
        }
      }, 15);
    }
  }

  openAccountSettings() {
    this.showUserMenu.set(false);
    this.settingsService.open('account');
  }

  logout() {
    this.showUserMenu.set(false);
    this.authService.logout().subscribe();
  }
}
