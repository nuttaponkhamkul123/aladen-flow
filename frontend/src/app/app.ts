import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/components/header/header.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { SettingsModalComponent } from './shared/components/settings-modal/settings-modal.component';
import { AuthModalComponent } from './shared/components/auth-modal/auth-modal.component';
import { ToastService } from './core/services/toast.service';
import { SettingsService } from './core/services/settings.service';
import { AuthService } from './core/services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, HeaderComponent, SidebarComponent, SettingsModalComponent, AuthModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  toastService = inject(ToastService);
  settingsService = inject(SettingsService);
  authService = inject(AuthService);
  toasts = this.toastService.toasts;
}


