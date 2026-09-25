const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '..', 'frontend', 'src', 'app', 'features', 'cms', 'cms-view.component.html');
let rawContent = fs.readFileSync(filePath, 'utf8');
const isCrlf = rawContent.includes('\r\n');
let content = rawContent.replace(/\r\n/g, '\n');

// 1. Update ng-template #canvasBlockTemplate opening tag
const oldTemplateStart = `<ng-template #canvasBlockTemplate let-b="block" let-parent="parentBlock" let-idx="index" let-isChild="isChild">
                  <div [class]="isChild ? 'container-child' : 'block-wrap'"
                       [class.selected]="selectedBlock()?.id === b.id"
                       [class.is-container]="b.type === 'container'"
                       [class.has-parallax]="b.props['parallax'] && (b.props['bgType'] === 'image' || b.props['bgType'] === 'video')"
                       [class.has-custom-bg]="b.props['bgType'] && b.props['bgType'] !== 'none'"
                       [ngStyle]="getBlockWrapStyle(b)"
                       [attr.data-block-id]="b.id"
                       [attr.draggable]="!isPreviewMode()"
                       (dragstart)="onBlockDragStart($event, b)"
                       (dragend)="onDragEnd()"
                       (click)="selectBlock(b, $event)"
                       style="position:relative;"
                       [style.marginBottom.px]="isChild ? (b.type === 'container' ? 10 : 6) : 12">`;

const newTemplateStart = `<ng-template #canvasBlockTemplate let-b="block" let-parent="parentBlock" let-idx="index" let-isChild="isChild">
                  <div [class]="isChild ? 'container-child' : 'block-wrap'"
                       [class.is-flex-row-child]="isChild && parent?.props?.['mode'] !== 'grid' && parent?.props?.['direction'] === 'row'"
                       [class.is-sticky-header]="b.type === 'header' && b.props['sticky']"
                       [class.selected]="selectedBlock()?.id === b.id"
                       [class.is-container]="b.type === 'container'"
                       [class.has-parallax]="b.props['parallax'] && (b.props['bgType'] === 'image' || b.props['bgType'] === 'video')"
                       [class.has-custom-bg]="b.props['bgType'] && b.props['bgType'] !== 'none'"
                       [ngStyle]="getBlockWrapStyle(b)"
                       [attr.data-block-id]="b.id"
                       [attr.draggable]="!isPreviewMode()"
                       (dragstart)="onBlockDragStart($event, b)"
                       (dragend)="onDragEnd()"
                       (click)="selectBlock(b, $event)"
                       style="position:relative;"
                       [style.marginBottom.px]="(isChild && parent?.props?.['mode'] !== 'grid' && parent?.props?.['direction'] === 'row') ? 0 : (isChild ? (b.type === 'container' ? 10 : 6) : 12)">`;

if (!content.includes(oldTemplateStart)) {
  console.error('Could not find oldTemplateStart');
  process.exit(1);
}
content = content.replace(oldTemplateStart, newTemplateStart);
console.log('Replaced template start');

// 2. Update Header block
const oldHeader = `                      @case ('header') {
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:12px 16px;background:var(--bg-surface-elevated);border:1px solid var(--border-subtle);border-radius:10px;margin-bottom:12px;"
                             [style.position]="b.props['sticky'] ? 'sticky' : 'static'"
                             [style.top]="b.props['sticky'] ? '0' : 'auto'"
                             [style.zIndex]="'10'">
                          <span style="font-weight:800;font-size:15px;white-space:nowrap;">{{ b.props['brandName'] || 'Aladen Studio' }}</span>
                          <nav [style.display]="viewportMode() === 'mobile' ? 'none' : 'flex'" style="gap:14px;align-items:center;overflow-x:auto;min-width:0;">
                            @for (lnk of b.props['links'] || []; track lnk.label) {
                              <a [href]="lnk.url || '#'" style="text-decoration:none;color:var(--text-secondary);font-size:12.5px;font-weight:500;white-space:nowrap;">{{ lnk.label }}</a>
                            }
                          </nav>
                          @if (b.props['showCta'] !== false) {
                            <a [href]="b.props['ctaUrl'] || '#'" class="btn primary btn-sm" style="white-space:nowrap;">{{ b.props['ctaLabel'] || 'Get Started' }}</a>
                          }
                        </div>
                      }`;

const newHeader = `                      @case ('header') {
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

if (!content.includes(oldHeader)) {
  console.error('Could not find oldHeader');
  process.exit(1);
}
content = content.replace(oldHeader, newHeader);
console.log('Replaced header block');

// 3. Update Heading block
const oldHeading = `                      @case ('heading') {
                        <div [style.textAlign]="b.props['align'] || 'left'"
                             [style.color]="b.props['color'] || 'inherit'"
                             [style.marginBottom.px]="b.props['margin'] != null ? b.props['margin'] : 12">
                          @switch (b.props['level'] || 2) {
                            @case (1) { <h1 style="font-size:32px;font-weight:800;letter-spacing:-0.03em;">{{ b.props['text'] || 'Heading 1' }}</h1> }
                            @case (2) { <h2 style="font-size:24px;font-weight:700;letter-spacing:-0.02em;">{{ b.props['text'] || 'Heading 2' }}</h2> }
                            @case (3) { <h3 style="font-size:20px;font-weight:600;">{{ b.props['text'] || 'Heading 3' }}</h3> }
                            @default { <h4 style="font-size:16px;font-weight:600;">{{ b.props['text'] || 'Heading 4' }}</h4> }
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
                            @default { <h4 style="font-size:16px;font-weight:600;margin:0;">{{ b.props['text'] || 'Heading 4' }}</h4> }
                          }
                        </div>
                      }`;

if (!content.includes(oldHeading)) {
  console.error('Could not find oldHeading');
  process.exit(1);
}
content = content.replace(oldHeading, newHeading);
console.log('Replaced heading block');

// 4. Update Button block
const oldButton = `                      @case ('button') {
                        <div style="margin:14px 0;"
                             [style.textAlign]="b.props['align'] === 'center' ? 'center' : b.props['align'] === 'right' ? 'right' : 'left'">
                          <a [href]="b.props['url'] || '#'"
                             class="btn"
                             [style.display]="b.props['align'] === 'full' ? 'block' : 'inline-block'"
                             [style.textAlign]="'center'"
                             [style.background]="b.props['variant'] === 'filled' ? (b.props['color'] || '#6366f1') : b.props['variant'] === 'soft' ? (b.props['color'] || '#6366f1') + '22' : 'transparent'"
                             [style.color]="b.props['variant'] === 'filled' ? (b.props['textColor'] || '#ffffff') : (b.props['color'] || '#6366f1')"
                             [style.border]="b.props['variant'] === 'outline' ? '1.5px solid ' + (b.props['color'] || '#6366f1') : b.props['variant'] === 'soft' ? '1px solid ' + (b.props['color'] || '#6366f1') + '44' : '1px solid transparent'"
                             [style.borderRadius.px]="b.props['borderRadius'] != null ? b.props['borderRadius'] : 8"
                             [style.padding]="b.props['size'] === 'small' ? '7px 14px' : b.props['size'] === 'large' ? '13px 26px' : '10px 20px'"
                             [style.fontSize]="b.props['size'] === 'small' ? '12.5px' : b.props['size'] === 'large' ? '16px' : '14px'"
                             [style.fontWeight]="'600'"
                             [style.textDecoration]="'none'"
                             [style.boxSizing]="b.props['align'] === 'full' ? 'border-box' : 'border-box'">
                            {{ b.props['label'] || 'Button Action' }}
                          </a>
                        </div>
                      }`;

const newButton = `                      @case ('button') {
                        <div [style.margin]="isChild ? '0' : '14px 0'"
                             [style.width]="b.props['align'] === 'full' ? '100%' : null"
                             [style.textAlign]="b.props['align'] === 'center' || b.props['align'] === 'full' ? 'center' : b.props['align'] === 'right' ? 'right' : 'left'">
                          <a [href]="b.props['url'] || '#'"
                             class="btn"
                             [style.display]="b.props['align'] === 'full' ? 'block' : 'inline-block'"
                             [style.width]="b.props['align'] === 'full' ? '100%' : null"
                             [style.textAlign]="'center'"
                             [style.background]="b.props['variant'] === 'filled' ? (b.props['color'] || '#6366f1') : b.props['variant'] === 'soft' ? (b.props['color'] || '#6366f1') + '22' : 'transparent'"
                             [style.color]="b.props['variant'] === 'filled' ? (b.props['textColor'] || '#ffffff') : (b.props['color'] || '#6366f1')"
                             [style.border]="b.props['variant'] === 'outline' ? '1.5px solid ' + (b.props['color'] || '#6366f1') : b.props['variant'] === 'soft' ? '1px solid ' + (b.props['color'] || '#6366f1') + '44' : '1px solid transparent'"
                             [style.borderRadius.px]="b.props['borderRadius'] != null ? b.props['borderRadius'] : 8"
                             [style.padding]="b.props['size'] === 'small' ? '7px 14px' : b.props['size'] === 'large' ? '13px 26px' : '10px 20px'"
                             [style.fontSize]="b.props['size'] === 'small' ? '12.5px' : b.props['size'] === 'large' ? '16px' : '14px'"
                             [style.fontWeight]="'600'"
                             [style.textDecoration]="'none'"
                             [style.boxSizing]="'border-box'">
                            {{ b.props['label'] || 'Button Action' }}
                          </a>
                        </div>
                      }`;

if (!content.includes(oldButton)) {
  console.error('Could not find oldButton');
  process.exit(1);
}
content = content.replace(oldButton, newButton);
console.log('Replaced button block');

// 5. Update Image block
const oldImage = `                      @case ('image') {
                        <div style="margin:14px 0;"
                             [style.textAlign]="b.props['align'] || 'center'">
                          @if (b.props['url']) {
                            <img [src]="b.props['url']" [alt]="b.props['alt'] || ''"
                                 [style.width]="b.props['width'] || '100%'"
                                 [style.maxWidth]="'100%'"
                                 [style.objectFit]="b.props['objectFit'] || 'cover'"
                                 [style.borderRadius.px]="b.props['borderRadius'] != null ? b.props['borderRadius'] : 8"
                                 [style.boxShadow]="b.props['shadow'] ? '0 10px 25px -5px rgba(0,0,0,0.15)' : 'none'"
                                 [style.border]="b.props['border'] ? '1px solid #e2e8f0' : 'none'"
                                 style="display:inline-block;" />
                            @if (b.props['caption']) {
                              <p style="font-size:12.5px;color:var(--text-secondary);margin-top:6px;">{{ b.props['caption'] }}</p>
                            }
                          } @else {
                            <div style="padding:36px 20px;border:1px dashed var(--border-subtle);border-radius:8px;color:var(--text-tertiary);font-size:12.5px;text-align:center;">
                              Image — set an image URL in the inspector
                            </div>
                          }
                        </div>
                      }`;

const newImage = `                      @case ('image') {
                        <div [style.margin]="isChild ? '0' : ((b.props['align'] === 'center' || !b.props['align']) ? '14px auto' : (b.props['align'] === 'right' ? '14px 0 14px auto' : '14px auto 14px 0'))"
                             [style.textAlign]="b.props['align'] || 'center'">
                          @if (b.props['url']) {
                            <img [src]="b.props['url']" [alt]="b.props['alt'] || ''"
                                 [style.width]="b.props['width'] || '100%'"
                                 [style.maxWidth]="'100%'"
                                 [style.objectFit]="b.props['objectFit'] || 'cover'"
                                 [style.borderRadius.px]="b.props['borderRadius'] != null ? b.props['borderRadius'] : 8"
                                 [style.boxShadow]="b.props['shadow'] ? '0 10px 25px -5px rgba(0,0,0,0.15)' : 'none'"
                                 [style.border]="b.props['border'] ? '1px solid #e2e8f0' : 'none'"
                                 style="display:inline-block;" />
                            @if (b.props['caption']) {
                              <p style="font-size:12.5px;color:var(--text-secondary);margin-top:6px;">{{ b.props['caption'] }}</p>
                            }
                          } @else {
                            <div style="padding:36px 20px;border:1px dashed var(--border-subtle);border-radius:8px;color:var(--text-tertiary);font-size:12.5px;text-align:center;">
                              Image — set an image URL in the inspector
                            </div>
                          }
                        </div>
                      }`;

if (!content.includes(oldImage)) {
  console.error('Could not find oldImage');
  process.exit(1);
}
content = content.replace(oldImage, newImage);
console.log('Replaced image block');

// 6. Update Bento block
const oldBento = `                      @case ('bento') {
                        <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:12px;margin-bottom:12px;">
                          @for (item of b.props['items'] || []; track item.title) {
                            <div style="background:var(--bg-surface-elevated);border:1px solid var(--border-subtle);border-radius:10px;padding:14px;"
                                 [style.gridColumn]="item.span === 2 ? 'span 2' : 'span 1'">
                              <div style="display:flex;justify-content:space-between;align-items:center;">
                                <span style="font-size:20px;">{{ item.icon }}</span>
                                <span style="font-size:10px;background:rgba(59,130,246,0.15);color:#60a5fa;padding:2px 6px;border-radius:4px;">{{ item.tag }}</span>
                              </div>
                              <h4 style="margin:8px 0 4px;font-size:14px;">{{ item.title }}</h4>
                              <p style="font-size:12px;color:var(--text-secondary);margin:0;">{{ item.subtitle }}</p>
                              @if (item.metric) {
                                <div style="font-size:20px;font-weight:800;color:#10b981;margin-top:8px;">{{ item.metric }}</div>
                              }
                            </div>
                          }
                        </div>
                      }`;

const newBento = `                      @case ('bento') {
                        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:16px;margin:16px 0;">
                          @for (item of b.props['items'] || []; track $index) {
                            <div class="cms-bento-card"
                                 [style.gridColumn]="item.span === 2 ? 'span 2' : null"
                                 [style.gridRow]="item.tall ? 'span 2' : null"
                                 [style.background]="item.bg || 'var(--bg-surface-elevated)'"
                                 style="border:1px solid var(--border-subtle);border-radius:16px;padding:20px;display:flex;flex-direction:column;justify-content:space-between;position:relative;overflow:hidden;">
                              <div>
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                                  @if (item.icon) { <span style="font-size:22px;">{{ item.icon }}</span> }
                                  @if (item.tag) { <span style="font-size:10.5px;font-weight:700;text-transform:uppercase;background:rgba(99,102,241,0.15);color:#818cf8;padding:2.5px 8px;border-radius:999px;border:1px solid rgba(99,102,241,0.25);">{{ item.tag }}</span> }
                                </div>
                                <h4 style="margin:0 0 6px 0;font-size:16px;font-weight:700;">{{ item.title || 'Feature Tile' }}</h4>
                                <p style="font-size:13px;color:var(--text-secondary);margin:0;line-height:1.5;">{{ item.subtitle }}</p>
                                @if (item.metric) {
                                  <div style="font-size:26px;font-weight:800;color:var(--text-primary);margin-top:8px;letter-spacing:-0.02em;">{{ item.metric }}</div>
                                }
                              </div>
                              @if (item.image) {
                                <div [style.backgroundImage]="'url(' + item.image + ')'" style="width:100%;height:120px;border-radius:10px;background-size:cover;background-position:center;margin-top:12px;"></div>
                              }
                            </div>
                          }
                        </div>
                      }`;

if (!content.includes(oldBento)) {
  console.error('Could not find oldBento');
  process.exit(1);
}
content = content.replace(oldBento, newBento);
console.log('Replaced bento block');

// 7. Update Divider block
const oldDivider = `                      @case ('divider') {
                        <hr style="border:none;border-top:1px solid var(--border-subtle);margin:16px 0;" />
                      }`;

const newDivider = `                      @case ('divider') {
                        <div [style.padding]="(b.props['margin'] != null ? b.props['margin'] : 16) + 'px 0'"
                             style="display:flex;justify-content:center;width:100%;box-sizing:border-box;">
                          <hr [style.width]="b.props['width'] || '100%'"
                              [style.borderTop]="(b.props['thickness'] || 1) + 'px ' + (b.props['style'] || 'solid') + ' ' + (b.props['color'] || 'var(--border-subtle)')"
                              style="border:none;margin:0;" />
                        </div>
                      }`;

if (!content.includes(oldDivider)) {
  console.error('Could not find oldDivider');
  process.exit(1);
}
content = content.replace(oldDivider, newDivider);
console.log('Replaced divider block');

const finalContent = isCrlf ? content.replace(/\n/g, '\r\n') : content;
fs.writeFileSync(filePath, finalContent, 'utf8');
console.log('All replacements saved successfully to cms-view.component.html!');
