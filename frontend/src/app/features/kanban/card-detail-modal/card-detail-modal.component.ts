import { Component, Input, Output, EventEmitter, OnInit, inject, DestroyRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Card, Label, ChecklistItem, Activity } from '../../../core/models/board.model';
import { BoardService } from '../../../core/services/board.service';
import { CmsService } from '../../../core/services/cms.service';
import { CmsPage } from '../../../core/models/cms.model';
import { parseMarkdown, MarkdownBlock, markdownToBlocks, blocksToMarkdown, parseInlineMarkdown, generateBlockId } from '../../../core/utils/markdown.util';

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
  private cmsService = inject(CmsService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private domSanitizer = inject(DomSanitizer);

  activities: Activity[] = [];
  showActivityHistory = false;
  newChecklistText = '';

  toggleActivityHistory() {
    this.showActivityHistory = !this.showActivityHistory;
  }

  // Linked CMS Page State
  availableCmsPages: CmsPage[] = [];
  linkedCmsPage: CmsPage | null = null;

  // Document Blocks State (Unified Single-View Block System)
  blocks: MarkdownBlock[] = [];
  editingBlockId: string | null = null;
  activeBlockMenuId: string | null = null;
  slashMenuBlockId: string | null = null;
  slashQuery = '';
  selectedSlashIndex = 0;
  private saveDebounceTimer: any = null;

  startEditingBlock(blockId: string, idx: number) {
    this.editingBlockId = blockId;
    setTimeout(() => {
      const el = document.querySelector(`[data-block-idx="${idx}"] textarea`) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        this.autoResizeBlock(el);
      }
    }, 30);
  }

  stopEditingBlock() {
    this.editingBlockId = null;
    this.syncBlocksToMarkdown(true, false);
  }

  getRenderedBlockHtml(block: MarkdownBlock): SafeHtml {
    const text = block.text || '';
    if (!text.trim()) {
      return this.domSanitizer.bypassSecurityTrustHtml('<span class="block-empty-placeholder">Click to type...</span>');
    }
    return this.domSanitizer.bypassSecurityTrustHtml(parseInlineMarkdown(text));
  }


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
    this.loadCmsPages();
  }

  loadCmsPages() {
    this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (pages) => {
        this.availableCmsPages = pages;
        if (this.card.cms_page_id) {
          this.linkedCmsPage = pages.find(p => p.id === this.card.cms_page_id) || null;
        }
      },
      error: (err) => console.error('Failed to load CMS pages for card:', err)
    });
  }

  onLinkCmsPage(event: any) {
    const rawVal = event?.target ? event.target.value : event;
    const pageId = Number(rawVal) || null;
    this.card.cms_page_id = pageId;
    this.linkedCmsPage = this.availableCmsPages.find(p => p.id === pageId) || null;
    if (this.linkedCmsPage) {
      this.card.cms_page_title = this.linkedCmsPage.title;
      this.card.cms_page_slug = this.linkedCmsPage.slug;
      this.card.cms_page_status = this.linkedCmsPage.status;
    } else {
      this.card.cms_page_title = undefined;
      this.card.cms_page_slug = undefined;
      this.card.cms_page_status = undefined;
    }
    this.boardService.updateCard(this.card.id, { cms_page_id: pageId } as any).subscribe({
      next: () => {
        this.cardUpdated.emit(this.card);
        this.loadActivities();
      }
    });
  }

  createAndLinkCmsPage() {
    const title = this.card.title.trim() || 'New Content Page';
    this.cmsService.createPage(title).subscribe({
      next: (page) => {
        this.availableCmsPages.push(page);
        this.onLinkCmsPage(page.id);
      }
    });
  }

  goToCmsStudio(pageId?: number) {
    this.close.emit();
    if (pageId) {
      this.cmsService.switchPage(pageId);
    }
    this.router.navigate(['/cms']);
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
    this.recomputeBlockHierarchy();

    this.onBlockDragEnd();
    this.syncBlocksToMarkdown(true, false);
  }

  onBlockDragEnd() {
    this.draggedBlockIndex = null;
    this.dragOverBlockIndex = null;
    this.dragDropPosition = null;
  }

  onBlockInput(block: MarkdownBlock, textarea: HTMLTextAreaElement, idx: number) {
    this.autoResizeBlock(textarea);

    const val = block.text;

    // 1. Heading 1: '# '
    if (val.startsWith('# ')) {
      block.type = 'h1';
      block.text = val.slice(2);
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

    // 2. Heading 2: '## '
    if (val.startsWith('## ')) {
      block.type = 'h2';
      block.text = val.slice(3);
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

    // 3. Heading 3: '### '
    if (val.startsWith('### ')) {
      block.type = 'h3';
      block.text = val.slice(4);
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

    // 4. Todo checkbox: '- [ ] ' or '[] ' or '- [x] '
    if (val.startsWith('- [ ] ') || val.startsWith('[] ')) {
      block.type = 'todo';
      block.checked = false;
      block.text = val.replace(/^(-\s*\[\s*\]\s*|\[\s*\]\s*)/, '');
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }
    if (val.startsWith('- [x] ') || val.startsWith('- [X] ')) {
      block.type = 'todo';
      block.checked = true;
      block.text = val.replace(/^-\s*\[[xX]\]\s*/, '');
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

    // 5. Bullet list: '- ' or '* '
    if (val.startsWith('- ') || val.startsWith('* ')) {
      block.type = 'bullet';
      block.text = val.slice(2);
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

    // 6. Quote: '> '
    if (val.startsWith('> ')) {
      block.type = 'quote';
      block.text = val.slice(2);
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

    // 7. Divider: '---' or '***'
    if (val === '---' || val === '***') {
      block.type = 'divider';
      block.text = '';
      this.syncBlocksToMarkdown(true, false);
      this.addBlockBelow(idx, 'text');
      return;
    }

    // 8. Code block: '```'
    if (val.startsWith('```')) {
      block.type = 'code';
      block.lang = val.slice(3).trim() || 'ts';
      block.text = '';
      this.syncBlocksToMarkdown(true, false);
      setTimeout(() => { textarea.value = block.text; this.autoResizeBlock(textarea); }, 0);
      return;
    }

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

  onBlockPaste(event: ClipboardEvent, index: number) {
    const text = event.clipboardData?.getData('text');
    if (!text) return;

    // If pasted text has multiple lines or contains markdown headers/lists/code
    if (text.includes('\n') || /^#{1,6}\s|^\s*[-*]\s|^>\s|^```/m.test(text)) {
      event.preventDefault();
      const parsed = markdownToBlocks(text);
      if (parsed.length > 0) {
        if (this.blocks[index].type === 'text' && !this.blocks[index].text.trim()) {
          this.blocks.splice(index, 1, ...parsed);
        } else {
          this.blocks.splice(index + 1, 0, ...parsed);
        }
        this.syncBlocksToMarkdown(true, false);
        setTimeout(() => {
          document.querySelectorAll<HTMLTextAreaElement>('.blocks-document-canvas textarea').forEach(ta => {
            this.autoResizeBlock(ta);
          });
        }, 50);
      }
    }
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

    // Tab key: Indent (become child) or Outdent (Shift+Tab)
    if (event.key === 'Tab') {
      event.preventDefault();
      if (event.shiftKey) {
        this.outdentBlock(index);
      } else {
        this.indentBlock(index);
      }
      return;
    }

    // Backspace handling
    if (event.key === 'Backspace') {
      const target = event.target as HTMLTextAreaElement;
      const atStart = !target || (target.selectionStart === 0 && target.selectionEnd === 0);

      // If at start of an indented child block, outdent it first before turning to text / deleting
      if (atStart && (block.level || 0) > 0) {
        event.preventDefault();
        this.outdentBlock(index);
        return;
      }

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

  recomputeBlockHierarchy() {
    const parentStack: { [level: number]: string } = {};
    for (const b of this.blocks) {
      b.level = Math.max(0, Math.min(b.level || 0, 4));
      b.parentId = b.level > 0 ? (parentStack[b.level - 1] || null) : null;
      parentStack[b.level] = b.id;
      for (let l = b.level + 1; l <= 6; l++) {
        delete parentStack[l];
      }
    }
  }

  indentBlock(index: number) {
    if (index <= 0) return;
    const current = this.blocks[index];
    const prev = this.blocks[index - 1];
    const maxLevel = (prev.level || 0) + 1;
    if ((current.level || 0) < maxLevel && (current.level || 0) < 4) {
      current.level = (current.level || 0) + 1;
      this.recomputeBlockHierarchy();
      this.syncBlocksToMarkdown(true, false);
    }
  }

  outdentBlock(index: number) {
    const current = this.blocks[index];
    if ((current.level || 0) > 0) {
      current.level = (current.level || 0) - 1;
      this.recomputeBlockHierarchy();
      this.syncBlocksToMarkdown(true, false);
    }
  }

  addChildBlock(index: number) {
    const parent = this.blocks[index];
    if (!parent) return;
    const newLevel = Math.min((parent.level || 0) + 1, 4);
    parent.collapsed = false;

    let childType: MarkdownBlock['type'] = 'text';
    if (parent.type === 'todo') childType = 'todo';
    else if (parent.type === 'bullet') childType = 'bullet';

    const newBlock: MarkdownBlock = {
      id: generateBlockId(),
      type: childType,
      text: '',
      level: newLevel,
      parentId: parent.id,
      checked: false
    };

    this.blocks.splice(index + 1, 0, newBlock);
    this.recomputeBlockHierarchy();
    this.editingBlockId = newBlock.id;
    this.activeBlockMenuId = null;
    this.syncBlocksToMarkdown(true, false);

    setTimeout(() => {
      const el = document.querySelector(`[data-block-idx="${index + 1}"] textarea`) as HTMLTextAreaElement;
      if (el) {
        el.focus();
        this.autoResizeBlock(el);
      }
    }, 40);
  }

  hasChildren(index: number): boolean {
    const current = this.blocks[index];
    if (!current || index >= this.blocks.length - 1) return false;
    const next = this.blocks[index + 1];
    return (next.level || 0) > (current.level || 0);
  }

  getChildrenCount(index: number): number {
    const current = this.blocks[index];
    if (!current) return 0;
    const baseLevel = current.level || 0;
    let count = 0;
    for (let i = index + 1; i < this.blocks.length; i++) {
      if ((this.blocks[i].level || 0) > baseLevel) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  toggleBlockCollapse(block: MarkdownBlock, event?: MouseEvent) {
    if (event) event.stopPropagation();
    block.collapsed = !block.collapsed;
  }

  isBlockHidden(index: number): boolean {
    const target = this.blocks[index];
    if (!target || !target.level || target.level === 0) return false;

    let currentLevel = target.level;
    for (let i = index - 1; i >= 0; i--) {
      const candidate = this.blocks[i];
      if ((candidate.level || 0) < currentLevel) {
        if (candidate.collapsed) return true;
        currentLevel = candidate.level || 0;
        if (currentLevel === 0) break;
      }
    }
    return false;
  }

  addBlockBelow(index: number, type: MarkdownBlock['type'] = 'text') {
    const prev = this.blocks[index];
    const level = prev ? (prev.level || 0) : 0;
    const parentId = prev ? (prev.parentId || null) : null;
    const newId = generateBlockId();
    const newBlock: MarkdownBlock = {
      id: newId,
      type,
      text: '',
      checked: false,
      level,
      parentId
    };

    this.blocks.splice(index + 1, 0, newBlock);
    this.recomputeBlockHierarchy();
    this.editingBlockId = newId;
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
      this.blocks.push({ id: generateBlockId(), type: 'text', text: '', level: 0, parentId: null });
    }
    this.recomputeBlockHierarchy();
    this.syncBlocksToMarkdown(true, false);
  }

  duplicateBlock(index: number) {
    const src = this.blocks[index];
    const copy: MarkdownBlock = {
      ...src,
      id: generateBlockId(),
      text: src.text
    };
    this.blocks.splice(index + 1, 0, copy);
    this.recomputeBlockHierarchy();
    this.activeBlockMenuId = null;
    this.syncBlocksToMarkdown(true, false);
  }

  moveBlock(index: number, delta: number) {
    const targetIdx = index + delta;
    if (targetIdx < 0 || targetIdx >= this.blocks.length) return;
    const [item] = this.blocks.splice(index, 1);
    this.blocks.splice(targetIdx, 0, item);
    this.recomputeBlockHierarchy();
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

  isCoverGradient(cover?: string): boolean {
    return !!cover && cover.startsWith('linear-gradient');
  }

  isCoverColorOrGradient(cover?: string): boolean {
    if (!cover) return false;
    return cover.startsWith('linear-gradient') || cover.startsWith('#') || cover.startsWith('rgb');
  }

  getCoverImageUrl(): string {
    if (!this.card.cover || this.isCoverColorOrGradient(this.card.cover)) return '';
    return this.card.cover;
  }

  setCoverImage(url: string) {
    this.setCover(url.trim());
  }

  getCoverColorValue(): string {
    if (this.card.cover && this.card.cover.startsWith('#')) {
      return this.card.cover;
    }
    return '#52b8a6';
  }

  onCoverColorPicked(event: Event) {
    const color = (event.target as HTMLInputElement)?.value;
    if (color) {
      this.setCover(color);
    }
  }

  isCustomCoverActive(): boolean {
    return !!this.card.cover && this.card.cover.startsWith('#');
  }

  getCompletedChecklistCount(): number {
    return (this.card.checklist || []).filter(i => i.checked).length;
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
