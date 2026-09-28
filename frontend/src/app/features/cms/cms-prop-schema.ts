export type PropFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'toggle'
  | 'color'
  | 'number'
  | 'stringlist'
  | 'objectlist'
  | 'matrix'
  | 'children';

export interface PropSelectOption {
  value: string;
  label: string;
}

export type PropSubFieldType =
  | 'text'
  | 'textarea'
  | 'select'
  | 'toggle'
  | 'color'
  | 'number'
  | 'links';

export interface PropSubField {
  key: string;
  label: string;
  type: PropSubFieldType;
  options?: PropSelectOption[];
  placeholder?: string;
  onLabel?: string;
}

export interface PropField {
  key: string;
  label: string;
  type: PropFieldType;
  options?: PropSelectOption[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  onLabel?: string;
  addLabel?: string;
  itemLabel?: string;
  itemDefault?: Record<string, any>;
  subFields?: PropSubField[];
  note?: string;
}

export const PROP_SCHEMAS: Record<string, PropField[]> = {
  heading: [
    { key: 'level', label: 'Hierarchy Level', type: 'select', options: [
      { value: 'display', label: 'Hero Display (54px+)' },
      { value: '1', label: 'H1 - Main Headline (36px)' },
      { value: '2', label: 'H2 - Section Header (28px)' },
      { value: '3', label: 'H3 - Sub-section (22px)' },
      { value: '4', label: 'H4 - Card Header (18px)' },
      { value: '5', label: 'H5 - Small Label (15px)' },
      { value: '6', label: 'H6 - Auxiliary (13px)' }
    ] },
    { key: 'text', label: 'Heading Text', type: 'textarea', placeholder: 'Heading text...' },
    { key: 'align', label: 'Alignment', type: 'select', options: [
      { value: 'left', label: 'Left Aligned' },
      { value: 'center', label: 'Centered' },
      { value: 'right', label: 'Right Aligned' }
    ] },

    // Typography
    { key: 'fontSize', label: 'Custom Font Size (px)', type: 'number', min: 12, max: 140, placeholder: 'Auto / Default' },
    { key: 'fontWeight', label: 'Font Weight', type: 'select', options: [
      { value: 'default', label: 'Default for Level' },
      { value: '400', label: '400 - Normal' },
      { value: '500', label: '500 - Medium' },
      { value: '600', label: '600 - Semi Bold' },
      { value: '700', label: '700 - Bold' },
      { value: '800', label: '800 - Extra Bold' },
      { value: '900', label: '900 - Black' }
    ] },
    { key: 'letterSpacing', label: 'Letter Spacing', type: 'select', options: [
      { value: 'default', label: 'Default' },
      { value: 'tightest', label: 'Tightest (-0.05em)' },
      { value: 'tight', label: 'Tight (-0.025em)' },
      { value: 'normal', label: 'Normal (0)' },
      { value: 'wide', label: 'Wide (+0.05em)' },
      { value: 'wider', label: 'Wider (+0.1em)' }
    ] },
    { key: 'textTransform', label: 'Text Transform', type: 'select', options: [
      { value: 'none', label: 'None (As Typed)' },
      { value: 'uppercase', label: 'UPPERCASE' },
      { value: 'capitalize', label: 'Capitalize Every Word' },
      { value: 'lowercase', label: 'lowercase' }
    ] },

    // Colors & Gradient Visuals
    { key: 'color', label: 'Text Color', type: 'color', placeholder: '#ffffff' },
    { key: 'gradient', label: 'Enable Gradient Text', type: 'toggle', onLabel: 'Gradient On' },
    { key: 'gradientPreset', label: 'Gradient Palette', type: 'select', options: [
      { value: 'electric', label: 'Linear Electric (Indigo → Cyan)' },
      { value: 'sunset', label: 'Sunset Glow (Purple → Pink)' },
      { value: 'emerald', label: 'Cyber Emerald (Green → Teal)' },
      { value: 'amber', label: 'Amber Flame (Orange → Red)' },
      { value: 'chrome', label: 'Silver Chrome (White → Slate)' },
      { value: 'custom', label: 'Custom Gradient CSS' }
    ] },
    { key: 'customGradient', label: 'Custom Gradient CSS', type: 'text', placeholder: 'linear-gradient(135deg, #6366f1, #a855f7)' },
    { key: 'glow', label: 'Text Glow Effect', type: 'select', options: [
      { value: 'none', label: 'None' },
      { value: 'subtle', label: 'Subtle Accent Glow' },
      { value: 'intense', label: 'Intense Glow' },
      { value: 'neon', label: 'Cyber Neon' }
    ] },

    // Eyebrow / Kicker Badge
    { key: 'kicker', label: 'Eyebrow / Kicker Text (Above Heading)', type: 'text', placeholder: 'e.g. WORKSPACE TELEMETRY, v2.0, NEW' },
    { key: 'kickerStyle', label: 'Kicker Style', type: 'select', options: [
      { value: 'subtle', label: 'Subtle Monospace Kicker' },
      { value: 'pill', label: 'Badge Pill' },
      { value: 'dot', label: 'Live Pulsing Dot + Label' }
    ] },
    { key: 'kickerColor', label: 'Kicker Accent Color', type: 'color', placeholder: '#6366f1' },

    // Subtitle / Description Below Heading
    { key: 'subtitle', label: 'Subtitle / Description (Below Heading)', type: 'textarea', placeholder: 'Optional supporting description text...' },
    { key: 'subtitleColor', label: 'Subtitle Color', type: 'color', placeholder: '#94a3b8' },
    { key: 'subtitleSize', label: 'Subtitle Size', type: 'select', options: [
      { value: 'small', label: 'Small (13px)' },
      { value: 'normal', label: 'Normal (15px)' },
      { value: 'large', label: 'Large (18px)' }
    ] },

    // Decorative Accent Line / Divider
    { key: 'divider', label: 'Decorative Accent Line', type: 'select', options: [
      { value: 'none', label: 'None' },
      { value: 'solid', label: 'Solid Accent Hairline' },
      { value: 'gradient', label: 'Gradient Accent Bar' },
      { value: 'dots', label: '3-Dot Milestone (• • •)' }
    ] },
    { key: 'dividerWidth', label: 'Divider Width', type: 'select', options: [
      { value: 'short', label: 'Short (48px)' },
      { value: 'medium', label: 'Medium (96px)' },
      { value: 'long', label: 'Long (180px)' }
    ] },

    // Spacing
    { key: 'marginTop', label: 'Top Margin (px)', type: 'number', min: 0, max: 120, placeholder: '0' },
    { key: 'margin', label: 'Bottom Margin (px)', type: 'number', min: 0, max: 120, placeholder: '12' },

    // Interactive Navigation
    { key: 'linkUrl', label: 'Link URL (optional)', type: 'text', placeholder: 'https://... or /p/...' },
    { key: 'newTab', label: 'Open link in new tab', type: 'toggle', onLabel: 'Yes' },
    { key: 'anchorId', label: 'Section Anchor ID (#hash)', type: 'text', placeholder: 'e.g. features, pricing, faq' }
  ],

  paragraph: [
    { key: 'text', label: 'Body Text', type: 'textarea', placeholder: 'Paragraph text...' },
    { key: 'align', label: 'Alignment', type: 'select', options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' }
    ] },
    { key: 'size', label: 'Text Size', type: 'select', options: [
      { value: 'small', label: 'Small (13px)' },
      { value: 'normal', label: 'Normal (15px)' },
      { value: 'large', label: 'Large (18px)' },
      { value: 'lead', label: 'Lead (20px)' }
    ] },
    { key: 'color', label: 'Text Color', type: 'color', placeholder: '#ffffff' },
    { key: 'bold', label: 'Bold', type: 'toggle', onLabel: 'Bold' },
    { key: 'italic', label: 'Italic', type: 'toggle', onLabel: 'Italic' },
    { key: 'linkUrl', label: 'Link URL (optional)', type: 'text', placeholder: 'https://...' },
    { key: 'newTab', label: 'Open link in new tab', type: 'toggle', onLabel: 'Yes' }
  ],

  button: [
    { key: 'label', label: 'Label', type: 'text', placeholder: 'Button Action' },
    { key: 'url', label: 'Target URL', type: 'text', placeholder: 'https://...' },
    { key: 'variant', label: 'Style', type: 'select', options: [
      { value: 'filled', label: 'Filled' },
      { value: 'outline', label: 'Outline' },
      { value: 'soft', label: 'Soft' }
    ] },
    { key: 'size', label: 'Size', type: 'select', options: [
      { value: 'small', label: 'Small' },
      { value: 'medium', label: 'Medium' },
      { value: 'large', label: 'Large' }
    ] },
    { key: 'align', label: 'Alignment', type: 'select', options: [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
      { value: 'full', label: 'Full Width' }
    ] },
    { key: 'color', label: 'Accent Color', type: 'color', placeholder: '#6366f1' },
    { key: 'textColor', label: 'Text Color', type: 'color', placeholder: '#ffffff' },
    { key: 'borderRadius', label: 'Border Radius (px)', type: 'number', min: 0, max: 40 },
    { key: 'newTab', label: 'Open link in new tab', type: 'toggle', onLabel: 'Yes' }
  ],

  image: [
    { key: 'url', label: 'Image URL', type: 'text', placeholder: 'https://images.unsplash.com/...' },
    { key: 'alt', label: 'Alt Text', type: 'text', placeholder: 'Describe the image' },
    { key: 'caption', label: 'Caption', type: 'text', placeholder: 'Optional caption' },
    { key: 'width', label: 'Width', type: 'text', placeholder: '100% / 640px / 50%' },
    { key: 'align', label: 'Alignment', type: 'select', options: [
      { value: 'center', label: 'Center' },
      { value: 'left', label: 'Left' },
      { value: 'right', label: 'Right' }
    ] },
    { key: 'objectFit', label: 'Object Fit', type: 'select', options: [
      { value: 'cover', label: 'Cover' },
      { value: 'contain', label: 'Contain' },
      { value: 'fill', label: 'Fill' }
    ] },
    { key: 'borderRadius', label: 'Border Radius (px)', type: 'number', min: 0, max: 60 },
    { key: 'shadow', label: 'Shadow', type: 'toggle', onLabel: 'Yes' },
    { key: 'border', label: 'Border', type: 'toggle', onLabel: 'Yes' },
    { key: 'linkUrl', label: 'Link URL (optional)', type: 'text', placeholder: 'https://...' },
    { key: 'newTab', label: 'Open link in new tab', type: 'toggle', onLabel: 'Yes' }
  ],

  carousel: [
    { key: 'aspectRatio', label: 'Aspect Ratio', type: 'text', placeholder: '16/9', note: 'e.g. 16/9, 4/3, 1/1, auto' },
    { key: 'slides', label: 'Slides', type: 'objectlist', itemLabel: 'Slide', addLabel: 'Add Slide',
      itemDefault: { url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop', caption: '', linkUrl: '#', newTab: true },
      subFields: [
        { key: 'url', label: 'Image URL', type: 'text', placeholder: 'https://...' },
        { key: 'caption', label: 'Caption', type: 'text', placeholder: 'Optional' },
        { key: 'linkUrl', label: 'Link URL', type: 'text', placeholder: 'Optional' },
        { key: 'newTab', label: 'Open in new tab', type: 'toggle', onLabel: 'Yes' }
      ] },
    { key: 'borderRadius', label: 'Border Radius (px)', type: 'number', min: 0, max: 40 },
    { key: 'autoplay', label: 'Autoplay', type: 'toggle', onLabel: 'Yes' },
    { key: 'interval', label: 'Autoplay Interval (s)', type: 'number', min: 1, max: 30 },
    { key: 'showArrows', label: 'Show Arrows', type: 'toggle', onLabel: 'Yes' },
    { key: 'showDots', label: 'Show Dots', type: 'toggle', onLabel: 'Yes' },
    { key: 'showCaptions', label: 'Show Captions', type: 'toggle', onLabel: 'Yes' }
  ],

  divider: [
    { key: 'style', label: 'Style', type: 'select', options: [
      { value: 'solid', label: 'Solid' },
      { value: 'dashed', label: 'Dashed' },
      { value: 'dotted', label: 'Dotted' }
    ] },
    { key: 'thickness', label: 'Thickness (px)', type: 'number', min: 1, max: 8 },
    { key: 'width', label: 'Width', type: 'text', placeholder: '100% / 60%' },
    { key: 'margin', label: 'Vertical Margin (px)', type: 'number', min: 0, max: 120 },
    { key: 'color', label: 'Color', type: 'color', placeholder: '#e2e8f0' }
  ],

  spacer: [
    { key: 'height', label: 'Height (px)', type: 'number', min: 0, max: 400 }
  ],

  table: [
    { key: 'headers', label: 'Column Headers', type: 'stringlist', addLabel: 'Add Column', note: 'Row cells are edited below — the first value is the row label column.' },
    { key: 'rows', label: 'Rows', type: 'matrix', addLabel: 'Add Row' },
    { key: 'hasHeader', label: 'Show Header Row', type: 'toggle', onLabel: 'Yes' },
    { key: 'striped', label: 'Striped Rows', type: 'toggle', onLabel: 'Yes' },
    { key: 'bordered', label: 'Bordered Cells', type: 'toggle', onLabel: 'Yes' },
    { key: 'compact', label: 'Compact Density', type: 'toggle', onLabel: 'Yes' }
  ],

  container: [
    { key: 'mode', label: 'Layout Mode', type: 'select', options: [
      { value: 'grid', label: 'Grid' },
      { value: 'flex', label: 'Flex' }
    ] },
    { key: 'direction', label: 'Flex Direction', type: 'select', options: [
      { value: 'row', label: 'Row' },
      { value: 'column', label: 'Column' }
    ] },
    { key: 'justify', label: 'Justify Content', type: 'select', options: [
      { value: 'flex-start', label: 'Start' },
      { value: 'center', label: 'Center' },
      { value: 'space-between', label: 'Space Between' },
      { value: 'space-around', label: 'Space Around' },
      { value: 'space-evenly', label: 'Space Evenly' },
      { value: 'flex-end', label: 'End' }
    ] },
    { key: 'align', label: 'Align Items', type: 'select', options: [
      { value: 'stretch', label: 'Stretch' },
      { value: 'flex-start', label: 'Start' },
      { value: 'center', label: 'Center' },
      { value: 'flex-end', label: 'End' }
    ] },
    { key: 'wrap', label: 'Flex Wrap', type: 'select', options: [
      { value: 'wrap', label: 'Wrap' },
      { value: 'nowrap', label: 'No Wrap' },
      { value: 'wrap-reverse', label: 'Wrap Reverse' }
    ] },
    { key: 'columns', label: 'Grid Columns', type: 'number', min: 1, max: 6 },
    { key: 'gap', label: 'Gap (px)', type: 'number', min: 0, max: 80 },
    { key: 'padding', label: 'Padding (px)', type: 'number', min: 0, max: 80 },
    { key: 'borderRadius', label: 'Border Radius (px)', type: 'number', min: 0, max: 40 },
    { key: 'bg', label: 'Background', type: 'select', options: [
      { value: 'surface', label: 'Surface' },
      { value: 'subtle', label: 'Subtle' },
      { value: 'dark', label: 'Dark Panel' },
      { value: 'none', label: 'Transparent' }
    ] },
    { key: 'border', label: 'Border', type: 'toggle', onLabel: 'Yes' },
    { key: 'shadow', label: 'Shadow', type: 'toggle', onLabel: 'Yes' },
    { key: 'linkUrl', label: 'Clickable Card URL (optional)', type: 'text', placeholder: 'https://... or /p/slug' },
    { key: 'anchorId', label: 'Section Anchor ID (#hash)', type: 'text', placeholder: 'e.g. craft, capabilities, testimonials' },
    { key: 'children', label: 'Child Blocks', type: 'children', addLabel: 'Add Child',
      note: 'Children render inside the layout on the published page. Canvas shows them as outlines.' }
  ],

  callout: [
    { key: 'type', label: 'Type', type: 'select', options: [
      { value: 'tip', label: 'Tip' },
      { value: 'info', label: 'Info' },
      { value: 'success', label: 'Success' },
      { value: 'warning', label: 'Warning' },
      { value: 'danger', label: 'Danger' }
    ] },
    { key: 'icon', label: 'Icon / Symbol', type: 'text', placeholder: 'info, zap, star...' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Optional header' },
    { key: 'text', label: 'Text', type: 'textarea', placeholder: 'Callout body text...' }
  ],

  accordion: [
    { key: 'items', label: 'Accordion Items', type: 'objectlist', itemLabel: 'Item', addLabel: 'Add Item',
      itemDefault: { title: 'New Question', content: 'Answer content', isOpen: false },
      subFields: [
        { key: 'title', label: 'Title', type: 'text', placeholder: 'Question' },
        { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Answer text...' },
        { key: 'isOpen', label: 'Open by default', type: 'toggle', onLabel: 'Yes' }
      ] }
  ],

  tabs: [
    { key: 'variant', label: 'Style', type: 'select', options: [
      { value: 'pills', label: 'Pills' },
      { value: 'underline', label: 'Underline' }
    ] },
    { key: 'tabs', label: 'Tabs', type: 'objectlist', itemLabel: 'Tab', addLabel: 'Add Tab',
      itemDefault: { label: 'New Tab', content: 'Tab content...' },
      subFields: [
        { key: 'label', label: 'Label', type: 'text', placeholder: 'Tab title' },
        { key: 'content', label: 'Content', type: 'textarea', placeholder: 'Tab body text...' }
      ] }
  ],

  pricing: [
    { key: 'planName', label: 'Plan Name', type: 'text', placeholder: 'Pro Plan' },
    { key: 'price', label: 'Price', type: 'text', placeholder: '$29' },
    { key: 'period', label: 'Billing Period', type: 'text', placeholder: '/ month' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Short selling point...' },
    { key: 'badge', label: 'Badge', type: 'text', placeholder: 'Most Popular' },
    { key: 'highlight', label: 'Highlight / Popular Plan', type: 'toggle', onLabel: 'Yes' },
    { key: 'features', label: 'Feature List', type: 'stringlist', addLabel: 'Add Feature' },
    { key: 'buttonLabel', label: 'Button Label', type: 'text', placeholder: 'Get Started' },
    { key: 'buttonUrl', label: 'Button URL', type: 'text', placeholder: '#' },
    { key: 'newTab', label: 'Open link in new tab', type: 'toggle', onLabel: 'Yes' }
  ],

  stat: [
    { key: 'value', label: 'Value', type: 'text', placeholder: '99.9%' },
    { key: 'label', label: 'Label', type: 'text', placeholder: 'Metric Label' },
    { key: 'trend', label: 'Trend Badge', type: 'text', placeholder: '+24.8%' },
    { key: 'trendType', label: 'Trend Direction', type: 'select', options: [
      { value: 'up', label: 'Up (green)' },
      { value: 'down', label: 'Down (red)' }
    ] },
    { key: 'icon', label: 'Icon / Symbol', type: 'text', placeholder: 'zap, chart, trend...' }
  ],

  testimonial: [
    { key: 'quote', label: 'Quote', type: 'textarea', placeholder: 'Customer testimonial...' },
    { key: 'author', label: 'Author', type: 'text', placeholder: 'Jane Doe' },
    { key: 'role', label: 'Role', type: 'text', placeholder: 'Product Lead at Acme Corp' },
    { key: 'avatar', label: 'Avatar Image URL', type: 'text', placeholder: 'https://...' },
    { key: 'rating', label: 'Rating (1-5 stars)', type: 'number', min: 1, max: 5 }
  ],

  video: [
    { key: 'url', label: 'Video URL', type: 'text', placeholder: 'YouTube / Vimeo / MP4 URL' },
    { key: 'aspectRatio', label: 'Aspect Ratio', type: 'text', placeholder: '16/9', note: 'e.g. 16/9, 4/3, 1/1, auto' },
    { key: 'borderRadius', label: 'Border Radius (px)', type: 'number', min: 0, max: 40 },
    { key: 'caption', label: 'Caption', type: 'text', placeholder: 'Optional' }
  ],

  code: [
    { key: 'language', label: 'Language', type: 'select', options: [
      { value: 'javascript', label: 'JavaScript' },
      { value: 'typescript', label: 'TypeScript' },
      { value: 'html', label: 'HTML' },
      { value: 'css', label: 'CSS' },
      { value: 'python', label: 'Python' },
      { value: 'bash', label: 'Bash' },
      { value: 'json', label: 'JSON' },
      { value: 'markdown', label: 'Markdown' }
    ] },
    { key: 'filename', label: 'File Name', type: 'text', placeholder: 'snippet.js' },
    { key: 'code', label: 'Code', type: 'textarea', placeholder: '// paste your code here' }
  ],

  bento: [
    { key: 'items', label: 'Bento Tiles', type: 'objectlist', itemLabel: 'Tile', addLabel: 'Add Tile',
      itemDefault: { title: 'New Tile', subtitle: '', icon: 'sparkles', tag: '', metric: '', span: 1, tall: false, image: '', bg: '' },
      subFields: [
        { key: 'title', label: 'Title', type: 'text', placeholder: 'Feature title' },
        { key: 'subtitle', label: 'Subtitle', type: 'textarea', placeholder: 'Short description' },
        { key: 'icon', label: 'Icon / Symbol', type: 'text', placeholder: 'zap, globe, layers...' },
        { key: 'tag', label: 'Tag', type: 'text', placeholder: 'Optional tag' },
        { key: 'metric', label: 'Metric', type: 'text', placeholder: '99.9%' },
        { key: 'image', label: 'Background Image URL', type: 'text', placeholder: 'Optional' },
        { key: 'span', label: 'Column Span', type: 'select', options: [
          { value: '1', label: '1 Column' },
          { value: '2', label: '2 Columns' }
        ] },
        { key: 'tall', label: 'Tall (2 rows)', type: 'toggle', onLabel: 'Yes' }
      ] }
  ],

  comparison: [
    { key: 'beforeImage', label: 'Before Image URL', type: 'text', placeholder: 'https://...' },
    { key: 'afterImage', label: 'After Image URL', type: 'text', placeholder: 'https://...' },
    { key: 'beforeLabel', label: 'Before Label', type: 'text', placeholder: 'Before' },
    { key: 'afterLabel', label: 'After Label', type: 'text', placeholder: 'After' }
  ],

  'tilt-card': [
    { key: 'badge', label: 'Badge', type: 'text', placeholder: 'Featured Experience' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Dynamic 3D Tilt Card' },
    { key: 'subtitle', label: 'Subtitle', type: 'textarea', placeholder: 'Card description...' },
    { key: 'ctaLabel', label: 'CTA Label', type: 'text', placeholder: 'Explore' },
    { key: 'ctaUrl', label: 'CTA URL', type: 'text', placeholder: '#' }
  ],

  marquee: [
    { key: 'speed', label: 'Scroll Speed', type: 'select', options: [
      { value: 'slow', label: 'Slow' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'Fast' }
    ] },
    { key: 'items', label: 'Marquee Items', type: 'objectlist', itemLabel: 'Item', addLabel: 'Add Item',
      itemDefault: { text: 'New Item', icon: 'star' },
      subFields: [
        { key: 'text', label: 'Text', type: 'text', placeholder: 'Item label' },
        { key: 'icon', label: 'Icon / Symbol', type: 'text', placeholder: 'star, zap...' }
      ] }
  ],

  countdown: [
    { key: 'targetDate', label: 'Target Date & Time', type: 'text', placeholder: '2026-12-31T23:59:59', note: 'ISO date string' },
    { key: 'title', label: 'Title', type: 'text', placeholder: 'Product Launch Countdown' },
    { key: 'subtitle', label: 'Subtitle', type: 'text', placeholder: 'Optional subtitle' }
  ],

  timeline: [
    { key: 'items', label: 'Timeline Entries', type: 'objectlist', itemLabel: 'Entry', addLabel: 'Add Entry',
      itemDefault: { title: 'Milestone', date: 'Q1 2026', description: '', status: 'upcoming' },
      subFields: [
        { key: 'title', label: 'Title', type: 'text', placeholder: 'Milestone name' },
        { key: 'date', label: 'Date / Period', type: 'text', placeholder: 'Q1 2026' },
        { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Details...' },
        { key: 'status', label: 'Status', type: 'select', options: [
          { value: 'upcoming', label: 'Planned' },
          { value: 'current', label: 'In Progress' },
          { value: 'completed', label: 'Completed' }
        ] }
      ] }
  ],

  form: [
    { key: 'title', label: 'Heading', type: 'text', placeholder: 'Get in Touch' },
    { key: 'description', label: 'Description', type: 'textarea', placeholder: 'Form intro text...' },
    { key: 'buttonLabel', label: 'Submit Button Label', type: 'text', placeholder: 'Send Message' }
  ],

  audio: [
    { key: 'title', label: 'Track Title', type: 'text', placeholder: 'Track Title' },
    { key: 'artist', label: 'Artist / Host', type: 'text', placeholder: 'Podcast Host / Artist' },
    { key: 'duration', label: 'Duration', type: 'text', placeholder: '04:15' },
    { key: 'cover', label: 'Cover Image URL', type: 'text', placeholder: 'https://...' }
  ],

  header: [
    { key: 'brandName', label: 'Brand Name', type: 'text', placeholder: 'Aladen Studio' },
    { key: 'brandUrl', label: 'Brand Link URL', type: 'text', placeholder: '#' },
    { key: 'brandLogo', label: 'Brand Logo URL', type: 'text', placeholder: 'Optional image' },
    { key: 'brandIcon', label: 'Brand Icon', type: 'text', placeholder: 'star, shield, logo...' },
    { key: 'layout', label: 'Layout', type: 'select', options: [
      { value: 'spread', label: 'Spread (links on right)' },
      { value: 'left', label: 'Left Aligned Links' },
      { value: 'center', label: 'Centered Links' },
      { value: 'floating', label: 'Floating Pill' }
    ] },
    { key: 'styleVariant', label: 'Style Variant', type: 'select', options: [
      { value: 'glass', label: 'Glass' },
      { value: 'solid', label: 'Solid' },
      { value: 'transparent', label: 'Transparent' },
      { value: 'bordered', label: 'Bordered' }
    ] },
    { key: 'sticky', label: 'Sticky Header', type: 'toggle', onLabel: 'Yes' },
    { key: 'links', label: 'Navigation Links', type: 'objectlist', itemLabel: 'Link', addLabel: 'Add Link',
      itemDefault: { label: 'New Link', url: '#' },
      subFields: [
        { key: 'label', label: 'Label', type: 'text', placeholder: 'Link text' },
        { key: 'url', label: 'URL', type: 'text', placeholder: '#' }
      ] },
    { key: 'showTopBar', label: 'Show Announcement Bar', type: 'toggle', onLabel: 'Yes' },
    { key: 'topBarText', label: 'Announcement Text', type: 'text', placeholder: 'New announcement' },
    { key: 'topBarBadge', label: 'Announcement Badge', type: 'text', placeholder: 'NEW' },
    { key: 'topBarLink', label: 'Announcement Link', type: 'text', placeholder: '#' },
    { key: 'showSearch', label: 'Show Search Box', type: 'toggle', onLabel: 'Yes' },
    { key: 'searchPlaceholder', label: 'Search Placeholder', type: 'text', placeholder: 'Search...' },
    { key: 'showCta', label: 'Show CTA Button', type: 'toggle', onLabel: 'Yes' },
    { key: 'ctaLabel', label: 'CTA Label', type: 'text', placeholder: 'Get Started' },
    { key: 'ctaUrl', label: 'CTA URL', type: 'text', placeholder: '#' },
    { key: 'ctaVariant', label: 'CTA Style', type: 'select', options: [
      { value: 'filled', label: 'Filled' },
      { value: 'outline', label: 'Outline' },
      { value: 'soft', label: 'Soft' },
      { value: 'glow', label: 'Glow' }
    ] },
    { key: 'logoHeight', label: 'Logo Height (px)', type: 'number', min: 16, max: 120 },
    { key: 'children', label: 'Component Carousel Slides', type: 'children', addLabel: 'Add Child',
      note: 'Each child renders as a slide in the header component carousel on the published page.' }
  ],

  footer: [
    { key: 'styleVariant', label: 'Theme', type: 'select', options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'transparent', label: 'Transparent' }
    ] },
    { key: 'brandName', label: 'Brand Name', type: 'text', placeholder: 'Aladen Platform' },
    { key: 'brandIcon', label: 'Brand Icon', type: 'text', placeholder: 'star, shield, logo...' },
    { key: 'tagline', label: 'Tagline', type: 'textarea', placeholder: 'Short description' },
    { key: 'showColumns', label: 'Show Link Columns', type: 'toggle', onLabel: 'Yes' },
    { key: 'columns', label: 'Link Columns', type: 'objectlist', itemLabel: 'Column', addLabel: 'Add Column',
      itemDefault: { title: 'Product', links: [{ label: 'Feature', url: '#' }] },
      subFields: [
        { key: 'title', label: 'Column Title', type: 'text', placeholder: 'Product' },
        { key: 'links', label: 'Column Links', type: 'links' }
      ] },
    { key: 'showNewsletter', label: 'Show Newsletter Form', type: 'toggle', onLabel: 'Yes' },
    { key: 'newsletterTitle', label: 'Newsletter Title', type: 'text', placeholder: 'Stay in the loop' },
    { key: 'newsletterText', label: 'Newsletter Text', type: 'textarea', placeholder: 'Optional note' },
    { key: 'copyright', label: 'Copyright Line', type: 'text', placeholder: '© 2026 Aladen Studio' }
  ]
};