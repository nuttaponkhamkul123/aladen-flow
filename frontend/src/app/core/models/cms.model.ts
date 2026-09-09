export interface CmsPage {
  id: number;
  title: string;
  slug: string;
  blocks: Block[];
  status: 'draft' | 'published';
  settings?: Record<string, any>;
  parent_id?: number | null;
  position?: number;
  is_first_page?: number;
  tags?: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ReusableBlock {
  id: number;
  name: string;
  category?: string;
  block_data: Block;
  created_at?: string;
}

export interface Block {
  id: string;
  type: string;
  props: Record<string, any>;
}

export interface BlockCategory {
  id: string;
  name: string;
  icon: string;
  items: BlockItemDef[];
}

export interface BlockItemDef {
  type: string;
  label: string;
  sub: string;
  iconSvg: string;
}

export const BLOCK_DEFAULTS: Record<string, any> = {
  header: {
    brandName: 'Aladen Studio',
    brandLogo: '',
    links: [
      { label: 'Overview', url: '#' },
      { label: 'Features', url: '#features' },
      { label: 'Showcase', url: '#showcase' },
      { label: 'Pricing', url: '#pricing' }
    ],
    ctaLabel: 'Get Started',
    ctaUrl: '#',
    sticky: true
  },
  footer: {
    brandName: 'Aladen Platform',
    tagline: 'Modern workspaces combining visual site building with agile project boards.',
    copyright: '© 2026 Aladen Studio Inc. All rights reserved.',
    showNewsletter: false,
    columns: [
      { title: 'Product', links: [{ label: 'Features', url: '#' }, { label: 'Kanban', url: '#' }, { label: 'CMS', url: '#' }] },
      { title: 'Resources', links: [{ label: 'Docs', url: '#' }, { label: 'Templates', url: '#' }, { label: 'Community', url: '#' }] }
    ]
  },
  heading: {
    level: 2,
    text: 'Craft Beautiful Experiences',
    align: 'left',
    color: '',
    margin: 12
  },
  paragraph: {
    text: 'Combine visual building with agile workflow tracking in a modern, streamlined workspace.',
    align: 'left',
    size: 'normal',
    color: '',
    bold: false,
    italic: false
  },
  button: {
    label: 'Explore Features',
    url: '#',
    variant: 'filled',
    size: 'medium',
    color: '#6366f1',
    textColor: '#ffffff',
    align: 'left',
    borderRadius: 8
  },
  image: {
    url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop',
    alt: 'Abstract gradient artwork',
    caption: '',
    width: '100%',
    align: 'center',
    objectFit: 'cover',
    borderRadius: 8,
    shadow: false,
    border: false
  },
  divider: {
    style: 'solid',
    thickness: 1,
    width: '100%',
    margin: 16,
    color: ''
  },
  spacer: {
    height: 24
  },
  table: {
    headers: ['Feature', 'Description', 'Status'],
    rows: [
      ['Kanban Board', 'Interactive drag-and-drop workflow tracking', 'Completed'],
      ['Site Builder', 'Visual block-based page creator', 'Completed'],
      ['Analytics', 'Performance and activity metrics', 'In Progress']
    ],
    hasHeader: true,
    striped: true,
    bordered: true,
    compact: false
  },
  container: {
    mode: 'grid',
    direction: 'row',
    justify: 'flex-start',
    align: 'stretch',
    wrap: 'wrap',
    columns: 2,
    gap: 16,
    padding: 16,
    bg: 'surface',
    border: true,
    borderRadius: 8,
    shadow: false,
    children: []
  },
  callout: {
    type: 'info',
    icon: '💡',
    title: 'Did you know?',
    text: 'You can combine Kanban project tracking with full visual site publishing on one canvas.'
  },
  accordion: {
    items: [
      { title: 'What is this platform?', content: 'A complete workspace combining visual site building and Kanban task management.' },
      { title: 'How do I publish my site?', content: 'Click the Publish button in the top bar to get an instant live public link.' },
      { title: 'Can I export or customize code?', content: 'Yes! Full custom CSS styles, responsive viewports, and clean semantic exports are built-in.' }
    ]
  },
  tabs: {
    tabs: [
      { label: 'Overview', content: 'Explore our core capabilities and workflows designed for modern creators and agile teams.' },
      { label: 'Features', content: 'Real-time drag-and-drop, responsive layout previews, AI-assisted generation, and Kanban boards.' },
      { label: 'Roadmap', content: 'Upcoming integrations include cloud syncing, webhook notifications, and multi-user collaboration.' }
    ]
  },
  pricing: {
    planName: 'Pro Plan',
    price: '$29',
    period: '/month',
    description: 'Everything you need to launch and scale your online presence.',
    features: [
      'Unlimited visual pages & blocks',
      'Integrated Kanban task tracking',
      'Local Ollama & Cloud AI generation',
      'Custom styling & responsive previews'
    ],
    buttonLabel: 'Get Started Today',
    buttonUrl: '#',
    highlight: true,
    badge: 'Most Popular'
  },
  stat: {
    label: 'Monthly Active Users',
    value: '128.4K',
    subtext: 'vs previous month',
    trend: '+24.8%',
    trendType: 'up'
  },
  testimonial: {
    quote: 'This platform completely transformed our development process. The visual builder combined with Kanban is unmatched!',
    author: 'Sarah Jenkins',
    role: 'Head of Product at TechFlow',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop',
    rating: 5
  },
  video: {
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    caption: '',
    autoplay: false
  },
  code: {
    code: '// Modern JavaScript sample\nasync function launchProject() {\n  console.log("Ready for takeoff!");\n}',
    language: 'javascript'
  },
  bento: {
    items: [
      { title: 'Ultra Fast Engine', subtitle: 'Native node:sqlite queries with sub-millisecond roundtrips.', icon: '⚡', tag: 'Core', metric: '0.4ms', span: 2, tall: false, image: '' },
      { title: 'Global CDN', subtitle: 'Edge deployed content delivered with zero latency globally.', icon: '🌐', tag: 'Network', metric: '99.99%', span: 1, tall: false, image: '' },
      { title: 'Deep Analytics', subtitle: 'Real-time telemetry and user interaction telemetry.', icon: '📊', tag: 'Insights', metric: '10M+', span: 1, tall: false, image: '' },
      { title: 'Design System', subtitle: 'Curated color palettes and sleek glassmorphic surfaces.', icon: '🎨', tag: 'Aesthetics', metric: '60fps', span: 2, tall: false, image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop' }
    ]
  },
  comparison: {
    beforeImage: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop',
    afterImage: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800&auto=format&fit=crop',
    beforeLabel: 'Before Design',
    afterLabel: 'After Design'
  },
  'tilt-card': {
    badge: 'Featured Experience',
    title: 'Dynamic 3D Tilt Card',
    subtitle: 'Hover or drag across this card to experience natural spatial perspective, dynamic parallax depth, and specular glare reflection.',
    ctaLabel: 'Explore Interactive',
    ctaUrl: '#'
  },
  marquee: {
    speed: 'normal',
    items: [
      { text: 'TypeScript', icon: '⚡' },
      { text: 'TailwindCSS', icon: '🎨' },
      { text: 'Node.js', icon: '🟢' },
      { text: 'SQLite', icon: '🗄️' },
      { text: 'GraphQL', icon: '◈' },
      { text: 'Next.js', icon: '▲' }
    ]
  },
  countdown: {
    title: 'Product Launch Countdown',
    subtitle: 'Our next major generation release is just around the corner.',
    targetDate: '2026-12-31T23:59:59'
  },
  timeline: {
    items: [
      { title: 'Project Genesis', date: 'Q1 2026', description: 'Initial architecture design, core Kanban workspace, and local database engine.', status: 'completed' },
      { title: 'Visual CMS & AI Generation', date: 'Q2 2026', description: 'Drag-and-drop block site builder integrated with local Ollama LLM intelligence.', status: 'completed' },
      { title: 'Creative Component Suite', date: 'Q3 2026', description: 'Launch of 3D tilt cards, bento grids, comparison sliders, and ambient themes.', status: 'current' },
      { title: 'Cloud Sync & Team Spaces', date: 'Q4 2026', description: 'Real-time multi-agent sync, team spaces, and decentralized publishing.', status: 'upcoming' }
    ]
  },
  form: {
    title: 'Connect With Our Team',
    description: 'Have questions, ideas, or feedback? Send us a message and we will respond within 24 hours.',
    buttonLabel: 'Send Message'
  },
  audio: {
    title: 'Midnight Synth Wave - Ambient Session 04',
    artist: 'Aladen Studio Radio',
    duration: '03:45',
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=150&auto=format&fit=crop'
  }
};
