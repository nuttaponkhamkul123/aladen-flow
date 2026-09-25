const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'frontend', 'src', 'app', 'features', 'cms', 'cms-view.component.html');
let rawContent = fs.readFileSync(filePath, 'utf8');
const isCrlf = rawContent.includes('\r\n');
let content = rawContent.replace(/\r\n/g, '\n');

// 1. Replace header block
const oldHeader = `                      @case ('header') {
                        <div style="background:var(--bg-surface-elevated);border:1px solid var(--border-subtle);border-radius:10px;margin-bottom:12px;overflow:hidden;"
                             [style.position]="b.props['sticky'] ? 'sticky' : 'static'"
                             [style.top]="b.props['sticky'] ? '0' : 'auto'"
                             [style.zIndex]="'10'">
                          @if (b.props['showTopBar']) {
                            <div style="background:linear-gradient(135deg, rgba(99,102,241,0.2), rgba(236,72,153,0.15));padding:6px 12px;font-size:11.5px;text-align:center;display:flex;align-items:center;justify-content:center;gap:8px;border-bottom:1px solid var(--border-subtle);">
                              @if (b.props['topBarBadge']) {
                                <span style="background:var(--accent-primary);color:#fff;font-size:9.5px;font-weight:700;padding:1px 6px;border-radius:4px;text-transform:uppercase;">{{ b.props['topBarBadge'] }}</span>
                              }
                              <span>{{ b.props['topBarText'] || 'Announcement message' }}</span>
                            </div>
                          }
                          <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;">
                            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                              @if (b.props['brandLogo']) {
                                <img [src]="b.props['brandLogo']" [alt]="b.props['brandName'] || 'Logo'" [style.height.px]="b.props['logoHeight'] || 28" style="object-fit:contain;display:block;" />
                              } @else if (b.props['brandIcon']) {
                                <span style="font-size:18px;">{{ b.props['brandIcon'] }}</span>
                              }
                              <span style="font-weight:800;font-size:15px;white-space:nowrap;">{{ b.props['brandName'] || 'Aladen Studio' }}</span>
                            </div>
                            <nav [style.display]="viewportMode() === 'mobile' ? 'none' : 'flex'" style="gap:14px;align-items:center;overflow-x:auto;min-width:0;">
                              @for (lnk of b.props['links'] || []; track lnk.label) {
                                <a [href]="lnk.url || '#'" style="text-decoration:none;color:var(--text-secondary);font-size:12.5px;font-weight:500;white-space:nowrap;">{{ lnk.label }}</a>
                              }
                            </nav>
                            <div style="display:flex;align-items:center;gap:10px;">
                              @if (b.props['showSearch']) {
                                <div style="display:flex;align-items:center;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:6px;padding:4px 8px;font-size:12px;">
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.6;margin-right:6px;"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                                  <span style="color:var(--text-tertiary);">{{ b.props['searchPlaceholder'] || 'Search...' }}</span>
                                </div>
                              }
                              @if (b.props['showCta'] !== false) {
                                <a [href]="b.props['ctaUrl'] || '#'" class="btn primary btn-sm" style="white-space:nowrap;">{{ b.props['ctaLabel'] || 'Get Started' }}</a>
                              }
                            </div>
                          </div>
                        </div>
                      }`;

const newHeader = `                      @case ('header') {
                        <header class="cms-header-block"
                                [class.variant-glass]="(b.props['styleVariant'] || 'glass') === 'glass'"
                                [class.variant-solid]="b.props['styleVariant'] === 'solid'"
                                [class.variant-transparent]="b.props['styleVariant'] === 'transparent'"
                                [class.variant-bordered]="b.props['styleVariant'] === 'bordered'"
                                [class.layout-spread]="(b.props['layout'] || 'spread') === 'spread'"
                                [class.layout-centered]="b.props['layout'] === 'centered' || b.props['layout'] === 'center'"
                                [class.layout-left]="b.props['layout'] === 'left'"
                                [class.layout-floating]="b.props['layout'] === 'floating'"
                                [class.is-sticky]="b.props['sticky']"
                                [style.position]="b.props['sticky'] ? 'sticky' : 'static'"
                                [style.top]="b.props['sticky'] ? '0' : 'auto'"
                                [style.zIndex]="'10'">
                          @if (b.props['showTopBar']) {
                            <div class="cms-header-topbar">
                              @if (b.props['topBarBadge']) {
                                <span class="cms-header-topbar-badge">{{ b.props['topBarBadge'] }}</span>
                              }
                              <a [href]="b.props['topBarLink'] || '#'" class="cms-header-topbar-link">{{ b.props['topBarText'] || 'Announcement message' }}</a>
                            </div>
                          }
                          <div class="cms-header-inner">
                            <a [href]="b.props['brandUrl'] || '#'" class="cms-header-brand">
                              @if (b.props['brandLogo']) {
                                <img [src]="b.props['brandLogo']" [alt]="b.props['brandName'] || 'Logo'" [style.height.px]="b.props['logoHeight'] || 32" class="cms-header-logo-img" />
                              } @else if (b.props['brandIcon']) {
                                <span class="cms-header-brand-icon">{{ b.props['brandIcon'] }}</span>
                              }
                              <span class="cms-header-brand-name">{{ b.props['brandName'] || 'Aladen Studio' }}</span>
                            </a>
                            <nav class="cms-header-nav" [style.display]="viewportMode() === 'mobile' ? 'none' : 'flex'">
                              @for (lnk of b.props['links'] || []; track lnk.label) {
                                <a [href]="lnk.url || '#'" class="cms-header-link">{{ lnk.label }}</a>
                              }
                            </nav>
                            <div class="cms-header-actions">
                              @if (b.props['showSearch']) {
                                <div class="cms-header-search">
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                    <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
                                  </svg>
                                  <input type="text" class="cms-header-search-input" [placeholder]="b.props['searchPlaceholder'] || 'Search...'" />
                                </div>
                              }
                              @if (b.props['showCta'] !== false) {
                                <a [href]="b.props['ctaUrl'] || '#'"
                                   class="cms-header-cta-btn"
                                   [class.cta-filled]="!b.props['ctaVariant'] || b.props['ctaVariant'] === 'filled'"
                                   [class.cta-outline]="b.props['ctaVariant'] === 'outline'"
                                   [class.cta-soft]="b.props['ctaVariant'] === 'soft'"
                                   [class.cta-glow]="b.props['ctaVariant'] === 'glow'">
                                  {{ b.props['ctaLabel'] || 'Get Started' }}
                                </a>
                              }
                            </div>
                          </div>
                        </header>
                      }`;

if (!content.includes(oldHeader)) {
  console.error('Could not find oldHeader');
  process.exit(1);
}
content = content.replace(oldHeader, newHeader);
console.log('Replaced header template');

// 2. Replace heading block to support H1-H6
const oldHeading = `                      @case ('heading') {
                        <div [style.textAlign]="b.props['align'] || 'left'"
                             [style.color]="b.props['color'] || 'inherit'"
                             [style.marginTop.px]="isChild ? 0 : 18"
                             [style.marginBottom.px]="b.props['margin'] != null ? b.props['margin'] : 12">
                          @switch (b.props['level'] || 2) {
                            @case (1) { <h1 style="font-size:32px;font-weight:800;letter-spacing:-0.03em;margin:0;">{{ b.props['text'] || 'Heading 1' }}</h1> }
                            @case (2) { <h2 style="font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0;">{{ b.props['text'] || 'Heading 2' }}</h2> }
                            @case (3) { <h3 style="font-size:20px;font-weight:600;margin:0;">{{ b.props['text'] || 'Heading 3' }}</h3> }
                            @default { <h4 style="font-size:16px;font-weight:600;margin:0;">{{ b.props['text'] || 'Heading 4' }}</h4> }
                          }
                        </div>
                      }`;

const newHeading = `                      @case ('heading') {
                        <div [style.textAlign]="b.props['align'] || 'left'"
                             [style.color]="b.props['color'] || 'inherit'"
                             [style.marginTop.px]="isChild ? 0 : 18"
                             [style.marginBottom.px]="b.props['margin'] != null ? b.props['margin'] : 12">
                          @switch (b.props['level'] || 2) {
                            @case (1) { <h1 style="font-size:32px;font-weight:800;letter-spacing:-0.03em;margin:0;">{{ b.props['text'] || 'Heading 1' }}</h1> }
                            @case (2) { <h2 style="font-size:24px;font-weight:700;letter-spacing:-0.02em;margin:0;">{{ b.props['text'] || 'Heading 2' }}</h2> }
                            @case (3) { <h3 style="font-size:20px;font-weight:600;margin:0;">{{ b.props['text'] || 'Heading 3' }}</h3> }
                            @case (4) { <h4 style="font-size:16px;font-weight:600;margin:0;">{{ b.props['text'] || 'Heading 4' }}</h4> }
                            @case (5) { <h5 style="font-size:14px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;margin:0;">{{ b.props['text'] || 'Heading 5' }}</h5> }
                            @case (6) { <h6 style="font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;margin:0;">{{ b.props['text'] || 'Heading 6' }}</h6> }
                            @default { <h2 style="font-size:24px;font-weight:700;margin:0;">{{ b.props['text'] || 'Heading 2' }}</h2> }
                          }
                        </div>
                      }`;

if (!content.includes(oldHeading)) {
  console.error('Could not find oldHeading');
  process.exit(1);
}
content = content.replace(oldHeading, newHeading);
console.log('Replaced heading template');

const finalContent = isCrlf ? content.replace(/\n/g, '\r\n') : content;
fs.writeFileSync(filePath, finalContent, 'utf8');
console.log('Successfully updated cms-view.component.html with full header styles!');
