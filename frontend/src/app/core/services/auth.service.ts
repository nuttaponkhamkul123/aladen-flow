import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap, catchError, of } from 'rxjs';
import { User, UserSettings, AuthResponse } from '../models/user.model';
import { ThemeService, ThemeMode, AmbientTheme } from './theme.service';
import { SettingsService } from './settings.service';
import { ToastService } from './toast.service';
import { AnimationService } from './animation.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  private themeService = inject(ThemeService);
  private settingsService = inject(SettingsService);
  private toastService = inject(ToastService);
  private router = inject(Router);
  private animationService = inject(AnimationService);

  private readonly TOKEN_KEY = 'aladen_auth_token';

  currentUser = signal<User | null>(null);
  currentSettings = signal<UserSettings | null>(null);
  token = signal<string | null>(this.getStoredToken());
  isLoggedIn = computed<boolean>(() => !!this.currentUser());
  authInitialized = signal<boolean>(false);
  isTransitioningToDashboard = signal<boolean>(false);

  availableUsers = signal<any[]>([]);
  isAuthModalOpen = signal<boolean>(false);
  authModalMode = signal<'login' | 'register'>('login');
  isLoading = signal<boolean>(false);

  constructor() {
    // Hook up ThemeService and SettingsService callbacks to persist to user profile
    this.themeService.onSettingsChange = (patch) => {
      if (this.isLoggedIn()) {
        this.updateSettings(patch).subscribe();
      }
    };

    this.settingsService.onSettingsChange = (patch) => {
      if (this.isLoggedIn()) {
        this.updateSettings(patch).subscribe();
      }
    };

    this.checkAuth();
  }

  private getStoredToken(): string | null {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return localStorage.getItem(this.TOKEN_KEY);
      }
    } catch (_) {}
    return null;
  }

  private setStoredToken(token: string | null) {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (token) {
          localStorage.setItem(this.TOKEN_KEY, token);
        } else {
          localStorage.removeItem(this.TOKEN_KEY);
        }
      }
    } catch (_) {}
  }

  checkAuth() {
    this.fetchAvailableUsers();
    const token = this.token();
    if (!token) {
      this.authInitialized.set(true);
      return;
    }

    this.http.get<{ user: User; settings: UserSettings }>('/api/auth/me').pipe(
      catchError(() => {
        this.setStoredToken(null);
        this.token.set(null);
        this.currentUser.set(null);
        this.currentSettings.set(null);
        this.themeService.resetToDefaults();
        this.settingsService.resetToDefaults();
        return of(null);
      })
    ).subscribe(res => {
      if (res) {
        this.currentUser.set(res.user);
        this.currentSettings.set(res.settings);
        this.applyUserSettings(res.settings);
      } else {
        this.themeService.resetToDefaults();
        this.settingsService.resetToDefaults();
      }
      this.authInitialized.set(true);
    });
  }

  fetchAvailableUsers() {
    this.http.get<any[]>('/api/auth/users').pipe(
      catchError(() => of([]))
    ).subscribe(users => {
      this.availableUsers.set(users);
    });
  }

  login(credentials: { username: string; password: string }, fromGate: boolean = false): Observable<AuthResponse> {
    this.isLoading.set(true);
    return this.http.post<AuthResponse>('/api/auth/login', credentials).pipe(
      tap({
        next: (res) => {
          this.isLoading.set(false);
          this.setStoredToken(res.token);
          this.token.set(res.token);
          if (fromGate || !this.currentUser()) {
            this.isTransitioningToDashboard.set(true);
          }
          this.currentUser.set(res.user);
          this.currentSettings.set(res.settings || null);
          if (res.settings) {
            this.applyUserSettings(res.settings);
          }
          this.toastService.show(`Welcome back, ${res.user.display_name}!`, 'success');
          this.closeModal();
          this.fetchAvailableUsers();

          if (fromGate || this.isTransitioningToDashboard()) {
            this.router.navigate(['/dashboard']).then(() => {
              setTimeout(() => {
                this.animationService.animateLoginToDashboard(() => {
                  this.isTransitioningToDashboard.set(false);
                });
              }, 40);
            });
          }
        },
        error: (err) => {
          this.isLoading.set(false);
          this.isTransitioningToDashboard.set(false);
          console.error('Login error:', err);
        }
      })
    );
  }

  register(data: { username: string; password: string; email?: string; displayName?: string }, fromGate: boolean = false): Observable<AuthResponse> {
    this.isLoading.set(true);
    return this.http.post<AuthResponse>('/api/auth/register', data).pipe(
      tap({
        next: (res) => {
          this.isLoading.set(false);
          this.setStoredToken(res.token);
          this.token.set(res.token);
          if (fromGate || !this.currentUser()) {
            this.isTransitioningToDashboard.set(true);
          }
          this.currentUser.set(res.user);
          this.currentSettings.set(res.settings || null);
          if (res.settings) {
            this.applyUserSettings(res.settings);
          }
          this.toastService.show(`Account created! Welcome, ${res.user.display_name}.`, 'success');
          this.closeModal();
          this.fetchAvailableUsers();

          if (fromGate || this.isTransitioningToDashboard()) {
            this.router.navigate(['/dashboard']).then(() => {
              setTimeout(() => {
                this.animationService.animateLoginToDashboard(() => {
                  this.isTransitioningToDashboard.set(false);
                });
              }, 40);
            });
          }
        },
        error: (err) => {
          this.isLoading.set(false);
          this.isTransitioningToDashboard.set(false);
          console.error('Registration error:', err);
        }
      })
    );
  }

  logout(): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>('/api/auth/logout', {}).pipe(
      catchError(() => of({ ok: true })),
      tap(() => {
        this.isTransitioningToDashboard.set(false);
        this.setStoredToken(null);
        this.token.set(null);
        this.currentUser.set(null);
        this.currentSettings.set(null);
        this.themeService.resetToDefaults();
        this.settingsService.resetToDefaults();
        this.toastService.show('You have been signed out', 'info');
        this.router.navigate(['/dashboard']);
      })
    );
  }

  applyUserSettings(settings: UserSettings) {
    if (!settings) return;
    const uid = this.currentUser()?.id || null;

    // Apply separated theme mode & ambient style strictly isolated to this user
    this.themeService.setUser(uid, settings);

    // Apply separated AI preferences strictly isolated to this user
    this.settingsService.setUser(uid, settings);
  }

  updateSettings(patch: Partial<UserSettings>): Observable<UserSettings> {
    return this.http.patch<UserSettings>('/api/users/settings', patch).pipe(
      tap(updated => {
        this.currentSettings.set(updated);
      })
    );
  }

  openLogin() {
    this.authModalMode.set('login');
    this.isAuthModalOpen.set(true);
  }

  openRegister() {
    this.authModalMode.set('register');
    this.isAuthModalOpen.set(true);
  }

  closeModal() {
    this.isAuthModalOpen.set(false);
  }
}
