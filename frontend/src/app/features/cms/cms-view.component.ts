import { Component, OnInit, OnDestroy, inject, signal, computed, effect, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DragDropModule } from '@angular/cdk/drag-drop';
import { DomSanitizer, SafeResourceUrl, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CmsService } from '../../core/services/cms.service';
import { ToastService } from '../../core/services/toast.service';
import { ThemeService, ThemeMode } from '../../core/services/theme.service';
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
  toastService = inject(ToastService);
  themeService = inject(ThemeService);
  private destroyRef = inject(DestroyRef);
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
  containerDropTarget = signal<{ containerId: string; index: number } | null>(null);
  containerDropOffset = signal<{ offset: number; horizontal: boolean } | null>(null);

  isSaving = signal<boolean>(false);
  isSaved = signal<boolean>(false);
  collapsedTreeNodes = signal<Set<string>>(new Set());
  treeDragTarget = signal<{ id: string; pos: 'before' | 'after' | 'inside' } | null>(null);

  showLayersPanel = signal<boolean>(this.loadStoredLayersPanelState());
  isLayersPanelMinimized = signal<boolean>(false);
  layersSearchQuery = signal<string>('');

  private loadStoredLayersPanelState(): boolean {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return localStorage.getItem('cms_show_layers_panel') !== 'false';
      }
    } catch (_) {}
    return true;
  }

  toggleLayersPanel() {
    this.showLayersPanel.update(v => {
      const next = !v;
      try {
        localStorage.setItem('cms_show_layers_panel', String(next));
      } catch (_) {}
      return next;
    });
  }

  toggleLayersPanelMinimized() {
    this.isLayersPanelMinimized.update(v => !v);
  }

  viewportMode = signal<'desktop' | 'tablet' | 'mobile'>('desktop');
  isLandscape = signal<boolean>(false);
  showDeviceFrame = signal<boolean>(true);
  isPreviewMode = signal<boolean>(false);

  showPagesPopup = false;
  showAiModal = false;
  showSaveReusableModal = signal<boolean>(false);
  targetReusableBlock = signal<Block | null>(null);
  reusableNameInput = signal<string>('');
  reusableCategoryInput = signal<string>('custom');
  blockSearchQuery = signal<string>('');
  pageSettings = signal<Record<string, any>>({
    maxWidth: '820px',
    minWidth: '0px',
    align: 'center',
    bg: 'default',
    customBg: '#0f172a',
    fontFamily: 'system',
    borderRadius: 16,
    paddingX: 36,
    paddingY: 44,
    editorTheme: 'dark',
    previewTheme: 'light'
  });

  storedEditorTheme = signal<ThemeMode>(this.loadStoredTheme('cms_editor_theme', 'dark'));
  storedPreviewTheme = signal<ThemeMode>(this.loadStoredTheme('cms_preview_theme', 'light'));

  private loadStoredTheme(key: string, fallback: ThemeMode): ThemeMode {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const val = localStorage.getItem(key);
        if (val === 'dark' || val === 'light' || val === 'auto') return val as ThemeMode;
      }
    } catch (_) {}
    return fallback;
  }

  editorTheme = computed<ThemeMode>(() => {
    const setting = this.pageSettings()['editorTheme'];
    if (setting === 'dark' || setting === 'light' || setting === 'auto') return setting;
    return this.storedEditorTheme();
  });

  previewTheme = computed<ThemeMode>(() => {
    const setting = this.pageSettings()['previewTheme'];
    if (setting === 'dark' || setting === 'light' || setting === 'auto') return setting;
    return this.storedPreviewTheme();
  });

  effectiveCanvasTheme = computed<'dark' | 'light'>(() => {
    const mode = this.isPreviewMode() ? this.previewTheme() : this.editorTheme();
    if (mode === 'dark') return 'dark';
    if (mode === 'light') return 'light';
    return this.themeService.systemIsDark() ? 'dark' : 'light';
  });

  currentModeTheme = computed<ThemeMode>(() => {
    return this.isPreviewMode() ? this.previewTheme() : this.editorTheme();
  });

  toggleActiveModeTheme() {
    const current = this.currentModeTheme();
    const next: ThemeMode = current === 'dark' ? 'light' : current === 'light' ? 'auto' : 'dark';
    if (this.isPreviewMode()) {
      this.setPreviewTheme(next);
    } else {
      this.setEditorTheme(next);
    }
  }

  setEditorTheme(theme: ThemeMode) {
    this.storedEditorTheme.set(theme);
    try {
      localStorage.setItem('cms_editor_theme', theme);
    } catch (_) {}
    this.updateSetting('editorTheme', theme);
  }

  setPreviewTheme(theme: ThemeMode) {
    this.storedPreviewTheme.set(theme);
    try {
      localStorage.setItem('cms_preview_theme', theme);
    } catch (_) {}
    this.updateSetting('previewTheme', theme);
  }

  collapsedSettingsSections = signal<Set<string>>(new Set());
  collapsedBlockSections = signal<Set<string>>(new Set());

  isSettingsSectionCollapsed(id: string): boolean {
    return this.collapsedSettingsSections().has(id);
  }

  toggleSettingsSection(id: string) {
    this.collapsedSettingsSections.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  isBlockSectionCollapsed(blockId: string, sectionKey: string): boolean {
    return this.collapsedBlockSections().has(`${blockId}_${sectionKey}`);
  }

  toggleBlockSection(blockId: string, sectionKey: string) {
    const key = `${blockId}_${sectionKey}`;
    this.collapsedBlockSections.update(set => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  bgColorsList = ['#0b0f19', '#0f172a', '#1e293b', '#111827', '#1e1b4b', '#0f766e', '#831843', '#ffffff'];

  gradientPresets = [
    { label: 'Navy → Indigo', css: 'linear-gradient(135deg, #0f172a, #312e81)' },
    { label: 'Deep Purple', css: 'linear-gradient(135deg, #1e1b4b, #4c1d95, #be185d)' },
    { label: 'Sky → Indigo', css: 'linear-gradient(135deg, #0ea5e9, #6366f1)' },
    { label: 'Teal & Cyan', css: 'linear-gradient(135deg, #0f766e, #06b6d4)' },
    { label: 'Slate Dark', css: 'linear-gradient(135deg, #1f2937, #0b0f17)' },
    { label: 'Sunset Glow', css: 'linear-gradient(135deg, #f97316, #ec4899)' }
  ];

  imagePresets = [
    { label: 'Mountain Parallax', url: 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Night City', url: 'https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Architecture', url: 'https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Deep Space', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?auto=format&fit=crop&w=1600&q=80' },
    { label: 'Gradient Mesh', url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1600&q=80' }
  ];

  setBlockBgType(b: Block, type: string) {
    this.mutateAndSave(() => {
      b.props['bgType'] = type;
      if (type === 'image') {
        if (!b.props['bgImage']) {
          b.props['bgImage'] = 'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1600&q=80';
        }
        if (b.props['parallax'] == null) {
          b.props['parallax'] = true;
        }
        if (!b.props['bgSize']) b.props['bgSize'] = 'cover';
        if (!b.props['bgPosition']) b.props['bgPosition'] = 'center';
        if (!b.props['bgRepeat']) b.props['bgRepeat'] = 'no-repeat';
      } else if (type === 'video') {
        if (!b.props['bgVideo']) {
          b.props['bgVideo'] = 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/1080/Jellyfish_1080_10s_2MB.mp4';
        }
        if (b.props['parallax'] == null) {
          b.props['parallax'] = true;
        }
        if (!b.props['parallaxSpeed']) b.props['parallaxSpeed'] = 0.15;
      } else if (type === 'gradient' && !b.props['bgGradient']) {
        b.props['bgGradient'] = 'linear-gradient(135deg, #0f172a, #312e81)';
      } else if (type === 'color' && !b.props['bgColor']) {
        b.props['bgColor'] = '#0f172a';
      }
    });
  }

  getBlockWrapStyle(b: Block): Record<string, string> {
    if (!b || !b.props) return {};
    const p = b.props;
    const type = p['bgType'] || 'none';
    const s: Record<string, string> = {};

    if (type === 'color' && p['bgColor']) {
      s['background'] = p['bgColor'];
      s['background-color'] = p['bgColor'];
    } else if (type === 'gradient' && p['bgGradient']) {
      s['background-image'] = p['bgGradient'];
      s['background-size'] = 'cover';
    } else if (type === 'image' && p['bgImage']) {
      const overlay = p['bgOverlay'] && p['bgOverlay'] !== 'none' ? p['bgOverlay'] : null;
      if (overlay) {
        s['background-image'] = `linear-gradient(${overlay}, ${overlay}), url('${p['bgImage']}')`;
      } else {
        s['background-image'] = `url('${p['bgImage']}')`;
      }
      s['background-size'] = p['bgSize'] || 'cover';
      s['background-position'] = p['bgPosition'] || 'center';
      s['background-repeat'] = p['bgRepeat'] || 'no-repeat';
      if (p['parallax']) {
        s['background-attachment'] = 'fixed';
      }
    } else if (type === 'video') {
      s['overflow'] = 'hidden';
      if (p['bgColor']) {
        s['background'] = p['bgColor'];
        s['background-color'] = p['bgColor'];
      }
    }

    return s;
  }

  videoPresets = [
    { label: 'Jellyfish', url: 'https://test-videos.co.uk/vids/jellyfish/mp4/h264/1080/Jellyfish_1080_10s_2MB.mp4' },
    { label: 'Big Buck Bunny', url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/1080/Big_Buck_Bunny_1080_10s_2MB.mp4' },
    { label: 'Bunny Short (360p)', url: 'https://test-videos.co.uk/vids/bigbuckbunny/mp4/h264/360/Big_Buck_Bunny_360_10s_1MB.mp4' },
    { label: 'MDN Flower', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' },
    { label: 'MDN Friday', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/friday.mp4' }
  ];

  private videoParallaxBound = false;
  private videoParallaxCanvas: HTMLElement | null = null;
  private videoParallaxRaf = 0;

  private onParallaxScroll = () => {
    if (this.videoParallaxRaf) return;
    this.videoParallaxRaf = requestAnimationFrame(() => {
      this.videoParallaxRaf = 0;
      this.updateParallaxVideos();
    });
  };

  private setupParallaxVideo() {
    if (this.videoParallaxBound) return;
    const canvas = document.getElementById('cmsCanvasDropList');
    if (!canvas) return;
    this.videoParallaxBound = true;
    this.videoParallaxCanvas = canvas;
    canvas.addEventListener('scroll', this.onParallaxScroll, { passive: true });
    window.addEventListener('resize', this.onParallaxScroll);
    this.onParallaxScroll();
  }

  private updateParallaxVideos() {
    const canvas = this.videoParallaxCanvas;
    if (!canvas) return;
    const cRect = canvas.getBoundingClientRect();
    const cTop = cRect.top - 80;
    const cBottom = cRect.bottom + 80;
    const cCenter = cRect.top + cRect.height / 2;
    canvas.querySelectorAll<HTMLElement>('.block-video-bg.parallax').forEach((bg) => {
      const video = bg.querySelector('video');
      if (!video) return;
      const r = bg.getBoundingClientRect();
      if (r.bottom < cTop || r.top > cBottom) return;
      if (video.paused) {
        video.muted = true;
        video.defaultMuted = true;
        video.play().catch(() => {});
      }
      const delta = (r.top + r.height / 2) - cCenter;
      const speed = parseFloat(bg.dataset['parallaxSpeed'] || '0.15') || 0.15;
      const maxShift = r.height * 0.15;
      let y = -delta * speed;
      y = Math.max(-maxShift, Math.min(maxShift, y));
      video.style.transform = `translateY(${y.toFixed(1)}px)`;
    });
  }

  playBgVideo(e: Event) {
    const video = e.target as HTMLVideoElement | null;
    if (!video) return;
    video.defaultMuted = true;
    video.muted = true;
    if (video.paused) {
      video.play().catch(() => {});
    }
  }

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

        let settings = page.settings || {};
        if (typeof settings === 'string') {
          try { settings = JSON.parse(settings); } catch (_) { settings = {}; }
        }
        const pX = settings['paddingX'] != null ? Number(settings['paddingX']) : 36;
        const pY = settings['paddingY'] != null ? Number(settings['paddingY']) : 44;
        const bRad = settings['borderRadius'] != null ? Number(settings['borderRadius']) : 16;
        this.pageSettings.set({
          maxWidth: settings['maxWidth'] || '820px',
          minWidth: settings['minWidth'] || '0px',
          align: settings['align'] || 'center',
          bg: settings['bg'] || 'default',
          customBg: settings['customBg'] || '#0f172a',
          fontFamily: settings['fontFamily'] || 'system',
          borderRadius: isNaN(bRad) ? 16 : bRad,
          paddingX: isNaN(pX) ? 36 : pX,
          paddingY: isNaN(pY) ? 44 : pY,
          ...settings
        });

        this.carouselIdx.clear();
        this.tabIdx.clear();
        this.pendingChildType.clear();
        this.dragOverContainers.set(new Set());
        this.setupParallaxVideo();
      }
    });
    this.tickTimer = setInterval(() => this.nowTick.set(Date.now()), 1000);
  }

  ngOnDestroy() {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.videoParallaxCanvas) {
      this.videoParallaxCanvas.removeEventListener('scroll', this.onParallaxScroll);
      window.removeEventListener('resize', this.onParallaxScroll);
    }
    if (this.videoParallaxRaf) cancelAnimationFrame(this.videoParallaxRaf);
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

  collapsedCategories = signal<Set<string>>(this.loadCollapsedCategories());

  private loadCollapsedCategories(): Set<string> {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const saved = localStorage.getItem('aladen_collapsed_categories');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            return new Set<string>(parsed);
          }
        }
      }
    } catch (_) {}
    return new Set<string>();
  }

  private saveCollapsedCategories(set: Set<string>): void {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        localStorage.setItem('aladen_collapsed_categories', JSON.stringify(Array.from(set)));
      }
    } catch (_) {}
  }

  isCategoryCollapsed(catId: string): boolean {
    if (this.blockSearchQuery().trim()) {
      return false; // auto-expand when actively searching
    }
    return this.collapsedCategories().has(catId);
  }

  toggleCategory(catId: string, event?: Event): void {
    if (event) {
      event.preventDefault();
    }
    const current = new Set(this.collapsedCategories());
    if (current.has(catId)) {
      current.delete(catId);
    } else {
      current.add(catId);
    }
    this.collapsedCategories.set(current);
    this.saveCollapsedCategories(current);
  }

  allCategoriesCollapsed = computed(() => {
    const cats = this.filteredBlockCategories();
    if (cats.length === 0) return false;
    const collapsed = this.collapsedCategories();
    return cats.every(cat => collapsed.has(cat.id));
  });

  toggleAllCategories(): void {
    const cats = this.filteredBlockCategories();
    if (cats.length === 0) return;
    const current = new Set(this.collapsedCategories());
    const isAllCollapsed = cats.every(cat => current.has(cat.id));

    if (isAllCollapsed) {
      for (const cat of cats) {
        current.delete(cat.id);
      }
    } else {
      for (const cat of cats) {
        current.add(cat.id);
      }
    }
    this.collapsedCategories.set(current);
    this.saveCollapsedCategories(current);
  }

  filteredBlockCategories = computed(() => {
    const q = this.blockSearchQuery().trim().toLowerCase();
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

  filteredReusableBlocks = computed(() => {
    const q = this.blockSearchQuery().trim().toLowerCase();
    const list = this.reusableBlocks();
    if (!q) return list;
    return list.filter(r =>
      r.name.toLowerCase().includes(q) ||
      (r.category && r.category.toLowerCase().includes(q))
    );
  });

  isNodeMatch(block: Block): boolean {
    const q = (this.layersSearchQuery() || this.blockSearchQuery()).trim().toLowerCase();
    if (!q) return true;
    const label = this.getBlockLabel(block.type).toLowerCase();
    const snippet = this.getBlockSnippet(block).toLowerCase();
    const type = block.type.toLowerCase();
    if (label.includes(q) || snippet.includes(q) || type.includes(q)) return true;
    if (Array.isArray(block.props && block.props['children'])) {
      return block.props['children'].some((c: any) => this.isNodeMatch(c));
    }
    return false;
  }

  ngOnInit() {
    this.loadPages();
    this.loadReusableBlocks();
  }

  loadPages() {
    this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.cmsService.getReusableBlocks().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (list) => this.reusableBlocks.set(list),
      error: (err) => console.error('Failed to load reusable blocks:', err)
    });
  }

  switchPage(id: number) {
    this.cmsService.getPage(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    if (!r || !r.block_data) {
      this.toastService.error('Invalid reusable component data');
      return;
    }
    const cloned = JSON.parse(JSON.stringify(r.block_data));
    this.reassignIds(cloned);

    const blocks = [...this.currentBlocks()];
    if (index == null || index < 0) index = blocks.length;
    blocks.splice(Math.min(index, blocks.length), 0, cloned);
    this.currentBlocks.set(blocks);
    this.selectedBlock.set(cloned);
    this.savePageDebounced();
    this.toastService.success(`Added reusable component "${r.name}"`);
  }

  dragPayload: string | null = null;
  private dragFormat = 'application/x-cms-block';

  onPaletteDragStart(event: DragEvent, type: string) {
    this.dragPayload = JSON.stringify({ kind: 'type', value: type });
    event.dataTransfer!.setData(this.dragFormat, this.dragPayload);
    event.dataTransfer!.setData('text/plain', type);
    event.dataTransfer!.effectAllowed = 'copy';
    this.draggingOver.set(true);
  }

  onReusableDragStart(event: DragEvent, r: ReusableBlock) {
    this.dragPayload = JSON.stringify({ kind: 'reusable', value: r.id });
    event.dataTransfer!.setData(this.dragFormat, this.dragPayload);
    event.dataTransfer!.setData('text/plain', String(r.id));
    event.dataTransfer!.effectAllowed = 'copy';
    this.draggingOver.set(true);
  }

  onBlockDragStart(event: DragEvent, b: Block) {
    event.stopPropagation();
    this.dragPayload = JSON.stringify({ kind: 'block', id: b.id });
    event.dataTransfer!.setData(this.dragFormat, this.dragPayload);
    event.dataTransfer!.setData('text/plain', b.id);
    event.dataTransfer!.effectAllowed = 'move';
    this.draggingOver.set(true);
    const target = event.currentTarget as HTMLElement;
    if (target) target.classList.add('dragging');
  }

  onDragEnd() {
    this.draggingOver.set(false);
    this.dragInsertIndex.set(null);
    this.containerDropTarget.set(null);
    this.containerDropOffset.set(null);
    this.dragPayload = null;
    this.dragOverContainers.set(new Set());
    this.treeDragTarget.set(null);
    document.querySelectorAll('.dragging').forEach(el => el.classList.remove('dragging'));
  }

  onCanvasDragOver(event: DragEvent) {
    if (!this.dragPayload) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = this.dragPayload.includes('"block"') ? 'move' : 'copy';
    this.draggingOver.set(true);
    this.dragInsertIndex.set(this.computeInsertIndex(event));
    this.containerDropTarget.set(null);
    this.containerDropOffset.set(null);
  }

  onCanvasDragLeave(event: DragEvent) {
    if (!this.dragPayload) return;
    const canvas = document.getElementById('cmsCanvasDropList');
    if (!canvas) return;
    if (event.relatedTarget && canvas.contains(event.relatedTarget as Node)) return;
    this.draggingOver.set(false);
    this.dragInsertIndex.set(null);
    this.containerDropTarget.set(null);
    this.containerDropOffset.set(null);
  }

  onCanvasDrop(event: DragEvent) {
    if (!this.dragPayload) return;
    event.preventDefault();
    const index = this.dragInsertIndex() ?? this.dragPayloadGetIndex();
    try {
      const payload = JSON.parse(this.dragPayload);
      if (payload.kind === 'type') {
        this.addBlock(payload.value, index ?? undefined);
        this.toastService.success(`Added ${this.getBlockLabel(payload.value)}`);
      } else if (payload.kind === 'reusable') {
        const r = this.reusableBlocks().find(x => x.id === payload.value);
        if (r) {
          this.addReusableBlock(r, index ?? undefined);
          this.toastService.success('Added reusable component');
        }
      } else if (payload.kind === 'block') {
        const blk = this.findBlock(payload.id);
        const label = blk ? this.getBlockLabel(blk.type) : 'Component';
        this.moveBlockTo(payload.id, null, index ?? this.currentBlocks().length);
        this.toastService.success(`Moved ${label}`);
      }
    } catch (_) {}
    this.onDragEnd();
  }

  selectBlock(b: Block, event?: Event) {
    if (event) event.stopPropagation();
    this.selectedBlock.set(b);
  }

  deselectBlock() {
    this.selectedBlock.set(null);
  }

  findBlock(id: string, list: Block[] = this.currentBlocks()): Block | null {
    for (const b of list) {
      if (b.id === id) return b;
      if (Array.isArray(b.props && b.props['children'])) {
        const found = this.findBlock(id, b.props['children']);
        if (found) return found;
      }
    }
    return null;
  }

  findBlockLocation(id: string, list: Block[] = this.currentBlocks(), parentBlock: Block | null = null): {
    parentArray: Block[];
    index: number;
    parentBlock: Block | null;
    parentContainerId: string | null;
  } | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        return {
          parentArray: list,
          index: i,
          parentBlock,
          parentContainerId: parentBlock ? parentBlock.id : null
        };
      }
      if (Array.isArray(list[i].props && list[i].props['children'])) {
        const loc = this.findBlockLocation(id, list[i].props['children'], list[i]);
        if (loc) return loc;
      }
    }
    return null;
  }

  isDescendant(parentId: string, potentialChildId: string): boolean {
    const parent = this.findBlock(parentId);
    if (!parent || !Array.isArray(parent.props && parent.props['children'])) return false;
    for (const c of parent.props['children']) {
      if (c.id === potentialChildId) return true;
      if (this.isDescendant(c.id, potentialChildId)) return true;
    }
    return false;
  }

  moveBlockTo(blockId: string, targetContainerId: string | null, targetIndex: number) {
    if (targetContainerId && (blockId === targetContainerId || this.isDescendant(blockId, targetContainerId))) {
      return;
    }
    const loc = this.findBlockLocation(blockId);
    if (!loc) return;

    const [block] = loc.parentArray.splice(loc.index, 1);
    if (!block) return;

    if (targetContainerId) {
      const target = this.findBlock(targetContainerId);
      if (target) {
        if (!Array.isArray(target.props['children'])) target.props['children'] = [];
        let idx = targetIndex;
        if (loc.parentArray === target.props['children'] && loc.index < targetIndex) {
          idx--;
        }
        idx = Math.max(0, Math.min(idx, target.props['children'].length));
        target.props['children'].splice(idx, 0, block);
      }
    } else {
      const root = this.currentBlocks();
      let idx = targetIndex;
      if (loc.parentArray === root && loc.index < targetIndex) {
        idx--;
      }
      idx = Math.max(0, Math.min(idx, root.length));
      root.splice(idx, 0, block);
    }

    this.currentBlocks.set([...this.currentBlocks()]);
    this.savePageDebounced();
  }

  insertBlockAt(type: string, targetContainerId: string | null, targetIndex: number) {
    const defaults = BLOCK_DEFAULTS[type] ? JSON.parse(JSON.stringify(BLOCK_DEFAULTS[type])) : {};
    const newBlock: Block = {
      id: this.newBlockId(),
      type,
      props: defaults
    };
    if (targetContainerId) {
      const parent = this.findBlock(targetContainerId);
      if (parent) {
        if (!Array.isArray(parent.props['children'])) parent.props['children'] = [];
        parent.props['children'].splice(targetIndex, 0, newBlock);
      }
    } else {
      const blocks = this.currentBlocks();
      blocks.splice(targetIndex, 0, newBlock);
    }
    this.currentBlocks.set([...this.currentBlocks()]);
    this.selectedBlock.set(newBlock);
    this.savePageDebounced();
  }

  insertReusableBlockAt(reusableId: number, targetContainerId: string | null, targetIndex: number) {
    const r = this.reusableBlocks().find(x => x.id === reusableId);
    if (!r) return;
    const clone = JSON.parse(JSON.stringify(r.block_data));
    this.reassignIds(clone);
    if (targetContainerId) {
      const parent = this.findBlock(targetContainerId);
      if (parent) {
        if (!Array.isArray(parent.props['children'])) parent.props['children'] = [];
        parent.props['children'].splice(targetIndex, 0, clone);
      }
    } else {
      const blocks = this.currentBlocks();
      blocks.splice(targetIndex, 0, clone);
    }
    this.currentBlocks.set([...this.currentBlocks()]);
    this.selectedBlock.set(clone);
    this.savePageDebounced();
  }

  deleteBlock(id: string, event?: Event) {
    if (event) event.stopPropagation();
    const loc = this.findBlockLocation(id);
    if (loc) {
      loc.parentArray.splice(loc.index, 1);
      this.currentBlocks.set([...this.currentBlocks()]);
      if (this.selectedBlock()?.id === id) {
        this.selectedBlock.set(null);
      }
      this.savePageDebounced();
      this.toastService.info('Block deleted');
    }
  }

  moveBlockUp(blockOrIdx: Block | number, event?: Event) {
    if (event) event.stopPropagation();
    let blockId: string | null = null;
    if (typeof blockOrIdx === 'object' && blockOrIdx !== null) {
      blockId = blockOrIdx.id;
    } else if (typeof blockOrIdx === 'number') {
      blockId = this.currentBlocks()[blockOrIdx]?.id || null;
    }
    if (!blockId) return;

    const loc = this.findBlockLocation(blockId);
    if (!loc || loc.index <= 0) return;

    const arr = loc.parentArray;
    const temp = arr[loc.index - 1];
    arr[loc.index - 1] = arr[loc.index];
    arr[loc.index] = temp;

    this.currentBlocks.set([...this.currentBlocks()]);
    this.savePageDebounced();
  }

  moveBlockDown(blockOrIdx: Block | number, event?: Event) {
    if (event) event.stopPropagation();
    let blockId: string | null = null;
    if (typeof blockOrIdx === 'object' && blockOrIdx !== null) {
      blockId = blockOrIdx.id;
    } else if (typeof blockOrIdx === 'number') {
      blockId = this.currentBlocks()[blockOrIdx]?.id || null;
    }
    if (!blockId) return;

    const loc = this.findBlockLocation(blockId);
    if (!loc || loc.index >= loc.parentArray.length - 1) return;

    const arr = loc.parentArray;
    const temp = arr[loc.index + 1];
    arr[loc.index + 1] = arr[loc.index];
    arr[loc.index] = temp;

    this.currentBlocks.set([...this.currentBlocks()]);
    this.savePageDebounced();
  }

  duplicateBlock(b: Block, event?: Event) {
    if (event) event.stopPropagation();
    const cloned: Block = JSON.parse(JSON.stringify(b));
    this.reassignIds(cloned);

    const loc = this.findBlockLocation(b.id);
    if (loc) {
      loc.parentArray.splice(loc.index + 1, 0, cloned);
      this.currentBlocks.set([...this.currentBlocks()]);
      this.selectedBlock.set(cloned);
      this.savePageDebounced();
      this.toastService.success('Block duplicated');
    }
  }

  private reassignIds(b: Block) {
    b.id = this.newBlockId();
    if (Array.isArray(b.props && b.props['children'])) {
      b.props['children'].forEach((c: any) => this.reassignIds(c));
    }
  }

  // --- Tree / Layers Methods ---
  isTreeCollapsed(id: string): boolean {
    return this.collapsedTreeNodes().has(id);
  }

  toggleTreeCollapse(id: string, event?: Event) {
    if (event) event.stopPropagation();
    this.collapsedTreeNodes.update(set => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  onTreeNodeMouseEnter(blockId: string) {
    const el = document.querySelector(`.cms-canvas [data-block-id="${blockId}"]`);
    if (el) el.classList.add('tree-hover-highlight');
  }

  onTreeNodeMouseLeave(blockId: string) {
    const el = document.querySelector(`.cms-canvas [data-block-id="${blockId}"]`);
    if (el) el.classList.remove('tree-hover-highlight');
  }

  scrollToBlock(blockId: string) {
    setTimeout(() => {
      const el = document.querySelector(`.cms-canvas [data-block-id="${blockId}"]`) as HTMLElement;
      if (!el) return;

      const canvasWrap = document.querySelector('.cms-canvas-wrap') as HTMLElement;
      if (canvasWrap) {
        const wrapRect = canvasWrap.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const currentScroll = canvasWrap.scrollTop;
        const targetScroll = currentScroll + (elRect.top - wrapRect.top) - (wrapRect.height / 2) + (elRect.height / 2);
        canvasWrap.scrollTo({ top: Math.max(0, targetScroll), behavior: 'smooth' });
      } else {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }

      el.classList.add('pulse-highlight');
      setTimeout(() => el.classList.remove('pulse-highlight'), 1600);
    }, 60);
  }

  selectTreeBlock(block: Block, event?: Event) {
    if (event) event.stopPropagation();
    this.selectBlock(block, event);
    this.scrollToBlock(block.id);
  }

  getBlockSnippet(block: Block): string {
    const p = block.props || {};
    switch (block.type) {
      case 'heading': return p['text'] || 'Heading';
      case 'paragraph': return p['text'] ? (p['text'].length > 20 ? p['text'].slice(0, 20) + '...' : p['text']) : '';
      case 'button': return p['label'] || 'Button';
      case 'image': return p['caption'] || '';
      case 'carousel': return `${(p['slides'] || []).length} slides`;
      case 'container': return p['mode'] === 'grid' ? `${p['columns'] || 2} cols` : (p['direction'] || 'row');
      case 'header': return p['brandName'] || 'Brand';
      case 'footer': return p['brandName'] || 'Brand';
      case 'callout': return p['title'] || '';
      case 'accordion': return `${(p['items'] || []).length} items`;
      case 'table': return `${(p['headers'] || []).length} cols`;
      case 'pricing': return `${(p['plans'] || []).length} plans`;
      case 'stat': return p['value'] ? `${p['value']} ${p['label'] || ''}` : '';
      case 'testimonial': return p['author'] || '';
      default: return '';
    }
  }

  getBlockIcon(type: string): SafeHtml {
    for (const cat of this.blockCategories) {
      const item = cat.items.find(i => i.type === type);
      if (item) return this.iconSafe(item.iconSvg);
    }
    return this.iconSafe('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>');
  }

  onTreeDragStart(event: DragEvent, block: Block) {
    event.stopPropagation();
    this.dragPayload = JSON.stringify({ kind: 'block', id: block.id, fromTree: true });
    event.dataTransfer!.setData(this.dragFormat, this.dragPayload);
    event.dataTransfer!.setData('text/plain', block.id);
    event.dataTransfer!.effectAllowed = 'move';
  }

  onTreeDragOver(event: DragEvent, targetBlock: Block) {
    if (!this.dragPayload) return;
    let payload: any;
    try { payload = JSON.parse(this.dragPayload); } catch { return; }
    if (payload.kind === 'block' && (payload.id === targetBlock.id || this.isDescendant(payload.id, targetBlock.id))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = payload.kind === 'block' ? 'move' : 'copy';

    const row = event.currentTarget as HTMLElement;
    const rect = row.getBoundingClientRect();
    const relY = (event.clientY - rect.top) / rect.height;
    const isContainer = targetBlock.type === 'container' || targetBlock.type === 'header';

    let pos: 'before' | 'after' | 'inside' = 'after';
    if (isContainer && relY > 0.25 && relY < 0.75) {
      pos = 'inside';
    } else if (relY <= 0.5) {
      pos = 'before';
    } else {
      pos = 'after';
    }

    this.treeDragTarget.set({ id: targetBlock.id, pos });
  }

  onTreeDragLeave(event: DragEvent, targetBlock: Block) {
    const row = event.currentTarget as HTMLElement;
    if (event.relatedTarget && row.contains(event.relatedTarget as Node)) return;
    if (this.treeDragTarget()?.id === targetBlock.id) {
      this.treeDragTarget.set(null);
    }
  }

  onTreeDrop(event: DragEvent, targetBlock: Block) {
    event.preventDefault();
    event.stopPropagation();
    const targetState = this.treeDragTarget();
    this.treeDragTarget.set(null);

    if (!this.dragPayload) return;
    let payload: any;
    try { payload = JSON.parse(this.dragPayload); } catch { return; }

    if (payload.kind === 'block' && (payload.id === targetBlock.id || this.isDescendant(payload.id, targetBlock.id))) {
      return;
    }

    const dropPos = targetState?.pos || 'after';
    const isContainer = targetBlock.type === 'container' || targetBlock.type === 'header';

    let targetParentId: string | null = null;
    let targetIdx = 0;

    if (dropPos === 'inside' && isContainer) {
      targetParentId = targetBlock.id;
      const container = this.findBlock(targetBlock.id);
      targetIdx = (container && container.props && Array.isArray(container.props['children']))
        ? container.props['children'].length : 0;
      this.collapsedTreeNodes.update(set => {
        const next = new Set(set);
        next.delete(targetBlock.id);
        return next;
      });
    } else {
      const loc = this.findBlockLocation(targetBlock.id);
      if (loc) {
        targetParentId = loc.parentContainerId;
        targetIdx = dropPos === 'before' ? loc.index : loc.index + 1;
      }
    }

    if (payload.kind === 'block') {
      this.moveBlockTo(payload.id, targetParentId, targetIdx);
      this.toastService.success('Component moved');
    } else if (payload.kind === 'type') {
      this.insertBlockAt(payload.value, targetParentId, targetIdx);
      this.toastService.success(`Added ${this.getBlockLabel(payload.value)}`);
    } else if (payload.kind === 'reusable') {
      this.insertReusableBlockAt(payload.value, targetParentId, targetIdx);
      this.toastService.success('Added reusable component');
    }

    this.onDragEnd();
  }

  openSaveReusableModal(b: Block, event?: Event) {
    if (event) event.stopPropagation();
    this.targetReusableBlock.set(b);
    const defaultName = this.getBlockSnippet(b) || this.getBlockLabel(b.type);
    this.reusableNameInput.set(defaultName);
    this.reusableCategoryInput.set(b.type || 'custom');
    this.showSaveReusableModal.set(true);
  }

  closeSaveReusableModal() {
    this.showSaveReusableModal.set(false);
    this.targetReusableBlock.set(null);
  }

  confirmSaveReusable() {
    const b = this.targetReusableBlock();
    const name = this.reusableNameInput().trim();
    if (!b || !name) return;

    const category = this.reusableCategoryInput().trim() || b.type || 'custom';
    const blockCopy = JSON.parse(JSON.stringify(b));

    this.cmsService.createReusableBlock(name, blockCopy, category).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.closeSaveReusableModal();
        this.loadReusableBlocks();
        this.sidebarTab.set('reusable');
        this.leftSidebarCollapsed.set(false);
        this.toastService.success(`Saved reusable component "${name}"`);
      },
      error: (err) => {
        console.error('Failed to save reusable block:', err);
        this.toastService.error('Failed to save reusable component');
      }
    });
  }

  saveAsReusable(b: Block, event?: Event) {
    this.openSaveReusableModal(b, event);
  }

  deleteReusableBlock(id: number, event: MouseEvent) {
    event.stopPropagation();
    if (!confirm('Delete this saved reusable block?')) return;
    this.cmsService.deleteReusableBlock(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => {
        this.loadReusableBlocks();
        this.toastService.info('Deleted reusable component');
      },
      error: (err) => {
        console.error('Failed to delete reusable block:', err);
        this.toastService.error('Failed to delete reusable component');
      }
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
    let payload: any;
    try { payload = JSON.parse(this.dragPayload); } catch { return; }
    if (payload.kind === 'block' && (payload.id === b.id || this.isDescendant(payload.id, b.id))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer!.dropEffect = payload.kind === 'block' ? 'move' : 'copy';
    this.dragInsertIndex.set(null);
    const containerEl = event.currentTarget as HTMLElement;
    const idx = this.getContainerInsertIndex(containerEl, event.clientX, event.clientY);
    this.containerDropTarget.set({ containerId: b.id, index: idx });
    this.containerDropOffset.set(this.computeContainerDropOffset(containerEl, b, idx));
    this.dragOverContainers.set(new Set([b.id]));
  }

  containerIsHorizontal(b: Block): boolean {
    return b.props['mode'] === 'grid' ||
      (b.props['direction'] || 'row') === 'row' ||
      (b.props['direction'] || 'row') === 'row-reverse';
  }

  private computeContainerDropOffset(containerEl: HTMLElement, b: Block, index: number): { offset: number; horizontal: boolean } | null {
    const children = Array.from(containerEl.querySelectorAll<HTMLElement>(':scope > .container-child, :scope > .block-wrap'));
    if (!children.length) return null;
    const horizontal = this.containerIsHorizontal(b);
    const containerRect = containerEl.getBoundingClientRect();
    const clamp = (n: number) => Math.max(0, Math.min(n, horizontal ? containerRect.width : containerRect.height));
    if (index >= children.length) {
      const r = children[children.length - 1].getBoundingClientRect();
      return { offset: clamp((horizontal ? r.right : r.bottom) - (horizontal ? containerRect.left : containerRect.top)), horizontal };
    }
    if (index === 0) {
      const r = children[0].getBoundingClientRect();
      return { offset: clamp((horizontal ? r.left : r.top) - (horizontal ? containerRect.left : containerRect.top)), horizontal };
    }
    const a = children[index - 1].getBoundingClientRect();
    const c = children[index].getBoundingClientRect();
    const mid = horizontal ? (a.right + c.left) / 2 : (a.bottom + c.top) / 2;
    return { offset: clamp(mid - (horizontal ? containerRect.left : containerRect.top)), horizontal };
  }

  onContainerDragLeave(b: Block, event: DragEvent) {
    const containerEl = event.currentTarget as HTMLElement;
    if (event.relatedTarget && containerEl.contains(event.relatedTarget as Node)) return;
    this.containerDropTarget.set(null);
    this.containerDropOffset.set(null);
    this.dragOverContainers.update(s => {
      if (!s.has(b.id)) return s;
      const n = new Set(s);
      n.delete(b.id);
      return n;
    });
  }

  onContainerDrop(b: Block, event: DragEvent) {
    if (!this.dragPayload) return;
    let payload: any;
    try { payload = JSON.parse(this.dragPayload); } catch { return; }
    if (payload.kind === 'block' && (payload.id === b.id || this.isDescendant(payload.id, b.id))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    const containerEl = event.currentTarget as HTMLElement;
    try {
      const target = this.containerDropTarget();
      const targetIdx = (target && target.containerId === b.id) ? target.index : this.getContainerInsertIndex(containerEl, event.clientX, event.clientY);
      if (payload.kind === 'type') {
        if (payload.value === 'header' || payload.value === 'footer') {
          this.toastService.warning(`${this.getBlockLabel(payload.value)} cannot be placed inside a container`);
          this.onDragEnd();
          return;
        }
        this.insertBlockAt(payload.value, b.id, targetIdx);
        this.toastService.success(`Added ${this.getBlockLabel(payload.value)} to container`);
      } else if (payload.kind === 'reusable') {
        this.insertReusableBlockAt(payload.value, b.id, targetIdx);
        this.toastService.success('Added reusable component to container');
      } else if (payload.kind === 'block') {
        const blk = this.findBlock(payload.id);
        if (blk && (blk.type === 'header' || blk.type === 'footer')) {
          this.toastService.warning(`${this.getBlockLabel(blk.type)} cannot be placed inside a container`);
          this.onDragEnd();
          return;
        }
        this.moveBlockTo(payload.id, b.id, targetIdx);
        this.toastService.success('Component moved into container');
      }
    } catch (_) {}
    this.onDragEnd();
  }

  getContainerInsertIndex(containerEl: HTMLElement, clientX: number, clientY: number): number {
    const children = Array.from(containerEl.querySelectorAll<HTMLElement>(':scope > .container-child, :scope > .block-wrap'));
    if (!children.length) return 0;
    const style = window.getComputedStyle(containerEl);
    const horizontal = style.display === 'grid' || style.flexDirection === 'row' || style.flexDirection === 'row-reverse';
    for (let i = 0; i < children.length; i++) {
      const rect = children[i].getBoundingClientRect();
      if (horizontal) {
        if (clientX < rect.left + rect.width / 2) return i;
      } else {
        if (clientY < rect.top + rect.height / 2) return i;
      }
    }
    return children.length;
  }

  addReusableChild(b: Block, r: ReusableBlock) {
    const clone = JSON.parse(JSON.stringify(r.block_data));
    this.reassignIds(clone);
    this.mutateAndSave(() => {
      if (!Array.isArray(b.props['children'])) b.props['children'] = [];
      b.props['children'].push(clone);
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
    const isDark = this.themeService.isDark();
    const themes: Record<string, { bg: string; border: string; titleColor: string; icon: string }> = {
      tip: {
        bg: isDark ? 'rgba(139, 92, 246, 0.12)' : 'rgba(139, 92, 246, 0.08)',
        border: '#8b5cf6',
        titleColor: isDark ? '#a78bfa' : '#6d28d9',
        icon: '💡'
      },
      info: {
        bg: isDark ? 'rgba(59, 130, 246, 0.12)' : 'rgba(59, 130, 246, 0.08)',
        border: '#3b82f6',
        titleColor: isDark ? '#60a5fa' : '#1d4ed8',
        icon: 'ℹ️'
      },
      success: {
        bg: isDark ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.08)',
        border: '#10b981',
        titleColor: isDark ? '#34d399' : '#047857',
        icon: '✅'
      },
      warning: {
        bg: isDark ? 'rgba(245, 158, 11, 0.12)' : 'rgba(245, 158, 11, 0.08)',
        border: '#f59e0b',
        titleColor: isDark ? '#fbbf24' : '#b45309',
        icon: '⚠️'
      },
      danger: {
        bg: isDark ? 'rgba(239, 68, 68, 0.12)' : 'rgba(239, 68, 68, 0.08)',
        border: '#ef4444',
        titleColor: isDark ? '#f87171' : '#b91c1c',
        icon: '🛑'
      }
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
    if (!page) {
      this.toastService.info('No active page selected');
      return;
    }

    if (this.isSaving()) return;
    this.isSaving.set(true);

    this.cmsService.updatePage(page.id, {
      title: page.title,
      slug: page.slug,
      status: page.status,
      blocks: this.currentBlocks(),
      settings: this.pageSettings()
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.isSaving.set(false);
        this.isSaved.set(true);
        this.toastService.success('Page saved successfully');
        setTimeout(() => this.isSaved.set(false), 1400);

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
          this.cmsService.getPage(page.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(p => this.activePage.set(p));
        }
      },
      error: (err) => {
        this.isSaving.set(false);
        console.error('Failed to save page:', err);
        this.toastService.error('Failed to save page');
      }
    });
  }

  getCanvasBackground(): string {
    const bg = this.pageSettings()['bg'] || 'default';
    switch (bg) {
      case 'pure-black': return '#000000';
      case 'deep-navy': return '#0a1324';
      case 'dark-card': return '#111827';
      case 'light': return '#ffffff';
      case 'custom': return this.pageSettings()['customBg'] || '#0f172a';
      default: return this.effectiveCanvasTheme() === 'dark' ? '#0b0f19' : '#ffffff';
    }
  }

  getCanvasTextColor(): string {
    const bg = this.pageSettings()['bg'] || 'default';
    if (bg === 'light') return '#0f172a';
    if (bg === 'pure-black' || bg === 'deep-navy' || bg === 'dark-card') return '#f8fafc';
    return this.effectiveCanvasTheme() === 'dark' ? '#f8fafc' : '#0f172a';
  }

  getCanvasFontFamily(): string {
    const font = this.pageSettings()['fontFamily'] || 'system';
    switch (font) {
      case 'inter': return "'Inter', sans-serif";
      case 'outfit': return "'Outfit', sans-serif";
      case 'roboto': return "'Roboto', sans-serif";
      case 'mono': return "'JetBrains Mono', monospace";
      default: return "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif";
    }
  }

  updateSetting(key: string, value: any) {
    this.pageSettings.update(s => ({ ...s, [key]: value }));
    this.savePageDebounced();
  }

  updateNumberSetting(key: string, value: any) {
    const num = Number(value);
    this.updateSetting(key, isNaN(num) ? 0 : num);
  }

  getPageWordCount(): number {
    let count = 0;
    const tally = (b: Block) => {
      if (b.props) {
        if (b.props['text']) count += String(b.props['text']).trim().split(/\s+/).filter(Boolean).length;
        if (b.props['label']) count += String(b.props['label']).trim().split(/\s+/).filter(Boolean).length;
        if (b.props['caption']) count += String(b.props['caption']).trim().split(/\s+/).filter(Boolean).length;
        if (Array.isArray(b.props['slides'])) {
          b.props['slides'].forEach((s: any) => {
            if (s.caption) count += String(s.caption).trim().split(/\s+/).filter(Boolean).length;
          });
        }
        if (Array.isArray(b.props['children'])) {
          b.props['children'].forEach(tally);
        }
      }
    };
    this.currentBlocks().forEach(tally);
    return count;
  }

  getReadTimeMinutes(): number {
    return Math.max(1, Math.ceil(this.getPageWordCount() / 200));
  }

  getTotalBlockCount(): number {
    let count = 0;
    const tally = (list: Block[]) => {
      list.forEach(b => {
        count++;
        if (Array.isArray(b.props && b.props['children'])) {
          tally(b.props['children']);
        }
      });
    };
    tally(this.currentBlocks());
    return count;
  }

  openLivePage() {
    const page = this.activePage();
    if (page?.slug) {
      window.open(`/p/${page.slug}`, '_blank');
    } else {
      this.toastService.info('Page has no slug set');
    }
  }

  private saveTimeout: any = null;
  savePageDebounced() {
    clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => this.savePageNow(), 500);
  }

  toggleFirstPage() {
    const page = this.activePage();
    if (!page) return;
    this.cmsService.setFirstPage(page.id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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

    this.cmsService.createPage({ title: title.trim(), slug }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
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
    this.cmsService.deletePage(id).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: () => this.loadPages(),
      error: (err) => console.error('Failed to delete page:', err)
    });
  }

  onAiPageGenerated(res: { page: CmsPage }) {
    this.cmsService.getPages().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(list => {
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
    if (!wraps.length) return 0;

    let idx = wraps.length;
    for (let i = 0; i < wraps.length; i++) {
      const midY = wraps[i].getBoundingClientRect().top + wraps[i].getBoundingClientRect().height / 2;
      if (event.clientY < midY) {
        idx = i;
        break;
      }
    }

    const blocks = this.currentBlocks();
    const hasHeader = blocks.length > 0 && blocks[0].type === 'header';
    const hasFooter = blocks.length > 0 && blocks[blocks.length - 1].type === 'footer';

    let draggedType: string | null = null;
    if (this.dragPayload) {
      try {
        const p = JSON.parse(this.dragPayload);
        if (p.kind === 'type') draggedType = p.value;
        else if (p.kind === 'block') {
          const b = this.findBlock(p.id);
          if (b) draggedType = b.type;
        }
      } catch (_) {}
    }

    if (hasHeader && draggedType !== 'header' && idx === 0) {
      idx = 1;
    }
    if (hasFooter && draggedType !== 'footer' && idx >= blocks.length) {
      idx = Math.max(0, blocks.length - 1);
    }

    return idx;
  }

  private dragPayloadGetIndex(): number {
    const canvas = document.getElementById('cmsCanvasDropList');
    return canvas ? canvas.querySelectorAll<HTMLElement>(':scope > .block-wrap').length : 0;
  }
}
