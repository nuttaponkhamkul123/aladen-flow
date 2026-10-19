import { Component, OnInit, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Board, Column, Card } from '../../core/models/board.model';
import { BoardService } from '../../core/services/board.service';
import { ThemeService } from '../../core/services/theme.service';
import { CardDetailModalComponent } from './card-detail-modal/card-detail-modal.component';

export interface CalendarDay {
  date: Date;
  dateStr: string;
  dayNum: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  cards: Card[];
}

export interface TimelineGroup {
  column: Column;
  cards: Card[];
}

@Component({
  selector: 'app-kanban-view',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, CardDetailModalComponent],
  templateUrl: './kanban-view.component.html',
  styleUrls: ['./kanban-view.component.css']
})
export class KanbanViewComponent implements OnInit {
  boardService = inject(BoardService);
  themeService = inject(ThemeService);
  private destroyRef = inject(DestroyRef);

  activeBoard = signal<Board | null>(null);
  addingCardColumnId: number | null = null;
  newCardTitle = '';
  selectedCard: Card | null = null;

  // View Mode: 'board' (Columns), 'calendar' (Month grid), 'timeline' (Gantt schedule)
  currentView = signal<'board' | 'calendar' | 'timeline'>('board');
  calendarDate = signal<Date>(new Date());

  calendarMonthLabel = computed(() => {
    return this.calendarDate().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  });

  allCards = computed(() => {
    const b = this.activeBoard();
    if (!b || !b.columns) return [];
    const res: Card[] = [];
    b.columns.forEach(col => {
      if (col.cards) res.push(...col.cards);
    });
    return res;
  });

  calendarDays = computed<CalendarDay[]>(() => {
    const baseDate = this.calendarDate();
    const year = baseDate.getFullYear();
    const month = baseDate.getMonth();
    const todayStr = new Date().toISOString().slice(0, 10);

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Monday is index 0
    let startDayOfWeek = firstDayOfMonth.getDay() - 1;
    if (startDayOfWeek === -1) startDayOfWeek = 6;

    const days: CalendarDay[] = [];
    const all = this.allCards();

    // Previous month padding
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const dNum = prevMonthLastDay - i;
      const d = new Date(year, month - 1, dNum);
      const dStr = d.toISOString().slice(0, 10);
      days.push({
        date: d,
        dateStr: dStr,
        dayNum: dNum,
        isCurrentMonth: false,
        isToday: dStr === todayStr,
        cards: all.filter(c => c.due_date === dStr)
      });
    }

    // Current month days
    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      const d = new Date(year, month, i);
      const dStr = d.toISOString().slice(0, 10);
      days.push({
        date: d,
        dateStr: dStr,
        dayNum: i,
        isCurrentMonth: true,
        isToday: dStr === todayStr,
        cards: all.filter(c => c.due_date === dStr)
      });
    }

    // Next month padding (total cells to reach multiple of 7, up to 35 or 42)
    const remaining = (7 - (days.length % 7)) % 7;
    for (let i = 1; i <= remaining; i++) {
      const d = new Date(year, month + 1, i);
      const dStr = d.toISOString().slice(0, 10);
      days.push({
        date: d,
        dateStr: dStr,
        dayNum: i,
        isCurrentMonth: false,
        isToday: dStr === todayStr,
        cards: all.filter(c => c.due_date === dStr)
      });
    }

    return days;
  });

  timelineCards = computed(() => {
    return this.allCards()
      .filter(c => !!c.due_date)
      .sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''));
  });

  prevMonth() {
    const d = new Date(this.calendarDate());
    d.setMonth(d.getMonth() - 1);
    this.calendarDate.set(d);
  }

  nextMonth() {
    const d = new Date(this.calendarDate());
    d.setMonth(d.getMonth() + 1);
    this.calendarDate.set(d);
  }

  goToToday() {
    this.calendarDate.set(new Date());
  }

  quickAddCardForDate(dateStr: string) {
    const b = this.activeBoard();
    if (!b || !b.columns || !b.columns.length) return;
    const title = prompt(`Enter title for new card due on ${dateStr}:`);
    if (!title || !title.trim()) return;

    const firstCol = b.columns[0];
    this.boardService.createCard(firstCol.id, {
      title: title.trim(),
      due_date: dateStr,
      priority: 'medium'
    }).subscribe({
      next: () => this.selectBoard(b.id)
    });
  }

  connectedDropLists = computed(() => {
    const b = this.activeBoard();
    if (!b || !b.columns) return [];
    return b.columns.map(c => 'col-' + c.id);
  });

  selectedTagFilter = this.boardService.selectedTagFilter;

  filteredColumns = computed(() => {
    const b = this.activeBoard();
    if (!b || !b.columns) return [];
    const q = this.boardService.searchQuery().trim().toLowerCase();
    const tagFilter = this.selectedTagFilter();

    return b.columns.map(c => {
      let cards = c.cards || [];
      if (tagFilter) {
        cards = cards.filter(card =>
          card.labels && card.labels.some(l => l.name.toLowerCase() === tagFilter.toLowerCase())
        );
      }
      if (q) {
        cards = cards.filter(card =>
          card.title.toLowerCase().includes(q) ||
          (card.description && card.description.toLowerCase().includes(q)) ||
          (card.labels && card.labels.some(l => l.name.toLowerCase().includes(q)))
        );
      }
      return { ...c, cards };
    });
  });

  toggleTagFilter(tagName: string) {
    if (this.selectedTagFilter()?.toLowerCase() === tagName.toLowerCase()) {
      this.selectedTagFilter.set(null);
    } else {
      this.selectedTagFilter.set(tagName);
    }
  }

  clearTagFilter() {
    this.selectedTagFilter.set(null);
  }

  onCardTagClick(tagName: string, event: MouseEvent) {
    event.stopPropagation();
    this.toggleTagFilter(tagName);
  }


  constructor() {
    effect(() => {
      const id = this.boardService.activeBoardId();
      if (id) {
        this.selectBoard(id);
      }
    });
  }

  ngOnInit() {
    this.boardService.getBoards().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => {
        this.boardService.boards.set(list);
        if (list.length > 0) {
          const currentId = this.boardService.activeBoardId();
          const targetId = list.some(b => b.id === currentId) ? currentId : list[0].id;
          this.boardService.activeBoardId.set(targetId);
        }
      },
      error: (err) => console.error('Failed to load boards:', err)
    });
  }

  selectBoard(id: number) {
    this.boardService.getBoard(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (fullBoard) => {
        if (fullBoard.columns) {
          fullBoard.columns.sort((a, b) => a.position - b.position);
          fullBoard.columns.forEach(c => {
            c.cards = (fullBoard.cards || []).filter(cd => cd.column_id === c.id);
            c.cards.sort((a, b) => a.position - b.position);
          });
        }
        this.activeBoard.set(fullBoard);
        if (this.selectedCard) {
          const fresh = (fullBoard.cards || []).find(c => c.id === this.selectedCard!.id);
          if (fresh) {
            this.selectedCard = fresh;
          }
        }
      },
      error: (err) => console.error('Failed to load board details:', err)
    });
  }

  openAddColumnPrompt() {
    const b = this.activeBoard();
    if (!b) return;
    const name = prompt('Column name:');
    if (name && name.trim()) {
      this.boardService.createColumn(b.id, name.trim()).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => this.selectBoard(b.id),
        error: (err) => console.error('Failed to create column:', err)
      });
    }
  }

  editingColumnId: number | null = null;

  startEditingColumn(columnId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.editingColumnId = columnId;
  }

  finishEditingColumn(col: Column, event: Event) {
    this.editingColumnId = null;
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim() || col.name;
    if (newName !== col.name) {
      this.boardService.updateColumn(col.id, newName).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          col.name = newName;
          const b = this.activeBoard();
          if (b && b.columns) {
            this.activeBoard.set({ ...b, columns: [...b.columns] });
          }
        },
        error: (err) => console.error('Failed to rename column:', err)
      });
    }
  }

  onColumnTitleBlur(col: Column, event: Event) {
    this.finishEditingColumn(col, event);
  }

  deleteColumn(columnId: number) {
    if (!confirm('Delete this column and all its cards?')) return;
    this.boardService.deleteColumn(columnId).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        const b = this.activeBoard();
        if (b) this.selectBoard(b.id);
      },
      error: (err) => console.error('Failed to delete column:', err)
    });
  }

  openAddCardInput(columnId: number) {
    this.addingCardColumnId = columnId;
    this.newCardTitle = '';
  }

  cancelAddCard() {
    this.addingCardColumnId = null;
    this.newCardTitle = '';
  }

  createCard(columnId: number) {
    const title = this.newCardTitle.trim();
    if (!title) return;

    this.boardService.createCard(columnId, { title }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.cancelAddCard();
        const b = this.activeBoard();
        if (b) this.selectBoard(b.id);
      },
      error: (err) => console.error('Failed to create card:', err)
    });
  }

  selectCard(card: Card) {
    this.selectedCard = card;
  }

  onCardUpdated(updated: Card) {
    const b = this.activeBoard();
    if (!b) return;
    this.selectBoard(b.id);
  }

  onCardDeleted(deletedId: number) {
    const b = this.activeBoard();
    if (!b) return;
    this.selectBoard(b.id);
  }

  onLabelsChanged() {
    const b = this.activeBoard();
    if (!b) return;
    this.selectBoard(b.id);
  }

  onColumnDrop(event: CdkDragDrop<any>) {
    const b = this.activeBoard();
    if (!b || !b.columns) return;
    if (event.previousIndex === event.currentIndex) return;

    const newColumns = [...b.columns];
    moveItemInArray(newColumns, event.previousIndex, event.currentIndex);
    newColumns.forEach((c, idx) => { c.position = idx; });

    // Explicitly update signal so computed() signals and the Angular template re-render!
    this.activeBoard.set({
      ...b,
      columns: newColumns
    });

    const orderedIds = newColumns.map(c => c.id);
    const movedCol = newColumns[event.currentIndex];
    this.boardService.moveColumns(movedCol.id, b.id, orderedIds).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      error: (err) => {
        console.error('Failed to persist column positions:', err);
        this.selectBoard(b.id);
      }
    });
  }

  onCardDrop(event: CdkDragDrop<Card[]>, targetColumnId: number) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      const card = event.container.data[event.currentIndex];
      const orderedIds = event.container.data.map(c => c.id);
      this.boardService.moveCards(card.id, targetColumnId, orderedIds).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    } else {
      transferArrayItem(
        event.previousContainer.data,
        event.container.data,
        event.previousIndex,
        event.currentIndex
      );
      const card = event.container.data[event.currentIndex];
      card.column_id = targetColumnId;
      const orderedIds = event.container.data.map(c => c.id);
      this.boardService.moveCards(card.id, targetColumnId, orderedIds).pipe(takeUntilDestroyed(this.destroyRef)).subscribe();
    }
  }

  getChecklistDone(card: Card): number {
    return (card.checklist || []).filter(i => i.checked).length;
  }
}
