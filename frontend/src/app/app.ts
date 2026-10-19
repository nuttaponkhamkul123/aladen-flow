import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, NavigationEnd, RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/components/header/header.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { SettingsModalComponent } from './shared/components/settings-modal/settings-modal.component';
import { AuthModalComponent } from './shared/components/auth-modal/auth-modal.component';
import { CommandPaletteComponent } from './shared/components/command-palette/command-palette.component';
import { ToastService } from './core/services/toast.service';
import { SettingsService } from './core/services/settings.service';
import { AuthService } from './core/services/auth.service';
import { AnimationService } from './core/services/animation.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, SidebarComponent, SettingsModalComponent, AuthModalComponent, CommandPaletteComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  toastService = inject(ToastService);
  settingsService = inject(SettingsService);
  authService = inject(AuthService);
  animationService = inject(AnimationService);
  private router = inject(Router);
  toasts = this.toastService.toasts;

  constructor() {
    this.router.events.pipe(takeUntilDestroyed()).subscribe(event => {
      if (event instanceof NavigationEnd) {
        setTimeout(() => {
          this.animationService.animateTabTransition('.app-main-content');
        }, 15);
      }
    });
  }
}


