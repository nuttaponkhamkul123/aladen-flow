const path = require('path');
const fs = require('fs');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'kanban.db');

let db;

try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
} catch (_) {
  const { DatabaseSync } = require('node:sqlite');
  const rawDb = new DatabaseSync(DB_PATH);

  function norm(params) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return [params[0].map(p => (p === undefined ? null : p)), false];
    }
    if (params.length === 1 && typeof params[0] === 'object' && params[0] !== null) {
      return [params[0], true];
    }
    return [params.map(p => (p === undefined ? null : p)), false];
  }

  db = {
    exec(sql) {
      return rawDb.exec(sql);
    },
    pragma(str) {
      try {
        return rawDb.prepare(`PRAGMA ${str}`).all();
      } catch (_) {
        return rawDb.exec(`PRAGMA ${str}`);
      }
    },
    prepare(sql) {
      const stmt = rawDb.prepare(sql);
      return {
        run(...params) {
          const [args, isObj] = norm(params);
          const res = isObj ? stmt.run(args) : stmt.run(...args);
          return {
            changes: Number(res.changes),
            lastInsertRowid: Number(res.lastInsertRowid)
          };
        },
        get(...params) {
          const [args, isObj] = norm(params);
          return isObj ? stmt.get(args) : stmt.get(...args);
        },
        all(...params) {
          const [args, isObj] = norm(params);
          return isObj ? stmt.all(args) : stmt.all(...args);
        }
      };
    },
    transaction(fn) {
      return function (...args) {
        rawDb.exec('BEGIN');
        try {
          const result = fn.apply(this, args);
          rawDb.exec('COMMIT');
          return result;
        } catch (err) {
          try { rawDb.exec('ROLLBACK'); } catch (_) { }
          throw err;
        }
      };
    }
  };

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
}

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

CREATE TABLE IF NOT EXISTS reusable_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'custom',
  block_data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_type TEXT NOT NULL DEFAULT 'checklist_completed',
  is_active INTEGER NOT NULL DEFAULT 1,
  nodes_json TEXT NOT NULL DEFAULT '[]',
  edges_json TEXT NOT NULL DEFAULT '[]',
  execution_count INTEGER NOT NULL DEFAULT 0,
  last_executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'success',
  summary TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_columns_board ON columns(board_id);
CREATE INDEX IF NOT EXISTS idx_cards_column ON cards(column_id);
CREATE INDEX IF NOT EXISTS idx_card_labels_card ON card_labels(card_id);
CREATE INDEX IF NOT EXISTS idx_checklist_card ON checklist_items(card_id);
CREATE INDEX IF NOT EXISTS idx_page_tags_tag ON page_tags(tag);
CREATE INDEX IF NOT EXISTS idx_automations_active ON automations(is_active);
CREATE INDEX IF NOT EXISTS idx_automation_logs_auto ON automation_logs(automation_id);
`);

try {
  db.prepare("ALTER TABLE pages ADD COLUMN settings TEXT DEFAULT '{}'").run();
} catch (_) { }
try {
  db.prepare("ALTER TABLE pages ADD COLUMN parent_id INTEGER DEFAULT NULL").run();
} catch (_) { }
try {
  db.prepare("ALTER TABLE pages ADD COLUMN position INTEGER DEFAULT 0").run();
} catch (_) { }
try {
  db.prepare("ALTER TABLE cards ADD COLUMN cover TEXT DEFAULT ''").run();
} catch (_) { }
try {
  db.prepare("ALTER TABLE pages ADD COLUMN is_first_page INTEGER DEFAULT 0").run();
} catch (_) { }

// Ensure a default first page is designated if pages exist
try {
  const hasFirst = db.prepare("SELECT COUNT(*) AS c FROM pages WHERE is_first_page = 1").get();
  if (!hasFirst || !hasFirst.c) {
    const top = db.prepare("SELECT id FROM pages ORDER BY position ASC, id ASC LIMIT 1").get();
    if (top) {
      db.prepare("UPDATE pages SET is_first_page = 1 WHERE id = ?").run(top.id);
    }
  }
} catch (_) { }

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
          { id: 'b4', type: 'paragraph', props: { text: 'Headings, paragraphs, buttons, images, image carousels, tables, dividers, and spacers. Mix and match.' } },
          {
            id: 'b_carousel',
            type: 'carousel',
            props: {
              slides: [
                { url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1000&auto=format&fit=crop', caption: 'Dynamic Abstract Composition' },
                { url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=1000&auto=format&fit=crop', caption: 'Cyberpunk Neon Horizon' },
                { url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1000&auto=format&fit=crop', caption: 'Tropical Ocean Sunset' }
              ],
              aspectRatio: '16/9',
              autoplay: true,
              interval: 4,
              showArrows: true,
              showDots: true,
              showCaptions: true,
              borderRadius: 10
            }
          },
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

function seedAutomationsIfEmpty() {
  try {
    const count = db.prepare('SELECT COUNT(*) AS c FROM automations').get()?.c || 0;
    if (count > 0) return;

    const insertAuto = db.prepare(`
      INSERT INTO automations (name, description, trigger_type, is_active, nodes_json, edges_json, execution_count, last_executed_at)
      VALUES (?, ?, ?, 1, ?, ?, ?, datetime('now'))
    `);

    const auto1Nodes = [
      {
        id: 'node_trig_1',
        type: 'trigger',
        title: 'Checklist Completed',
        subtitle: 'When all checklist items on a card are checked',
        x: 60,
        y: 160,
        config: {
          event: 'checklist_completed',
          label: 'Card Checklist 100%'
        }
      },
      {
        id: 'node_cond_1',
        type: 'condition',
        title: 'Not in Done Column',
        subtitle: 'Verify card is not already in Done column',
        x: 420,
        y: 160,
        config: {
          field: 'column_name',
          operator: 'not_equals',
          value: 'Done'
        }
      },
      {
        id: 'node_act_1',
        type: 'action',
        title: 'Promote to Done Column',
        subtitle: 'Automatically move card into "Done" column and record activity',
        x: 780,
        y: 160,
        config: {
          action_type: 'move_card_column',
          target_column: 'Done',
          add_activity: 'Auto-promoted to Done on checklist 100% completion'
        }
      }
    ];
    const auto1Edges = [
      { id: 'edge_1_1', source: 'node_trig_1', target: 'node_cond_1' },
      { id: 'edge_1_2', source: 'node_cond_1', target: 'node_act_1' }
    ];

    const auto2Nodes = [
      {
        id: 'node_trig_2',
        type: 'trigger',
        title: 'Card Created / Updated',
        subtitle: 'When card details or title are modified',
        x: 60,
        y: 160,
        config: {
          event: 'card_updated',
          label: 'Card Updated'
        }
      },
      {
        id: 'node_cond_2',
        type: 'condition',
        title: 'Detect Urgent Bug',
        subtitle: 'Title or description matches "bug", "urgent", or "critical"',
        x: 420,
        y: 160,
        config: {
          field: 'title_or_desc',
          operator: 'contains',
          value: 'bug'
        }
      },
      {
        id: 'node_act_2',
        type: 'action',
        title: 'Escalate to Urgent Priority',
        subtitle: 'Set priority to Urgent and elevate card on board',
        x: 780,
        y: 160,
        config: {
          action_type: 'set_priority',
          priority: 'urgent',
          add_activity: 'Escalated to Urgent priority by bug detection rule'
        }
      }
    ];
    const auto2Edges = [
      { id: 'edge_2_1', source: 'node_trig_2', target: 'node_cond_2' },
      { id: 'edge_2_2', source: 'node_cond_2', target: 'node_act_2' }
    ];

    const auto3Nodes = [
      {
        id: 'node_trig_3',
        type: 'trigger',
        title: 'CMS Page Published',
        subtitle: 'When a site page status changes to Published',
        x: 60,
        y: 160,
        config: {
          event: 'cms_page_published',
          label: 'Page Published'
        }
      },
      {
        id: 'node_cond_3',
        type: 'condition',
        title: 'Status is Published',
        subtitle: 'Ensure published status is valid',
        x: 420,
        y: 160,
        config: {
          field: 'status',
          operator: 'equals',
          value: 'published'
        }
      },
      {
        id: 'node_act_3',
        type: 'action',
        title: 'Create Board QA Card',
        subtitle: 'Auto-create card in "Review" column with checklist',
        x: 780,
        y: 160,
        config: {
          action_type: 'create_card',
          target_column: 'Review',
          title_prefix: 'Verify Live SEO: ',
          priority: 'high',
          add_activity: 'Generated QA verification card for newly published CMS page'
        }
      }
    ];
    const auto3Edges = [
      { id: 'edge_3_1', source: 'node_trig_3', target: 'node_cond_3' },
      { id: 'edge_3_2', source: 'node_cond_3', target: 'node_act_3' }
    ];

    const tx = db.transaction(() => {
      const id1 = insertAuto.run(
        'Auto-Move to Done on Checklist Completion',
        'When all checklist items on a card are checked, automatically transition it into the Done column.',
        'checklist_completed',
        JSON.stringify(auto1Nodes),
        JSON.stringify(auto1Edges),
        12
      ).lastInsertRowid;

      const id2 = insertAuto.run(
        'Urgent Bug Escalator',
        'Automatically escalates priority to Urgent when any card is tagged or titled as a bug.',
        'card_updated',
        JSON.stringify(auto2Nodes),
        JSON.stringify(auto2Edges),
        7
      ).lastInsertRowid;

      const id3 = insertAuto.run(
        'CMS Publish -> Kanban QA Verification',
        'When a page is published in Site Builder, automatically create a verification card in the Kanban Review column.',
        'cms_page_published',
        JSON.stringify(auto3Nodes),
        JSON.stringify(auto3Edges),
        3
      ).lastInsertRowid;

      const logStmt = db.prepare(`
        INSERT INTO automation_logs (automation_id, status, summary, details_json, created_at)
        VALUES (?, ?, ?, ?, datetime('now', ?))
      `);

      logStmt.run(id1, 'success', 'Card "Deploy landing page" moved to Done (3/3 items complete)', JSON.stringify({ cardId: 1, column: 'Done' }), '-10 minutes');
      logStmt.run(id1, 'success', 'Card "Fix mobile touch target" moved to Done (2/2 items complete)', JSON.stringify({ cardId: 2, column: 'Done' }), '-45 minutes');
      logStmt.run(id2, 'success', 'Card "Production SSL expired" priority set to Urgent', JSON.stringify({ cardId: 3, priority: 'urgent' }), '-2 hours');
      logStmt.run(id3, 'success', 'Created QA card "Verify Live SEO: Product Roadmap" in Review column', JSON.stringify({ page: 'Product Roadmap' }), '-5 hours');
    });

    tx();
  } catch (err) {
    console.error('Failed to seed automations:', err);
  }
}

seedIfEmpty();
seedAutomationsIfEmpty();

module.exports = db;
