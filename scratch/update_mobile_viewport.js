const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const htmlPath = path.join(repoRoot, 'frontend', 'src', 'app', 'features', 'cms', 'cms-view.component.html');
let content = fs.readFileSync(htmlPath, 'utf8');

// Normalize line endings to LF for consistent replacement, then we can preserve LF/CRLF
const isCRLF = content.includes('\r\n');
content = content.replace(/\r\n/g, '\n');

// 1. Add device-frame-top above #cmsCanvasDropList
if (!content.includes('class="device-speaker-notch"')) {
  content = content.replace(
    /<!-- Rendered Blocks Container -->\n\s*<div id="cmsCanvasDropList"/,
    `@if (showDeviceFrame() && viewportMode() !== 'desktop') {
                <div class="device-frame-top">
                  <div class="device-speaker-notch"></div>
                </div>
              }

              <!-- Rendered Blocks Container -->
              <div id="cmsCanvasDropList"`
  );
  console.log('1. Added device-frame-top');
}

// 2. Add device-frame-bottom after #cmsCanvasDropList closes
if (!content.includes('class="device-home-bar"')) {
  content = content.replace(
    /@if \(draggingOver\(\) && dragInsertIndex\(\) === currentBlocks\(\)\.length\) \{\n\s*<div class="drop-indicator"><\/div>\n\s*\}\n\s*<\/div>\n\s*<\/div>\n\s*<\/div>/,
    `@if (draggingOver() && dragInsertIndex() === currentBlocks().length) {
                    <div class="drop-indicator"></div>
                  }
              </div>

              @if (showDeviceFrame() && viewportMode() !== 'desktop') {
                <div class="device-frame-bottom">
                  <div class="device-home-bar"></div>
                </div>
              }
            </div>
          </div>`
  );
  console.log('2. Added device-frame-bottom');
}

// 3. Canvas responsive padding
content = content.replace(
  `[style.padding]="(pageSettings()['paddingY'] != null ? pageSettings()['paddingY'] : 44) + 'px ' + (pageSettings()['paddingX'] != null ? pageSettings()['paddingX'] : 36) + 'px'"`,
  `[style.padding]="viewportMode() === 'mobile' ? '18px 12px' : (pageSettings()['paddingY'] != null ? pageSettings()['paddingY'] : 44) + 'px ' + (pageSettings()['paddingX'] != null ? pageSettings()['paddingX'] : 36) + 'px'"`
);
console.log('3. Responsive canvas padding');

// 4. Responsive grid columns in container
content = content.replace(
  `[style.gridTemplateColumns]="b.props['mode'] === 'grid' ? 'repeat(' + (b.props['columns'] || 2) + ', minmax(0, 1fr))' : 'none'"`,
  `[style.gridTemplateColumns]="b.props['mode'] === 'grid' ? (viewportMode() === 'mobile' && !isLandscape() ? '1fr' : 'repeat(' + (b.props['columns'] || 2) + ', minmax(0, 1fr))') : 'none'"`
);
console.log('4. Container gridTemplateColumns');

// 5. Responsive flexDirection in container
content = content.replace(
  `[style.flexDirection]="b.props['mode'] !== 'grid' ? (b.props['direction'] || 'row') : 'row'"`,
  `[style.flexDirection]="b.props['mode'] !== 'grid' ? (viewportMode() === 'mobile' && !isLandscape() && b.props['direction'] === 'row' && (!b.props['wrap'] || b.props['wrap'] === 'nowrap') ? 'column' : (b.props['direction'] || 'row')) : 'row'"`
);
console.log('5. Container flexDirection');

// 6. Responsive flexWrap in container
content = content.replace(
  `[style.flexWrap]="b.props['mode'] !== 'grid' ? (b.props['wrap'] || 'wrap') : 'nowrap'"`,
  `[style.flexWrap]="b.props['mode'] !== 'grid' ? (viewportMode() === 'mobile' ? 'wrap' : (b.props['wrap'] || 'wrap')) : 'nowrap'"`
);
console.log('6. Container flexWrap');

// 7. Header nav adaptation on mobile
content = content.replace(
  `<nav style="display:flex;gap:14px;align-items:center;overflow-x:auto;min-width:0;">`,
  `<nav [style.display]="viewportMode() === 'mobile' ? 'none' : 'flex'" style="gap:14px;align-items:center;overflow-x:auto;min-width:0;">`
);
console.log('7. Header nav adaptation');

if (isCRLF) {
  content = content.replace(/\n/g, '\r\n');
}

fs.writeFileSync(htmlPath, content, 'utf8');
console.log('Successfully updated cms-view.component.html');
