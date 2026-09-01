const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'kanban.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS boards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS columns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  column_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  priority TEXT NOT NULL DEFAULT 'medium',
  position INTEGER NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (column_id) REFERENCES columns(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS card_labels (
  card_id INTEGER NOT NULL,
  label_id INTEGER NOT NULL,
  PRIMARY KEY (card_id, label_id),
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checklist_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  checked INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL,
  FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS activities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER,
  board_id INTEGER,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  blocks TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS page_tags (
  page_id INTEGER NOT NULL,
  tag TEXT NOT NULL,
  PRIMARY KEY (page_id, tag),
  FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
CREATE INDEX IF NOT EXISTS idx_card_labels_card ON card_labels(card_id);
CREATE INDEX IF NOT EXISTS idx_checklist_card ON checklist_items(card_id);
CREATE INDEX IF NOT EXISTS idx_page_tags_tag ON page_tags(tag);
`);

function seedIfEmpty() {
  const boardCount = db.prepare('SELECT COUNT(*) AS c FROM boards').get().c;
  if (boardCount > 0) return;

  const insertBoard = db.prepare('INSERT INTO boards (name) VALUES (?)');
  const insertColumn = db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)');
  const insertLabel = db.prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)');
  const insertCard = db.prepare(
    'INSERT INTO cards (column_id, title, description, due_date, priority, position) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertCardLabel = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
  const insertActivity = db.prepare(
    'INSERT INTO activities (card_id, board_id, message) VALUES (?, ?, ?)'
  );

  const tx = db.transaction(() => {
    const boardId = insertBoard.run('Personal Board').lastInsertRowid;

    const colIds = {};
    const colNames = ['Backlog', 'In Progress', 'Review', 'Done'];
    colNames.forEach((n, i) => {
      colIds[n] = insertColumn.run(boardId, n, i).lastInsertRowid;
    });

    const labels = [
      { name: 'bug', color: '#ef4444' },
      { name: 'feature', color: '#3b82f6' },
      { name: 'urgent', color: '#f59e0b' },
      { name: 'docs', color: '#10b981' }
    ];
    const labelIds = labels.map(l => ({ ...l, id: insertLabel.run(boardId, l.name, l.color).lastInsertRowid }));

    const today = new Date();
    const inDays = d => {
      const dt = new Date(today);
      dt.setDate(dt.getDate() + d);
      return dt.toISOString().slice(0, 10);
    };

    const seedCards = [
      { col: 'Backlog', title: 'Design landing page', desc: 'Sketch hero section and CTA.', due: inDays(7), priority: 'medium', labels: ['feature', 'docs'] },
      { col: 'Backlog', title: 'Set up analytics', desc: 'Track page views and events.', due: inDays(14), priority: 'low', labels: ['feature'] },
      { col: 'In Progress', title: 'Fix login redirect bug', desc: 'Users redirected to 404 after OAuth.', due: inDays(2), priority: 'urgent', labels: ['bug', 'urgent'] },
      { col: 'In Progress', title: 'Write API docs', desc: 'Document all endpoints with examples.', due: inDays(5), priority: 'medium', labels: ['docs'] },
      { col: 'Review', title: 'Refactor DB layer', desc: 'Simplify queries, add indexes.', due: inDays(1), priority: 'high', labels: [] },
      { col: 'Done', title: 'Project scaffold', desc: 'Initial repo and tooling.', due: null, priority: 'low', labels: ['feature'] }
    ];

    let posByCol = { Backlog: 0, 'In Progress': 0, Review: 0, Done: 0 };
    seedCards.forEach(c => {
      const cardId = insertCard.run(colIds[c.col], c.title, c.desc, c.due, c.priority, posByCol[c.col]).lastInsertRowid;
      posByCol[c.col]++;
      c.labels.forEach(lname => {
        const lbl = labelIds.find(l => l.name === lname);
        if (lbl) insertCardLabel.run(cardId, lbl.id);
      });
      insertActivity.run(cardId, boardId, `Card created: "${c.title}"`);
    });
  });
  tx();

  const pageCount = db.prepare('SELECT COUNT(*) AS c FROM pages').get().c;
  if (pageCount === 0) {
    const insertPage = db.prepare(
      'INSERT INTO pages (title, slug, blocks, status) VALUES (?, ?, ?, ?)'
    );
    const insertPageTag = db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (?, ?)');

    const seedPages = [
      {
        title: 'Getting Started',
        slug: 'getting-started',
        status: 'published',
        tags: ['guide', 'intro'],
        blocks: [
          { id: 'b1', type: 'heading', props: { level: 1, text: 'Welcome to the Site Builder' } },
          { id: 'b2', type: 'paragraph', props: { text: 'Drag blocks from the palette to build your page. Click any block to edit it on the right.' } },
          { id: 'b3', type: 'heading', props: { level: 2, text: 'How it works' } },
          { id: 'b4', type: 'paragraph', props: { text: 'Headings, paragraphs, buttons, images, dividers, and spacers. Mix and match.' } },
          { id: 'b5', type: 'button', props: { label: 'Learn more', url: 'https://example.com', color: '#6366f1' } },
          { id: 'b6', type: 'divider', props: {} },
          { id: 'b7', type: 'paragraph', props: { text: 'Happy building.' } }
        ]
      },
      {
        title: 'Product Roadmap',
        slug: 'product-roadmap',
        status: 'draft',
        tags: ['roadmap', 'planning'],
        blocks: [
          { id: 'b1', type: 'heading', props: { level: 1, text: 'Product Roadmap' } },
          { id: 'b2', type: 'heading', props: { level: 2, text: 'Q3' } },
          { id: 'b3', type: 'paragraph', props: { text: 'Ship the drag-and-drop site builder. Improve search. Mobile layout.' } },
          { id: 'b4', type: 'heading', props: { level: 2, text: 'Q4' } },
          { id: 'b5', type: 'paragraph', props: { text: 'Real-time collaboration. Export / import boards.' } }
        ]
      },
      {
        title: 'Team Handbook',
        slug: 'team-handbook',
        status: 'published',
        tags: ['guide', 'team'],
        blocks: [
          { id: 'b1', type: 'heading', props: { level: 1, text: 'Team Handbook' } },
          { id: 'b2', type: 'paragraph', props: { text: 'Our values, processes, and how we work day-to-day.' } },
          { id: 'b3', type: 'heading', props: { level: 2, text: 'Standups' } },
          { id: 'b4', type: 'paragraph', props: { text: 'We keep them short and async-friendly.' } },
          { id: 'b5', type: 'spacer', props: { height: 24 } }
        ]
      }
    ];
    const tx2 = db.transaction(() => {
      seedPages.forEach(p => {
        const info = insertPage.run(p.title, p.slug, JSON.stringify(p.blocks), p.status);
        p.tags.forEach(t => insertPageTag.run(info.lastInsertRowid, t));
      });
    });
    tx2();
  }
}

seedIfEmpty();

module.exports = db;
