import { Component, inject, signal, computed, effect, ElementRef, ViewChild, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { CommandPaletteService } from '../../../core/services/command-palette.service';
import { BoardService } from '../../../core/services/board.service';
import { CmsService } from '../../../core/services/cms.service';
import { ThemeService } from '../../../core/services/theme.service';
import { SettingsService } from '../../../core/services/settings.service';
import { Card } from '../../../core/models/board.model';
import { CmsPage } from '../../../core/models/cms.model';

export interface CommandItem {
  id: string;
  category: 'action' | 'navigation' | 'card' | 'page';
  title: string;
  subtitle?: string;
  badge?: string;
  badgeClass?: string;
  icon: string;
  run: () => void;
}

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './command-palette.component.html',
  styleUrls: ['./command-palette.component.css']
})
export class CommandPaletteComponent {
  paletteService = inject(CommandPaletteService);
  private boardService = inject(BoardService);
  private cmsService = inject(CmsService);
  themeService = inject(ThemeService);
  private settingsService = inject(SettingsService);
  private router = inject(Router);

  @ViewChild('searchInput') searchInput?: ElementRef<HTMLInputElement>;

  query = signal<string>('');
  selectedIndex = signal<number>(0);

  // Cached cards & pages for instant searching
  loadedCards = signal<Card[]>([]);
  loadedPages = signal<CmsPage[]>([]);

  constructor() {
    effect(() => {
      if (this.paletteService.isOpen()) {
        this.query.set('');
        this.selectedIndex.set(0);
        this.fetchSearchData();
        setTimeout(() => this.searchInput?.nativeElement.focus(), 50);
      }
    });
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalShortcut(e: KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.paletteService.toggle();
    }
  }

  fetchSearchData() {
    // 1. Fetch current board cards
    const activeBoardId = this.boardService.activeBoardId();
    if (activeBoardId) {
      this.boardService.getBoard(activeBoardId).subscribe({
        next: (b) => {
          if (b && b.cards) {
            this.loadedCards.set(b.cards);
          }
        }
      });
    }

    // 2. Fetch CMS pages
    this.cmsService.getPages().subscribe({
      next: (pages) => this.loadedPages.set(pages || [])
    });
  }

  staticActions = computed<CommandItem[]>(() => {
    return [
      {
        id: 'act-new-card',
        category: 'action',
        title: 'Create New Kanban Card',
        subtitle: 'Add a new task directly to your board',
        badge: 'Kanban',
        badgeClass: 'badge-blue',
        icon: 'plus-square',
        run: () => {
          this.paletteService.close();
          this.router.navigate(['/kanban']).then(() => {
            const addBtn = document.querySelector('.add-card-btn') as HTMLElement;
            addBtn?.click();
          });
        }
      },
      {
        id: 'act-new-board',
        category: 'action',
        title: 'Create New Board',
        subtitle: 'Start a clean Kanban workspace',
        badge: 'Kanban',
        badgeClass: 'badge-blue',
        icon: 'layout',
        run: () => {
          this.paletteService.close();
          const name = prompt('Enter new board name:');
          if (name && name.trim()) {
            this.boardService.createBoard(name.trim()).subscribe();
          }
        }
      },
      {
        id: 'act-new-page',
        category: 'action',
        title: 'Create New CMS Page',
        subtitle: 'Build a new landing page or document',
        badge: 'CMS',
        badgeClass: 'badge-purple',
        icon: 'file-plus',
        run: () => {
          this.paletteService.close();
          const title = prompt('Enter new page title:');
          if (title && title.trim()) {
            this.cmsService.createPage(title.trim()).subscribe({
              next: () => this.router.navigate(['/cms'])
            });
          }
        }
      },
      {
        id: 'nav-dashboard',
        category: 'navigation',
        title: 'Go to Workspace Dashboard',
        subtitle: 'View overall project metrics, completion, and activity',
        badge: 'Navigate',
        badgeClass: 'badge-gray',
        icon: 'bar-chart-2',
        run: () => {
          this.paletteService.close();
          this.router.navigate(['/dashboard']);
        }
      },
      {
        id: 'nav-kanban',
        category: 'navigation',
        title: 'Go to Kanban Boards',
        subtitle: 'Manage cards, drag columns, and checklist workflows',
        badge: 'Navigate',
        badgeClass: 'badge-gray',
        icon: 'columns',
        run: () => {
          this.paletteService.close();
          this.router.navigate(['/kanban']);
        }
      },
      {
        id: 'nav-cms',
        category: 'navigation',
        title: 'Go to CMS Site Builder',
        subtitle: 'Design block layouts, preview live pages, and AI generate content',
        badge: 'Navigate',
        badgeClass: 'badge-gray',
        icon: 'layout',
        run: () => {
          this.paletteService.close();
          this.router.navigate(['/cms']);
        }
      },
      {
        id: 'nav-automations',
        category: 'navigation',
        title: 'Go to Workflow Automations',
        subtitle: 'Configure automated pipeline triggers and actions',
        badge: 'Navigate',
        badgeClass: 'badge-gray',
        icon: 'zap',
        run: () => {
          this.paletteService.close();
          this.router.navigate(['/automations']);
        }
      },
      {
        id: 'act-toggle-theme',
        category: 'action',
        title: 'Toggle Theme Mode',
        subtitle: `Currently ${this.themeService.themeMode().toUpperCase()} (Dark / Light / Auto)`,
        badge: 'Appearance',
        badgeClass: 'badge-amber',
        icon: 'moon',
        run: () => {
          this.themeService.toggleThemeMode();
        }
      },
      {
        id: 'act-cycle-ambient',
        category: 'action',
        title: 'Cycle Atmosphere Canvas Theme',
        subtitle: `Current: ${this.themeService.ambientTheme().toUpperCase()} (Nebula, Aurora, Cyberpunk, Blueprint, Default)`,
        badge: 'Atmosphere',
        badgeClass: 'badge-cyan',
        icon: 'sparkles',
        run: () => {
          const themes: Array<'nebula' | 'aurora' | 'cyberpunk' | 'blueprint' | 'default'> = ['nebula', 'aurora', 'cyberpunk', 'blueprint', 'default'];
          const curIdx = themes.indexOf(this.themeService.ambientTheme());
          const next = themes[(curIdx + 1) % themes.length];
          this.themeService.setAmbientTheme(next);
        }
      },
      {
        id: 'act-settings',
        category: 'action',
        title: 'Open Aladenflow Settings',
        subtitle: 'AI configuration, themes, sidebar widths, and storage',
        badge: 'Settings',
        badgeClass: 'badge-gray',
        icon: 'settings',
        run: () => {
          this.paletteService.close();
          this.settingsService.open();
        }
      }
    ];
  });

  filteredItems = computed<CommandItem[]>(() => {
    const q = this.query().trim().toLowerCase();
    const actions = this.staticActions();

    if (!q) {
      return actions;
    }

    // Filter static actions
    const matchedActions = actions.filter(a =>
      a.title.toLowerCase().includes(q) ||
      (a.subtitle && a.subtitle.toLowerCase().includes(q)) ||
      (a.badge && a.badge.toLowerCase().includes(q))
    );

    // Filter cards
    const matchedCards: CommandItem[] = this.loadedCards()
      .filter(c => c.title.toLowerCase().includes(q) || (c.description && c.description.toLowerCase().includes(q)))
      .slice(0, 8)
      .map(c => ({
        id: `card-${c.id}`,
        category: 'card',
        title: c.title,
        subtitle: `Card #${c.id} • Priority: ${c.priority} • ${c.checklist?.length ? c.checklist.length + ' checklist items' : 'No checklist'}`,
        badge: c.priority.toUpperCase(),
        badgeClass: c.priority === 'urgent' ? 'badge-red' : (c.priority === 'high' ? 'badge-amber' : 'badge-blue'),
        icon: 'check-square',
        run: () => {
          this.paletteService.close();
          this.router.navigate(['/kanban']).then(() => {
            const cardEl = document.querySelector(`[data-card-id="${c.id}"]`) as HTMLElement;
            if (cardEl) {
              cardEl.click();
            } else {
              // Open modal directly by dispatching click
              const cards = document.querySelectorAll('.card') as NodeListOf<HTMLElement>;
              cards.forEach(el => {
                if (el.textContent?.includes(c.title)) el.click();
              });
            }
          });
        }
      }));

    // Filter CMS pages
    const matchedPages: CommandItem[] = this.loadedPages()
      .filter(p => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q))
      .slice(0, 6)
      .map(p => ({
        id: `page-${p.id}`,
        category: 'page',
        title: p.title,
        subtitle: `/p/${p.slug} • ${p.status === 'published' ? 'Live Published' : 'Draft'}`,
        badge: p.status.toUpperCase(),
        badgeClass: p.status === 'published' ? 'badge-green' : 'badge-amber',
        icon: 'file-text',
        run: () => {
          this.paletteService.close();
          this.cmsService.switchPage(p.id);
          this.router.navigate(['/cms']);
        }
      }));

    return [...matchedActions, ...matchedCards, ...matchedPages];
  });

  onKeyDown(e: KeyboardEvent) {
    const items = this.filteredItems();
    if (!items.length) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex.update(idx => (idx + 1) % items.length);
      this.scrollActiveIntoView();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex.update(idx => (idx - 1 + items.length) % items.length);
      this.scrollActiveIntoView();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = items[this.selectedIndex()];
      if (current) {
        current.run();
      }
    } else if (e.key === 'Escape') {
      this.paletteService.close();
    }
  }

  scrollActiveIntoView() {
    setTimeout(() => {
      const activeEl = document.querySelector('.palette-item.active') as HTMLElement;
      activeEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, 20);
  }

  selectItem(item: CommandItem, index: number) {
    this.selectedIndex.set(index);
    item.run();
  }
}
