import { Component, OnInit, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Board, Column, Card } from '../../core/models/board.model';
import { BoardService } from '../../core/services/board.service';
import { ThemeService } from '../../core/services/theme.service';
import { CardDetailModalComponent } from './card-detail-modal/card-detail-modal.component';

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

  isDraggingCard = false;

  onCardMouseMove(event: MouseEvent, cardEl: HTMLElement) {
    if (this.isDraggingCard || cardEl.classList.contains('cdk-drag-dragging')) return;
    const rect = cardEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    // Fluid 3D tilt angles (-11deg to +11deg)
    const rotateX = ((0.5 - y) * 14).toFixed(2);
    const rotateY = ((x - 0.5) * 16).toFixed(2);
    const glareX = (x * 100).toFixed(1);
    const glareY = (y * 100).toFixed(1);

    cardEl.style.setProperty('--rx', `${rotateX}deg`);
    cardEl.style.setProperty('--ry', `${rotateY}deg`);
    cardEl.style.setProperty('--mx', `${glareX}%`);
    cardEl.style.setProperty('--my', `${glareY}%`);
    cardEl.style.setProperty('--card-hover', '1');
  }

  onCardMouseLeave(cardEl: HTMLElement) {
    cardEl.style.setProperty('--rx', '0deg');
    cardEl.style.setProperty('--ry', '0deg');
    cardEl.style.setProperty('--mx', '50%');
    cardEl.style.setProperty('--my', '50%');
    cardEl.style.setProperty('--card-hover', '0');
  }

  onCardDragStarted(cardEl: HTMLElement) {
    this.isDraggingCard = true;
    this.onCardMouseLeave(cardEl);
  }

  onCardDragEnded(cardEl: HTMLElement) {
    this.isDraggingCard = false;
    this.onCardMouseLeave(cardEl);
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
    this.isDraggingCard = false;
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
