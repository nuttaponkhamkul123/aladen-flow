import { Component, OnInit, OnDestroy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { CmsService } from '../../core/services/cms.service';
import { CmsPage, ReusableBlock, Block, BlockCategory, BLOCK_DEFAULTS } from '../../core/models/cms.model';
import { AiModalComponent } from './components/ai-modal/ai-modal.component';
import { PROP_SCHEMAS, PropField } from './cms-prop-schema';

@Component({
  selector: 'app-cms-view',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule, AiModalComponent],
  templateUrl: './cms-view.component.html',
  styleUrls: ['./cms-view.component.css']
})
export class CmsViewComponent implements OnInit, OnDestroy {
  cmsService = inject(CmsService);
  private sanitizer = inject(DomSanitizer);

  pages = this.cmsService.pages;
  activePage = this.cmsService.activePage;
  currentBlocks = signal<Block[]>([]);
  selectedBlock = signal<Block | null>(null);
  reusableBlocks = signal<ReusableBlock[]>([]);

  sidebarTab = signal<'blocks' | 'reusable' | 'tree'>('blocks');
  leftSidebarCollapsed = signal<boolean>(false);
  rightSidebarCollapsed = signal<boolean>(false);

  draggingOver = signal<boolean>(false);
  dragInsertIndex = signal<number | null>(null);

  viewportMode = signal<'desktop' | 'tablet' | 'mobile'>('desktop');
  isLandscape = signal<boolean>(false);
  showDeviceFrame = signal<boolean>(true);
  isPreviewMode = signal<boolean>(false);

  showPagesPopup = false;
  showAiModal = false;
  blockSearchQuery = '';

  private lastLoadedPageId: number | null = null;
  private nowTick = signal(Date.now());
  private tickTimer: any = null;
  private carouselIdx = new Map<string, number>();
  private tabIdx = new Map<string, number>();
  private pendingChildType = new Map<string, string>();
  private dragOverContainers = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      const page = this.activePage();
      if (page && page.id && page.id !== this.lastLoadedPageId) {
        this.lastLoadedPageId = page.id;
        let blocks = page.blocks || [];
        if (typeof blocks === 'string') {
          try { blocks = JSON.parse(blocks); } catch (_) { blocks = []; }
        }
        this.currentBlocks.set(blocks);
        this.selectedBlock.set(null);
        this.carouselIdx.clear();
        this.tabIdx.clear();
        this.pendingChildType.clear();
        this.dragOverContainers.set(new Set());
      }
    });
    this.tickTimer = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
  }

  blockCategories: BlockCategory[] = [
    {
      id: 'content',
      name: 'Content & Typography',
      icon: 'type',
      items: [
        {
          type: 'heading',
          label: 'Heading',
          sub: 'H1 to H6 title with style controls',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 12h12M6 4v16M18 4v16"/></svg>'
        },
        {
          type: 'paragraph',
          label: 'Paragraph',
          sub: 'Body text with rich styling',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/></svg>'
        },
        {
          type: 'button',
          label: 'Button',
          sub: 'Call to action link button',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="6" width="20" height="12" rx="4"/><circle cx="8" cy="12" r="1.5"/><line x1="12" y1="12" x2="16" y2="12"/></svg>'
        },
        {
          type: 'callout',
          label: 'Callout Box',
          sub: 'Attention highlight banner',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>'
        },
        {
          type: 'table',
          label: 'Data Table',
          sub: 'Structured rows and columns',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="14" x2="21" y2="14"/><line x1="3" y1="19" x2="21" y2="19"/></svg>'
        },
        {
          type: 'tabs',
          label: 'Tabs',
          sub: 'Tabbed content sections',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M7 6V4h10v2"/><line x1="7" y1="10" x2="17" y2="10"/></svg>'
        }
      ]
    },
    {
      id: 'layout',
      name: 'Layout & Navigation',
      icon: 'layout',
      items: [
        {
          type: 'header',
          label: 'Custom Header',
          sub: 'Site navigation and branding bar',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M2 10h20"/><circle cx="6" cy="7" r="1"/><path d="M14 7h4"/></svg>'
        },
        {
          type: 'footer',
          label: 'Site Footer',
          sub: 'Multi-column footer and copyright',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 10h18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M5 15h14"/></svg>'
        },
        {
          type: 'bento',
          label: 'Bento Grid',
          sub: 'Modern asymmetric feature tiles',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>'
        },
        {
          type: 'divider',
          label: 'Divider',
          sub: 'Horizontal line separator',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="12" x2="21" y2="12"/></svg>'
        },
        {
          type: 'spacer',
          label: 'Spacer',
          sub: 'Vertical spacing block',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>'
        },
        {
          type: 'container',
          label: 'Container',
          sub: 'Grid or flex layout wrapper',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M15 3v18"/></svg>'
        }
      ]
    },
    {
      id: 'marketing',
      name: 'Marketing & Conversion',
      icon: 'trending-up',
      items: [
        {
          type: 'pricing',
          label: 'Pricing Card',
          sub: 'Plan tier with features & CTA',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>'
        },
        {
          type: 'stat',
          label: 'Stats Metric',
          sub: 'Key metric number and trend indicator',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>'
        },
        {
          type: 'testimonial',
          label: 'Testimonial',
          sub: 'Quote review with client profile',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>'
        },
        {
          type: 'accordion',
          label: 'Accordion (FAQ)',
          sub: 'Expandable questions and answers',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 8h10M7 12h10M15 16l-3-3-3 3"/></svg>'
        },
        {
          type: 'form',
          label: 'Contact Form',
          sub: 'Lead capture form',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><circle cx="12" cy="15" r="1"/></svg>'
        },
        {
          type: 'countdown',
          label: 'Countdown Timer',
          sub: 'Clock to a target date',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/></svg>'
        }
      ]
    },
    {
      id: 'media',
      name: 'Media & Visuals',
      icon: 'image',
      items: [
        {
          type: 'image',
          label: 'Image',
          sub: 'Responsive image with caption',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>'
        },
        {
          type: 'carousel',
          label: 'Carousel',
          sub: 'Auto-rotating image slides',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="2"/><polyline points="9 9 12 12 9 15"/><polyline points="15 9 18 12 15 15"/></svg>'
        },
        {
          type: 'video',
          label: 'Video',
          sub: 'YouTube, Vimeo or mp4 embed',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="2" y="5" width="20" height="14" rx="3"/><polyline points="10 9 15 12 10 15"/></svg>'
        },
        {
          type: 'code',
          label: 'Code Block',
          sub: 'Syntax highlighted snippet',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>'
        },
        {
          type: 'comparison',
          label: 'Before / After',
          sub: 'Interactive image slider',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="12" y1="4" x2="12" y2="20"/><polyline points="8 9 11 12 8 15"/><polyline points="16 9 13 12 16 15"/></svg>'
        },
        {
          type: 'tilt-card',
          label: '3D Tilt Card',
          sub: 'Interactive perspective card',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-5 9 5v8l-9 5-9-5z"/><path d="M3 9l9 5 9-5"/><path d="M12 14v8"/></svg>'
        },
        {
          type: 'marquee',
          label: 'Marquee',
          sub: 'Scrolling tech ticker',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="7 8 3 12 7 16"/><polyline points="17 8 21 12 17 16"/></svg>'
        },
        {
          type: 'timeline',
          label: 'Timeline',
          sub: 'Vertical milestone roadmap',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="6" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="18" r="2"/><line x1="12" y1="8" x2="12" y2="10"/><line x1="12" y1="14" x2="12" y2="16"/></svg>'
        },
        {
          type: 'audio',
          label: 'Audio Player',
          sub: 'Track card with waveform',
          iconSvg: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>'
        }
      ]
    }
  ];

  filteredBlockCategories = computed(() => {
    const q = this.blockSearchQuery.trim().toLowerCase();
    if (!q) return this.blockCategories;

    return this.blockCategories
      .map(cat => ({
        ...cat,
        items: cat.items.filter(item =>
          item.label.toLowerCase().includes(q) ||
          item.sub.toLowerCase().includes(q) ||
          item.type.toLowerCase().includes(q)
        )
      }))
      .filter(cat => cat.items.length > 0);
  });

  ngOnInit() {
    this.loadPages();
    this.loadReusableBlocks();
  }

  loadPages() {
    this.cmsService.getPages().subscribe({
      next: (list) => {
        this.pages.set(list);
        if (list.length > 0) {
          const currentId = this.activePage()?.id;
          const target = list.find(p => p.id === currentId) || list.find(p => p.is_first_page) || list[0];
          this.switchPage(target.id);
        }
      },
      error: (err) => console.error('Failed to load pages:', err)
    });
  }

  loadReusableBlocks() {
    this.cmsService.getReusableBlocks().subscribe({
      next: (list) => this.reusableBlocks.set(list),
      error: (err) => console.error('Failed to load reusable blocks:', err)
    });
  }

  switchPage(id: number) {
    this.cmsService.getPage(id).subscribe({
      next: (page) => {
        this.activePage.set(page);
        this.showPagesPopup = false;
      },
      error: (err) => console.error('Failed to load page:', err)
    });
  }

  togglePagesPopup() {
    this.showPagesPopup = !this.showPagesPopup;
  }

  toggleLeftSidebar() {
    this.leftSidebarCollapsed.set(!this.leftSidebarCollapsed());
  }

  toggleRightSidebar() {
    this.rightSidebarCollapsed.set(!this.rightSidebarCollapsed());
  }

  setViewport(mode: 'desktop' | 'tablet' | 'mobile') {
    this.viewportMode.set(mode);
  }

  toggleOrientation() {
    this.isLandscape.set(!this.isLandscape());
  }

  toggleDeviceFrame() {
    this.showDeviceFrame.set(!this.showDeviceFrame());
  }

  getViewportWidthDisplay(): string {
    const mode = this.viewportMode();
    if (mode === 'desktop') return '100%';
    if (mode === 'tablet') return this.isLandscape() ? '1024px' : '768px';
    return this.isLandscape() ? '844px' : '390px';
  }

  addBlock(type: string, index?: number) {
    const defaults = BLOCK_DEFAULTS[type] ? JSON.parse(JSON.stringify(BLOCK_DEFAULTS[type])) : {};
    const newBlock: Block = {
      id: 'b' + Math.random().toString(36).slice(2, 10),
      type,
      props: defaults
    };

    const blocks = [...this.currentBlocks()];
    if (index == null || index < 0) index = blocks.length;
    blocks.splice(Math.min(index, blocks.length), 0, newBlock);
    this.currentBlocks.set(blocks);
    this.selectedBlock.set(newBlock);
    this.savePageDebounced();
  }

  addReusableBlock(r: ReusableBlock, index?: number) {
    const cloned = JSON.parse(JSON.stringify(r.block_data));
    cloned.id = 'b' + Math.random().toString(36).slice(2, 10);

    const blocks = [...this.currentBlocks()];
    if (index == null || index < 0) index = blocks.length;
    blocks.splice(Math.min(index, blocks.length), 0, cloned);
    this.currentBlocks.set(blocks);
    this.selectedBlock.set(cloned);
    this.savePageDebounced();
  }

  private dragPayload: string | null = null;
  private dragFormat = 'application/x-cms-block';

  onPaletteDragStart(event: DragEvent, type: string) {
    this.dragPayload = JSON.stringify({ kind: 'type', value: type });
    event.dataTransfer!.setData(this.dragFormat, this.dragPayload);
    event.dataTransfer!.effectAllowed = 'copy';
    this.draggingOver.set(true);
  }

  onReusableDragStart(event: DragEvent, r: ReusableBlock) {
    this.dragPayload = JSON.stringify({ kind: 'reusable', value: r.id });
    event.dataTransfer!.setData(this.dragFormat, this.dragPayload);
    event.dataTransfer!.effectAllowed = 'copy';
    this.draggingOver.set(true);
  }

  onDragEnd() {
    this.draggingOver.set(false);
    this.dragInsertIndex.set(null);
    this.dragPayload = null;
  }

  onCanvasDragOver(event: DragEvent) {
    if (!this.dragPayload) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'copy';
    this.draggingOver.set(true);
    this.dragInsertIndex.set(this.computeInsertIndex(event));
  }

  onCanvasDragLeave(event: DragEvent) {
    if (!this.dragPayload) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
                   event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) {
      this.draggingOver.set(false);
      this.dragInsertIndex.set(null);
    }
  }

  onCanvasDrop(event: DragEvent) {
    if (!this.dragPayload) return;
    event.preventDefault();
    const index = this.dragInsertIndex() ?? this.dragPayloadGetIndex();
    try {
      const payload = JSON.parse(this.dragPayload);
      if (payload.kind === 'type') this.addBlock(payload.value, index ?? undefined);
      else if (payload.kind === 'reusable') {
        const r = this.reusableBlocks().find(x => x.id === payload.value);
        if (r) this.addReusableBlock(r, index ?? undefined);
      }
    } catch (_) {}
    this.onDragEnd();
  }

  onBlockDrop(event: CdkDragDrop<Block[]>) {
    if (event.previousIndex === event.currentIndex) return;
    const blocks = [...this.currentBlocks()];
    moveItemInArray(blocks, event.previousIndex, event.currentIndex);
    this.currentBlocks.set(blocks);
    this.savePageDebounced();
  }

  selectBlock(b: Block, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.selectedBlock.set(b);
  }

  deselectBlock() {
    this.selectedBlock.set(null);
  }

  deleteBlock(id: string, event?: MouseEvent) {
    if (event) event.stopPropagation();
    const updated = this.currentBlocks().filter(b => b.id !== id);
    this.currentBlocks.set(updated);
    if (this.selectedBlock()?.id === id) {
      this.selectedBlock.set(null);
    }
    this.savePageDebounced();
  }

  moveBlockUp(idx: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    if (idx <= 0) return;
    const blocks = [...this.currentBlocks()];
    const temp = blocks[idx - 1];
    blocks[idx - 1] = blocks[idx];
    blocks[idx] = temp;
    this.currentBlocks.set(blocks);
    this.savePageDebounced();
  }

  moveBlockDown(idx: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    const blocks = [...this.currentBlocks()];
    if (idx >= blocks.length - 1) return;
    const temp = blocks[idx + 1];
    blocks[idx + 1] = blocks[idx];
    blocks[idx] = temp;
    this.currentBlocks.set(blocks);
    this.savePageDebounced();
  }

  duplicateBlock(b: Block, event?: MouseEvent) {
    if (event) event.stopPropagation();
    const cloned: Block = JSON.parse(JSON.stringify(b));
    cloned.id = 'b' + Math.random().toString(36).slice(2, 10);
    const idx = this.currentBlocks().findIndex(item => item.id === b.id);
    const blocks = [...this.currentBlocks()];
    blocks.splice(idx + 1, 0, cloned);
    this.currentBlocks.set(blocks);
    this.selectedBlock.set(cloned);
    this.savePageDebounced();
  }

  saveAsReusable(b: Block) {
    const name = prompt('Reusable Component Name:', this.getBlockLabel(b.type));
    if (!name || !name.trim()) return;

    this.cmsService.createReusableBlock(name.trim(), b).subscribe({
      next: () => this.loadReusableBlocks(),
      error: (err) => console.error('Failed to save reusable block:', err)
    });
  }

  deleteReusableBlock(id: number, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm('Delete this saved reusable block?')) return;
    this.cmsService.deleteReusableBlock(id).subscribe({
      next: () => this.loadReusableBlocks(),
      error: (err) => console.error('Failed to delete reusable block:', err)
    });
  }

  getBlockLabel(type: string): string {
    const map: Record<string, string> = {
      header: 'Header Navbar',
      footer: 'Site Footer',
      heading: 'Heading',
      paragraph: 'Paragraph',
      button: 'Button',
      image: 'Image',
      bento: 'Bento Grid',
      pricing: 'Pricing Card',
      stat: 'Stats Metric',
      testimonial: 'Testimonial',
      callout: 'Callout Box',
      accordion: 'Accordion',
      divider: 'Divider',
      spacer: 'Spacer',
      table: 'Data Table',
      tabs: 'Tabs',
      container: 'Container',
      form: 'Contact Form',
      countdown: 'Countdown Timer',
      carousel: 'Carousel',
      video: 'Video',
      code: 'Code Block',
      comparison: 'Before / After',
      'tilt-card': '3D Tilt Card',
      marquee: 'Marquee',
      timeline: 'Timeline',
      audio: 'Audio Player'
    };
    return map[type] || type.toUpperCase();
  }

  onPropChange() {
    this.savePageDebounced();
  }

  iconSafe(s: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(s);
  }

  getBlockSchema(type: string): PropField[] {
    return PROP_SCHEMAS[type] || [];
  }

  private mutateAndSave(fn: () => void) {
    fn();
    this.currentBlocks.set([...this.currentBlocks()]);
    this.savePageDebounced();
  }

  setProp(b: Block, key: string, value: any) {
    this.mutateAndSave(() => { b.props[key] = value; });
  }

  selectValue(b: Block, key: string): string {
    const v = b.props[key];
    return v == null ? '' : String(v);
  }

  selectSubValue(item: any, key: string): string {
    const v = item == null ? undefined : item[key];
    return v == null ? '' : String(v);
  }

  toNumber(v: any): number | null {
    if (v === '' || v == null) return null;
    const n = Number(v);
    return Number.isNaN(n) ? null : n;
  }

  setNestedProp(b: Block, listKey: string, itemIdx: number, subKey: string, value: any) {
    this.mutateAndSave(() => {
      const item = (b.props[listKey] || [])[itemIdx];
      if (item) item[subKey] = value;
    });
  }

  addListItem(b: Block, key: string, itemDefault?: Record<string, any>) {
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props[key])) b.props[key] = [];
      b.props[key].push(itemDefault ? JSON.parse(JSON.stringify(itemDefault)) : {});
    });
  }

  addStringItem(b: Block, key: string) {
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props[key])) b.props[key] = [];
      b.props[key].push('');
    });
  }

  setListString(b: Block, key: string, itemIdx: number, value: string) {
    this.mutateAndSave(() => {
      if (Array.isArray(b.props[key])) b.props[key][itemIdx] = value;
    });
  }

  removeFromArray(arr: any[] | undefined, idx: number) {
    if (!Array.isArray(arr)) return;
    this.mutateAndSave(() => arr.splice(idx, 1));
  }

  setLink(links: any[] | undefined, idx: number, key: 'label' | 'url', value: string) {
    if (!Array.isArray(links)) return;
    this.mutateAndSave(() => { links[idx][key] = value; });
  }

  addLink(links: any[] | undefined) {
    if (!Array.isArray(links)) return;
    this.mutateAndSave(() => links.push({ label: 'New Link', url: '#' }));
  }

  childTypeOf(b: Block): string {
    return this.pendingChildType.get(b.id) || 'heading';
  }

  setChildType(b: Block, t: string) {
    this.pendingChildType.set(b.id, t);
  }

  addChild(b: Block, containerKey: string, type: string) {
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props[containerKey])) b.props[containerKey] = [];
      const defaults = BLOCK_DEFAULTS[type] ? JSON.parse(JSON.stringify(BLOCK_DEFAULTS[type])) : {};
      b.props[containerKey].push({
        id: this.newBlockId(),
        type,
        props: defaults
      });
    });
  }

  childLabel(child: any): string {
    return child && typeof child === 'object' ? this.getBlockLabel(child.type) : 'Child';
  }

  private newBlockId(): string {
    return 'b' + Math.random().toString(36).slice(2, 12);
  }

  isContainerDragOver(b: Block): boolean {
    return this.dragOverContainers().has(b.id);
  }

  onContainerDragOver(b: Block, event: DragEvent) {
    if (!this.dragPayload) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = 'copy';
    this.dragOverContainers.update(s => {
      const n = new Set(s);
      n.add(b.id);
      return n;
    });
  }

  onContainerDragLeave(b: Block, event: DragEvent) {
    if (!this.dragPayload) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
                   event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (!inside) {
      this.dragOverContainers.update(s => {
        const n = new Set(s);
        n.delete(b.id);
        return n;
      });
    }
  }

  onContainerDrop(b: Block, event: DragEvent) {
    if (!this.dragPayload) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const payload = JSON.parse(this.dragPayload);
      if (payload.kind === 'type') {
        this.addChild(b, 'children', payload.value);
      } else if (payload.kind === 'reusable') {
        const r = this.reusableBlocks().find(x => x.id === payload.value);
        if (r) this.addReusableChild(b, r);
      }
    } catch (_) {}
    this.onDragEnd();
  }

  addReusableChild(b: Block, r: ReusableBlock) {
    const clone = JSON.parse(JSON.stringify(r.block_data));
    clone.id = this.newBlockId();
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props['children'])) b.props['children'] = [];
      b.props['children'].push(clone);
    });
  }

  onChildDrop(b: Block, event: CdkDragDrop<any[]>) {
    if (event.previousIndex === event.currentIndex) return;
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props['children'])) b.props['children'] = [];
      moveItemInArray(b.props['children'], event.previousIndex, event.currentIndex);
    });
  }

  tableCols(b: Block): number {
    const headers = b.props['headers'] || [];
    let maxCells = 0;
    for (const row of b.props['rows'] || []) {
      if (Array.isArray(row)) maxCells = Math.max(maxCells, row.length);
    }
    return Math.max(headers.length, maxCells, 1);
  }

  tableRowIndexes(b: Block): number[] {
    return (b.props['rows'] || []).map((_: any, i: number) => i);
  }

  colRange(b: Block): number[] {
    const n = this.tableCols(b);
    return Array.from({ length: n }, (_, i) => i);
  }

  setTableCell(b: Block, rowIdx: number, colIdx: number, value: any) {
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props['rows'])) b.props['rows'] = [];
      if (!Array.isArray(b.props['rows'][rowIdx])) b.props['rows'][rowIdx] = [];
      b.props['rows'][rowIdx][colIdx] = value;
    });
  }

  addTableRow(b: Block) {
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props['rows'])) b.props['rows'] = [];
      const cells: string[] = [];
      for (let i = 0; i < this.tableCols(b); i++) cells.push('');
      b.props['rows'].push(cells);
    });
  }

  calloutTheme(type: string): { bg: string; border: string; titleColor: string; icon: string } {
    const themes: Record<string, { bg: string; border: string; titleColor: string; icon: string }> = {
      tip: { bg: 'rgba(139, 92, 246, 0.12)', border: '#8b5cf6', titleColor: '#a78bfa', icon: '💡' },
      info: { bg: 'rgba(59, 130, 246, 0.12)', border: '#3b82f6', titleColor: '#60a5fa', icon: 'ℹ️' },
      success: { bg: 'rgba(16, 185, 129, 0.12)', border: '#10b981', titleColor: '#34d399', icon: '✅' },
      warning: { bg: 'rgba(245, 158, 11, 0.12)', border: '#f59e0b', titleColor: '#fbbf24', icon: '⚠️' },
      danger: { bg: 'rgba(239, 68, 68, 0.12)', border: '#ef4444', titleColor: '#f87171', icon: '🛑' }
    };
    return themes[type] || themes['info'];
  }

  videoEmbedSrc(url: string | undefined): SafeResourceUrl | null {
    if (!url) return null;
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      const m = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=)([^#&?]*)/);
      if (m && m[1]) return this.sanitizer.bypassSecurityTrustResourceUrl(`https://www.youtube.com/embed/${m[1]}`);
    }
    if (url.includes('vimeo.com')) {
      const m = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|album\/(\d+)\/video\/|)(\d+)/);
      if (m && m[3]) return this.sanitizer.bypassSecurityTrustResourceUrl(`https://player.vimeo.com/video/${m[3]}`);
    }
    return null;
  }

  countdownParts(raw?: string | undefined): { d: string; h: string; m: string; s: string } {
    const target = new Date(raw || '2026-12-31T23:59:59').getTime();
    const diff = Math.max(0, target - this.nowTick());
    const secs = Math.floor(diff / 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      d: pad(Math.floor(secs / 86400)),
      h: pad(Math.floor((secs % 86400) / 3600)),
      m: pad(Math.floor((secs % 3600) / 60)),
      s: pad(secs % 60)
    };
  }

  carouselCurrent(b: Block): number {
    return this.carouselIdx.get(b.id) || 0;
  }

  carouselMove(b: Block, dir: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    const n = (b.props['slides'] || []).length;
    if (!n) return;
    const next = (this.carouselCurrent(b) + dir + n) % n;
    this.carouselIdx.set(b.id, next);
  }

  carouselGo(b: Block, idx: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.carouselIdx.set(b.id, idx);
  }

  tabCurrent(b: Block): number {
    return this.tabIdx.get(b.id) || 0;
  }

  setTab(b: Block, idx: number, event?: MouseEvent) {
    if (event) event.stopPropagation();
    this.tabIdx.set(b.id, idx);
  }

  savePageNow() {
    const page = this.activePage();
    if (!page) return;

    this.cmsService.updatePage(page.id, {
      title: page.title,
      slug: page.slug,
      status: page.status,
      blocks: this.currentBlocks()
    }).subscribe({
      next: (res) => {
        if (res && typeof res.id === 'number') {
          this.activePage.set(res);
          this.pages.update(list => {
            const idx = list.findIndex(p => p.id === res.id);
            if (idx >= 0) {
              list[idx] = res;
              return [...list];
            }
            return list;
          });
        } else {
          this.cmsService.getPage(page.id).subscribe(p => this.activePage.set(p));
        }
      },
      error: (err) => console.error('Failed to save page:', err)
    });
  }

  private saveTimeout: any = null;
  savePageDebounced() {
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.savePageNow(), 500);
  }

  toggleFirstPage() {
    const page = this.activePage();
    if (!page) return;
    this.cmsService.setFirstPage(page.id).subscribe({
      next: () => this.loadPages(),
      error: (err) => console.error('Failed to set homepage:', err)
    });
  }

  updateActiveSlug(event: Event) {
    const page = this.activePage();
    if (!page) return;
    const input = event.target as HTMLInputElement;
    page.slug = input.value.trim();
    this.savePageNow();
  }

  updateActiveStatus(event: Event) {
    const page = this.activePage();
    if (!page) return;
    const select = event.target as HTMLSelectElement;
    page.status = select.value as 'draft' | 'published';
    this.savePageNow();
  }

  updateActiveTitle(event: Event) {
    const page = this.activePage();
    if (!page) return;
    const input = event.target as HTMLInputElement;
    page.title = input.value.trim();
    this.savePageNow();
  }

  promptCreatePage() {
    const title = prompt('New Page Title:');
    if (!title || !title.trim()) return;
    const slug = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

    this.cmsService.createPage({ title: title.trim(), slug }).subscribe({
      next: (newPage) => {
        this.loadPages();
        this.switchPage(newPage.id);
      },
      error: (err) => console.error('Failed to create page:', err)
    });
  }

  deletePage(id: number, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm('Are you sure you want to delete this page?')) return;
    this.cmsService.deletePage(id).subscribe({
      next: () => this.loadPages(),
      error: (err) => console.error('Failed to delete page:', err)
    });
  }

  onAiPageGenerated(res: { page: CmsPage }) {
    this.cmsService.getPages().subscribe(list => {
      this.pages.set(list);
      if (res.page?.id) {
        this.switchPage(res.page.id);
      }
    });
  }

  private computeInsertIndex(event: DragEvent): number {
    const canvas = document.getElementById('cmsCanvasDropList');
    if (!canvas) return 0;
    const wraps = Array.from(canvas.querySelectorAll<HTMLElement>(':scope > .block-wrap'));
    for (let i = 0; i < wraps.length; i++) {
      const midY = wraps[i].getBoundingClientRect().top + wraps[i].getBoundingClientRect().height / 2;
      if (event.clientY < midY) return i;
    }
    return wraps.length;
  }

  private dragPayloadGetIndex(): number {
    const canvas = document.getElementById('cmsCanvasDropList');
    return canvas ? canvas.querySelectorAll<HTMLElement>(':scope > .block-wrap').length : 0;
  }
}
