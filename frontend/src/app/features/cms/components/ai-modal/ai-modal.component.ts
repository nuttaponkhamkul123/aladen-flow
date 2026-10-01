import { Component, Output, EventEmitter, OnInit, AfterViewInit, OnDestroy, inject, DestroyRef, ElementRef, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiService, OllamaModelInfo } from '../../../../core/services/ai.service';

interface Preset {
  id: string;
  label: string;
  prompt: string;
}

@Component({
  selector: 'app-ai-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-modal.component.html',
  styleUrls: ['./ai-modal.component.css']
})
export class AiModalComponent implements OnInit, AfterViewInit, OnDestroy {
  @Output() close = new EventEmitter<void>();
  @Output() pageGenerated = new EventEmitter<{ page: any }>();

  private aiService = inject(AiService);
  private destroyRef = inject(DestroyRef);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Previously focused element, restored on close so keyboard users keep context. */
  private previouslyFocused: HTMLElement | null = null;

  prompt = '';
  theme = 'dark-card';
  provider = 'opencode';
  selectedOllamaModel = '';
  ollamaModels: OllamaModelInfo[] = [];
  ollamaLoading = false;
  generating = false;
  errorMessage = '';
  activePreset = '';

  readonly presets: Preset[] = [
    {
      id: 'saas',
      label: 'SaaS Landing',
      prompt:
        'Modern high-converting B2B SaaS landing page for an AI developer platform. Includes header navbar, punchy hero headline with primary and secondary CTA, 4-card bento grid feature showcase, customer testimonials, and pricing comparison table.'
    },
    {
      id: 'portfolio',
      label: 'Designer Portfolio',
      prompt:
        'Minimalist creative portfolio for a senior product designer. Features a bold typography hero, selected work showcase with rich media tiles, experience timeline, and a clean contact inquiry form.'
    },
    {
      id: 'ecommerce',
      label: 'Product Launch',
      prompt:
        'Sleek product launch showcase page for a high-end mechanical keyboard. Features an immersive hero with product visual, specs table, audio sound test player, FAQ accordion, and preorder pricing card.'
    }
  ];

  ngOnInit() {
    this.previouslyFocused = document.activeElement as HTMLElement | null;
  }

  ngAfterViewInit() {
    // Move focus into the dialog so keyboard and screen-reader users land here
    // instead of staying on the toolbar button that opened it.
    this.focusFirstField();
  }

  ngOnDestroy() {
    this.previouslyFocused?.focus?.();
  }

  private focusFirstField() {
    const textarea = this.host.nativeElement.querySelector<HTMLTextAreaElement>('#ai-prompt');
    textarea?.focus();
  }

  /** Esc closes the dialog, matching the vanilla-JS modal behaviour. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (!this.generating) {
      this.close.emit();
    }
  }

  /** Keeps Tab focus cycling inside the dialog while it is open. */
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;

    const focusables = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea, select, input, [tabindex]:not([tabindex="-1"])'
      )
    ).filter(el => el.offsetParent !== null);

    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('ai-modal') && !this.generating) {
      this.close.emit();
    }
  }

  applyPreset(id: string) {
    const preset = this.presets.find(p => p.id === id);
    if (!preset) return;
    // Toggle off if the same preset is clicked again.
    this.activePreset = this.activePreset === id ? '' : id;
    this.prompt = this.activePreset ? preset.prompt : '';
  }

  onProviderChange() {
    if (this.provider === 'ollama') {
      this.loadOllamaModels();
    }
  }

  loadOllamaModels() {
    this.ollamaLoading = true;
    this.errorMessage = '';
    this.aiService.getOllamaModels().pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.ollamaLoading = false;
        if (res.ok && res.models) {
          this.ollamaModels = res.models;
          if (res.models.length > 0) {
            this.selectedOllamaModel = res.models[0].name;
          }
        } else {
          this.errorMessage = res.error || 'Failed to detect Ollama models.';
        }
      },
      error: (err) => {
        this.ollamaLoading = false;
        this.errorMessage = 'Could not reach local Ollama on port 11434.';
      }
    });
  }

  generate() {
    if (!this.prompt.trim()) return;
    this.generating = true;
    this.errorMessage = '';

    const payload = {
      prompt: this.prompt.trim(),
      preset: this.activePreset || undefined,
      theme: this.theme,
      provider: this.provider,
      model: this.provider === 'ollama' ? this.selectedOllamaModel : undefined
    };

    this.aiService.generatePage(payload).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.generating = false;
        if (res.page) {
          this.pageGenerated.emit({ page: res.page });
          if (res.warning) {
            console.warn('AI generation warning:', res.warning);
          }
          this.close.emit();
        } else {
          this.errorMessage = res.warning || 'AI generation failed. Please try again.';
        }
      },
      error: (err) => {
        this.generating = false;
        this.errorMessage = err.error?.error || 'Failed to communicate with AI generation endpoint.';
      }
    });
  }
}
