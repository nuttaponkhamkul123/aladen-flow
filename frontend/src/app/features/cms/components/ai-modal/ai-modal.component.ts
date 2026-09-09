import { Component, Output, EventEmitter, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AiService, OllamaModelInfo } from '../../../../core/services/ai.service';

@Component({
  selector: 'app-ai-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './ai-modal.component.html',
  styleUrls: ['./ai-modal.component.css']
})
export class AiModalComponent implements OnInit {
  @Output() close = new EventEmitter<void>();
  @Output() pageGenerated = new EventEmitter<{ page: any }>();

  private aiService = inject(AiService);
  private destroyRef = inject(DestroyRef);

  prompt = '';
  theme = 'dark-card';
  provider = 'opencode';
  selectedOllamaModel = '';
  ollamaModels: OllamaModelInfo[] = [];
  ollamaLoading = false;
  generating = false;
  errorMessage = '';

  ngOnInit() {
    // Initial check
  }

  onBackdropClick(event: MouseEvent) {
    if ((event.target as HTMLElement).classList.contains('modal')) {
      this.close.emit();
    }
  }

  applyPreset(type: string) {
    if (type === 'saas') {
      this.prompt = 'Modern high-converting B2B SaaS landing page for an AI developer platform. Includes header navbar, punchy hero headline with primary and secondary CTA, 4-card bento grid feature showcase, customer testimonials, and pricing comparison table.';
    } else if (type === 'portfolio') {
      this.prompt = 'Minimalist creative portfolio for a senior product designer. Features a bold typography hero, selected work showcase with rich media tiles, experience timeline, and a clean contact inquiry form.';
    } else if (type === 'ecommerce') {
      this.prompt = 'Sleek product launch showcase page for a high-end mechanical keyboard. Features an immersive hero with product visual, specs table, audio sound test player, FAQ accordion, and preorder pricing card.';
    }
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
