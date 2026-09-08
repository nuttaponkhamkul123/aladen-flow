import { Component, Input, Output, EventEmitter, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Card, Label, ChecklistItem, Activity } from '../../../core/models/board.model';
import { BoardService } from '../../../core/services/board.service';

@Component({
  selector: 'app-card-detail-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './card-detail-modal.component.html',
  styleUrls: ['./card-detail-modal.component.css']
})
export class CardDetailModalComponent implements OnInit {
  @Input({ required: true }) card!: Card;
  @Input() boardLabels: Label[] = [];
  @Output() close = new EventEmitter<void>();
  @Output() cardUpdated = new EventEmitter<Card>();
  @Output() cardDeleted = new EventEmitter<number>();

  private boardService = inject(BoardService);

  activities: Activity[] = [];
  newChecklistText = '';

  ngOnInit() {
    this.loadActivities();
  }

  loadActivities() {
    this.boardService.getCardActivity(this.card.id).subscribe({
      next: acts => this.activities = acts,
      error: err => console.error('Failed to load card activity:', err)
    });
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal')) {
      this.close.emit();
    }
  }

  saveCardField(field: keyof Card) {
    const patchData: Partial<Card> = { [field]: this.card[field] };
    this.boardService.updateCard(this.card.id, patchData).subscribe({
      next: () => {
        this.cardUpdated.emit(this.card);
        this.loadActivities();
      },
      error: err => console.error(`Failed to update ${field}:`, err)
    });
  }

  setCover(val: string) {
    this.card.cover = val;
    this.saveCardField('cover');
  }

  toggleChecklistItem(item: ChecklistItem) {
    item.checked = !item.checked;
    this.boardService.updateChecklistItem(item.id, { checked: item.checked }).subscribe({
      next: () => this.cardUpdated.emit(this.card),
      error: err => console.error('Failed to update checklist item:', err)
    });
  }

  addChecklist() {
    const text = this.newChecklistText.trim();
    if (!text) return;
    this.boardService.addChecklistItem(this.card.id, text).subscribe({
      next: (newItem) => {
        if (!this.card.checklist) this.card.checklist = [];
        this.card.checklist.push(newItem);
        this.newChecklistText = '';
        this.cardUpdated.emit(this.card);
        this.loadActivities();
      },
      error: err => console.error('Failed to add checklist item:', err)
    });
  }

  deleteChecklistItem(id: number) {
    this.boardService.deleteChecklistItem(id).subscribe({
      next: () => {
        if (this.card.checklist) {
          this.card.checklist = this.card.checklist.filter(i => i.id !== id);
        }
        this.cardUpdated.emit(this.card);
        this.loadActivities();
      },
      error: err => console.error('Failed to delete checklist item:', err)
    });
  }

  hasLabel(labelId: number): boolean {
    return (this.card.labels || []).some(l => l.id === labelId);
  }

  toggleLabel(labelId: number) {
    const current = (this.card.labels || []).map(l => l.id);
    const exists = current.includes(labelId);
    const updatedIds = exists ? current.filter(id => id !== labelId) : [...current, labelId];

    this.boardService.updateCard(this.card.id, { labelIds: updatedIds }).subscribe({
      next: () => {
        if (exists) {
          this.card.labels = (this.card.labels || []).filter(l => l.id !== labelId);
        } else {
          const found = this.boardLabels.find(l => l.id === labelId);
          if (found) {
            this.card.labels = [...(this.card.labels || []), found];
          }
        }
        this.cardUpdated.emit(this.card);
      },
      error: err => console.error('Failed to update card labels:', err)
    });
  }

  deleteCard() {
    if (!confirm(`Delete card "${this.card.title}"?`)) return;
    this.boardService.deleteCard(this.card.id).subscribe({
      next: () => {
        this.cardDeleted.emit(this.card.id);
        this.close.emit();
      },
      error: err => console.error('Failed to delete card:', err)
    });
  }
}
