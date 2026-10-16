import { Component, Input, Output, EventEmitter, OnInit, inject, DestroyRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Card, Label, ChecklistItem, Activity } from '../../../core/models/board.model';
import { BoardService } from '../../../core/services/board.service';
import { parseMarkdown, MarkdownBlock, markdownToBlocks, blocksToMarkdown } from '../../../core/utils/markdown.util';

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
  @Output() labelsChanged = new EventEmitter<void>();

  private boardService = inject(BoardService);
  private destroyRef = inject(DestroyRef);
  private domSanitizer = inject(DomSanitizer);

  activities: Activity[] = [];
  newChecklistText = '';

  // Mode: Block Editor, Rendered Preview, or Raw Markdown
  descriptionMode: 'blocks' | 'preview' | 'raw' = 'blocks';

  // Markdown Block State
  blocks: MarkdownBlock[] = [];
  activeBlockMenuId: string | null = null;
  slashMenuBlockId: string | null = null;
  slashQuery = '';
  selectedSlashIndex = 0;
  private saveDebounceTimer: any = null;

  // Drag & Drop State for moving markdown blocks
  draggedBlockIndex: number | null = null;
  dragOverBlockIndex: number | null = null;
  dragDropPosition: 'before' | 'after' | null = null;

  @HostListener('document:click')
  onDocumentClick() {
    this.activeBlockMenuId = null;
    this.slashMenuBlockId = null;
  }

  readonly slashCommands: { type: MarkdownBlock['type']; label: string; icon: string; desc: string }[] = [
    { type: 'text', label: 'Text', icon: '¶', desc: 'Plain text paragraph' },
    { type: 'h1', label: 'Heading 1', icon: 'H1', desc: 'Large section heading' },
    { type: 'h2', label: 'Heading 2', icon: 'H2', desc: 'Medium section heading' },
    { type: 'h3', label: 'Heading 3', icon: 'H3', desc: 'Small section heading' },
    { type: 'todo', label: 'To-do list', icon: '☑', desc: 'Track tasks with checkboxes' },
    { type: 'bullet', label: 'Bulleted list', icon: '•', desc: 'Create a bulleted list' },
    { type: 'quote', label: 'Quote', icon: '“', desc: 'Capture a quote or insight' },
    { type: 'callout', label: 'Callout', icon: '💡', desc: 'Highlight critical notes' },
    { type: 'code', label: 'Code', icon: '{ }', desc: 'Technical snippet with syntax' },
    { type: 'divider', label: 'Divider', icon: '—', desc: 'Visual divider line' },
  ];

  // Custom tag creation & filtering
  showTagCreator = false;
  newTagName = '';
  newTagColor = '#52b8a6';
  tagSearchQuery = '';

  readonly presetColors = [
    '#52b8a6', // Studio Verdigris
    '#5aa469', // Sage Green
    '#d99a3d', // Warm Amber
    '#e0574f', // Terracotta Red
    '#6b9bc4', // Slate Blue
    '#9d7cd8', // Soft Lilac
    '#d67096', // Dusty Rose
    '#8d8880'  // Warm Graphite
  ];

  ngOnInit() {
    this.loadActivities();
    this.initBlocksFromDescription();
  }

  initBlocksFromDescription() {
    this.blocks = markdownToBlocks(this.card.description);
    setTimeout(() => {
      document.querySelectorAll<HTMLTextAreaElement>('.blocks-document-canvas textarea').forEach(ta => {
        this.autoResizeBlock(ta);
      });
    }, 60);
  }

  syncBlocksToMarkdown(saveToBackend: boolean = true, debounce: boolean = false) {
    this.card.description = blocksToMarkdown(this.blocks);
    if (!saveToBackend) return;

    if (debounce) {
      if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = setTimeout(() => {
        this.saveCardField('description');
      }, 400);
    } else {
      if (this.saveDebounceTimer) clearTimeout(this.saveDebounceTimer);
      this.saveCardField('description');
    }
  }

  switchMode(mode: 'blocks' | 'preview' | 'raw') {
    if (this.descriptionMode === 'blocks' && mode === 'raw') {
      this.syncBlocksToMarkdown(false);
    } else if (this.descriptionMode === 'raw' && mode === 'blocks') {
      this.initBlocksFromDescription();
    } else if (mode === 'preview') {
      this.syncBlocksToMarkdown(false);
    }
    this.descriptionMode = mode;
    this.activeBlockMenuId = null;
    this.slashMenuBlockId = null;
  }

  // Auto-resize block textarea to fit contents without internal scrollbars
  autoResizeBlock(el: HTMLTextAreaElement) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  // Drag and drop handlers to move markdown blocks
  onBlockDragStart(event: DragEvent, index: number) {
    this.draggedBlockIndex = index;
    this.activeBlockMenuId = null;
    this.slashMenuBlockId = null;

    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', `${index}`);
      const row = (event.target as HTMLElement).closest('.block-row') as HTMLElement;
      if (row) {
        event.dataTransfer.setDragImage(row, 20, 20);
      }
    }
  }

  onBlockDragOver(event: DragEvent, index: number) {
    if (this.draggedBlockIndex === null || this.draggedBlockIndex === index) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    this.dragOverBlockIndex = index;
    const targetEl = event.currentTarget as HTMLElement;
    const rect = targetEl.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    this.dragDropPosition = event.clientY < midY ? 'before' : 'after';
  }

  onBlockDragLeave(event: DragEvent, index: number) {
    if (this.dragOverBlockIndex === index) {
      this.dragOverBlockIndex = null;
      this.dragDropPosition = null;
    }
  }

  onBlockDrop(event: DragEvent, index: number) {
    event.preventDefault();
    if (this.draggedBlockIndex === null || this.draggedBlockIndex === index) {
      this.onBlockDragEnd();
      return;
    }

    const fromIdx = this.draggedBlockIndex;
    let toIdx = index;
    if (this.dragDropPosition === 'after' && fromIdx > toIdx) {
      toIdx++;
    } else if (this.dragDropPosition === 'before' && fromIdx < toIdx) {
      toIdx--;
    }

    const [movedBlock] = this.blocks.splice(fromIdx, 1);
    this.blocks.splice(toIdx, 0, movedBlock);

    this.onBlockDragEnd();
    this.syncBlocksToMarkdown(true, false);
  }

  onBlockDragEnd() {
    this.draggedBlockIndex = null;
    this.dragOverBlockIndex = null;
    this.dragDropPosition = null;
  }

  onBlockInput(block: MarkdownBlock, textarea: HTMLTextAreaElement) {
    this.autoResizeBlock(textarea);

    // Detect if slash command triggered at end
    if (block.text.endsWith('/')) {
      this.slashMenuBlockId = block.id;
      this.slashQuery = '';
      this.selectedSlashIndex = 0;
    } else if (this.slashMenuBlockId === block.id) {
      const match = block.text.match(/\/([a-zA-Z0-9]*)$/);
      if (match) {
        this.slashQuery = match[1].toLowerCase();
        this.selectedSlashIndex = 0;
      } else {
        this.slashMenuBlockId = null;
        this.selectedSlashIndex = 0;
      }
    }

    this.syncBlocksToMarkdown(true, true);
  }

  onBlockKeydown(event: KeyboardEvent, index: number, block: MarkdownBlock) {
    // If slash command menu is open, handle keyboard navigation and Enter
    if (this.slashMenuBlockId === block.id) {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.slashMenuBlockId = null;
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const total = this.filteredSlashCommands.length;
        if (total > 0) {
          this.selectedSlashIndex = (this.selectedSlashIndex + 1) % total;
        }
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const total = this.filteredSlashCommands.length;
        if (total > 0) {
          this.selectedSlashIndex = (this.selectedSlashIndex - 1 + total) % total;
        }
        return;
      }

      if (event.key === 'Enter') {
        event.preventDefault();
        const cmd = this.filteredSlashCommands[this.selectedSlashIndex];
        if (cmd) {
          this.applySlashCommand(block, cmd.type);
        } else {
          this.slashMenuBlockId = null;
        }
        return;
      }
    }

    // Escape closes active block menu
    if (event.key === 'Escape') {
      this.activeBlockMenuId = null;
      return;
    }

    // Enter key: create a new block below
    if (event.key === 'Enter' && !event.shiftKey) {
      if (block.type === 'code') {
        // In code blocks, Enter adds a newline inside the code
        return;
      }

      event.preventDefault();
      this.slashMenuBlockId = null;

      // Maintain list or todo continuation if not empty
      let nextType: MarkdownBlock['type'] = 'text';
      if ((block.type === 'todo' || block.type === 'bullet') && block.text.trim()) {
        nextType = block.type;
      }

      this.addBlockBelow(index, nextType);
      return;
    }

    // Backspace handling
    if (event.key === 'Backspace') {
      const target = event.target as HTMLTextAreaElement;
      const atStart = !target || (target.selectionStart === 0 && target.selectionEnd === 0);

      // If at start of a formatted block (heading, bullet, quote, etc), turn it back to plain text
      if (atStart && block.type !== 'text') {
        event.preventDefault();
        block.type = 'text';
        this.syncBlocksToMarkdown(true, false);
        return;
      }

      // If text block is empty and we have multiple blocks, delete it and focus previous block
      if ((!block.text || block.text === '') && this.blocks.length > 1) {
        event.preventDefault();
        this.slashMenuBlockId = null;
        this.deleteBlock(index);

        setTimeout(() => {
          const prevIdx = Math.max(0, index - 1);
          const prevEl = document.querySelector(`[data-block-idx="${prevIdx}"] textarea`) as HTMLTextAreaElement;
          if (prevEl) {
            prevEl.focus();
            prevEl.setSelectionRange(prevEl.value.length, prevEl.value.length);
          }
        }, 30);
        return;
      }
    }
  }

  applySlashCommand(block: MarkdownBlock, type: MarkdownBlock['type']) {
    block.type = type;
    // Strip trailing slash and command query
    block.text = block.text.replace(/\/[a-zA-Z0-9]*$/, '').trim();
    this.slashMenuBlockId = null;
    this.selectedSlashIndex = 0;
    this.syncBlocksToMarkdown(true, false);

    setTimeout(() => {
      const idx = this.blocks.indexOf(block);
      const el = document.querySelector(`[data-block-idx="${idx}"] textarea`) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        this.autoResizeBlock(el);
      }
    }, 40);
  }

  setBlockType(block: MarkdownBlock, type: MarkdownBlock['type']) {
    block.type = type;
    this.activeBlockMenuId = null;
    this.slashMenuBlockId = null;
    this.syncBlocksToMarkdown(true, false);
  }

  toggleTodoBlock(block: MarkdownBlock) {
    block.checked = !block.checked;
    this.syncBlocksToMarkdown(true, false);
  }

  addBlockBelow(index: number, type: MarkdownBlock['type'] = 'text') {
    const newId = `block_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newBlock: MarkdownBlock = {
      id: newId,
      type,
      text: '',
      checked: false
    };

    this.blocks.splice(index + 1, 0, newBlock);
    this.syncBlocksToMarkdown(true, false);

    setTimeout(() => {
      const el = document.querySelector(`[data-block-idx="${index + 1}"] textarea`) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        this.autoResizeBlock(el);
      }
    }, 40);
  }

  deleteBlock(index: number) {
    this.activeBlockMenuId = null;
    this.blocks.splice(index, 1);
    if (this.blocks.length === 0) {
      this.blocks.push({ id: `block_${Date.now()}`, type: 'text', text: '' });
    }
    this.syncBlocksToMarkdown(true, false);
  }

  duplicateBlock(index: number) {
    const src = this.blocks[index];
    const copy: MarkdownBlock = {
      ...src,
      id: `block_${Date.now()}_copy`,
      text: src.text
    };
    this.blocks.splice(index + 1, 0, copy);
    this.activeBlockMenuId = null;
    this.syncBlocksToMarkdown(true, false);
  }

  moveBlock(index: number, delta: number) {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= this.blocks.length) return;
    const [item] = this.blocks.splice(index, 1);
    this.blocks.splice(targetIdx, 0, item);
    this.activeBlockMenuId = null;
    this.syncBlocksToMarkdown(true, false);
  }

  toggleBlockMenu(blockId: string, event: MouseEvent) {
    event.stopPropagation();
    this.activeBlockMenuId = this.activeBlockMenuId === blockId ? null : blockId;
  }

  onCanvasClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('blocks-document-canvas')) {
      const lastIdx = this.blocks.length - 1;
      if (lastIdx >= 0) {
        const lastBlock = this.blocks[lastIdx];
        if (lastBlock.text && lastBlock.text.trim()) {
          this.addBlockBelow(lastIdx);
        } else {
          const el = document.querySelector(`[data-block-idx="${lastIdx}"] textarea`) as HTMLTextAreaElement;
          if (el) el.focus();
        }
      }
    }
  }

  get filteredSlashCommands() {
    if (!this.slashQuery) return this.slashCommands;
    return this.slashCommands.filter(c =>
      c.label.toLowerCase().includes(this.slashQuery) || c.type.toLowerCase().includes(this.slashQuery)
    );
  }

  get parsedDescriptionHtml(): SafeHtml {
    return this.domSanitizer.bypassSecurityTrustHtml(parseMarkdown(this.card.description));
  }

  // Floating bubble toolbar for highlighted blocks
  floatingToolbarVisible = false;
  floatingToolbarPos = { top: 0, left: 0 };
  activeHighlightText = '';

  onEditorSelectionChange(textarea: HTMLTextAreaElement, container: HTMLElement) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value.substring(start, end).trim();

    if (text.length > 0) {
      this.activeHighlightText = text;
      // Calculate position above textarea selection
      const top = Math.max(6, textarea.offsetTop - 36);
      const left = Math.min(container.clientWidth - 290, Math.max(12, textarea.offsetLeft + 20));
      this.floatingToolbarPos = { top, left };
      this.floatingToolbarVisible = true;
    } else {
      this.floatingToolbarVisible = false;
    }
  }

  onPreviewBlockClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const blockEl = target.closest('p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, tr');
    this.switchMode('blocks');
    if (!blockEl) return;

    const blockText = (blockEl.textContent || '').trim().slice(0, 30);
    const matchingIdx = this.blocks.findIndex(b => b.text && b.text.includes(blockText));
    setTimeout(() => {
      const idxToFocus = matchingIdx !== -1 ? matchingIdx : 0;
      const el = document.querySelector(`[data-block-idx="${idxToFocus}"] textarea`) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        this.autoResizeBlock(el);
      }
    }, 60);
  }

  alterBlock(action: string, textarea: HTMLTextAreaElement) {
    if (!this.card.description) this.card.description = '';
    const desc = this.card.description;
    let start = textarea.selectionStart;
    let end = textarea.selectionEnd;

    // If no text selected, expand to current line
    if (start === end) {
      const lineStart = desc.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = desc.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = desc.length;
      start = lineStart;
      end = lineEnd;
    }

    const selectedText = desc.substring(start, end);
    let newText = '';

    if (action === 'bold') {
      if (selectedText.startsWith('**') && selectedText.endsWith('**') && selectedText.length >= 4) {
        newText = selectedText.slice(2, -2);
      } else {
        newText = `**${selectedText}**`;
      }
    } else if (action === 'italic') {
      if (selectedText.startsWith('*') && selectedText.endsWith('*') && selectedText.length >= 2 && !selectedText.startsWith('**')) {
        newText = selectedText.slice(1, -1);
      } else {
        newText = `*${selectedText}*`;
      }
    } else if (action === 'code') {
      if (selectedText.startsWith('`') && selectedText.endsWith('`') && selectedText.length >= 2) {
        newText = selectedText.slice(1, -1);
      } else {
        newText = `\`${selectedText}\``;
      }
    } else if (action === 'codeblock') {
      if (selectedText.startsWith('```') && selectedText.endsWith('```')) {
        newText = selectedText.replace(/^```[a-zA-Z0-9_-]*\r?\n?/, '').replace(/\r?\n?```$/, '');
      } else {
        newText = `\`\`\`ts\n${selectedText}\n\`\`\``;
      }
    } else if (action === 'h1' || action === 'h2' || action === 'h3') {
      const prefix = action === 'h1' ? '# ' : action === 'h2' ? '## ' : '### ';
      const lineStart = desc.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = desc.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = desc.length;

      const lines = desc.substring(lineStart, lineEnd).split('\n');
      const transformedLines = lines.map(line => {
        const clean = line.replace(/^#{1,6}\s+/, '');
        return line.startsWith(prefix) ? clean : prefix + clean;
      });

      newText = transformedLines.join('\n');
      this.card.description = desc.substring(0, lineStart) + newText + desc.substring(lineEnd);
      this.saveCardField('description');
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart, lineStart + newText.length);
      }, 0);
      return;
    } else if (action === 'list') {
      const lineStart = desc.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = desc.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = desc.length;

      const lines = desc.substring(lineStart, lineEnd).split('\n');
      const allBulleted = lines.every(l => /^[-*]\s+/.test(l));
      const transformedLines = lines.map(line => {
        return allBulleted ? line.replace(/^[-*]\s+/, '') : `- ${line.replace(/^[-*]\s+/, '')}`;
      });

      newText = transformedLines.join('\n');
      this.card.description = desc.substring(0, lineStart) + newText + desc.substring(lineEnd);
      this.saveCardField('description');
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart, lineStart + newText.length);
      }, 0);
      return;
    } else if (action === 'task') {
      const lineStart = desc.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = desc.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = desc.length;

      const lines = desc.substring(lineStart, lineEnd).split('\n');
      const transformedLines = lines.map(line => {
        if (line.startsWith('- [ ] ')) return line.replace('- [ ] ', '- [x] ');
        if (line.startsWith('- [x] ') || line.startsWith('- [X] ')) return line.replace(/^-\s+\[[xX]\]\s+/, '');
        return `- [ ] ${line.replace(/^[-*]\s+/, '')}`;
      });

      newText = transformedLines.join('\n');
      this.card.description = desc.substring(0, lineStart) + newText + desc.substring(lineEnd);
      this.saveCardField('description');
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart, lineStart + newText.length);
      }, 0);
      return;
    } else if (action === 'quote') {
      const lineStart = desc.lastIndexOf('\n', start - 1) + 1;
      let lineEnd = desc.indexOf('\n', end);
      if (lineEnd === -1) lineEnd = desc.length;

      const lines = desc.substring(lineStart, lineEnd).split('\n');
      const allQuoted = lines.every(l => l.startsWith('> ') || l.startsWith('>'));
      const transformedLines = lines.map(line => {
        return allQuoted ? line.replace(/^>\s?/, '') : `> ${line.replace(/^>\s?/, '')}`;
      });

      newText = transformedLines.join('\n');
      this.card.description = desc.substring(0, lineStart) + newText + desc.substring(lineEnd);
      this.saveCardField('description');
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(lineStart, lineStart + newText.length);
      }, 0);
      return;
    } else if (action === 'link') {
      newText = `[${selectedText || 'link text'}](https://)`;
    } else if (action === 'strip') {
      newText = selectedText
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/\*([^*]+)\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/^[-*]\s+(\[[ xX]\]\s+)?/gm, '')
        .replace(/^>\s?/gm, '');
    }

    this.card.description = desc.substring(0, start) + newText + desc.substring(end);
    this.saveCardField('description');
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start, start + newText.length);
    }, 0);
  }

  insertMarkdown(prefix: string, suffix: string = '', defaultText: string = '', textarea?: HTMLTextAreaElement) {
    if (textarea && textarea.selectionStart !== textarea.selectionEnd) {
      this.alterBlock(prefix === '**' ? 'bold' : prefix === '*' ? 'italic' : prefix === '`' ? 'code' : 'link', textarea);
      return;
    }

    if (!this.card.description) {
      this.card.description = '';
    }

    if (textarea) {
      const start = textarea.selectionStart || 0;
      const end = textarea.selectionEnd || 0;
      const selected = this.card.description.substring(start, end) || defaultText;
      const replacement = `${prefix}${selected}${suffix}`;
      this.card.description =
        this.card.description.substring(0, start) + replacement + this.card.description.substring(end);
      setTimeout(() => {
        textarea.focus();
        textarea.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
      }, 0);
    } else {
      this.card.description = (this.card.description ? this.card.description + '\n' : '') + `${prefix}${defaultText}${suffix}`;
    }
    this.saveCardField('description');
  }

  loadActivities() {
    this.boardService.getCardActivity(this.card.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.boardService.updateCard(this.card.id, patchData).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.boardService.updateChecklistItem(item.id, { checked: item.checked }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.cardUpdated.emit(this.card),
      error: err => console.error('Failed to update checklist item:', err)
    });
  }

  addChecklist() {
    const text = this.newChecklistText.trim();
    if (!text) return;
    this.boardService.addChecklistItem(this.card.id, text).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.boardService.deleteChecklistItem(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

    this.boardService.updateCard(this.card.id, { labelIds: updatedIds }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
        this.loadActivities();
      },
      error: err => console.error('Failed to update card labels:', err)
    });
  }

  createCustomTag() {
    const name = this.newTagName.trim();
    if (!name) return;
    const color = this.newTagColor.trim() || '#3b82f6';

    this.boardService.addTagToCard(this.card.id, { name, color })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (tag) => {
          if (!this.boardLabels.some(l => l.id === tag.id)) {
            this.boardLabels = [...this.boardLabels, tag];
          }
          if (!this.card.labels) this.card.labels = [];
          if (!this.card.labels.some(l => l.id === tag.id)) {
            this.card.labels = [...this.card.labels, tag];
          }
          this.newTagName = '';
          this.showTagCreator = false;
          this.cardUpdated.emit(this.card);
          this.labelsChanged.emit();
          this.loadActivities();
        },
        error: (err) => console.error('Failed to create custom tag:', err)
      });
  }

  removeLabelFromCard(labelId: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.boardService.removeTagFromCard(this.card.id, labelId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.card.labels = (this.card.labels || []).filter(l => l.id !== labelId);
          this.cardUpdated.emit(this.card);
          this.loadActivities();
        },
        error: (err) => console.error('Failed to remove tag from card:', err)
      });
  }

  deleteBoardLabel(labelId: number, event: MouseEvent) {
    event.stopPropagation();
    const tag = this.boardLabels.find(l => l.id === labelId);
    const tagName = tag ? tag.name : 'this tag';
    if (!confirm(`Delete tag "${tagName}" from board?`)) return;

    this.boardService.deleteLabel(labelId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.boardLabels = this.boardLabels.filter(l => l.id !== labelId);
          this.card.labels = (this.card.labels || []).filter(l => l.id !== labelId);
          this.cardUpdated.emit(this.card);
          this.labelsChanged.emit();
        },
        error: (err) => console.error('Failed to delete label:', err)
      });
  }

  get filteredBoardLabels(): Label[] {
    const q = this.tagSearchQuery.trim().toLowerCase();
    if (!q) return this.boardLabels;
    return this.boardLabels.filter(l => l.name.toLowerCase().includes(q));
  }

  deleteCard() {
    if (!confirm(`Delete card "${this.card.title}"?`)) return;
    this.boardService.deleteCard(this.card.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.cardDeleted.emit(this.card.id);
        this.close.emit();
      },
      error: err => console.error('Failed to delete card:', err)
    });
  }
}
