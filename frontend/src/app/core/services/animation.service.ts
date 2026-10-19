import { Injectable } from '@angular/core';
import { animate, stagger } from 'animejs';

@Injectable({
  providedIn: 'root'
})
export class AnimationService {

  /**
   * Smooth transition when switching tabs / views across Aladenflow Studio
   */
  animateTabTransition(target: string | HTMLElement = '.app-main-content') {
    try {
      animate(target, {
        opacity: [0, 1],
        translateY: [12, 0],
        duration: 340,
        ease: 'outCubic'
      });
    } catch (e) {
      console.warn('Anime tab transition error:', e);
    }
  }

  /**
   * Staggered entrance animation when user enters the Telemetry Dashboard
   */
  animateDashboardEntrance() {
    try {
      // 1. Dashboard Header
      animate('.dash-header', {
        opacity: [0, 1],
        translateY: [-16, 0],
        duration: 380,
        ease: 'outCubic'
      });

      // 2. Stat Metric Cards (Staggered spring up)
      animate('.stat-card', {
        opacity: [0, 1],
        translateY: [24, 0],
        scale: [0.95, 1],
        delay: stagger(60, { start: 90 }),
        duration: 440,
        ease: 'outCubic'
      });

      // 3. Telemetry and chart panels
      animate('.dash-grid > div, .telemetry-grid > div, .cms-overview-grid > div, .chart-card, .pipeline-card, .dash-panel', {
        opacity: [0, 1],
        translateY: [20, 0],
        delay: stagger(70, { start: 240 }),
        duration: 460,
        ease: 'outCubic'
      });

      // 4. Stage progress bars fill
      animate('.stage-bar-fill', {
        scaleX: [0, 1],
        transformOrigin: 'left',
        delay: stagger(50, { start: 280 }),
        duration: 520,
        ease: 'outCubic'
      });

      // 5. Board progress list items
      animate('.board-progress-item, .cms-doc-item', {
        opacity: [0, 1],
        translateY: [12, 0],
        delay: stagger(35, { start: 320 }),
        duration: 400,
        ease: 'outCubic'
      });
    } catch (e) {
      console.warn('Anime dashboard entrance error:', e);
    }
  }

  /**
   * Elegant pop-out reveal when user clicks profile button in header
   */
  animateUserMenu(menuElement: HTMLElement) {
    try {
      animate(menuElement, {
        opacity: [0, 1],
        translateY: [-10, 0],
        scale: [0.94, 1],
        duration: 260,
        ease: 'outCubic'
      });

      // Stagger items inside user menu
      const items = menuElement.querySelectorAll('.dropdown-badge, .dropdown-ambient-btn, .dropdown-action-btn');
      if (items.length > 0) {
        animate(items, {
          opacity: [0, 1],
          translateY: [6, 0],
          delay: stagger(22, { start: 40 }),
          duration: 220,
          ease: 'outCubic'
        });
      }
    } catch (e) {
      console.warn('Anime user menu error:', e);
    }
  }

  /**
   * Workspace entrance when user successfully signs in
   */
  animateWorkspaceEnter() {
    try {
      animate('.app-shell', {
        opacity: [0, 1],
        scale: [0.98, 1],
        duration: 420,
        ease: 'outCubic'
      });
    } catch (e) {
      console.warn('Anime workspace entrance error:', e);
    }
  }

  /**
   * Cinematic seamless transition from full-screen Auth Gate into the Telemetry Dashboard
   */
  animateLoginToDashboard(onComplete?: () => void) {
    try {
      const gateWrapper = document.querySelector('.auth-gate-wrapper') as HTMLElement;
      const gateBadge = document.querySelector('.gate-logo-badge') as HTMLElement;
      const gateBranding = document.querySelector('.gate-branding-card') as HTMLElement;
      const gateCard = document.querySelector('.gate-form-card') as HTMLElement;
      const appShell = document.querySelector('.app-shell') as HTMLElement;
      const sidebar = document.querySelector('app-sidebar') as HTMLElement;
      const header = document.querySelector('app-header') as HTMLElement;

      // 1. Badge glows and pulses outward
      if (gateBadge) {
        animate(gateBadge, {
          scale: [1, 1.15],
          boxShadow: '0 0 34px rgba(82, 184, 166, 0.75)',
          duration: 320,
          ease: 'outQuad'
        });
      }

      // 2. Gate Card & Branding glide upward with gentle scale and blur dissolve
      if (gateBranding || gateCard) {
        const elementsToFade = [gateBranding, gateCard].filter(Boolean) as HTMLElement[];
        animate(elementsToFade, {
          opacity: [1, 0],
          translateY: [0, -24],
          scale: [1, 0.95],
          filter: ['blur(0px)', 'blur(8px)'],
          delay: 60,
          duration: 440,
          ease: 'inOutCubic'
        });
      }

      // 3. Whole Gate Wrapper overlay background dissolves
      if (gateWrapper) {
        animate(gateWrapper, {
          opacity: [1, 0],
          delay: 140,
          duration: 380,
          ease: 'inOutQuad'
        });
      }

      // 4. App Shell underneath expands smoothly in from slight scale
      if (appShell) {
        animate(appShell, {
          opacity: [0.2, 1],
          scale: [1.025, 1],
          duration: 520,
          delay: 80,
          ease: 'outCubic'
        });
      }

      // 5. Sidebar glides in from left
      if (sidebar) {
        animate(sidebar, {
          opacity: [0, 1],
          translateX: [-28, 0],
          duration: 480,
          delay: 140,
          ease: 'outCubic'
        });
      }

      // 6. Header drops gently in from top
      if (header) {
        animate(header, {
          opacity: [0, 1],
          translateY: [-16, 0],
          duration: 480,
          delay: 160,
          ease: 'outCubic'
        });
      }

      // 7. Dashboard cards float smoothly upward into view
      const dashCards = document.querySelectorAll('.metric-card, .chart-card, .quick-actions-bar, .automation-shortcut-card');
      if (dashCards.length > 0) {
        animate(dashCards, {
          opacity: [0, 1],
          translateY: [20, 0],
          delay: stagger(35, { start: 180 }),
          duration: 440,
          ease: 'outCubic'
        });
      }

      // 8. Complete callback
      setTimeout(() => {
        if (onComplete) onComplete();
      }, 540);

    } catch (e) {
      console.warn('Login to dashboard transition error:', e);
      if (onComplete) onComplete();
    }
  }

  /**
   * Micro-interaction tactile feedback on button/user icon click
   */
  animateClick(element: HTMLElement) {
    try {
      animate(element, {
        scale: [1, 0.92, 1],
        duration: 240,
        ease: 'outBack'
      });
    } catch (e) {
      console.warn('Anime click error:', e);
    }
  }
}
