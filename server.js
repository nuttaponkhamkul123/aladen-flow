const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// Automatic .env loader for API keys
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    });
  }
} catch (e) { }

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function logActivity(cardId, boardId, message) {
  db.prepare('INSERT INTO activities (card_id, board_id, message) VALUES (?, ?, ?)').run(
    cardId || null,
    boardId || null,
    message
  );
}

app.get('/api/boards', (req, res) => {
  const boards = db.prepare('SELECT * FROM boards ORDER BY created_at ASC').all();
  res.json(boards);
});

app.post('/api/boards', (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const info = db.prepare('INSERT INTO boards (name) VALUES (?)').run(name.trim());
  const boardId = info.lastInsertRowid;
  const defaults = ['To Do', 'Doing', 'Done'];
  defaults.forEach((n, i) => {
    db.prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)').run(boardId, n, i);
  });
  logActivity(null, boardId, `Board created: "${name.trim()}"`);
  res.json({ id: boardId, name: name.trim() });
});

app.delete('/api/boards/:id', (req, res) => {
  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/boards/:id', (req, res) => {
  const boardId = Number(req.params.id);
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
  if (!board) return res.status(404).json({ error: 'not found' });

  const columns = db
    .prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC')
    .all(boardId);

  const labels = db.prepare('SELECT * FROM labels WHERE board_id = ? ORDER BY id ASC').all(boardId);

  const cardStmt = db.prepare(
    'SELECT * FROM cards WHERE column_id = ? AND archived = 0 ORDER BY position ASC'
  );
  const labelMapStmt = db.prepare(
    `SELECT l.id, l.name, l.color FROM card_labels cl
     JOIN labels l ON l.id = cl.label_id WHERE cl.card_id = ?`
  );
  const checklistStmt = db.prepare(
    'SELECT * FROM checklist_items WHERE card_id = ? ORDER BY position ASC'
  );

  const cards = [];
  const columnIds = columns.map(c => c.id);
  if (columnIds.length) {
    const placeholders = columnIds.map(() => '?').join(',');
    const allCards = db
      .prepare(
        `SELECT * FROM cards WHERE column_id IN (${placeholders}) AND archived = 0 ORDER BY column_id, position ASC`
      )
      .all(...columnIds);

    for (const card of allCards) {
      card.labels = labelMapStmt.all(card.id);
      card.checklist = checklistStmt.all(card.id).map(i => ({
        ...i,
        checked: !!i.checked
      }));
      cards.push(card);
    }
  }

  res.json({ ...board, columns, labels, cards });
});

app.post('/api/boards/:id/columns', (req, res) => {
  const boardId = Number(req.params.id);
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM columns WHERE board_id = ?')
    .get(boardId).m;
  const info = db
    .prepare('INSERT INTO columns (board_id, name, position) VALUES (?, ?, ?)')
    .run(boardId, name.trim(), max + 1);
  res.json({ id: info.lastInsertRowid, board_id: boardId, name: name.trim(), position: max + 1 });
});

app.patch('/api/columns/:id', (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (typeof name === 'string' && name.trim()) {
    db.prepare('UPDATE columns SET name = ? WHERE id = ?').run(name.trim(), id);
  }
  res.json({ ok: true });
});

app.delete('/api/columns/:id', (req, res) => {
  db.prepare('DELETE FROM columns WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/columns/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const { board_id, orderedIds } = req.body;
  const tx = db.transaction(() => {
    orderedIds.forEach((cid, idx) => {
      db.prepare('UPDATE columns SET board_id = ?, position = ? WHERE id = ?').run(board_id, idx, cid);
    });
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/columns/:id/cards', (req, res) => {
  const columnId = Number(req.params.id);
  const { title, description = '', due_date = null, priority = 'medium', labelIds = [] } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM cards WHERE column_id = ?')
    .get(columnId).m;
  const info = db
    .prepare(
      'INSERT INTO cards (column_id, title, description, due_date, priority, position) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(columnId, title.trim(), description, due_date, priority, max + 1);

  const cardId = info.lastInsertRowid;
  const insertLabel = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
  labelIds.forEach(lid => insertLabel.run(cardId, lid));

  const boardId = db.prepare('SELECT board_id AS b FROM columns WHERE id = ?').get(columnId)?.b;
  logActivity(cardId, boardId, `Card created: "${title.trim()}"`);
  res.json({ id: cardId });
});

app.patch('/api/cards/:id', (req, res) => {
  const id = Number(req.params.id);
  const { title, description, due_date, priority, archived, labelIds } = req.body;

  const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const tx = db.transaction(() => {
    const updates = [];
    const params = [];
    if (typeof title === 'string') {
      updates.push('title = ?');
      params.push(title.trim());
      if (title.trim() !== existing.title) logActivity(id, null, `Title changed to "${title.trim()}"`);
    }
    if (typeof description === 'string') {
      updates.push('description = ?');
      params.push(description);
    }
    if (due_date !== undefined) {
      updates.push('due_date = ?');
      params.push(due_date);
      if (existing.due_date !== due_date)
        logActivity(id, null, `Due date set to ${due_date || 'none'}`);
    }
    if (priority !== undefined) {
      updates.push('priority = ?');
      params.push(priority);
      if (existing.priority !== priority) logActivity(id, null, `Priority changed to ${priority}`);
    }
    if (archived !== undefined) {
      updates.push('archived = ?');
      params.push(archived ? 1 : 0);
      logActivity(id, null, archived ? 'Card archived' : 'Card restored');
    }
    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE cards SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    if (Array.isArray(labelIds)) {
      db.prepare('DELETE FROM card_labels WHERE card_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO card_labels (card_id, label_id) VALUES (?, ?)');
      labelIds.forEach(lid => ins.run(id, lid));
    }
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/cards/:id', (req, res) => {
  db.prepare('DELETE FROM cards WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/cards/:id/move', (req, res) => {
  const id = Number(req.params.id);
  const { column_id, position } = req.body;
  const newCol = Number(column_id);
  const newPos = Number(position);

  const tx = db.transaction(() => {
    const all = db
      .prepare('SELECT id, position FROM cards WHERE column_id = ? AND id != ? AND archived = 0 ORDER BY position ASC')
      .all(newCol, id);
    all.splice(newPos, 0, { id, position: 0 });
    all.forEach((c, idx) => {
      db.prepare('UPDATE cards SET position = ?, column_id = ? WHERE id = ?').run(idx, newCol, c.id);
    });
    db.prepare("UPDATE cards SET updated_at = datetime('now') WHERE id = ?").run(id);
  });
  tx();
  res.json({ ok: true });
});

app.get('/api/cards/:id/activity', (req, res) => {
  const items = db
    .prepare('SELECT * FROM activities WHERE card_id = ? ORDER BY created_at DESC LIMIT 50')
    .all(req.params.id);
  res.json(items);
});

app.get('/api/boards/:id/activity', (req, res) => {
  const items = db
    .prepare(
      `SELECT a.*, c.title AS card_title FROM activities a
       LEFT JOIN cards c ON c.id = a.card_id
       WHERE a.board_id = ? ORDER BY a.created_at DESC LIMIT 100`
    )
    .all(req.params.id);
  res.json(items);
});

app.get('/api/search', (req, res) => {
  const q = `%${(req.query.q || '').trim()}%`;
  if (!q || q === '%%') return res.json([]);
  const rows = db
    .prepare('SELECT * FROM cards WHERE archived = 0 AND (title LIKE ? OR description LIKE ?) ORDER BY updated_at DESC LIMIT 50')
    .all(q, q);
  res.json(rows);
});

app.post('/api/boards/:id/labels', (req, res) => {
  const boardId = Number(req.params.id);
  const { name, color } = req.body;
  if (!name || !color) return res.status(400).json({ error: 'name and color required' });
  const info = db
    .prepare('INSERT INTO labels (board_id, name, color) VALUES (?, ?, ?)')
    .run(boardId, name.trim(), color);
  res.json({ id: info.lastInsertRowid });
});

app.delete('/api/labels/:id', (req, res) => {
  db.prepare('DELETE FROM labels WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/cards/:id/checklist', (req, res) => {
  const cardId = Number(req.params.id);
  const { text } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'text required' });
  const max = db
    .prepare('SELECT COALESCE(MAX(position), -1) AS m FROM checklist_items WHERE card_id = ?')
    .get(cardId).m;
  const info = db
    .prepare('INSERT INTO checklist_items (card_id, text, position) VALUES (?, ?, ?)')
    .run(cardId, text.trim(), max + 1);
  logActivity(cardId, null, `Checklist item added: "${text.trim()}"`);
  res.json({ id: info.lastInsertRowid });
});

app.patch('/api/checklist/:id', (req, res) => {
  const id = Number(req.params.id);
  const { text, checked } = req.body;
  if (typeof text === 'string' && text.trim()) {
    db.prepare('UPDATE checklist_items SET text = ? WHERE id = ?').run(text.trim(), id);
  }
  if (checked !== undefined) {
    db.prepare('UPDATE checklist_items SET checked = ? WHERE id = ?').run(checked ? 1 : 0, id);
  }
  res.json({ ok: true });
});

app.delete('/api/checklist/:id', (req, res) => {
  db.prepare('DELETE FROM checklist_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function uniqueSlug(base, excludeId = null) {
  let slug = base || 'untitled';
  let i = 2;
  const check = db.prepare('SELECT id FROM pages WHERE slug = ? AND id IS NOT ?');
  while (check.get(slug, excludeId ?? -1)) {
    slug = `${base}-${i++}`;
  }
  return slug;
}

app.get('/api/pages', (req, res) => {
  const { q, tag, status } = req.query;
  let sql = `SELECT p.id, p.title, p.slug, p.status, p.parent_id, p.position, p.created_at, p.updated_at,
    (SELECT GROUP_CONCAT(tag, ',') FROM page_tags pt WHERE pt.page_id = p.id) AS tag_csv
    FROM pages p WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ' AND (p.title LIKE ?)';
    params.push(`%${q}%`);
  }
  if (status) {
    sql += ' AND p.status = ?';
    params.push(status);
  }
  if (tag) {
    sql += ' AND p.id IN (SELECT page_id FROM page_tags WHERE tag = ?)';
    params.push(tag);
  }
  sql += ' ORDER BY p.position ASC, p.id ASC';
  const rows = db.prepare(sql).all(...params);
  rows.forEach(r => {
    r.tags = r.tag_csv ? r.tag_csv.split(',') : [];
    delete r.tag_csv;
  });
  res.json(rows);
});

app.get('/api/tags', (req, res) => {
  const rows = db
    .prepare('SELECT tag, COUNT(*) AS c FROM page_tags GROUP BY tag ORDER BY tag ASC')
    .all();
  res.json(rows);
});

app.get('/api/pages/:id', (req, res) => {
  const id = Number(req.params.id);
  const page = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  if (!page) return res.status(404).json({ error: 'not found' });
  page.tags = db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(id).map(r => r.tag);
  try { page.blocks = JSON.parse(page.blocks || '[]'); }
  catch { page.blocks = []; }
  try { page.settings = JSON.parse(page.settings || '{}'); }
  catch { page.settings = {}; }
  res.json(page);
});

app.get('/api/pages/by-slug/:slug', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = ? AND status = 'published'").get(req.params.slug);
  if (!page) return res.status(404).json({ error: 'not found' });
  page.tags = db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(page.id).map(r => r.tag);
  try { page.blocks = JSON.parse(page.blocks || '[]'); }
  catch { page.blocks = []; }
  try { page.settings = JSON.parse(page.settings || '{}'); }
  catch { page.settings = {}; }
  res.json(page);
});

app.post('/api/pages', (req, res) => {
  const { title, blocks = [], status = 'draft', tags = [], settings = {}, parent_id = null, position = 0 } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const slug = uniqueSlug(slugify(title));
  let blocksJson;
  try { blocksJson = JSON.stringify(Array.isArray(blocks) ? blocks : []); }
  catch { return res.status(400).json({ error: 'invalid blocks' }); }
  let settingsJson;
  try { settingsJson = JSON.stringify(typeof settings === 'object' && settings !== null ? settings : {}); }
  catch { settingsJson = '{}'; }
  const info = db
    .prepare('INSERT INTO pages (title, slug, blocks, status, settings, parent_id, position) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(title.trim(), slug, blocksJson, status, settingsJson, parent_id != null ? Number(parent_id) : null, Number(position) || 0);
  const insertTag = db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (?, ?)');
  (tags || []).forEach(t => {
    if (t && typeof t === 'string') insertTag.run(info.lastInsertRowid, t.trim().toLowerCase());
  });
  res.json({ id: info.lastInsertRowid, slug });
});

app.patch('/api/pages/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { title, blocks, status, tags, settings, parent_id, position } = req.body;
  const tx = db.transaction(() => {
    const updates = [];
    const params = [];
    if (typeof title === 'string' && title.trim()) {
      updates.push('title = ?');
      params.push(title.trim());
      const newSlug = slugify(title);
      if (newSlug && newSlug !== existing.slug) {
        updates.push('slug = ?');
        params.push(uniqueSlug(newSlug, id));
      }
    }
    if (Array.isArray(blocks)) {
      updates.push('blocks = ?');
      params.push(JSON.stringify(blocks));
    }
    if (settings && typeof settings === 'object') {
      updates.push('settings = ?');
      params.push(JSON.stringify(settings));
    }
    if (status && ['draft', 'published'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
    }
    if (parent_id !== undefined) {
      updates.push('parent_id = ?');
      params.push(parent_id === null || parent_id === '' ? null : Number(parent_id));
    }
    if (position !== undefined) {
      updates.push('position = ?');
      params.push(Number(position) || 0);
    }
    if (updates.length) {
      updates.push("updated_at = datetime('now')");
      params.push(id);
      db.prepare(`UPDATE pages SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }
    if (Array.isArray(tags)) {
      db.prepare('DELETE FROM page_tags WHERE page_id = ?').run(id);
      const ins = db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (?, ?)');
      tags.forEach(t => {
        if (t && typeof t === 'string') ins.run(id, t.trim().toLowerCase());
      });
    }
  });
  tx();
  res.json({ ok: true });
});

app.post('/api/pages/reorder', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items)) return res.status(400).json({ error: 'items required' });
  const stmt = db.prepare('UPDATE pages SET parent_id = ?, position = ? WHERE id = ?');
  const tx = db.transaction(() => {
    for (const item of items) {
      stmt.run(item.parent_id != null ? Number(item.parent_id) : null, Number(item.position) || 0, Number(item.id));
    }
  });
  tx();
  res.json({ ok: true });
});

app.delete('/api/pages/:id', (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Reusable Blocks API
app.get('/api/reusable-blocks', (req, res) => {
  const rows = db.prepare('SELECT * FROM reusable_blocks ORDER BY created_at DESC').all();
  rows.forEach(r => {
    try { r.block_data = JSON.parse(r.block_data); }
    catch { r.block_data = null; }
  });
  res.json(rows);
});

app.post('/api/reusable-blocks', (req, res) => {
  const { name, category = 'custom', block_data } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name required' });
  if (!block_data || typeof block_data !== 'object') return res.status(400).json({ error: 'block_data required' });
  const jsonStr = JSON.stringify(block_data);
  const info = db.prepare('INSERT INTO reusable_blocks (name, category, block_data) VALUES (?, ?, ?)').run(name.trim(), category, jsonStr);
  res.json({ id: info.lastInsertRowid, name: name.trim(), category, block_data });
});

app.delete('/api/reusable-blocks/:id', (req, res) => {
  db.prepare('DELETE FROM reusable_blocks WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// AI Website Generator Endpoint
app.post('/api/ai/generate-page', async (req, res) => {
  try {
    const {
      prompt = '',
      preset = 'custom',
      theme = 'dark-card',
      boardId = null,
      provider = 'opencode', // 'opencode' | 'gemini' | 'auto'
      apiKey = '',
      baseUrl = 'https://api.opencode.ai/v1',
      model = 'opencode-1'
    } = req.body;

    const effectiveOpenCodeKey = apiKey || process.env.OPENCODE_API_KEY || process.env.OPENAI_API_KEY || '';
    let effectiveBaseUrl = baseUrl || process.env.OPENCODE_BASE_URL || 'https://opencode.ai/zen/v1';
    if (effectiveBaseUrl.includes('api.opencode.ai/v1')) {
      effectiveBaseUrl = 'https://opencode.ai/zen/v1';
    }
    let effectiveModel = (model && model !== 'opencode-1') ? model : (process.env.OPENCODE_MODEL || model || 'qwen/qwen3.8-27b');
    if (effectiveBaseUrl.includes('opencode.ai') && effectiveModel.startsWith('opencode/')) {
      effectiveModel = effectiveModel.replace(/^opencode\//i, '');
    }
    const effectiveGeminiKey = (provider === 'gemini' ? apiKey : '') || process.env.GEMINI_API_KEY || '';

    let generatedPage = null;
    let aiError = null;

    // 1. If boardId is provided, synthesize from Kanban board
    if (boardId) {
      const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(boardId);
      if (board) {
        const columns = db.prepare('SELECT * FROM columns WHERE board_id = ? ORDER BY position ASC').all(board.id);
        const listsWithCards = columns.map(col => {
          const cards = db.prepare('SELECT * FROM cards WHERE column_id = ? AND archived = 0 ORDER BY position ASC').all(col.id);
          return { ...col, cards };
        });
        generatedPage = generateRoadmapPageFromBoard(board, listsWithCards, theme, prompt);
      }
    }

    // 2. OpenCode / OpenAI-Compatible API Call
    if (!generatedPage && (provider === 'opencode' || provider === 'openai' || (!provider && effectiveOpenCodeKey)) && effectiveOpenCodeKey && prompt.trim()) {
      try {
        generatedPage = await callOpenCodePageGenerator(effectiveOpenCodeKey, effectiveBaseUrl, effectiveModel, prompt, preset, theme);
      } catch (err) {
        aiError = `OpenCode (${effectiveModel}): ${err.message}`;
        console.warn('OpenCode API call failed, falling back to archetype generator:', err.message);
      }
    }

    // 3. Gemini API Call
    if (!generatedPage && provider === 'gemini' && effectiveGeminiKey && prompt.trim()) {
      try {
        generatedPage = await callGeminiPageGenerator(effectiveGeminiKey, prompt, preset, theme);
      } catch (err) {
        aiError = `Gemini: ${err.message}`;
        console.warn('Gemini API call failed, falling back to archetype generator:', err.message);
      }
    }

    // 4. Fallback: Smart Archetype Generator
    if (!generatedPage) {
      generatedPage = generateArchetypePage(prompt, preset, theme);
    }

    // Ensure unique slug
    let baseSlug = (generatedPage.slug || 'ai-page').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'ai-page';
    let slug = baseSlug;
    let counter = 1;
    while (db.prepare('SELECT id FROM pages WHERE slug = ?').get(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }
    generatedPage.slug = slug;

    // Insert into DB
    const blocksJson = JSON.stringify(generatedPage.blocks || []);
    const settingsJson = JSON.stringify(generatedPage.settings || {});
    const info = db.prepare(
      "INSERT INTO pages (title, slug, status, parent_id, position, blocks, settings) VALUES (?, ?, 'draft', NULL, 0, ?, ?)"
    ).run(generatedPage.title || 'AI Generated Page', slug, blocksJson, settingsJson);

    const pageId = info.lastInsertRowid;
    const tags = Array.isArray(generatedPage.tags) ? generatedPage.tags : ['ai-generated'];
    for (const t of tags) {
      if (t && t.trim()) {
        db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (?, ?)').run(pageId, t.trim().toLowerCase());
      }
    }

    const createdPage = db.prepare('SELECT * FROM pages WHERE id = ?').get(pageId);
    createdPage.blocks = generatedPage.blocks;
    createdPage.settings = generatedPage.settings;
    const source = (!aiError && effectiveOpenCodeKey) ? 'opencode-ai' : ((!aiError && effectiveGeminiKey) ? 'gemini-ai' : 'smart-archetype');
    res.json({ page: createdPage, source, warning: aiError });
  } catch (err) {
    console.error('Error generating AI page:', err);
    res.status(500).json({ error: err.message || 'Failed to generate page' });
  }
});

function generateRoadmapPageFromBoard(board, columns, theme, customPrompt) {
  const boardName = board.name || 'Kanban Project';
  const title = `${boardName} — Public Roadmap & Status`;
  const slug = `${boardName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-roadmap`;

  const totalCards = columns.reduce((acc, l) => acc + l.cards.length, 0);
  const doneList = columns.find(l => (l.name || '').toLowerCase().includes('done') || (l.name || '').toLowerCase().includes('complete'));
  const completedCount = doneList ? doneList.cards.length : 0;

  const blocks = [
    {
      id: 'b_hero_' + Math.random().toString(36).slice(2, 7),
      type: 'heading',
      props: { level: 1, text: `🚀 ${boardName} Roadmap`, align: 'center', margin: 10 }
    },
    {
      id: 'b_sub_' + Math.random().toString(36).slice(2, 7),
      type: 'paragraph',
      props: { text: customPrompt || 'Welcome to our live project roadmap and development status overview.', align: 'center', size: 'lead', color: '#94a3b8' }
    },
    {
      id: 'b_spacer_1',
      type: 'spacer',
      props: { height: 16 }
    },
    // Metrics Counter Cards Container
    {
      id: 'b_stats_cnt',
      type: 'container',
      props: {
        mode: 'grid',
        columns: 3,
        gap: 16,
        padding: 16,
        borderRadius: 12,
        border: true,
        bg: 'subtle',
        children: [
          {
            id: 'b_stat_1',
            type: 'container',
            props: {
              mode: 'flex',
              direction: 'column',
              padding: 12,
              align: 'center',
              children: [
                { id: 'b_stat_1_num', type: 'heading', props: { level: 2, text: String(totalCards), align: 'center', color: '#818cf8', margin: 4 } },
                { id: 'b_stat_1_lbl', type: 'paragraph', props: { text: 'Total Tasks Tracked', align: 'center', size: 'small', color: '#64748b' } }
              ]
            }
          },
          {
            id: 'b_stat_2',
            type: 'container',
            props: {
              mode: 'flex',
              direction: 'column',
              padding: 12,
              align: 'center',
              children: [
                { id: 'b_stat_2_num', type: 'heading', props: { level: 2, text: `${columns.length} Phases`, align: 'center', color: '#38bdf8', margin: 4 } },
                { id: 'b_stat_2_lbl', type: 'paragraph', props: { text: 'Pipeline Columns', align: 'center', size: 'small', color: '#64748b' } }
              ]
            }
          },
          {
            id: 'b_stat_3',
            type: 'container',
            props: {
              mode: 'flex',
              direction: 'column',
              padding: 12,
              align: 'center',
              children: [
                { id: 'b_stat_3_num', type: 'heading', props: { level: 2, text: `${completedCount} Done`, align: 'center', color: '#34d399', margin: 4 } },
                { id: 'b_stat_3_lbl', type: 'paragraph', props: { text: 'Completed Features', align: 'center', size: 'small', color: '#64748b' } }
              ]
            }
          }
        ]
      }
    },
    {
      id: 'b_spacer_2',
      type: 'spacer',
      props: { height: 24 }
    },
    {
      id: 'b_sec_heading',
      type: 'heading',
      props: { level: 2, text: '📋 Pipeline Status by Milestone', align: 'left', margin: 12 }
    }
  ];

  // For each column, create a status container
  columns.forEach(l => {
    const cardChildren = l.cards.slice(0, 5).map(c => ({
      id: 'b_c_' + c.id,
      type: 'container',
      props: {
        mode: 'flex',
        direction: 'column',
        padding: 12,
        borderRadius: 8,
        border: true,
        bg: 'surface',
        children: [
          { id: 'b_ct_' + c.id, type: 'heading', props: { level: 4, text: c.title, margin: 4 } },
          { id: 'b_cd_' + c.id, type: 'paragraph', props: { text: c.description || 'Feature undergoing implementation and testing.', size: 'small', color: '#94a3b8' } }
        ]
      }
    }));

    if (!cardChildren.length) {
      cardChildren.push({
        id: 'b_empty_' + l.id,
        type: 'paragraph',
        props: { text: 'No items in this milestone currently.', italic: true, color: '#64748b' }
      });
    }

    blocks.push({
      id: 'b_col_' + l.id,
      type: 'container',
      props: {
        mode: 'flex',
        direction: 'column',
        padding: 16,
        borderRadius: 12,
        border: true,
        shadow: true,
        bg: 'subtle',
        children: [
          { id: 'b_col_title_' + l.id, type: 'heading', props: { level: 3, text: `● ${l.name || 'Milestone'} (${l.cards.length})`, margin: 8 } },
          ...cardChildren
        ]
      }
    });
    blocks.push({ id: 'b_sp_' + l.id, type: 'spacer', props: { height: 12 } });
  });

  // Table summary
  const tableRows = [];
  columns.forEach(l => {
    l.cards.forEach(c => {
      tableRows.push([c.title, l.name || 'Stage', c.priority || 'medium', c.description ? c.description.slice(0, 45) + '...' : 'Planned']);
    });
  });

  if (tableRows.length > 0) {
    blocks.push({
      id: 'b_tbl_heading',
      type: 'heading',
      props: { level: 2, text: '🔍 Full Milestone Detail Matrix', margin: 12 }
    });
    blocks.push({
      id: 'b_roadmap_tbl',
      type: 'table',
      props: {
        headers: ['Feature', 'Milestone Stage', 'Priority', 'Notes'],
        rows: tableRows.slice(0, 10),
        hasHeader: true,
        striped: true,
        bordered: true
      }
    });
  }

  // CTA
  blocks.push({
    id: 'b_cta_cnt',
    type: 'container',
    props: {
      mode: 'flex',
      direction: 'column',
      align: 'center',
      padding: 24,
      borderRadius: 16,
      bg: 'surface',
      border: true,
      children: [
        { id: 'b_cta_h', type: 'heading', props: { level: 3, text: 'Stay Updated on Releases', align: 'center', margin: 6 } },
        { id: 'b_cta_p', type: 'paragraph', props: { text: 'Subscribe to our release notes or contribute feedback directly to our team.', align: 'center', color: '#94a3b8' } },
        { id: 'b_cta_btn', type: 'button', props: { label: 'Submit Feature Request', size: 'large', variant: 'filled', color: '#6366f1', align: 'center', url: '#' } }
      ]
    }
  });

  return {
    title,
    slug,
    tags: ['roadmap', 'kanban-sync', 'status'],
    settings: {
      maxWidth: '860px',
      bg: theme || 'dark-card',
      paddingX: 36,
      paddingY: 48,
      borderRadius: 16,
      fontFamily: 'inter'
    },
    blocks
  };
}

function generateArchetypePage(prompt, preset, theme) {
  const pTrimmed = (prompt || '').trim();
  const pLower = pTrimmed.toLowerCase();
  const customTitle = pTrimmed ? pTrimmed.slice(0, 50) : 'Modern Web Application';
  const customSlug = pTrimmed ? pTrimmed.slice(0, 30).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') : 'custom-page';

  if (preset === 'saas' || pLower.includes('saas') || pLower.includes('landing') || pLower.includes('startup') || pLower.includes('ai app')) {
    const pageTitle = pTrimmed ? `${customTitle} — SaaS Platform` : 'NextGen AI Cloud — Modern SaaS Platform';
    return {
      title: pageTitle,
      slug: customSlug || 'ai-saas-platform',
      tags: ['saas', 'landing-page', 'web-app'],
      settings: { maxWidth: '920px', bg: theme || 'dark-card', paddingX: 36, paddingY: 48, borderRadius: 16, fontFamily: 'outfit' },
      blocks: [
        {
          id: 'b_h1',
          type: 'heading',
          props: {
            level: 1,
            text: pTrimmed ? `Empower Your Business with ${customTitle}` : 'Automate Your Workflows with Intelligent Agents',
            align: 'center',
            margin: 14,
            customCss: 'background: linear-gradient(135deg, #c7d2fe, #818cf8, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; letter-spacing: -0.5px;'
          }
        },
        { id: 'b_lead', type: 'paragraph', props: { text: pTrimmed ? `The all-in-one modern platform for ${pTrimmed}. Built for scale, precision, and lightning performance.` : 'Empower your engineering and operations teams with real-time autonomous systems designed for scale, precision, and instant ROI.', align: 'center', size: 'lead', color: '#94a3b8' } },
        { id: 'b_sp1', type: 'spacer', props: { height: 16 } },
        {
          id: 'b_btn_group',
          type: 'container',
          props: {
            mode: 'flex',
            direction: 'row',
            justify: 'center',
            gap: 12,
            children: [
              { id: 'b_b1', type: 'button', props: { label: 'Start Free 14-Day Trial →', size: 'large', variant: 'filled', color: '#6366f1', url: '#pricing', customCss: 'box-shadow: 0 0 25px rgba(99, 102, 241, 0.6); font-weight: 700;' } },
              { id: 'b_b2', type: 'button', props: { label: 'Explore Interactive Demo', size: 'large', variant: 'outline', color: '#818cf8', url: '#features', customCss: 'backdrop-filter: blur(8px); background: rgba(99, 102, 241, 0.08);' } }
            ]
          }
        },
        { id: 'b_sp2', type: 'spacer', props: { height: 28 } },
        {
          id: 'b_banner_img',
          type: 'image',
          props: {
            url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200&auto=format&fit=crop',
            alt: 'SaaS Dashboard Interface',
            width: '100%',
            borderRadius: 14,
            shadow: true,
            border: true,
            customCss: 'box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6), 0 0 30px rgba(99, 102, 241, 0.2);'
          }
        },
        { id: 'b_sp3', type: 'spacer', props: { height: 36 } },
        { id: 'b_sec1', type: 'heading', props: { level: 2, text: '✨ Core Platform Capabilities', align: 'center', margin: 8 } },
        { id: 'b_sec1_sub', type: 'paragraph', props: { text: 'Everything you need to ship enterprise-grade intelligence without technical debt.', align: 'center', color: '#94a3b8' } },
        {
          id: 'b_feat_grid',
          type: 'container',
          props: {
            mode: 'grid',
            columns: 3,
            gap: 16,
            padding: 8,
            children: [
              {
                id: 'b_f1',
                type: 'container',
                props: {
                  mode: 'flex',
                  direction: 'column',
                  padding: 16,
                  borderRadius: 12,
                  border: true,
                  bg: 'surface',
                  customCss: 'backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); transition: transform 0.2s ease;',
                  children: [
                    { id: 'b_f1_t', type: 'heading', props: { level: 4, text: '⚡ Sub-Second Latency', color: '#818cf8', margin: 6 } },
                    { id: 'b_f1_d', type: 'paragraph', props: { text: 'Built on edge distributed micro-clusters with guaranteed 99.99% uptime SLA.', size: 'small', color: '#94a3b8' } }
                  ]
                }
              },
              {
                id: 'b_f2',
                type: 'container',
                props: {
                  mode: 'flex',
                  direction: 'column',
                  padding: 16,
                  borderRadius: 12,
                  border: true,
                  bg: 'surface',
                  customCss: 'backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); transition: transform 0.2s ease;',
                  children: [
                    { id: 'b_f2_t', type: 'heading', props: { level: 4, text: '🔒 Zero-Trust Security', color: '#34d399', margin: 6 } },
                    { id: 'b_f2_d', type: 'paragraph', props: { text: 'End-to-end encrypted storage, SOC-2 compliance, and audit log tracking out of the box.', size: 'small', color: '#94a3b8' } }
                  ]
                }
              },
              {
                id: 'b_f3',
                type: 'container',
                props: {
                  mode: 'flex',
                  direction: 'column',
                  padding: 16,
                  borderRadius: 12,
                  border: true,
                  bg: 'surface',
                  customCss: 'backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); transition: transform 0.2s ease;',
                  children: [
                    { id: 'b_f3_t', type: 'heading', props: { level: 4, text: '📊 Deep Analytics', color: '#38bdf8', margin: 6 } },
                    { id: 'b_f3_d', type: 'paragraph', props: { text: 'Real-time telemetry and visualization boards for instant performance optimization.', size: 'small', color: '#94a3b8' } }
                  ]
                }
              }
            ]
          }
        },
        { id: 'b_sp4', type: 'spacer', props: { height: 32 } },
        { id: 'b_car_h', type: 'heading', props: { level: 2, text: '💬 Loved by Industry Leaders', align: 'center', margin: 8 } },
        {
          id: 'b_quotes_carousel',
          type: 'carousel',
          props: {
            aspectRatio: '21/9',
            borderRadius: 12,
            autoplay: true,
            interval: 5,
            slides: [
              { url: 'https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1000&auto=format&fit=crop', caption: '"Antigravity reduced our release cycle from days to hours." — CTO, CloudCore' },
              { url: 'https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=1000&auto=format&fit=crop', caption: '"The smoothest developer experience we have encountered in years." — VP Eng, DataWave' }
            ]
          }
        },
        { id: 'b_sp5', type: 'spacer', props: { height: 32 } },
        { id: 'b_prc_h', type: 'heading', props: { level: 2, text: '💳 Transparent Pricing Plans', align: 'center', margin: 8 } },
        {
          id: 'b_pricing_tbl',
          type: 'table',
          props: {
            headers: ['Plan Tier', 'Included Seats', 'Compute Units', 'Pricing / mo'],
            rows: [
              ['Starter', 'Up to 3 Members', '50,000 Ops', '$0 (Free Forever)'],
              ['Professional', 'Up to 15 Members', '500,000 Ops', '$49 / month'],
              ['Enterprise', 'Unlimited Seats', 'Dedicated Cluster', '$299 / month']
            ],
            striped: true,
            bordered: true
          }
        }
      ]
    };
  }

  // Portfolio archetype
  if (preset === 'portfolio' || pLower.includes('portfolio') || pLower.includes('designer') || pLower.includes('agency')) {
    return {
      title: 'Creative Studio & Portfolio',
      slug: 'creative-portfolio',
      tags: ['portfolio', 'design', 'agency'],
      settings: { maxWidth: '840px', bg: theme || 'dark-card', paddingX: 36, paddingY: 48, borderRadius: 16, fontFamily: 'outfit' },
      blocks: [
        { id: 'b_p_h1', type: 'heading', props: { level: 1, text: 'Designing Digital Experiences with Soul & Precision', align: 'left', margin: 12 } },
        { id: 'b_p_sub', type: 'paragraph', props: { text: 'Independent design & development laboratory partnering with forward-thinking tech teams worldwide.', size: 'large', color: '#94a3b8' } },
        { id: 'b_p_sp1', type: 'spacer', props: { height: 20 } },
        {
          id: 'b_p_car',
          type: 'carousel',
          props: {
            aspectRatio: '16/9',
            borderRadius: 14,
            slides: [
              { url: 'https://images.unsplash.com/photo-1507238691740-187a5b1d37b8?w=1000&auto=format&fit=crop', caption: 'Case Study 01 — Fintech Mobile Ecosystem' },
              { url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=1000&auto=format&fit=crop', caption: 'Case Study 02 — Data Visualization Studio' }
            ]
          }
        },
        { id: 'b_p_sp2', type: 'spacer', props: { height: 24 } },
        { id: 'b_p_srv_h', type: 'heading', props: { level: 2, text: 'Selected Services', margin: 8 } },
        {
          id: 'b_p_srv_tbl',
          type: 'table',
          props: {
            headers: ['Service Discipline', 'Deliverables', 'Timeline'],
            rows: [
              ['Product Design & UX', 'Design System, Prototypes, User Testing', '2–4 Weeks'],
              ['Full-Stack Development', 'Production Web App, API, Database', '3–6 Weeks'],
              ['Brand Identity', 'Typography, Logo, Design Guidelines', '1–2 Weeks']
            ],
            striped: true,
            bordered: true
          }
        },
        { id: 'b_p_sp3', type: 'spacer', props: { height: 24 } },
        { id: 'b_p_btn', type: 'button', props: { label: 'Let’s Work Together → Contact Studio', size: 'large', variant: 'filled', color: '#6366f1', align: 'center', url: 'mailto:hello@example.com' } }
      ]
    };
  }

  // Default: Knowledge Base / Documentation Archetype
  return {
    title: prompt ? `Knowledge Base — ${prompt.slice(0, 35)}` : 'Documentation & Reference Guide',
    slug: 'docs-knowledge-base',
    tags: ['documentation', 'guide', 'knowledge-base'],
    settings: { maxWidth: '820px', bg: theme || 'dark-card', paddingX: 36, paddingY: 44, borderRadius: 16, fontFamily: 'inter' },
    blocks: [
      { id: 'b_d_h1', type: 'heading', props: { level: 1, text: prompt || 'Developer Documentation & API Guide', margin: 10 } },
      { id: 'b_d_p1', type: 'paragraph', props: { text: 'Comprehensive reference materials, architectural concepts, and interactive examples for engineering teams.', size: 'large', color: '#94a3b8' } },
      { id: 'b_d_div', type: 'divider', props: { style: 'solid', thickness: 1, margin: 16 } },
      { id: 'b_d_h2', type: 'heading', props: { level: 2, text: '📖 Getting Started', margin: 8 } },
      { id: 'b_d_p2', type: 'paragraph', props: { text: 'Follow our step-by-step setup guides to integrate components into your active production pipeline in under 5 minutes.' } },
      {
        id: 'b_d_tbl',
        type: 'table',
        props: {
          headers: ['Module', 'Protocol', 'Authentication', 'Status'],
          rows: [
            ['Authentication API', 'REST / JSON', 'Bearer JWT', 'Stable (v2.4)'],
            ['Realtime Sync Engine', 'WebSocket', 'Session Token', 'Active'],
            ['Webhook Dispatcher', 'HTTP POST', 'HMAC SHA256', 'GA']
          ],
          striped: true,
          bordered: true
        }
      },
      { id: 'b_d_sp', type: 'spacer', props: { height: 20 } },
      { id: 'b_d_btn', type: 'button', props: { label: 'Explore API Endpoints →', variant: 'filled', color: '#6366f1', url: '#' } }
    ]
  };
}

async function callGeminiPageGenerator(apiKey, prompt, preset, theme) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  const systemInstruction = `You are an elite web architect and UI/UX designer.
The user wants to generate a complete website layout in structured JSON for a visual CMS page builder.
Return ONLY valid JSON (no markdown formatting, no code block backticks) matching this exact schema:
{
  "title": "Page Title",
  "slug": "page-slug",
  "tags": ["tag1", "tag2"],
  "settings": {
    "maxWidth": "860px",
    "bg": "${theme || 'dark-card'}",
    "paddingX": 36,
    "paddingY": 48,
    "borderRadius": 16,
    "fontFamily": "inter"
  },
  "blocks": [
    // Array of block objects. Available block types:
    // 1. heading: { "id": "h_1", "type": "heading", "props": { "level": 1|2|3|4, "text": "...", "align": "left"|"center"|"right", "color": "#hex", "customCss": "..." } }
    // 2. paragraph: { "id": "p_1", "type": "paragraph", "props": { "text": "...", "align": "left"|"center", "size": "small"|"normal"|"large"|"lead", "color": "#hex", "bold": false, "italic": false, "customCss": "..." } }
    // 3. button: { "id": "btn_1", "type": "button", "props": { "label": "...", "url": "/p/...", "variant": "filled"|"outline"|"soft", "size": "medium"|"large", "color": "#6366f1", "align": "center"|"left", "customCss": "..." } }
    // 4. image: { "id": "img_1", "type": "image", "props": { "url": "https://images.unsplash.com/...", "alt": "...", "caption": "...", "width": "100%", "borderRadius": 12, "shadow": true, "customCss": "..." } }
    // 5. carousel: { "id": "car_1", "type": "carousel", "props": { "aspectRatio": "16/9", "borderRadius": 12, "autoplay": true, "slides": [{ "url": "https://images.unsplash.com/...", "caption": "..." }], "customCss": "..." } }
    // 6. container: { "id": "cnt_1", "type": "container", "props": { "mode": "grid"|"flex", "columns": 2|3|4, "direction": "row"|"column", "padding": 16, "gap": 16, "bg": "surface"|"subtle"|"transparent", "border": true, "borderRadius": 12, "customCss": "...", "children": [ ...blocks ] } }
    // 7. table: { "id": "tbl_1", "type": "table", "props": { "headers": ["Col1", "Col2"], "rows": [["A", "B"], ["C", "D"]], "striped": true, "bordered": true, "customCss": "..." } }
    // 8. divider: { "id": "div_1", "type": "divider", "props": { "style": "solid", "thickness": 1, "margin": 16, "customCss": "..." } }
    // 9. spacer: { "id": "sp_1", "type": "spacer", "props": { "height": 24, "customCss": "..." } }
  ]
}
IMPORTANT STYLING DIRECTIVE:
Every block supports an optional "customCss" string in "props". When needed to elevate the design (e.g. gradient hero titles, glassmorphism containers, glowing CTA buttons, subtle card borders, or badge styling), USE "customCss" to give the page a modern, visually stunning look.
Examples:
- Gradient Hero Title: "background: linear-gradient(135deg, #818cf8, #ec4899, #f43f5e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; letter-spacing: -0.5px;"
- Glassmorphism Cards: "backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);"
- Glowing CTA Button: "box-shadow: 0 0 25px rgba(99, 102, 241, 0.6); font-weight: 700;"
Make the website rich, professional, engaging, with multiple sections (Hero, Features Grid, Testimonials/Quotes, Pricing or Stats Table, CTA buttons).`;

  const payload = {
    contents: [
      {
        parts: [
          { text: `${systemInstruction}\n\nUser Request: ${prompt}\nTheme: ${theme}\nPreset: ${preset}` }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 3000
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error: ${response.status} - ${errText}`);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return extractAndParseJson(rawText);
}

function extractAndParseJson(rawText) {
  if (!rawText) throw new Error('Empty response from AI model');

  // 1. Remove thinking blocks <think>...</think>
  let text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Extract markdown code block if present
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 3. Find outermost JSON object { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  // 4. Clean trailing commas before closing braces/brackets
  text = text.replace(/,\s*([\]}])/g, '$1');

  try {
    return JSON.parse(text);
  } catch (err) {
    // Attempt auto-recovery for common unclosed brackets/quotes
    try {
      let repaired = text;
      // Close unclosed string if odd number of quotes
      const quoteCount = (repaired.match(/(?<!\\)"/g) || []).length;
      if (quoteCount % 2 !== 0) repaired += '"';

      const openBraces = (repaired.match(/\{/g) || []).length;
      const closeBraces = (repaired.match(/\}/g) || []).length;
      const openBrackets = (repaired.match(/\[/g) || []).length;
      const closeBrackets = (repaired.match(/\]/g) || []).length;

      for (let i = 0; i < openBrackets - closeBrackets; i++) repaired += ']';
      for (let i = 0; i < openBraces - closeBraces; i++) repaired += '}';
      repaired = repaired.replace(/,\s*([\]}])/g, '$1');

      return JSON.parse(repaired);
    } catch (repairErr) {
      throw new Error(`Invalid JSON returned by model: ${err.message}`);
    }
  }
}

async function callOpenCodePageGenerator(apiKey, baseUrl = 'https://api.groq.com/openai/v1', model = 'qwen/qwen3.8-27b', prompt = '', preset = 'custom', theme = 'dark-card') {
  let endpoint = (baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '');
  if (endpoint.includes('api.opencode.ai/v1')) {
    endpoint = 'https://opencode.ai/zen/v1';
  }
  if (!endpoint.endsWith('/chat/completions')) {
    endpoint = `${endpoint}/chat/completions`;
  }

  let finalModel = (model || 'qwen/qwen3.8-27b').trim();
  if (endpoint.includes('opencode.ai') && finalModel.toLowerCase().startsWith('opencode/')) {
    finalModel = finalModel.slice(9).trim();
  }
  if (!finalModel || finalModel === 'opencode-1') {
    finalModel = 'qwen/qwen3.8-27b';
  }

  const systemInstruction = `You are an elite web architect and UI/UX designer.
The user wants to generate a complete visual website in structured JSON for a visual CMS page builder.
Return ONLY valid JSON (no markdown formatting, no code block backticks) matching this exact schema:
{
  "title": "Page Title",
  "slug": "page-slug",
  "tags": ["tag1", "tag2"],
  "settings": {
    "maxWidth": "860px",
    "bg": "${theme || 'dark-card'}",
    "paddingX": 36,
    "paddingY": 48,
    "borderRadius": 16,
    "fontFamily": "inter"
  },
  "blocks": [
    // Array of block objects. Available block types:
    // 1. heading: { "id": "h_1", "type": "heading", "props": { "level": 1|2|3|4, "text": "...", "align": "left"|"center"|"right", "color": "#hex", "customCss": "..." } }
    // 2. paragraph: { "id": "p_1", "type": "paragraph", "props": { "text": "...", "align": "left"|"center", "size": "small"|"normal"|"large"|"lead", "color": "#hex", "bold": false, "italic": false, "customCss": "..." } }
    // 3. button: { "id": "btn_1", "type": "button", "props": { "label": "...", "url": "/p/...", "variant": "filled"|"outline"|"soft", "size": "medium"|"large", "color": "#6366f1", "align": "center"|"left", "customCss": "..." } }
    // 4. image: { "id": "img_1", "type": "image", "props": { "url": "https://images.unsplash.com/...", "alt": "...", "caption": "...", "width": "100%", "borderRadius": 12, "shadow": true, "customCss": "..." } }
    // 5. carousel: { "id": "car_1", "type": "carousel", "props": { "aspectRatio": "16/9", "borderRadius": 12, "autoplay": true, "slides": [{ "url": "https://images.unsplash.com/...", "caption": "..." }], "customCss": "..." } }
    // 6. container: { "id": "cnt_1", "type": "container", "props": { "mode": "grid"|"flex", "columns": 2|3|4, "direction": "row"|"column", "padding": 16, "gap": 16, "bg": "surface"|"subtle"|"transparent", "border": true, "borderRadius": 12, "customCss": "...", "children": [ ...blocks ] } }
    // 7. table: { "id": "tbl_1", "type": "table", "props": { "headers": ["Col1", "Col2"], "rows": [["A", "B"], ["C", "D"]], "striped": true, "bordered": true, "customCss": "..." } }
    // 8. divider: { "id": "div_1", "type": "divider", "props": { "style": "solid", "thickness": 1, "margin": 16, "customCss": "..." } }
    // 9. spacer: { "id": "sp_1", "type": "spacer", "props": { "height": 24, "customCss": "..." } }
  ]
}
IMPORTANT STYLING DIRECTIVE:
Every block supports an optional "customCss" string in "props". When needed to elevate the design (e.g. gradient hero titles, glassmorphism containers, glowing CTA buttons, subtle card borders, or badge styling), USE "customCss" to give the page a modern, visually stunning look.
Examples:
- Gradient Hero Title: "background: linear-gradient(135deg, #818cf8, #ec4899, #f43f5e); -webkit-background-clip: text; -webkit-text-fill-color: transparent; font-weight: 800; letter-spacing: -0.5px;"
- Glassmorphism Cards: "backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);"
- Glowing CTA Button: "box-shadow: 0 0 25px rgba(99, 102, 241, 0.6); font-weight: 700;"
Make the website rich, professional, engaging, with multiple sections (Hero, Features Grid, Testimonials/Quotes, Pricing or Stats Table, CTA buttons).`;

  const payload = {
    model: finalModel,
    messages: [
      { role: 'system', content: systemInstruction },
      { role: 'user', content: `Generate a full visual website layout in JSON for:\nPrompt: ${prompt}\nTheme: ${theme}\nPreset: ${preset}` }
    ],
    response_format: { type: 'json_object' },
    temperature: 0.7
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenCode API error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data.choices?.[0]?.message?.content || '';
  return extractAndParseJson(rawText);
}

app.get('/p/:slug(*)', (req, res) => {
  const rawPath = req.params.slug || '';
  const segments = rawPath.split('/').filter(Boolean);
  const slug = segments[segments.length - 1] || rawPath;

  // 1. Match exact slug (case-insensitive)
  let page = db.prepare("SELECT * FROM pages WHERE slug = ? COLLATE NOCASE").get(slug);

  // 2. Fallback: match by ID or partial slug
  if (!page && segments.length > 0 && /^\d+$/.test(segments[0])) {
    page = db.prepare("SELECT * FROM pages WHERE id = ?").get(Number(segments[0]));
  }
  if (!page && rawPath) {
    page = db.prepare("SELECT * FROM pages WHERE slug = ? COLLATE NOCASE").get(rawPath);
  }
  if (!page) {
    page = db.prepare("SELECT * FROM pages WHERE slug LIKE ?").get(`%${slug}%`);
  }

  if (!page) {
    res.status(404).set('Content-Type', 'text/html; charset=utf-8');
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>404 — Page Not Found</title>
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background: #0b0f17; color: #f1f5f9; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; }
          .card { background: #111827; border: 1px solid #1f2937; padding: 40px; border-radius: 16px; max-width: 440px; box-shadow: 0 20px 40px rgba(0,0,0,0.5); }
          h1 { margin: 0 0 12px; font-size: 24px; color: #f87171; }
          p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin-bottom: 24px; }
          a { display: inline-block; background: #6366f1; color: #fff; padding: 10px 22px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; }
          a:hover { background: #4f46e5; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>Page Not Found</h1>
          <p>The page "<strong>${escHtml(slug || rawPath)}</strong>" could not be found. Make sure the page has been created in your studio.</p>
          <a href="/">← Return to Studio</a>
        </div>
      </body>
      </html>
    `);
  }

  let blocks = [];
  try { blocks = JSON.parse(page.blocks || '[]'); } catch { }
  const tags = db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(page.id).map(r => r.tag);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPublishedPage(page, blocks, tags));
});

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatCustomCssForHtml(cssStr) {
  if (!cssStr || typeof cssStr !== 'string') return '';
  return cssStr.split(';').map(d => {
    d = d.trim();
    if (!d) return '';
    if (d.toLowerCase().includes('!important')) return d + ';';
    return d + ' !important;';
  }).filter(Boolean).join(' ');
}

function parseRichTextHtml(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = escHtml(raw);

  // 1. Shorthand: [gradient](text)
  s = s.replace(/\[gradient(?::([^\]]+))?\]\(([\s\S]*?)\)/gi, (match, colors, text) => {
    let grad = 'linear-gradient(135deg, #818cf8, #ec4899, #f43f5e)';
    if (colors) {
      const parts = colors.split('-').map(c => c.trim()).filter(Boolean);
      if (parts.length >= 2) grad = `linear-gradient(135deg, ${parts.join(', ')})`;
    }
    return `<span style="background:${grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:bold;display:inline-block;">${text}</span>`;
  });

  // 2. Shorthand: [color:#hex](text)
  s = s.replace(/\[color:([^\]]+)\]\(([\s\S]*?)\)/gi, (match, col, text) => {
    return `<span style="color:${col};">${text}</span>`;
  });

  // 3. Shorthand: [glow:#hex](text) or [glow](text)
  s = s.replace(/\[glow(?::([^\]]+))?\]\(([\s\S]*?)\)/gi, (match, col, text) => {
    const color = col || '#818cf8';
    return `<span style="color:${color};text-shadow:0 0 14px ${color};font-weight:600;">${text}</span>`;
  });

  // 4. Shorthand: [bg:#hex](text) or [highlight:#hex](text)
  s = s.replace(/\[(?:bg|highlight):([^\]]+)\]\(([\s\S]*?)\)/gi, (match, col, text) => {
    return `<mark style="background:${col};color:inherit;padding:2px 6px;border-radius:4px;display:inline-block;">${text}</mark>`;
  });

  // 5. Shorthand: [badge(?::#hex)?](text)
  s = s.replace(/\[badge(?::([^\]]+))?\]\(([\s\S]*?)\)/gi, (match, col, text) => {
    const baseColor = col || '#818cf8';
    return `<span style="display:inline-block;padding:2px 10px;font-size:0.8em;border-radius:999px;background:rgba(99,102,241,0.15);color:${baseColor};border:1px solid ${baseColor}66;font-weight:600;vertical-align:middle;">${text}</span>`;
  });

  // 6. Markdown bold **text**
  s = s.replace(/\*\*([\s\S]*?)\*\*/g, '<strong>$1</strong>');

  // 7. Markdown italic *text*
  s = s.replace(/(?<!\*)\*(?!\*)([\s\S]*?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');

  // 8. Markdown underline __text__
  s = s.replace(/__([\s\S]*?)__/g, '<u>$1</u>');

  // 9. Markdown strikethrough ~~text~~
  s = s.replace(/~~([\s\S]*?)~~/g, '<s>$1</s>');

  // 10. Code snippet `text`
  s = s.replace(/`([^`]+)`/g, '<code style="background:rgba(255,255,255,0.1);padding:2px 6px;border-radius:4px;font-size:0.9em;font-family:monospace;">$1</code>');

  return s;
}

function renderBlockHtml(b) {
  const p = b.props || {};
  const customCss = p.customCss ? escHtml(formatCustomCssForHtml(p.customCss)) : '';
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, Number(p.level) || 2));
      const align = p.align || 'left';
      const color = p.color ? `color:${escHtml(p.color)};` : '';
      const margin = p.margin != null ? `margin-bottom:${Number(p.margin)}px;` : 'margin-bottom:12px;';
      let content = parseRichTextHtml(p.text || '');
      if (p.linkUrl) {
        const target = p.newTab !== false && !p.linkUrl.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';
        content = `<a href="${escHtml(p.linkUrl)}"${target} style="color:inherit;text-decoration:none;border-bottom:1px dashed currentColor;">${content}</a>`;
      }
      return `<h${lvl} style="text-align:${align};${color}${margin}margin-top:18px;${customCss}">${content}</h${lvl}>`;
    }
    case 'paragraph': {
      const align = p.align || 'left';
      const sizeMap = { small: '13px', normal: '15px', large: '18px', lead: '20px' };
      const fontSize = sizeMap[p.size] || '15px';
      const color = p.color ? `color:${escHtml(p.color)};` : '';
      const fontStyle = p.italic ? 'font-style:italic;' : '';
      const fontWeight = p.bold ? 'font-weight:600;' : '';
      let content = parseRichTextHtml(p.text || '');
      if (p.linkUrl) {
        const target = p.newTab !== false && !p.linkUrl.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';
        content = `<a href="${escHtml(p.linkUrl)}"${target} style="color:inherit;text-decoration:underline;">${content}</a>`;
      }
      return `<p style="text-align:${align};font-size:${fontSize};${color}${fontStyle}${fontWeight}margin:0 0 14px;line-height:1.7;${customCss}">${content}</p>`;
    }
    case 'button': {
      const align = p.align || 'left';
      const variant = p.variant || 'filled';
      const color = escHtml(p.color || '#6366f1');
      const textColor = escHtml(p.textColor || '#ffffff');
      const label = escHtml(p.label || 'Button');
      const url = escHtml(p.url || '#');
      const rad = p.borderRadius != null ? Number(p.borderRadius) : 8;
      const target = p.newTab !== false && !url.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';

      const padMap = { small: '7px 14px;font-size:12.5px;', medium: '10px 20px;font-size:14px;', large: '13px 26px;font-size:16px;' };
      const sizePad = padMap[p.size] || padMap.medium;

      let btnStyle = `display:inline-block;padding:${sizePad}border-radius:${rad}px;text-decoration:none;font-weight:600;transition:opacity 0.15s;${customCss}`;
      if (variant === 'filled') {
        btnStyle += `background:${color};color:${textColor};border:1px solid transparent;`;
      } else if (variant === 'outline') {
        btnStyle += `background:transparent;color:${color};border:1.5px solid ${color};`;
      } else if (variant === 'soft') {
        btnStyle += `background:${color}22;color:${color};border:1px solid ${color}44;`;
      }

      const alignStyle = align === 'center' ? 'text-align:center;' : align === 'right' ? 'text-align:right;' : align === 'full' ? 'text-align:center;display:block;' : 'text-align:left;';
      if (align === 'full') btnStyle += 'width:100%;box-sizing:border-box;';

      return `<div style="margin:14px 0;${alignStyle}"><a href="${url}"${target} style="${btnStyle}">${label}</a></div>`;
    }
    case 'image': {
      if (!p.url) return '';
      const align = p.align || 'center';
      const width = p.width || '100%';
      const rad = p.borderRadius != null ? Number(p.borderRadius) : 8;
      const fit = p.objectFit || 'cover';
      const shadowStyle = p.shadow ? 'box-shadow: 0 10px 25px -5px rgba(0,0,0,0.15);' : '';
      const borderStyle = p.border ? 'border: 1px solid #e2e8f0;' : '';
      const alignStyle = align === 'center' ? 'margin:0 auto;text-align:center;' : align === 'right' ? 'margin-left:auto;text-align:right;' : 'margin-right:auto;text-align:left;';

      let imgHtml = `<img src="${escHtml(p.url)}" alt="${escHtml(p.alt || '')}" style="width:${width};max-width:100%;border-radius:${rad}px;object-fit:${fit};${shadowStyle}${borderStyle}display:inline-block;${customCss}" />`;
      if (p.linkUrl) {
        const target = p.newTab !== false && !p.linkUrl.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';
        imgHtml = `<a href="${escHtml(p.linkUrl)}"${target} style="text-decoration:none;display:inline-block;width:${width};">${imgHtml}</a>`;
      }
      const captionHtml = p.caption ? `<div style="font-size:12.5px;color:#64748b;margin-top:6px;">${escHtml(p.caption)}</div>` : '';

      return `<div style="margin:14px 0;${alignStyle}">${imgHtml}${captionHtml}</div>`;
    }
    case 'carousel': {
      const slides = Array.isArray(p.slides) ? p.slides : [];
      if (!slides.length) return '';
      const carouselId = 'c_' + Math.random().toString(36).slice(2, 9);
      const ratio = p.aspectRatio && p.aspectRatio !== 'auto' ? p.aspectRatio : '16/9';
      const rad = p.borderRadius != null ? Number(p.borderRadius) : 10;
      const autoplay = !!p.autoplay;
      const interval = Math.max(1, Number(p.interval) || 4);
      const showArrows = p.showArrows !== false && slides.length > 1;
      const showDots = p.showDots !== false && slides.length > 1;
      const showCaptions = p.showCaptions !== false;

      const slidesHtml = slides.map((s, idx) => {
        const slideBody = `
          <img src="${escHtml(s.url)}" alt="${escHtml(s.caption || '')}" style="width:100%;height:100%;object-fit:cover;display:block;" />
          ${showCaptions && s.caption ? `<div class="cms-slide-caption">${escHtml(s.caption)}</div>` : ''}
        `;
        if (s.linkUrl) {
          const target = s.newTab !== false && !s.linkUrl.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';
          return `
            <div class="cms-slide ${idx === 0 ? 'active' : ''}">
              <a href="${escHtml(s.linkUrl)}"${target} style="display:block;width:100%;height:100%;text-decoration:none;color:inherit;">
                ${slideBody}
              </a>
            </div>
          `;
        }
        return `
          <div class="cms-slide ${idx === 0 ? 'active' : ''}">
            ${slideBody}
          </div>
        `;
      }).join('');

      const arrowsHtml = showArrows ? `
        <button type="button" class="cms-carousel-arrow prev" onclick="navigateCarousel('${carouselId}', -1)" aria-label="Previous slide">&#10094;</button>
        <button type="button" class="cms-carousel-arrow next" onclick="navigateCarousel('${carouselId}', 1)" aria-label="Next slide">&#10095;</button>
      ` : '';

      const dotsHtml = showDots ? `
        <div class="cms-carousel-dots">
          ${slides.map((_, idx) => `<button type="button" class="cms-carousel-dot ${idx === 0 ? 'active' : ''}" onclick="setCarouselSlide('${carouselId}', ${idx})" aria-label="Go to slide ${idx + 1}"></button>`).join('')}
        </div>
      ` : '';

      return `<div id="${carouselId}" class="cms-carousel" data-autoplay="${autoplay}" data-interval="${interval}" style="position:relative;width:100%;aspect-ratio:${ratio};border-radius:${rad}px;overflow:hidden;margin:16px 0;background:#0f172a;${customCss}">
        <div class="cms-carousel-track" style="width:100%;height:100%;position:relative;">
          ${slidesHtml}
        </div>
        ${arrowsHtml}
        ${dotsHtml}
      </div>`;
    }
    case 'divider': {
      const style = p.style || 'solid';
      const thickness = Math.max(1, Math.min(8, Number(p.thickness) || 1));
      const width = p.width || '100%';
      const margin = p.margin != null ? Number(p.margin) : 16;
      const color = p.color || '#e2e8f0';
      return `<div style="padding:${margin}px 0;display:flex;justify-content:center;${customCss}"><hr style="width:${width};border:none;border-top:${thickness}px ${style} ${color};margin:0;" /></div>`;
    }
    case 'spacer':
      return `<div style="height:${Number(p.height) || 24}px;${customCss}"></div>`;
    case 'table': {
      const headers = Array.isArray(p.headers) ? p.headers : [];
      const rows = Array.isArray(p.rows) ? p.rows : [];
      const hasHeader = p.hasHeader !== false;
      const striped = p.striped ? ' striped' : '';
      const bordered = p.bordered ? ' bordered' : '';
      const compact = p.compact ? ' compact' : '';

      let theadHtml = '';
      if (hasHeader && headers.length) {
        theadHtml = `<thead><tr>${headers.map(h => `<th>${escHtml(h)}</th>`).join('')}</tr></thead>`;
      }
      const tbodyHtml = `<tbody>${rows.map(row => {
        const rowCells = Array.isArray(row) ? row : [];
        const cols = (headers.length ? headers : rowCells);
        return `<tr>${cols.map((_, cIdx) => `<td>${escHtml(rowCells[cIdx] || '')}</td>`).join('')}</tr>`;
      }).join('')}</tbody>`;

      return `<div class="cms-table-wrap" style="overflow-x:auto;margin:16px 0;${customCss}"><table class="cms-table${striped}${bordered}${compact}" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${theadHtml}${tbodyHtml}</table></div>`;
    }
    case 'container': {
      const mode = p.mode || 'grid';
      const children = Array.isArray(p.children) ? p.children : [];
      const padding = p.padding != null ? Number(p.padding) : 16;
      const borderRadius = p.borderRadius != null ? Number(p.borderRadius) : 8;
      const gap = p.gap != null ? Number(p.gap) : 16;
      const borderStyle = p.border ? 'border:1px solid #e2e8f0;' : '';
      const shadowStyle = p.shadow ? 'box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1);' : '';
      const bgStyle = p.bg === 'surface' ? 'background:#f1f5f9;' : p.bg === 'subtle' ? 'background:#f8fafc;' : p.bg === 'dark' ? 'background:#0f172a;color:#fff;' : 'background:transparent;';

      let layoutStyle = `display:${mode === 'grid' ? 'grid' : 'flex'};gap:${gap}px;padding:${padding}px;border-radius:${borderRadius}px;${borderStyle}${shadowStyle}${bgStyle}margin:16px 0;box-sizing:border-box;${customCss}`;
      if (mode === 'grid') {
        layoutStyle += `grid-template-columns:repeat(${p.columns || 2}, minmax(0, 1fr));`;
      } else {
        layoutStyle += `flex-direction:${p.direction || 'row'};justify-content:${p.justify || 'flex-start'};align-items:${p.align || 'stretch'};flex-wrap:${p.wrap || 'wrap'};`;
      }

      const childrenHtml = children.map(renderBlockHtml).join('\n');
      if (p.linkUrl) {
        const target = p.newTab !== false && !p.linkUrl.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';
        return `<a href="${escHtml(p.linkUrl)}"${target} style="text-decoration:none;color:inherit;display:block;"><div class="cms-container" style="${layoutStyle}">${childrenHtml}</div></a>`;
      }
      return `<div class="cms-container" style="${layoutStyle}">${childrenHtml}</div>`;
    }
    default:
      return '';
  }
}

function renderPublishedPage(page, blocks, tags) {
  let settings = {};
  try {
    settings = typeof page.settings === 'object' && page.settings !== null
      ? page.settings
      : JSON.parse(page.settings || '{}');
  } catch (_) { settings = {}; }

  const maxWidth = settings.maxWidth || '760px';
  const paddingX = (settings.paddingX != null ? Number(settings.paddingX) : 24) + 'px';
  const paddingY = (settings.paddingY != null ? Number(settings.paddingY) : 48) + 'px';
  const marginY = (settings.marginY != null ? Number(settings.marginY) : 0) + 'px';
  const marginX = (settings.marginX != null ? Number(settings.marginX) : 0) + 'px';
  const borderRadius = (settings.borderRadius != null ? Number(settings.borderRadius) : 0) + 'px';
  const bgType = settings.bg || 'default';

  let pageBg = '#f8fafc';
  let cardBg = '#ffffff';
  let textColor = '#0f172a';
  let borderColor = '#e2e8f0';

  if (bgType === 'pure-black') {
    pageBg = '#000000'; cardBg = '#050505'; textColor = '#f1f5f9'; borderColor = '#1e293b';
  } else if (bgType === 'dark-card') {
    pageBg = '#0b0f17'; cardBg = '#111827'; textColor = '#f1f5f9'; borderColor = '#1f2937';
  } else if (bgType === 'deep-navy') {
    pageBg = '#050a14'; cardBg = '#0a1324'; textColor = '#f1f5f9'; borderColor = '#1e293b';
  } else if (bgType === 'custom' && settings.customBg) {
    pageBg = settings.customBg; cardBg = settings.customBg; textColor = '#ffffff'; borderColor = 'rgba(255,255,255,0.15)';
  } else if (bgType === 'light') {
    pageBg = '#f1f5f9'; cardBg = '#ffffff'; textColor = '#0f172a'; borderColor = '#e2e8f0';
  }

  const fontMap = {
    inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    outfit: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    roboto: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
  };
  const fontFamily = fontMap[settings.fontFamily] || fontMap.system;
  let alignMargin = `${marginY} auto`;
  if (settings.align === 'left') {
    alignMargin = `${marginY} auto ${marginY} ${marginX}`;
  } else if (Number(settings.marginX) > 0) {
    alignMargin = `${marginY} ${marginX}`;
  }

  const body = blocks.map(renderBlockHtml).join('\n');
  const draftBanner = page.status !== 'published' ? `
  <div style="background:#f59e0b;color:#1e1b4b;padding:8px 16px;text-align:center;font-size:13px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:10px;box-shadow:0 2px 8px rgba(0,0,0,0.15);">
    <span>⚡ <strong>Draft Preview Mode</strong> &mdash; This page is currently unpublished (${escHtml(page.status || 'draft')})</span>
    <a href="/" style="color:#1e1b4b;text-decoration:underline;margin-left:8px;font-weight:700;">Open Studio &rarr;</a>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(page.title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Outfit:wght@400;500;600;700;800&family=Roboto:wght@400;500;700&family=JetBrains+Mono:wght@400;600&display=swap" rel="stylesheet">
  <style>
    body { font-family: ${fontFamily}; background: ${pageBg}; color: ${textColor}; margin: 0; min-height: 100vh; }
    .wrap { max-width: ${maxWidth}; margin: ${alignMargin}; padding: ${paddingY} ${paddingX}; border-radius: ${borderRadius}; background: ${cardBg}; min-height: 100vh; box-sizing: border-box; box-shadow: 0 0 0 1px ${borderColor}; }
    .tags { margin-top: 32px; padding-top: 16px; border-top: 1px solid ${borderColor}; font-size: 12px; color: #64748b; }
    .tags span { display: inline-block; background: rgba(100,116,139,0.15); padding: 2px 8px; border-radius: 999px; margin-right: 4px; }
    .cms-table th { background: rgba(100,116,139,0.12); color: inherit; font-weight: 600; padding: 10px 14px; text-align: left; border-bottom: 2px solid ${borderColor}; }
    .cms-table td { padding: 9px 14px; border-bottom: 1px solid ${borderColor}; color: inherit; opacity: 0.9; }
    .cms-table.striped tbody tr:nth-child(even) { background: rgba(100,116,139,0.05); }
    .cms-table.bordered { border: 1px solid ${borderColor}; }
    .cms-table.bordered th, .cms-table.bordered td { border: 1px solid ${borderColor}; }
    .cms-table.compact th, .cms-table.compact td { padding: 6px 10px; font-size: 12px; }
    
    /* Carousel Styles */
    .cms-carousel { position: relative; overflow: hidden; }
    .cms-slide { position: absolute; inset: 0; opacity: 0; transition: opacity 0.4s ease-in-out; pointer-events: none; }
    .cms-slide.active { opacity: 1; pointer-events: auto; }
    .cms-slide-caption { position: absolute; bottom: 0; left: 0; right: 0; padding: 12px 16px; background: linear-gradient(transparent, rgba(0,0,0,0.8)); color: #fff; font-size: 13.5px; font-weight: 500; }
    .cms-carousel-arrow { position: absolute; top: 50%; transform: translateY(-50%); width: 36px; height: 36px; border-radius: 50%; background: rgba(0,0,0,0.45); color: #fff; border: 1px solid rgba(255,255,255,0.25); display: grid; place-items: center; cursor: pointer; backdrop-filter: blur(4px); font-size: 14px; z-index: 5; transition: background 0.15s; }
    .cms-carousel-arrow:hover { background: rgba(0,0,0,0.8); }
    .cms-carousel-arrow.prev { left: 12px; }
    .cms-carousel-arrow.next { right: 12px; }
    .cms-carousel-dots { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 6px; z-index: 5; }
    .cms-carousel-dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.45); border: none; cursor: pointer; transition: all 0.2s; padding: 0; }
    .cms-carousel-dot.active { width: 22px; background: #fff; }
  </style>
</head>
<body>
  ${draftBanner}
  <div class="wrap">
    ${body}
    ${tags.length ? `<div class="tags">${tags.map(t => `<span>${escHtml(t)}</span>`).join('')}</div>` : ''}
  </div>
  <script>
    function setCarouselSlide(id, idx) {
      const c = document.getElementById(id);
      if (!c) return;
      const slides = c.querySelectorAll('.cms-slide');
      const dots = c.querySelectorAll('.cms-carousel-dot');
      if (idx < 0) idx = slides.length - 1;
      if (idx >= slides.length) idx = 0;
      slides.forEach((s, i) => s.classList.toggle('active', i === idx));
      dots.forEach((d, i) => d.classList.toggle('active', i === idx));
      c.dataset.current = idx;
    }
    function navigateCarousel(id, dir) {
      const c = document.getElementById(id);
      if (!c) return;
      const slides = c.querySelectorAll('.cms-slide');
      let cur = parseInt(c.dataset.current || '0', 10);
      setCarouselSlide(id, (cur + dir + slides.length) % slides.length);
    }
    document.querySelectorAll('.cms-carousel[data-autoplay="true"]').forEach(c => {
      const interval = (parseFloat(c.dataset.interval) || 4) * 1000;
      let timer = setInterval(() => navigateCarousel(c.id, 1), interval);
      c.addEventListener('mouseenter', () => clearInterval(timer));
      c.addEventListener('mouseleave', () => {
        clearInterval(timer);
        timer = setInterval(() => navigateCarousel(c.id, 1), interval);
      });
    });
  </script>
</body>
</html>`;
}

const PORT = process.env.PORT || 3456;
app.listen(PORT, () => {
  console.log(`Kanban app running on http://localhost:${PORT}`);
});
