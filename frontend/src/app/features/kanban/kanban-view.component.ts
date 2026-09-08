import { Component, OnInit, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray, transferArrayItem } from '@angular/cdk/drag-drop';
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

  activeBoard = signal<Board | null>(null);
  addingCardColumnId: number | null = null;
  newCardTitle = '';
  selectedCard: Card | null = null;

  connectedDropLists = computed(() => {
    const b = this.activeBoard();
    if (!b || !b.columns) return [];
    return b.columns.map(c => 'col-' + c.id);
  });

  filteredColumns = computed(() => {
    const b = this.activeBoard();
    if (!b || !b.columns) return [];
    const q = this.boardService.searchQuery().trim().toLowerCase();
    if (!q) return b.columns;

    return b.columns.map(c => {
      const matchingCards = (c.cards || []).filter(card =>
        card.title.toLowerCase().includes(q) ||
        (card.description && card.description.toLowerCase().includes(q)) ||
        (card.labels && card.labels.some(l => l.name.toLowerCase().includes(q)))
      );
      return { ...c, cards: matchingCards };
    });
  });

  constructor() {
    effect(() => {
      const id = this.boardService.activeBoardId();
      if (id) {
        this.selectBoard(id);
      }
    });
  }

  ngOnInit() {
    this.boardService.getBoards().subscribe({
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
    this.boardService.getBoard(id).subscribe({
      next: (fullBoard) => {
        if (fullBoard.columns) {
          fullBoard.columns.sort((a, b) => a.position - b.position);
          fullBoard.columns.forEach(c => {
            c.cards = (fullBoard.cards || []).filter(cd => cd.column_id === c.id);
            c.cards.sort((a, b) => a.position - b.position);
          });
        }
        this.activeBoard.set(fullBoard);
      },
      error: (err) => console.error('Failed to load board details:', err)
    });
  }

  openAddColumnPrompt() {
    const b = this.activeBoard();
    if (!b) return;
    const name = prompt('Column name:');
    if (name && name.trim()) {
      this.boardService.createColumn(b.id, name.trim()).subscribe({
        next: () => this.selectBoard(b.id),
        error: (err) => console.error('Failed to create column:', err)
      });
    }
  }

  onColumnTitleBlur(col: Column, event: Event) {
    const input = event.target as HTMLInputElement;
    const newName = input.value.trim() || col.name;
    if (newName !== col.name) {
      this.boardService.updateColumn(col.id, newName).subscribe({
        next: () => { col.name = newName; },
        error: (err) => console.error('Failed to rename column:', err)
      });
    }
  }

  deleteColumn(columnId: number) {
    if (!confirm('Delete this column and all its cards?')) return;
    this.boardService.deleteColumn(columnId).subscribe({
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

    this.boardService.createCard(columnId, { title }).subscribe({
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

  onColumnDrop(event: CdkDragDrop<Column[]>) {
    const b = this.activeBoard();
    if (!b || !b.columns) return;
    moveItemInArray(b.columns, event.previousIndex, event.currentIndex);
    const orderedIds = b.columns.map(c => c.id);
    const movedColId = b.columns[event.currentIndex].id;
    this.boardService.moveColumns(movedColId, b.id, orderedIds).subscribe();
  }

  onCardDrop(event: CdkDragDrop<Card[]>, targetColumnId: number) {
    if (event.previousContainer === event.container) {
      moveItemInArray(event.container.data, event.previousIndex, event.currentIndex);
      const card = event.container.data[event.currentIndex];
      const orderedIds = event.container.data.map(c => c.id);
      this.boardService.moveCards(card.id, targetColumnId, orderedIds).subscribe();
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
      this.boardService.moveCards(card.id, targetColumnId, orderedIds).subscribe();
    }
  }

  getChecklistDone(card: Card): number {
    return (card.checklist || []).filter(i => i.checked).length;
  }
}
