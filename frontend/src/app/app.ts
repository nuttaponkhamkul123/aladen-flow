import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HeaderComponent } from './shared/components/header/header.component';
import { SidebarComponent } from './shared/components/sidebar/sidebar.component';
import { SettingsModalComponent } from './shared/components/settings-modal/settings-modal.component';
import { ToastService } from './core/services/toast.service';
import { SettingsService } from './core/services/settings.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, HeaderComponent, SidebarComponent, SettingsModalComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  toastService = inject(ToastService);
  settingsService = inject(SettingsService);
  toasts = this.toastService.toasts;
}

