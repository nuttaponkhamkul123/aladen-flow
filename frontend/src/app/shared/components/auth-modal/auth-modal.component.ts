import { Component, inject, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-auth-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './auth-modal.component.html',
  styleUrls: ['./auth-modal.component.css']
})
export class AuthModalComponent {
  authService = inject(AuthService);

  @Input() isGate: boolean = false;

  username = '';
  password = '';
  email = '';
  displayName = '';
  errorMessage = '';

  onBackdropClick(event: MouseEvent) {
    if (this.isGate) return;
    if ((event.target as HTMLElement).classList.contains('modal-backdrop')) {
      this.authService.closeModal();
    }
  }

  switchMode(mode: 'login' | 'register') {
    this.authService.authModalMode.set(mode);
    this.errorMessage = '';
  }

  onSubmit() {
    this.errorMessage = '';
    const u = this.username.trim();
    const p = this.password;

    if (!u || !p) {
      this.errorMessage = 'Please enter your username and password';
      return;
    }

    if (this.authService.authModalMode() === 'login') {
      this.authService.login({ username: u, password: p }).subscribe({
        next: () => {
          this.username = '';
          this.password = '';
          this.errorMessage = '';
        },
        error: (err) => {
          this.errorMessage = err?.error?.error || 'Invalid credentials. Please try again.';
        }
      });
    } else {
      this.authService.register({
        username: u,
        password: p,
        email: this.email.trim() || undefined,
        displayName: this.displayName.trim() || undefined
      }).subscribe({
        next: () => {
          this.username = '';
          this.password = '';
          this.email = '';
          this.displayName = '';
          this.errorMessage = '';
        },
        error: (err) => {
          this.errorMessage = err?.error?.error || 'Registration failed. Please check inputs.';
        }
      });
    }
  }

  quickLogin(uname: string) {
    this.authService.quickSwitchUser(uname);
  }
}
