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
  const { title, description, due_date, priority, archived, labelIds, cover } = req.body;

  const existing = db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const tx = db.transaction(() => {
    const updates = [];
    const params = [];
    if (typeof cover === 'string') {
      updates.push('cover = ?');
      params.push(cover.trim());
    }
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
  let sql = `SELECT p.id, p.title, p.slug, p.status, p.parent_id, p.position, p.is_first_page, p.created_at, p.updated_at,
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
  const pageCount = db.prepare('SELECT COUNT(*) AS c FROM pages').get()?.c || 0;
  const isFirstPage = pageCount === 0 ? 1 : 0;
  const info = db
    .prepare('INSERT INTO pages (title, slug, blocks, status, settings, parent_id, position, is_first_page) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(title.trim(), slug, blocksJson, status, settingsJson, parent_id != null ? Number(parent_id) : null, Number(position) || 0, isFirstPage);
  const insertTag = db.prepare('INSERT OR IGNORE INTO page_tags (page_id, tag) VALUES (?, ?)');
  (tags || []).forEach(t => {
    if (t && typeof t === 'string') insertTag.run(info.lastInsertRowid, t.trim().toLowerCase());
  });
  res.json({ id: info.lastInsertRowid, slug, is_first_page: isFirstPage });
});

app.patch('/api/pages/:id', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT * FROM pages WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'not found' });
  const { title, blocks, status, tags, settings, parent_id, position, is_first_page } = req.body;
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
    if (is_first_page !== undefined) {
      const isFirst = !!is_first_page;
      if (isFirst) {
        db.prepare('UPDATE pages SET is_first_page = 0').run();
        updates.push('is_first_page = 1');
      } else {
        updates.push('is_first_page = 0');
      }
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

app.post('/api/pages/:id/set-first', (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare('SELECT id, title FROM pages WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Page not found' });
  const tx = db.transaction(() => {
    db.prepare('UPDATE pages SET is_first_page = 0').run();
    db.prepare('UPDATE pages SET is_first_page = 1 WHERE id = ?').run(id);
  });
  tx();
  res.json({ ok: true, id });
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
  const id = Number(req.params.id);
  const target = db.prepare('SELECT is_first_page FROM pages WHERE id = ?').get(id);
  db.prepare('DELETE FROM pages WHERE id = ?').run(id);
  if (target && target.is_first_page) {
    const nextFirst = db.prepare('SELECT id FROM pages ORDER BY position ASC, id ASC LIMIT 1').get();
    if (nextFirst) {
      db.prepare('UPDATE pages SET is_first_page = 1 WHERE id = ?').run(nextFirst.id);
    }
  }
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

// Ollama Local AI - Check connection and list installed local models
app.get('/api/ai/ollama/models', async (req, res) => {
  const baseUrl = (req.query.baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.json({
        ok: false,
        models: [],
        error: `Ollama returned HTTP ${response.status}`
      });
    }

    const data = await response.json();
    const models = (data.models || []).map(m => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
      details: m.details
    }));

    res.json({ ok: true, models, baseUrl });
  } catch (err) {
    res.json({
      ok: false,
      models: [],
      error: `Could not connect to Ollama at ${baseUrl}. Ensure Ollama is running (e.g. run "ollama serve").`
    });
  }
});

// AI Website Generator Endpoint
app.post('/api/ai/generate-page', async (req, res) => {
  try {
    const {
      prompt = '',
      preset = 'custom',
      theme = 'dark-card',
      boardId = null,
      provider = 'opencode', // 'opencode' | 'gemini' | 'ollama' | 'auto'
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

    // 2. Ollama Local AI Call
    if (!generatedPage && provider === 'ollama' && prompt.trim()) {
      try {
        const ollamaBaseUrl = (baseUrl && !baseUrl.includes('opencode') && !baseUrl.includes('groq')) ? baseUrl : 'http://localhost:11434';
        const ollamaModel = (model && model !== 'opencode-1') ? model : 'llama3.2';
        generatedPage = await callOllamaPageGenerator(ollamaBaseUrl, ollamaModel, prompt, preset, theme);
      } catch (err) {
        const ollamaModel = (model && model !== 'opencode-1') ? model : 'llama3.2';
        aiError = `Ollama (${ollamaModel}): ${err.message}`;
        console.warn('Ollama API call failed, falling back to archetype generator:', err.message);
      }
    }

    // 3. OpenCode / OpenAI-Compatible API Call
    if (!generatedPage && (provider === 'opencode' || provider === 'openai' || (!provider && effectiveOpenCodeKey)) && effectiveOpenCodeKey && prompt.trim()) {
      try {
        generatedPage = await callOpenCodePageGenerator(effectiveOpenCodeKey, effectiveBaseUrl, effectiveModel, prompt, preset, theme);
      } catch (err) {
        aiError = `OpenCode (${effectiveModel}): ${err.message}`;
        console.warn('OpenCode API call failed, falling back to archetype generator:', err.message);
      }
    }

    // 4. Gemini API Call
    if (!generatedPage && provider === 'gemini' && effectiveGeminiKey && prompt.trim()) {
      try {
        generatedPage = await callGeminiPageGenerator(effectiveGeminiKey, prompt, preset, theme);
      } catch (err) {
        aiError = `Gemini: ${err.message}`;
        console.warn('Gemini API call failed, falling back to archetype generator:', err.message);
      }
    }

    // 5. Fallback: Smart Archetype Generator
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
    const source = (!aiError && provider === 'ollama')
      ? 'ollama-ai'
      : ((!aiError && effectiveOpenCodeKey)
        ? 'opencode-ai'
        : ((!aiError && effectiveGeminiKey)
          ? 'gemini-ai'
          : 'smart-archetype'));
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
        { id: 'b_sp3', type: 'spacer', props: { height: 28 } },
        {
          id: 'b_partners_mrq',
          type: 'marquee',
          props: {
            speed: 'normal',
            items: [
              { text: 'TypeScript', icon: '⚡' },
              { text: 'TailwindCSS', icon: '🎨' },
              { text: 'Node.js', icon: '🟢' },
              { text: 'SQLite', icon: '🗄️' },
              { text: 'GraphQL', icon: '◈' },
              { text: 'Next.js', icon: '▲' }
            ]
          }
        },
        { id: 'b_sp3_sub', type: 'spacer', props: { height: 32 } },
        { id: 'b_sec1', type: 'heading', props: { level: 2, text: '✨ Core Platform Capabilities', align: 'center', margin: 8 } },
        { id: 'b_sec1_sub', type: 'paragraph', props: { text: 'Everything you need to ship enterprise-grade intelligence without technical debt.', align: 'center', color: '#94a3b8' } },
        {
          id: 'b_bento_grid',
          type: 'bento',
          props: {
            items: [
              { title: 'Edge Micro-Clusters', subtitle: 'Ultra-low latency inference distributed across 40+ points of presence.', icon: '⚡', tag: 'Speed', metric: '0.4ms', span: 2, image: '' },
              { title: 'Zero-Trust Architecture', subtitle: 'End-to-end encrypted storage with cryptographic isolation.', icon: '🔒', tag: 'Security', metric: 'SOC-2', span: 1, image: '' },
              { title: 'Deep Telemetry', subtitle: 'Real-time telemetry and visualization boards for performance tracking.', icon: '📊', tag: 'Insights', metric: '99.99%', span: 1, image: '' },
              { title: 'Design System & Spatial UI', subtitle: 'Curated color palettes and sleek glassmorphic surfaces for immersive UX.', icon: '🎨', tag: 'Aesthetics', metric: '60fps', span: 2, image: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop' }
            ]
          }
        },
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
Every block supports an optional "customCss" string in "props". When needed to elevate the design (e.g. gradient hero titles, glassmorphism containers, glowing CTA buttons, subtle card borders, or badge styling), USE "customCss" to give the page a modern, visually stunning look. Every block ALSO supports background + parallax props: "bgType": "none"|"color"|"gradient"|"image", "bgColor": "#hex", "bgGradient": "linear-gradient(135deg, #0f172a, #4f46e5)", "bgImage": "https://images.unsplash.com/...", "bgSize": "cover"|"contain"|"auto", "bgPosition": "center"|"top"|"bottom"|"left"|"right", "bgRepeat": "no-repeat"|"repeat"|"repeat-x"|"repeat-y", "parallax": true (fixes the background while scrolling). Use these for section backgrounds and parallax hero effects.
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

  // 1. Remove thinking tags <think>...</think>
  let text = rawText.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  // 2. Extract markdown code block if present
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 3. Find outermost JSON object
  const firstBrace = text.indexOf('{');
  if (firstBrace === -1) throw new Error('No JSON object found in output');
  text = text.slice(firstBrace);

  const lastBrace = text.lastIndexOf('}');
  let candidate = lastBrace !== -1 && lastBrace > 0 ? text.slice(0, lastBrace + 1) : text;

  // Function to try parsing with multi-pass sanitation
  function tryParse(s) {
    // 1. Clean trailing commas before } or ]
    let cleaned = s.replace(/,\s*([\]}])/g, '$1');
    // 2. Fix missing commas between objects: } { -> }, {
    cleaned = cleaned.replace(/}\s*(\r?\n\s*){/g, '},$1{');
    // 3. Fix missing commas between array brackets: ] [ -> ], [
    cleaned = cleaned.replace(/\]\s*(\r?\n\s*)\[/g, '],$1[');
    // 4. Fix missing comma after value before next object key: "val" "key": -> "val", "key":
    cleaned = cleaned.replace(/(["\d]|true|false|null)\s*(\r?\n\s*)"([a-zA-Z0-9_-]+)"\s*:/g, '$1,$2"$3":');
    // 5. Clean trailing commas again if introduced
    cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');

    return JSON.parse(cleaned);
  }

  // Attempt 1: Parse candidate
  try {
    return tryParse(candidate);
  } catch (e1) {
    // Attempt 2: Parse full text
    try {
      return tryParse(text);
    } catch (e2) {}

    // Attempt 3: Stack-based truncated JSON auto-repair
    try {
      let repaired = candidate;

      let inString = false;
      let escaped = false;
      const stack = [];

      for (let i = 0; i < repaired.length; i++) {
        const char = repaired[i];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === '\\') {
          escaped = true;
          continue;
        }
        if (char === '"') {
          inString = !inString;
          continue;
        }
        if (!inString) {
          if (char === '{' || char === '[') {
            stack.push(char);
          } else if (char === '}') {
            if (stack.length && stack[stack.length - 1] === '{') stack.pop();
          } else if (char === ']') {
            if (stack.length && stack[stack.length - 1] === '[') stack.pop();
          }
        }
      }

      if (inString) {
        repaired += '"';
      }

      // Strip partial key-value or dangling comma at end
      repaired = repaired.replace(/,\s*$/, '');
      repaired = repaired.replace(/:\s*$/, ': null');
      repaired = repaired.replace(/"[a-zA-Z0-9_-]+"\s*:\s*$/, '');
      repaired = repaired.replace(/,\s*$/, '');

      // Close open structures in LIFO order
      while (stack.length > 0) {
        const open = stack.pop();
        if (open === '{') repaired += '}';
        else if (open === '[') repaired += ']';
      }

      return tryParse(repaired);
    } catch (e3) {
      // Attempt 4: Fallback to last complete block inside "blocks"
      try {
        const lastCompleteBlock = text.lastIndexOf('}');
        if (lastCompleteBlock !== -1) {
          let sub = text.slice(0, lastCompleteBlock + 1);
          if (!sub.endsWith(']}')) {
            if (sub.endsWith(']')) sub += '}';
            else sub += ']}';
          }
          return tryParse(sub);
        }
      } catch (e4) {}

      throw new Error(`Invalid JSON returned by model: ${e1.message}`);
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
    // 10. callout: { "id": "cal_1", "type": "callout", "props": { "type": "info"|"tip"|"warning"|"danger", "icon": "💡", "title": "...", "text": "..." } }
    // 11. accordion: { "id": "acc_1", "type": "accordion", "props": { "items": [{ "title": "Question?", "content": "Answer..." }] } }
    // 12. tabs: { "id": "tab_1", "type": "tabs", "props": { "tabs": [{ "title": "Tab Title", "content": "Panel content..." }] } }
    // 13. pricing: { "id": "prc_1", "type": "pricing", "props": { "plan": "Pro Plan", "price": "$29", "period": "/month", "description": "...", "features": ["Feature 1", "Feature 2"], "ctaLabel": "Get Started", "ctaUrl": "#", "isPopular": true, "badge": "Popular" } }
    // 14. stat: { "id": "stat_1", "type": "stat", "props": { "label": "Active Users", "value": "128K+", "subtext": "Global", "trend": "+24%", "trendDirection": "up"|"down" } }
    // 15. testimonial: { "id": "tst_1", "type": "testimonial", "props": { "quote": "...", "author": "Name", "role": "Role", "avatar": "https://images.unsplash.com/...", "rating": 5 } }
    // 16. video: { "id": "vid_1", "type": "video", "props": { "url": "https://www.youtube.com/watch?v=...", "caption": "..." } }
    // 17. code: { "id": "cod_1", "type": "code", "props": { "language": "javascript", "code": "console.log('hi');" } }
    // 18. bento: { "id": "bnt_1", "type": "bento", "props": { "items": [{ "title": "Feature Title", "subtitle": "...", "icon": "⚡", "tag": "Core", "metric": "0.4ms", "span": 1, "image": "" }] } }
    // 19. comparison: { "id": "cmp_1", "type": "comparison", "props": { "beforeImage": "https://...", "afterImage": "https://...", "beforeLabel": "Before", "afterLabel": "After" } }
    // 20. tilt-card: { "id": "tlt_1", "type": "tilt-card", "props": { "badge": "Featured", "title": "3D Tilt Title", "subtitle": "...", "ctaLabel": "Learn More", "ctaUrl": "#" } }
    // 21. marquee: { "id": "mrq_1", "type": "marquee", "props": { "speed": "normal", "items": [{ "text": "Next.js", "icon": "▲" }] } }
    // 22. countdown: { "id": "cnd_1", "type": "countdown", "props": { "title": "Launch Event", "subtitle": "...", "targetDate": "2026-12-31T23:59:59" } }
    // 23. timeline: { "id": "tml_1", "type": "timeline", "props": { "items": [{ "title": "Milestone", "date": "Q1 2026", "description": "...", "status": "completed"|"current"|"upcoming" }] } }
    // 24. form: { "id": "frm_1", "type": "form", "props": { "title": "Contact Us", "description": "...", "buttonLabel": "Send Message" } }
    // 25. audio: { "id": "aud_1", "type": "audio", "props": { "title": "Episode 01", "artist": "Host Name", "duration": "04:15", "cover": "https://..." } }
    // 26. header: { "id": "hdr_1", "type": "header", "props": { "brandName": "Brand Name", "brandIcon": "✦", "layout": "spread"|"centered"|"floating", "styleVariant": "glass"|"solid"|"transparent"|"bordered", "sticky": false, "showCta": true, "ctaLabel": "Get Started", "ctaUrl": "#", "ctaVariant": "filled"|"outline"|"glow", "links": [{ "label": "Features", "url": "#features" }] } }
    // 27. footer: { "id": "ftr_1", "type": "footer", "props": { "brandName": "Brand Name", "brandIcon": "✦", "tagline": "...", "styleVariant": "dark"|"light"|"transparent", "columns": [{ "title": "Product", "links": [{ "label": "Features", "url": "#features" }] }], "showNewsletter": true, "newsletterTitle": "Stay in the loop", "newsletterText": "...", "showSocial": true, "social": [{ "platform": "twitter", "url": "https://twitter.com/..." }], "copyright": "© 2026 Brand. All rights reserved.", "bottomLinks": [{ "label": "Privacy Policy", "url": "#" }] } }
  ]
}
IMPORTANT STYLING DIRECTIVE:
Every block supports an optional "customCss" string in "props". When needed to elevate the design (e.g. gradient hero titles, glassmorphism containers, glowing CTA buttons, subtle card borders, or badge styling), USE "customCss" to give the page a modern, visually stunning look. Every block ALSO supports background + parallax props: "bgType": "none"|"color"|"gradient"|"image", "bgColor": "#hex", "bgGradient": "linear-gradient(135deg, #0f172a, #4f46e5)", "bgImage": "https://images.unsplash.com/...", "bgSize": "cover"|"contain"|"auto", "bgPosition": "center"|"top"|"bottom"|"left"|"right", "bgRepeat": "no-repeat"|"repeat"|"repeat-x"|"repeat-y", "parallax": true (fixes the background while scrolling). Use these for section backgrounds and parallax hero effects.
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

// Ollama Local AI Page Generator
async function callOllamaPageGenerator(baseUrl = 'http://localhost:11434', model = 'llama3.2', prompt = '', preset = 'custom', theme = 'dark-card') {
  let endpoint = (baseUrl || 'http://localhost:11434').replace(/\/+$/, '');
  let finalModel = (model || 'llama3.2').trim();

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
    // 10. callout: { "id": "cal_1", "type": "callout", "props": { "type": "info"|"tip"|"warning"|"danger", "icon": "💡", "title": "...", "text": "..." } }
    // 11. accordion: { "id": "acc_1", "type": "accordion", "props": { "items": [{ "title": "Question?", "content": "Answer..." }] } }
    // 12. tabs: { "id": "tab_1", "type": "tabs", "props": { "tabs": [{ "title": "Tab Title", "content": "Panel content..." }] } }
    // 13. pricing: { "id": "prc_1", "type": "pricing", "props": { "plan": "Pro Plan", "price": "$29", "period": "/month", "description": "...", "features": ["Feature 1", "Feature 2"], "ctaLabel": "Get Started", "ctaUrl": "#", "isPopular": true, "badge": "Popular" } }
    // 14. stat: { "id": "stat_1", "type": "stat", "props": { "label": "Active Users", "value": "128K+", "subtext": "Global", "trend": "+24%", "trendDirection": "up"|"down" } }
    // 15. testimonial: { "id": "tst_1", "type": "testimonial", "props": { "quote": "...", "author": "Name", "role": "Role", "avatar": "https://images.unsplash.com/...", "rating": 5 } }
    // 16. video: { "id": "vid_1", "type": "video", "props": { "url": "https://www.youtube.com/watch?v=...", "caption": "..." } }
    // 17. code: { "id": "cod_1", "type": "code", "props": { "language": "javascript", "code": "console.log('hi');" } }
    // 18. bento: { "id": "bnt_1", "type": "bento", "props": { "items": [{ "title": "Feature Title", "subtitle": "...", "icon": "⚡", "tag": "Core", "metric": "0.4ms", "span": 1, "image": "" }] } }
    // 19. comparison: { "id": "cmp_1", "type": "comparison", "props": { "beforeImage": "https://...", "afterImage": "https://...", "beforeLabel": "Before", "afterLabel": "After" } }
    // 20. tilt-card: { "id": "tlt_1", "type": "tilt-card", "props": { "badge": "Featured", "title": "3D Tilt Title", "subtitle": "...", "ctaLabel": "Learn More", "ctaUrl": "#" } }
    // 21. marquee: { "id": "mrq_1", "type": "marquee", "props": { "speed": "normal", "items": [{ "text": "Next.js", "icon": "▲" }] } }
    // 22. countdown: { "id": "cnd_1", "type": "countdown", "props": { "title": "Launch Event", "subtitle": "...", "targetDate": "2026-12-31T23:59:59" } }
    // 23. timeline: { "id": "tml_1", "type": "timeline", "props": { "items": [{ "title": "Milestone", "date": "Q1 2026", "description": "...", "status": "completed"|"current"|"upcoming" }] } }
    // 24. form: { "id": "frm_1", "type": "form", "props": { "title": "Contact Us", "description": "...", "buttonLabel": "Send Message" } }
    // 25. audio: { "id": "aud_1", "type": "audio", "props": { "title": "Episode 01", "artist": "Host Name", "duration": "04:15", "cover": "https://..." } }
    // 26. header: { "id": "hdr_1", "type": "header", "props": { "brandName": "Brand Name", "brandIcon": "✦", "layout": "spread"|"centered"|"floating", "styleVariant": "glass"|"solid"|"transparent"|"bordered", "sticky": false, "showCta": true, "ctaLabel": "Get Started", "ctaUrl": "#", "ctaVariant": "filled"|"outline"|"glow", "links": [{ "label": "Features", "url": "#features" }] } }
    // 27. footer: { "id": "ftr_1", "type": "footer", "props": { "brandName": "Brand Name", "brandIcon": "✦", "tagline": "...", "styleVariant": "dark"|"light"|"transparent", "columns": [{ "title": "Product", "links": [{ "label": "Features", "url": "#features" }] }], "showNewsletter": true, "newsletterTitle": "Stay in the loop", "newsletterText": "...", "showSocial": true, "social": [{ "platform": "twitter", "url": "https://twitter.com/..." }], "copyright": "© 2026 Brand. All rights reserved.", "bottomLinks": [{ "label": "Privacy Policy", "url": "#" }] } }
  ]
}
IMPORTANT STYLING DIRECTIVE:
Every block supports an optional "customCss" string in "props". When needed to elevate the design (e.g. gradient hero titles, glassmorphism containers, glowing CTA buttons, subtle card borders, or badge styling), USE "customCss" to give the page a modern, visually stunning look. Every block ALSO supports background + parallax props: "bgType": "none"|"color"|"gradient"|"image", "bgColor": "#hex", "bgGradient": "linear-gradient(135deg, #0f172a, #4f46e5)", "bgImage": "https://images.unsplash.com/...", "bgSize": "cover"|"contain"|"auto", "bgPosition": "center"|"top"|"bottom"|"left"|"right", "bgRepeat": "no-repeat"|"repeat"|"repeat-x"|"repeat-y", "parallax": true (fixes the background while scrolling). Use these for section backgrounds and parallax hero effects.
Make the website rich, professional, engaging, with multiple sections (Hero, Features Grid, Testimonials/Quotes, Pricing or Stats Table, CTA buttons).

CRITICAL SYNTAX & COMPLETION RULES:
1. Output valid JSON only. Always separate array elements and object properties with commas.
2. Keep the website concise and complete (5-10 primary blocks). Do not over-nest beyond 2 levels so the entire JSON is fully generated without truncation.`;

  const userContent = `Generate a complete, fully-closed visual website layout in JSON for:\nPrompt: ${prompt}\nTheme: ${theme}\nPreset: ${preset}`;

  let lastError = null;

  // 1. Try native Ollama /api/chat with format: "json"
  try {
    const res = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: finalModel,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContent }
        ],
        format: 'json',
        stream: false,
        options: {
          temperature: 0.7,
          num_ctx: 8192,
          num_predict: 4096
        }
      })
    });

    if (res.ok) {
      const data = await res.json();
      const rawText = data.message?.content || '';
      if (rawText) {
        return extractAndParseJson(rawText);
      }
    } else {
      const errText = await res.text().catch(() => '');
      lastError = new Error(`Ollama /api/chat returned HTTP ${res.status}: ${errText || 'Endpoint unavailable'}`);
    }
  } catch (nativeErr) {
    lastError = nativeErr;
    if (nativeErr.code === 'ECONNREFUSED' || (nativeErr.message && (nativeErr.message.includes('fetch failed') || nativeErr.message.includes('ECONNREFUSED')))) {
      throw new Error(`Could not connect to Ollama at ${endpoint}. Please ensure Ollama is running (e.g. run "ollama serve" or open Ollama desktop app).`);
    }
  }

  // 2. Fallback to OpenAI-compatible /v1/chat/completions on Ollama
  try {
    const v1Res = await fetch(`${endpoint}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: finalModel,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userContent }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 4096,
        temperature: 0.7
      })
    });

    if (!v1Res.ok) {
      const errText = await v1Res.text().catch(() => '');
      throw new Error(`Ollama error (${v1Res.status}): ${errText || 'Unavailable'}`);
    }

    const v1Data = await v1Res.json();
    const rawText = v1Data.choices?.[0]?.message?.content || '';
    if (rawText) {
      return extractAndParseJson(rawText);
    }
  } catch (v1Err) {
    if (v1Err.code === 'ECONNREFUSED' || (v1Err.message && (v1Err.message.includes('fetch failed') || v1Err.message.includes('ECONNREFUSED')))) {
      throw new Error(`Could not connect to Ollama at ${endpoint}. Please ensure Ollama is running (e.g. run "ollama serve" or open Ollama desktop app).`);
    }
    throw lastError || v1Err;
  }

  throw lastError || new Error('Ollama returned empty response.');
}

app.get('/p', (req, res) => {
  let page = db.prepare("SELECT * FROM pages WHERE is_first_page = 1 AND status = 'published'").get();
  if (!page) {
    page = db.prepare("SELECT * FROM pages WHERE is_first_page = 1").get();
  }
  if (!page) {
    page = db.prepare("SELECT * FROM pages ORDER BY position ASC, id ASC LIMIT 1").get();
  }
  if (!page) {
    return res.redirect('/');
  }
  let blocks = [];
  try { blocks = JSON.parse(page.blocks || '[]'); } catch { }
  const tags = db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(page.id).map(r => r.tag);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPublishedPage(page, blocks, tags));
});

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

// Universal "Background & Parallax" CSS applied to every component's outer element.
function makeBlockBgCss(p) {
  const type = p.bgType || 'none';
  let css = '';
  if (type === 'color' && p.bgColor) {
    css += `background:${p.bgColor};background-color:${p.bgColor};`;
  } else if (type === 'gradient' && p.bgGradient) {
    css += `background:${p.bgGradient};`;
  } else if (type === 'image' && p.bgImage) {
    css += `background-image:url('${p.bgImage}');background-size:${p.bgSize || 'cover'};background-position:${p.bgPosition || 'center'};background-repeat:${p.bgRepeat || 'no-repeat'};`;
  }
  if (p.parallax && type === 'image') css += 'background-attachment:fixed;';
  return css;
}

// Appends a CSS string into the first tag's style attribute of a rendered block HTML string.
function injectBgStyleIntoFirstTag(html, css) {
  if (!css || typeof html !== 'string' || !html) return html;
  const gt = html.indexOf('>');
  if (gt === -1) return html;
  const firstTag = html.slice(0, gt + 1);
  const styleAttrMatch = firstTag.match(/style="([^"]*)"/);
  if (styleAttrMatch) {
    const inner = styleAttrMatch[1];
    const separator = inner && !inner.trim().endsWith(';') ? ';' : '';
    const replaced = firstTag.replace(/style="([^"]*)"/, `style="${inner}${separator}${css}"`);
    return replaced + html.slice(gt + 1);
  }
  const selfClosing = firstTag.endsWith('/>');
  const openTag = selfClosing ? firstTag.slice(0, gt - 1) : firstTag.slice(0, gt);
  return `${openTag} style="${css}"${selfClosing ? '/>' : '>'}` + html.slice(gt + 1);
}

function renderBlockHtml(b) {
  const bgCss = makeBlockBgCss(b.props || {});
  return injectBgStyleIntoFirstTag(renderBlockInnerHtml(b), bgCss);
}

function renderBlockInnerHtml(b) {
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

      return `<div class="cms-table-wrap block-table-wrap" style="overflow-x:auto;margin:16px 0;${customCss}"><table class="cms-table block-table${striped}${bordered}${compact}" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${theadHtml}${tbodyHtml}</table></div>`;
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
    case 'callout': {
      const type = p.type || 'tip';
      const colorMap = {
        tip: { bg: 'rgba(139, 92, 246, 0.1)', border: '#8b5cf6', icon: '💡', titleColor: '#a78bfa' },
        info: { bg: 'rgba(59, 130, 246, 0.1)', border: '#3b82f6', icon: 'ℹ️', titleColor: '#60a5fa' },
        success: { bg: 'rgba(16, 185, 129, 0.1)', border: '#10b981', icon: '✅', titleColor: '#34d399' },
        warning: { bg: 'rgba(245, 158, 11, 0.1)', border: '#f59e0b', icon: '⚠️', titleColor: '#fbbf24' },
        danger: { bg: 'rgba(239, 68, 68, 0.1)', border: '#ef4444', icon: '🛑', titleColor: '#f87171' }
      };
      const themeConfig = colorMap[type] || colorMap.tip;
      const icon = p.icon || themeConfig.icon;
      const title = p.title ? `<div style="font-weight:700;font-size:15px;margin-bottom:4px;color:${themeConfig.titleColor};">${escHtml(p.title)}</div>` : '';
      const text = p.text ? `<div style="font-size:14px;line-height:1.6;opacity:0.95;">${parseRichTextHtml(p.text)}</div>` : '';

      return `<div class="cms-callout cms-callout-${type}" style="border-left:4px solid ${themeConfig.border};background:${themeConfig.bg};padding:14px 18px;border-radius:0 10px 10px 0;margin:16px 0;display:flex;gap:14px;align-items:flex-start;${customCss}">
        <div style="font-size:20px;line-height:1;margin-top:2px;">${escHtml(icon)}</div>
        <div style="flex:1;">${title}${text}</div>
      </div>`;
    }
    case 'accordion': {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!items.length) return '';
      const accordionId = 'acc_' + Math.random().toString(36).slice(2, 9);
      const itemsHtml = items.map((it, idx) => {
        const isOpen = idx === 0 || it.isOpen;
        return `
          <div class="cms-accordion-item" style="border:1px solid rgba(255,255,255,0.1);border-radius:8px;margin-bottom:8px;overflow:hidden;background:rgba(255,255,255,0.02);">
            <button type="button" class="cms-accordion-trigger" style="width:100%;text-align:left;padding:14px 16px;background:transparent;border:none;color:inherit;font-size:15px;font-weight:600;cursor:pointer;display:flex;justify-content:space-between;align-items:center;">
              <span>${escHtml(it.title || 'FAQ Item')}</span>
              <span class="cms-accordion-arrow" style="transition:transform 0.2s ease;display:inline-block;font-size:12px;">&#9660;</span>
            </button>
            <div class="cms-accordion-panel" style="padding:0 16px 14px;font-size:14px;line-height:1.6;opacity:0.9;display:${isOpen ? 'block' : 'none'};">
              ${parseRichTextHtml(it.content || '')}
            </div>
          </div>
        `;
      }).join('');
      return `<div id="${accordionId}" class="cms-accordion" style="margin:16px 0;${customCss}">${itemsHtml}</div>`;
    }
    case 'tabs': {
      const tabs = Array.isArray(p.tabs) ? p.tabs : [];
      if (!tabs.length) return '';
      const tabsId = 'tabs_' + Math.random().toString(36).slice(2, 9);
      const variant = p.variant || 'pills';

      const navHtml = tabs.map((t, idx) => {
        const isActive = idx === 0;
        const pillStyle = variant === 'underline'
          ? `padding:8px 16px;border-bottom:2px solid ${isActive ? '#6366f1' : 'transparent'};background:transparent;color:${isActive ? '#6366f1' : 'inherit'};font-weight:600;cursor:pointer;border-top:none;border-left:none;border-right:none;`
          : `padding:8px 16px;border-radius:6px;background:${isActive ? '#6366f1' : 'rgba(255,255,255,0.06)'};color:#fff;font-weight:600;border:none;cursor:pointer;`;
        return `<button type="button" class="cms-tab-btn ${isActive ? 'active' : ''}" data-target="${tabsId}_pane_${idx}" style="${pillStyle}">${escHtml(t.label || `Tab ${idx + 1}`)}</button>`;
      }).join('');

      const panesHtml = tabs.map((t, idx) => {
        const isShown = idx === 0 ? 'display:block;' : 'display:none;';
        return `<div id="${tabsId}_pane_${idx}" class="cms-tab-pane" style="${isShown}padding:16px 4px;font-size:14.5px;line-height:1.6;">${parseRichTextHtml(t.content || '')}</div>`;
      }).join('');

      return `<div id="${tabsId}" class="cms-tabs-wrap" style="margin:16px 0;${customCss}">
        <div class="cms-tabs-nav" style="display:flex;gap:8px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:8px;overflow-x:auto;">${navHtml}</div>
        <div class="cms-tabs-content">${panesHtml}</div>
      </div>`;
    }
    case 'pricing': {
      const plan = escHtml(p.planName || 'Standard Plan');
      const price = escHtml(p.price || '$29');
      const period = escHtml(p.period || '/ month');
      const desc = p.description ? `<p style="margin:6px 0 16px;font-size:13.5px;opacity:0.8;">${escHtml(p.description)}</p>` : '';
      const badge = p.badge ? `<div style="display:inline-block;padding:4px 10px;font-size:11px;font-weight:700;border-radius:20px;background:linear-gradient(135deg, #6366f1, #ec4899);color:#fff;margin-bottom:12px;letter-spacing:0.4px;">${escHtml(p.badge)}</div>` : '';
      const features = Array.isArray(p.features) ? p.features : [];
      const featsHtml = features.map(f => `<li style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13.5px;"><span style="color:#10b981;font-weight:bold;">✓</span> <span>${escHtml(f)}</span></li>`).join('');
      const btnLabel = escHtml(p.buttonLabel || 'Get Started');
      const btnUrl = escHtml(p.buttonUrl || '#');
      const target = p.newTab !== false && !btnUrl.startsWith('/p/') ? ' target="_blank" rel="noopener noreferrer"' : '';
      const borderStyle = p.highlight ? 'border:2px solid #6366f1;box-shadow:0 12px 32px rgba(99,102,241,0.25);' : 'border:1px solid rgba(255,255,255,0.12);';

      return `<div class="cms-pricing-card" style="border-radius:14px;padding:26px;background:rgba(255,255,255,0.03);${borderStyle}box-sizing:border-box;margin:16px 0;${customCss}">
        ${badge}
        <h3 style="margin:0 0 6px;font-size:20px;">${plan}</h3>
        <div style="display:flex;align-items:baseline;gap:4px;margin-bottom:4px;">
          <span style="font-size:32px;font-weight:800;letter-spacing:-0.5px;">${price}</span>
          <span style="font-size:14px;opacity:0.7;">${period}</span>
        </div>
        ${desc}
        <ul style="list-style:none;padding:0;margin:16px 0 22px;border-top:1px solid rgba(255,255,255,0.08);padding-top:16px;">${featsHtml}</ul>
        <a href="${btnUrl}"${target} style="display:block;text-align:center;padding:12px;border-radius:8px;background:${p.highlight ? 'linear-gradient(135deg, #6366f1, #4f46e5)' : 'rgba(255,255,255,0.1)'};color:#fff;text-decoration:none;font-weight:600;font-size:14px;">${btnLabel} &rarr;</a>
      </div>`;
    }
    case 'stat': {
      const val = escHtml(p.value || '99.9%');
      const label = escHtml(p.label || 'Metric Label');
      const trend = p.trend ? `<span style="font-size:11.5px;padding:2px 8px;border-radius:999px;background:${p.trendType === 'down' ? 'rgba(239,68,68,0.15)' : 'rgba(16,185,129,0.15)'};color:${p.trendType === 'down' ? '#f87171' : '#34d399'};font-weight:600;">${escHtml(p.trend)}</span>` : '';
      const icon = p.icon ? `<div style="font-size:22px;margin-bottom:8px;">${escHtml(p.icon)}</div>` : '';

      return `<div class="cms-stat-card" style="padding:20px;border-radius:12px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.02);margin:12px 0;${customCss}">
        ${icon}
        <div style="font-size:36px;font-weight:800;letter-spacing:-1px;line-height:1.1;margin-bottom:6px;">${val}</div>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="font-size:13.5px;opacity:0.8;font-weight:500;">${label}</span>
          ${trend}
        </div>
      </div>`;
    }
    case 'testimonial': {
      const quote = parseRichTextHtml(p.quote || 'This platform has dramatically accelerated our team workflow.');
      const author = escHtml(p.author || 'Jane Doe');
      const role = escHtml(p.role || 'Product Lead at Acme Corp');
      const avatar = p.avatar ? `<img src="${escHtml(p.avatar)}" alt="${author}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;border:2px solid rgba(255,255,255,0.2);" />` : '';
      const rating = Math.min(5, Math.max(1, Number(p.rating) || 5));
      const stars = '★'.repeat(rating) + '☆'.repeat(5 - rating);

      return `<div class="cms-testimonial-card" style="border-radius:14px;padding:22px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);margin:16px 0;${customCss}">
        <div style="color:#f59e0b;font-size:16px;letter-spacing:2px;margin-bottom:12px;">${stars}</div>
        <p style="font-size:15px;line-height:1.6;font-style:italic;margin:0 0 16px;">&ldquo;${quote}&rdquo;</p>
        <div style="display:flex;align-items:center;gap:12px;">
          ${avatar}
          <div>
            <div style="font-weight:700;font-size:14px;">${author}</div>
            <div style="font-size:12px;opacity:0.75;">${role}</div>
          </div>
        </div>
      </div>`;
    }
    case 'video': {
      const url = p.url || '';
      if (!url) return '';
      const ratio = p.aspectRatio || '16/9';
      const rad = p.borderRadius != null ? Number(p.borderRadius) : 10;
      const caption = p.caption ? `<div style="font-size:12.5px;color:#64748b;margin-top:6px;text-align:center;">${escHtml(p.caption)}</div>` : '';

      let playerHtml = '';
      if (url.includes('youtube.com') || url.includes('youtu.be')) {
        let yId = '';
        const m = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=)([^#&?]*)/);
        if (m && m[1]) yId = m[1];
        playerHtml = `<iframe src="https://www.youtube.com/embed/${escHtml(yId)}" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>`;
      } else if (url.includes('vimeo.com')) {
        const m = url.match(/vimeo\.com\/(?:channels\/(?:\w+\/)?|groups\/([^\/]*)\/videos\/|album\/(\d+)\/video\/|)(\d+)/);
        const vId = m ? m[3] : '';
        playerHtml = `<iframe src="https://player.vimeo.com/video/${escHtml(vId)}" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>`;
      } else {
        playerHtml = `<video src="${escHtml(url)}" controls style="width:100%;height:100%;object-fit:cover;"></video>`;
      }

      return `<div class="cms-video-wrap" style="margin:16px 0;${customCss}">
        <div style="width:100%;aspect-ratio:${ratio};border-radius:${rad}px;overflow:hidden;background:#000;box-shadow:0 8px 24px rgba(0,0,0,0.25);">
          ${playerHtml}
        </div>
        ${caption}
      </div>`;
    }
    case 'code': {
      const code = escHtml(p.code || '// Enter your code snippet here');
      const lang = escHtml(p.language || 'javascript');
      const filename = escHtml(p.filename || 'snippet.js');
      const codeId = 'code_' + Math.random().toString(36).slice(2, 9);

      return `<div id="${codeId}" class="cms-code-block" style="border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#0d1117;color:#c9d1d9;font-family:'JetBrains Mono',monospace;margin:16px 0;overflow:hidden;${customCss}">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 14px;background:rgba(255,255,255,0.04);border-bottom:1px solid rgba(255,255,255,0.08);font-size:12px;">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#ff5f56;"></span>
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#ffbd2e;"></span>
            <span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:#27c93f;"></span>
            <span style="margin-left:8px;opacity:0.8;font-size:11.5px;">${filename}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="opacity:0.6;font-size:11px;text-transform:uppercase;">${lang}</span>
            <button type="button" class="cms-copy-code-btn" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#fff;border-radius:4px;padding:2px 8px;font-size:11px;cursor:pointer;">Copy</button>
          </div>
        </div>
        <pre style="margin:0;padding:16px;overflow-x:auto;font-size:13px;line-height:1.6;"><code>${code}</code></pre>
      </div>`;
    }
    case 'bento': {
      const items = Array.isArray(p.items) ? p.items : [];
      let cardsHtml = '';
      items.forEach((item, idx) => {
        const spanClass = item.span === 2 ? 'grid-column: span 2;' : '';
        const tallClass = item.tall ? 'grid-row: span 2;' : '';
        const bg = item.bg || 'rgba(255,255,255,0.03)';
        const icon = item.icon ? `<div style="font-size:24px;margin-bottom:12px;">${escHtml(item.icon)}</div>` : '';
        const metric = item.metric ? `<div style="font-size:32px;font-weight:800;color:#fff;margin:8px 0;letter-spacing:-0.02em;">${escHtml(item.metric)}</div>` : '';
        const tag = item.tag ? `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#818cf8;background:rgba(99,102,241,0.15);padding:3px 8px;border-radius:999px;border:1px solid rgba(99,102,241,0.3);">${escHtml(item.tag)}</span>` : '';
        const img = item.image ? `<div style="width:100%;height:140px;border-radius:10px;background-image:url('${escHtml(item.image)}');background-size:cover;background-position:center;margin-top:14px;"></div>` : '';

        cardsHtml += `<div class="cms-bento-card" style="background:${bg};border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:24px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 10px 30px rgba(0,0,0,0.25);position:relative;overflow:hidden;${spanClass}${tallClass}">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              ${icon}
              ${tag}
            </div>
            <h4 style="font-size:18px;font-weight:700;color:#fff;margin:0 0 6px 0;">${escHtml(item.title || 'Feature Tile')}</h4>
            <p style="font-size:13.5px;color:#94a3b8;line-height:1.5;margin:0;">${parseRichTextHtml(item.subtitle || '')}</p>
            ${metric}
          </div>
          ${img}
        </div>`;
      });

      return `<div class="cms-bento-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px;margin:24px 0;${customCss}">
        ${cardsHtml}
      </div>`;
    }
    case 'comparison': {
      const beforeImg = escHtml(p.beforeImage || 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop');
      const afterImg = escHtml(p.afterImage || 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800&auto=format&fit=crop');
      const beforeLabel = escHtml(p.beforeLabel || 'Before');
      const afterLabel = escHtml(p.afterLabel || 'After');

      return `<div class="cms-comparison-container" style="position:relative;width:100%;aspect-ratio:16/9;border-radius:16px;overflow:hidden;user-select:none;margin:24px 0;box-shadow:0 16px 40px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);${customCss}">
        <img src="${afterImg}" alt="${afterLabel}" style="position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;" />
        <div style="position:absolute;top:12px;right:16px;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);z-index:2;">${afterLabel}</div>
        <div class="cms-comparison-overlay" style="position:absolute;top:0;left:0;bottom:0;width:50%;overflow:hidden;z-index:3;">
          <img src="${beforeImg}" alt="${beforeLabel}" style="position:absolute;top:0;left:0;height:100%;max-width:none;width:100%;object-fit:cover;" class="cms-before-full-img" />
          <div style="position:absolute;top:12px;left:16px;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);">${beforeLabel}</div>
        </div>
        <div class="cms-comparison-handle" style="position:absolute;top:0;bottom:0;left:50%;width:3px;background:#ffffff;box-shadow:0 0 12px rgba(99,102,241,0.8);z-index:5;cursor:ew-resize;transform:translateX(-50%);">
          <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:36px;height:36px;border-radius:50%;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.5);font-size:14px;font-weight:bold;">⇄</div>
        </div>
      </div>`;
    }
    case 'tilt-card': {
      const title = escHtml(p.title || 'Interactive 3D Card');
      const subtitle = parseRichTextHtml(p.subtitle || 'Move your cursor across this card to experience natural depth and specular reflections.');
      const badge = p.badge ? `<span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#38bdf8;background:rgba(56,189,248,0.15);padding:3px 9px;border-radius:999px;border:1px solid rgba(56,189,248,0.3);">${escHtml(p.badge)}</span>` : '';
      const cta = p.ctaLabel ? `<a href="${escHtml(p.ctaUrl || '#')}" style="display:inline-flex;align-items:center;gap:6px;background:#6366f1;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;margin-top:16px;box-shadow:0 4px 14px rgba(99,102,241,0.4);">${escHtml(p.ctaLabel)} →</a>` : '';

      return `<div class="cms-tilt-wrap" style="perspective:1000px;margin:24px 0;${customCss}">
        <div class="cms-tilt-card" style="position:relative;background:linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01));border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:36px 30px;box-shadow:0 20px 50px rgba(0,0,0,0.5);transform-style:preserve-3d;transition:transform 0.1s ease-out;overflow:hidden;">
          <div class="cms-tilt-glare" style="position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(circle at 50% 50%, rgba(255,255,255,0.15), transparent 70%);opacity:0;pointer-events:none;transition:opacity 0.2s;"></div>
          <div style="transform:translateZ(30px);">
            <div style="margin-bottom:12px;">${badge}</div>
            <h3 style="font-size:22px;font-weight:800;color:#fff;margin:0 0 8px 0;letter-spacing:-0.01em;">${title}</h3>
            <p style="font-size:14.5px;color:#94a3b8;line-height:1.6;margin:0;">${subtitle}</p>
            ${cta}
          </div>
        </div>
      </div>`;
    }
    case 'marquee': {
      let items = (Array.isArray(p.items) && p.items.length > 0) ? p.items : [
        { text: 'TypeScript', icon: '⚡' },
        { text: 'TailwindCSS', icon: '🎨' },
        { text: 'Node.js', icon: '🟢' },
        { text: 'SQLite', icon: '🗄️' },
        { text: 'GraphQL', icon: '◈' },
        { text: 'Next.js', icon: '▲' }
      ];
      items = items.map(it => typeof it === 'string' ? { text: it, icon: '✦' } : it);
      const speed = p.speed === 'fast' ? '14s' : p.speed === 'slow' ? '32s' : '22s';

      let itemsHtml = '';
      items.forEach(it => {
        const icon = it.icon ? `<span style="font-size:16px;">${escHtml(it.icon)}</span>` : '✦';
        itemsHtml += `<div style="display:inline-flex;align-items:center;gap:8px;padding:8px 18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:999px;color:#f1f5f9;font-size:13.5px;font-weight:600;white-space:nowrap;margin-right:14px;flex-shrink:0;user-select:none;">
          ${icon}
          <span>${escHtml(it.text || 'Item')}</span>
        </div>`;
      });

      const halfHtml = `<div style="display:flex;flex-shrink:0;align-items:center;"><div style="display:flex;flex-shrink:0;">${itemsHtml}</div><div style="display:flex;flex-shrink:0;">${itemsHtml}</div></div>`;

      return `<div class="cms-marquee-wrap" style="position:relative;width:100%;overflow:hidden;padding:14px 0;margin:24px 0;mask-image:linear-gradient(to right, transparent, black 10%, black 90%, transparent);-webkit-mask-image:linear-gradient(to right, transparent, black 10%, black 90%, transparent);${customCss}">
        <div class="cms-marquee-track" style="display:flex;width:max-content;flex-shrink:0;will-change:transform;animation:marqueeScroll ${speed} linear infinite;">
          ${halfHtml}
          ${halfHtml}
        </div>
      </div>`;
    }
    case 'countdown': {
      const targetDate = p.targetDate || '2026-12-31T23:59:59';
      const title = escHtml(p.title || 'Next Milestone Launch');
      const subtitle = escHtml(p.subtitle || 'Counting down every second to release');

      return `<div class="cms-countdown-container" data-target="${escHtml(targetDate)}" style="text-align:center;padding:32px 24px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:20px;margin:24px 0;box-shadow:0 14px 40px rgba(0,0,0,0.3);${customCss}">
        <h3 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 6px 0;">${title}</h3>
        <p style="font-size:13px;color:#94a3b8;margin:0 0 20px 0;">${subtitle}</p>
        <div style="display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;">
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:14px 18px;min-width:70px;">
            <div class="cd-val cd-days" style="font-size:32px;font-weight:800;color:#6366f1;line-height:1;">00</div>
            <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-top:4px;">Days</div>
          </div>
          <div style="font-size:24px;font-weight:bold;color:#6366f1;opacity:0.6;">:</div>
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:14px 18px;min-width:70px;">
            <div class="cd-val cd-hours" style="font-size:32px;font-weight:800;color:#6366f1;line-height:1;">00</div>
            <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-top:4px;">Hours</div>
          </div>
          <div style="font-size:24px;font-weight:bold;color:#6366f1;opacity:0.6;">:</div>
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:14px 18px;min-width:70px;">
            <div class="cd-val cd-minutes" style="font-size:32px;font-weight:800;color:#6366f1;line-height:1;">00</div>
            <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-top:4px;">Mins</div>
          </div>
          <div style="font-size:24px;font-weight:bold;color:#6366f1;opacity:0.6;">:</div>
          <div style="background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:14px 18px;min-width:70px;">
            <div class="cd-val cd-seconds" style="font-size:32px;font-weight:800;color:#6366f1;line-height:1;">00</div>
            <div style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-top:4px;">Secs</div>
          </div>
        </div>
      </div>`;
    }
    case 'timeline': {
      const items = Array.isArray(p.items) ? p.items : [];
      let nodesHtml = '';
      items.forEach((item, idx) => {
        const status = item.status || 'upcoming';
        const statusColor = status === 'completed' ? '#10b981' : status === 'current' ? '#6366f1' : '#94a3b8';
        const statusLabel = status === 'completed' ? 'Completed' : status === 'current' ? 'In Progress' : 'Planned';
        const date = item.date ? `<div style="font-size:12px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">${escHtml(item.date)}</div>` : '';

        nodesHtml += `<div style="position:relative;padding-left:36px;margin-bottom:28px;">
          <div style="position:absolute;left:0;top:4px;width:16px;height:16px;border-radius:50%;background:#0d1117;border:3px solid ${statusColor};box-shadow:0 0 10px ${statusColor}66;z-index:2;"></div>
          ${date}
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <h4 style="font-size:16px;font-weight:700;color:#fff;margin:0;">${escHtml(item.title || 'Milestone')}</h4>
            <span style="font-size:10.5px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;">${statusLabel}</span>
          </div>
          <p style="font-size:13.5px;color:#94a3b8;line-height:1.5;margin:0;">${parseRichTextHtml(item.description || '')}</p>
        </div>`;
      });

      return `<div class="cms-timeline-wrap" style="position:relative;padding:10px 0;margin:24px 0;${customCss}">
        <div style="position:absolute;top:10px;bottom:10px;left:7px;width:2px;background:rgba(255,255,255,0.1);z-index:1;"></div>
        ${nodesHtml}
      </div>`;
    }
    case 'form': {
      const title = escHtml(p.title || 'Get in Touch');
      const desc = escHtml(p.description || 'We would love to hear from you. Leave your details below.');
      const btnLabel = escHtml(p.buttonLabel || 'Send Message');

      return `<div class="cms-form-card" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:32px 28px;margin:24px 0;box-shadow:0 16px 40px rgba(0,0,0,0.35);${customCss}">
        <h3 style="font-size:20px;font-weight:800;color:#fff;margin:0 0 6px 0;">${title}</h3>
        <p style="font-size:13.5px;color:#94a3b8;margin:0 0 20px 0;line-height:1.5;">${desc}</p>
        <form class="cms-contact-form" onsubmit="event.preventDefault(); this.querySelector('.form-success-alert').style.display='block'; this.reset();" style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">Your Name</label>
            <input type="text" required placeholder="Alex Mercer" style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 14px;color:#fff;font-size:13.5px;outline:none;" />
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">Email Address</label>
            <input type="email" required placeholder="alex@example.com" style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 14px;color:#fff;font-size:13.5px;outline:none;" />
          </div>
          <div>
            <label style="display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;">Message</label>
            <textarea rows="3" required placeholder="How can we help you?" style="width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 14px;color:#fff;font-size:13.5px;outline:none;resize:vertical;"></textarea>
          </div>
          <button type="submit" style="background:#6366f1;color:#fff;border:none;border-radius:8px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.4);transition:background 0.15s;">${btnLabel}</button>
          <div class="form-success-alert" style="display:none;padding:10px 14px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#34d399;font-size:13px;border-radius:8px;text-align:center;">✓ Thank you! Your message has been received.</div>
        </form>
      </div>`;
    }
    case 'audio': {
      const title = escHtml(p.title || 'Track Title');
      const artist = escHtml(p.artist || 'Podcast Host / Artist');
      const duration = escHtml(p.duration || '04:15');
      const cover = p.cover ? `<img src="${escHtml(p.cover)}" style="width:52px;height:52px;border-radius:10px;object-fit:cover;" />` : `<div style="width:52px;height:52px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#ec4899);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;">🎵</div>`;

      return `<div class="cms-audio-card" style="display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:16px 20px;margin:20px 0;box-shadow:0 10px 30px rgba(0,0,0,0.25);${customCss}">
        ${cover}
        <div style="flex:1;overflow:hidden;">
          <h4 style="font-size:14.5px;font-weight:700;color:#fff;margin:0 0 4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${title}</h4>
          <div style="font-size:12px;color:#94a3b8;">${artist} • <span style="color:#6366f1;">${duration}</span></div>
          <div class="cms-waveform-bar" style="display:flex;align-items:flex-end;gap:3px;height:18px;margin-top:8px;">
            <span style="width:3px;height:40%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:70%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:100%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:50%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:80%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:30%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:90%;background:#6366f1;border-radius:2px;"></span>
            <span style="width:3px;height:60%;background:#6366f1;border-radius:2px;"></span>
          </div>
        </div>
        <button type="button" class="cms-audio-play-btn" style="width:42px;height:42px;border-radius:50%;background:#6366f1;border:none;color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.4);flex-shrink:0;">▶</button>
      </div>`;
    }
    case 'header': {
      const layout = p.layout || 'spread';
      const variant = p.styleVariant || 'glass';
      const isSticky = !!p.sticky;
      const links = Array.isArray(p.links) ? p.links : [];
      const children = Array.isArray(p.children) ? p.children : [];
      const enableCarousel = p.enableCarousel !== false;

      // Subsection 1: Top Announcement Bar
      let topBarHtml = '';
      if (p.showTopBar) {
        const badgeHtml = p.topBarBadge ? `<span class="cms-header-topbar-badge">${escHtml(p.topBarBadge)}</span>` : '';
        topBarHtml = `<div class="cms-header-topbar">${badgeHtml}<a href="${escHtml(p.topBarLink || '#')}" class="cms-header-topbar-link">${escHtml(p.topBarText || '')}</a></div>`;
      }

      // Subsection 2: Main Navigation Bar
      const logoHeightStyle = p.logoHeight ? `height:${p.logoHeight}px;max-height:${p.logoHeight}px;` : '';
      const brandLogo = p.brandLogo
        ? `<img src="${escHtml(p.brandLogo)}" alt="${escHtml(p.brandName || 'Logo')}" class="cms-header-logo-img" style="${logoHeightStyle}" />`
        : (p.brandIcon ? `<span class="cms-header-brand-icon">${escHtml(p.brandIcon)}</span>` : '');
      const brandText = `<span class="cms-header-brand-name">${escHtml(p.brandName || 'Brand')}</span>`;
      const brandHtml = `<a href="${escHtml(p.brandUrl || '#')}" class="cms-header-brand">${brandLogo}${brandText}</a>`;

      let navLinksHtml = '';
      links.forEach(l => {
        navLinksHtml += `<a href="${escHtml(l.url || '#')}" class="cms-header-link">${escHtml(l.label || 'Link')}</a>`;
      });

      let searchHtml = '';
      if (p.showSearch) {
        searchHtml = `<div class="cms-header-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input type="text" class="cms-header-search-input" placeholder="${escHtml(p.searchPlaceholder || 'Search...')}" />
        </div>`;
      }

      let ctaHtml = '';
      if (p.showCta !== false) {
        ctaHtml = `<a href="${escHtml(p.ctaUrl || '#')}" class="cms-header-cta-btn cta-${escHtml(p.ctaVariant || 'filled')}">${escHtml(p.ctaLabel || 'Get Started')}</a>`;
      }

      const burgerHtml = `<button type="button" class="cms-header-burger" aria-label="Toggle Navigation"><span></span><span></span><span></span></button>`;

      const mobileSearchHtml = p.showSearch ? `<div class="cms-header-search mobile"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input type="text" class="cms-header-search-input" placeholder="${escHtml(p.searchPlaceholder || 'Search...')}" /></div>` : '';
      const mobileDrawerHtml = `<div class="cms-header-mobile-drawer">${mobileSearchHtml}${navLinksHtml}${p.showCta !== false ? `<div style="margin-top:6px;">${ctaHtml}</div>` : ''}</div>`;

      // Subsection 3: Component Carousel
      let carouselHtml = '';
      if (enableCarousel && children.length > 0) {
        const itemWidth = p.carouselItemWidth || 'medium';
        const showArrows = p.carouselShowArrows !== false && children.length > 1;
        const showPrevNext = p.carouselShowPrevNext || 'both';
        const showPrev = showArrows && (showPrevNext === 'both' || showPrevNext === 'prev-only');
        const showNext = showArrows && (showPrevNext === 'both' || showPrevNext === 'next-only');
        const arrowStyle = p.carouselArrowStyle || 'circle';
        const arrowBehavior = p.carouselArrowBehavior || 'smooth';
        const showDots = p.carouselShowDots !== false && children.length > 1;
        const dotStyle = p.carouselDotStyle || 'bars';
        const dotBehavior = p.carouselDotBehavior || 'smooth';
        const showSlideCounter = p.showSlideCounter !== false;
        const autoplay = p.carouselAutoplay ? 'true' : 'false';
        const interval = p.carouselInterval || 4;

        let slidesHtml = '';
        children.forEach(child => {
          slidesHtml += `<div class="cms-header-carousel-slide slide-width-${itemWidth}">${renderBlockHtml(child)}</div>`;
        });

        const prevArrowHtml = showPrev ? `<button type="button" class="cms-header-carousel-arrow prev arrow-style-${escHtml(arrowStyle)}" aria-label="Previous Slide"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg></button>` : '';
        const nextArrowHtml = showNext ? `<button type="button" class="cms-header-carousel-arrow next arrow-style-${escHtml(arrowStyle)}" aria-label="Next Slide"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></button>` : '';

        let dotsHtml = '';
        if (showDots) {
          dotsHtml = `<div class="cms-header-carousel-dots dot-style-${escHtml(dotStyle)}">${children.map((_, idx) => `<button type="button" class="cms-header-carousel-dot${idx === 0 ? ' active' : ''}" data-index="${idx}" aria-label="Slide ${idx + 1}">${dotStyle === 'numbers' ? `<span>${idx + 1}</span>` : ''}</button>`).join('')}</div>`;
        }

        let counterHtml = '';
        if (showSlideCounter) {
          const totalStr = String(children.length).padStart(2, '0');
          counterHtml = `<div class="cms-header-carousel-counter">01 / ${totalStr}</div>`;
        }

        let controlsBarHtml = '';
        if (dotsHtml || counterHtml) {
          controlsBarHtml = `<div class="cms-header-carousel-controls">${dotsHtml}${counterHtml}</div>`;
        }

        carouselHtml = `<div class="cms-header-carousel-wrapper" data-autoplay="${autoplay}" data-interval="${interval}" data-arrow-behavior="${escHtml(arrowBehavior)}" data-dot-behavior="${escHtml(dotBehavior)}">
          ${prevArrowHtml}
          <div class="cms-header-carousel-viewport">
            <div class="cms-header-carousel-track">
              ${slidesHtml}
            </div>
          </div>
          ${nextArrowHtml}
          ${controlsBarHtml}
        </div>`;
      }

      return `<header class="cms-header-block layout-${layout} variant-${variant}${isSticky ? ' is-sticky' : ''}" style="${customCss}">
        ${topBarHtml}
        <div class="cms-header-inner">
          ${brandHtml}
          <nav class="cms-header-nav">${navLinksHtml}</nav>
          <div class="cms-header-actions">${searchHtml}${ctaHtml}${burgerHtml}</div>
        </div>
        ${mobileDrawerHtml}
        ${carouselHtml}
      </header>`;
    }
    case 'footer': {
      const variant = p.styleVariant || 'dark';
      const brandIcon = p.brandIcon ? `<span class="cms-footer-brand-icon">${escHtml(p.brandIcon)}</span>` : '';
      const brandHtml = `<div class="cms-footer-brand">
          <div class="cms-footer-brand-name">${brandIcon}<span class="cms-footer-brand-title">${escHtml(p.brandName || 'Brand')}</span></div>
          ${p.tagline ? `<div class="cms-footer-tagline">${escHtml(p.tagline)}</div>` : ''}
        </div>`;

      let colsHtml = '';
      if (p.showColumns !== false && Array.isArray(p.columns)) {
        colsHtml = `<div class="cms-footer-cols" style="grid-template-columns:repeat(${Math.min(p.columns.length, 4)}, minmax(0, 1fr));">${p.columns.map(col => `
            <div class="cms-footer-col">
              <div class="cms-footer-col-title">${escHtml(col.title || '')}</div>
              <ul class="cms-footer-col-links">${(col.links || []).map(l => `<li><a class="cms-footer-link" href="${escHtml(l.url || '#')}">${escHtml(l.label || '')}</a></li>`).join('')}</ul>
            </div>`).join('')}</div>`;
      }

      let newsletterHtml = '';
      if (p.showNewsletter !== false) {
        newsletterHtml = `<div class="cms-footer-newsletter">
            <div class="cms-footer-newsletter-info">
              ${p.newsletterTitle ? `<div class="cms-footer-newsletter-title">${escHtml(p.newsletterTitle)}</div>` : ''}
              ${p.newsletterText ? `<div class="cms-footer-newsletter-text">${escHtml(p.newsletterText)}</div>` : ''}
            </div>
            <form class="cms-footer-newsletter-form" onsubmit="return false;">
              <input class="cms-footer-newsletter-input" type="email" placeholder="${escHtml(p.newsletterPlaceholder || 'Your email address')}" />
              <button class="cms-footer-newsletter-btn" type="button">${escHtml(p.newsletterButton || 'Subscribe')}</button>
            </form>
          </div>`;
      }

      let socialHtml = '';
      if (p.showSocial !== false && Array.isArray(p.social)) {
        const icons = p.social.filter(s => s && s.platform && s.platform !== 'none');
        if (icons.length) {
          socialHtml = `<div class="cms-footer-social">${icons.map(s => `<a class="cms-footer-social-link" href="${escHtml(s.url || '#')}" title="${escHtml(s.platform)}" target="_blank" rel="noopener noreferrer">${footerSocialSvgHtml(s.platform)}</a>`).join('')}</div>`;
        }
      }

      let bottomLinksHtml = '';
      if (Array.isArray(p.bottomLinks) && p.bottomLinks.length) {
        bottomLinksHtml = `<div class="cms-footer-bottom-links">${p.bottomLinks.map(l => `<a class="cms-footer-link" href="${escHtml(l.url || '#')}">${escHtml(l.label || '')}</a>`).join('')}</div>`;
      }

      return `<footer class="cms-footer-block variant-${variant}" style="${customCss}">
        <div class="cms-footer-top">${brandHtml}${colsHtml}</div>
        ${newsletterHtml}
        <div class="cms-footer-bottom">
          ${socialHtml}
          <div class="cms-footer-copyright">${escHtml(p.copyright || '© 2026. All rights reserved.')}</div>
          ${bottomLinksHtml}
        </div>
      </footer>`;
    }
    default:
      return '';
  }
}

function footerSocialSvgHtml(platform) {
  const icons = {
    twitter: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
    github: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.73.5.5 5.73.5 12a11.5 11.5 0 0 0 7.86 10.9c.58.11.79-.25.79-.56v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.66.41.35.77 1.05.77 2.12v3.15c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>',
    linkedin: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.45 20.45h-3.55v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.12 2.06 2.06 0 0 1 0 4.12zM7.12 20.45H3.56V9h3.56zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>',
    facebook: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.7 4.53-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.95.93-1.95 1.89v2.26h3.32l-.53 3.49h-2.79V24C19.61 23.09 24 18.1 24 12.07z"/></svg>',
    instagram: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect width="20" height="20" x="2" y="2" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>',
    youtube: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3.02 3.02 0 0 0 .5 6.19 31.6 31.6 0 0 0 0 12a31.6 31.6 0 0 0 .5 5.81 3.02 3.02 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3.02 3.02 0 0 0 2.12-2.14A31.6 31.6 0 0 0 24 12a31.6 31.6 0 0 0-.5-5.81zM9.55 15.57V8.43L15.82 12z"/></svg>'
  };
  const fallback = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/></svg>';
  return icons[platform] || fallback;
}

function renderPublishedPage(page, blocks, tags) {
  let settings = {};
  try {
    settings = typeof page.settings === 'object' && page.settings !== null
      ? page.settings
      : JSON.parse(page.settings || '{}');
  } catch (_) { settings = {}; }

  const maxWidth = settings.maxWidth || '760px';
  const minWidth = settings.minWidth || '0px';
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

  const blockList = Array.isArray(blocks) ? blocks : [];
  const headerBlocks = [];
  const footerBlocks = [];
  const contentBlocks = [];
  for (const b of blockList) {
    if (b.type === 'header' && headerBlocks.length === 0) headerBlocks.push(b);
    else if (b.type === 'footer' && footerBlocks.length === 0) footerBlocks.push(b);
    else contentBlocks.push(b);
  }
  const headerHtml = headerBlocks.map(renderBlockHtml).join('\n');
  const contentHtml = contentBlocks.map(renderBlockHtml).join('\n');
  const footerHtml = footerBlocks.map(renderBlockHtml).join('\n');
  const tagsHtml = tags.length ? `<div class="tags">${tags.map(t => `<span>${escHtml(t)}</span>`).join('')}</div>` : '';
  const body = `${headerHtml}
  <main class="cms-page-main">${contentHtml}${tagsHtml}</main>
  ${footerHtml}`;
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
  <link rel="stylesheet" href="/style.css" />
  <style>
    html {
      height: auto !important;
      min-height: 100vh !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
    }
    body { font-family: ${fontFamily}; background: ${pageBg}; color: ${textColor}; margin: 0; min-height: 100vh; overflow: visible; display: block; }
    .wrap { max-width: ${maxWidth}; min-width: ${minWidth}; margin: ${alignMargin}; padding: ${paddingY} ${paddingX}; border-radius: ${borderRadius}; background: ${cardBg}; min-height: 100vh; box-sizing: border-box; box-shadow: 0 0 0 1px ${borderColor}; display: flex; flex-direction: column; }
    .cms-page-main { flex: 1 1 auto; min-width: 0; width: 100%; box-sizing: border-box; }
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

    /* Infinite Marquee Styles */
    .cms-marquee-wrap {
      position: relative;
      width: 100%;
      overflow: hidden;
      padding: 14px 0;
      margin: 24px 0;
      mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
      -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
    }
    .cms-marquee-track {
      display: flex;
      width: max-content;
      will-change: transform;
      animation: marqueeScroll 22s linear infinite;
    }
    @keyframes marqueeScroll {
      0% { transform: translate3d(0, 0, 0); }
      100% { transform: translate3d(-50%, 0, 0); }
    }

    /* Custom Header / Navbar */
    .cms-header-block {
      width: 100%;
      box-sizing: border-box;
      margin: 10px 0 20px;
      position: relative;
      border-radius: 14px;
      transition: all 0.25s ease;
    }
    .cms-header-block.variant-glass {
      background: rgba(15, 23, 42, 0.72);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.09);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .cms-header-block.variant-solid {
      background: #1a2234;
      border: 1px solid rgba(255, 255, 255, 0.08);
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2);
    }
    .cms-header-block.variant-transparent {
      background: transparent;
      border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    }
    .cms-header-block.variant-bordered {
      background: rgba(0, 0, 0, 0.25);
      border: 1.5px solid rgba(255, 255, 255, 0.14);
    }
    .cms-header-block.layout-spread .cms-header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 24px;
    }
    .cms-header-block.layout-centered .cms-header-inner {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 18px 24px;
    }
    .cms-header-block.layout-floating {
      border-radius: 999px;
      max-width: 96%;
      margin: 12px auto 24px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.35);
    }
    .cms-header-block.layout-floating .cms-header-inner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 24px;
    }
    .cms-header-block.is-sticky {
      position: sticky;
      top: 12px;
      z-index: 100;
    }
    .cms-header-brand {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      text-decoration: none;
      color: #ffffff;
      font-weight: 700;
      font-size: 17px;
      letter-spacing: -0.02em;
    }
    .cms-header-logo-img {
      max-height: 32px;
      width: auto;
      border-radius: 6px;
    }
    .cms-header-brand-icon {
      font-size: 20px;
      color: #818cf8;
      text-shadow: 0 0 12px rgba(129, 140, 248, 0.5);
    }
    .cms-header-nav {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .cms-header-link {
      font-size: 13.5px;
      font-weight: 600;
      color: #cbd5e1;
      text-decoration: none;
      padding: 7px 14px;
      border-radius: 999px;
      transition: all 0.15s ease;
    }
    .cms-header-link:hover {
      color: #ffffff;
      background: rgba(255, 255, 255, 0.08);
    }
    .cms-header-actions {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .cms-header-cta-btn {
      font-size: 13px;
      font-weight: 600;
      padding: 8px 18px;
      border-radius: 999px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      transition: all 0.2s ease;
    }
    .cms-header-cta-btn.cta-filled {
      background: linear-gradient(135deg, #6366f1, #8b5cf6);
      color: #ffffff;
      box-shadow: 0 4px 14px rgba(99, 102, 241, 0.4);
    }
    .cms-header-cta-btn.cta-outline {
      background: transparent;
      color: #c7d2fe;
      border: 1.5px solid #6366f1;
    }
    .cms-header-cta-btn.cta-glow {
      background: #6366f1;
      color: #ffffff;
      box-shadow: 0 0 20px rgba(99, 102, 241, 0.6);
    }
    .cms-header-burger {
      display: none;
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 6px;
      flex-direction: column;
      justify-content: space-around;
      width: 28px;
      height: 26px;
    }
    .cms-header-burger span {
      width: 100%;
      height: 2px;
      background: #ffffff;
      border-radius: 2px;
      transition: all 0.25s ease;
    }
    .cms-header-burger.is-active span:nth-child(1) { transform: translateY(7px) rotate(45deg); }
    .cms-header-burger.is-active span:nth-child(2) { opacity: 0; }
    .cms-header-burger.is-active span:nth-child(3) { transform: translateY(-7px) rotate(-45deg); }
    .cms-header-mobile-drawer {
      display: none;
      width: 100%;
      box-sizing: border-box;
      padding: 16px 24px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      flex-direction: column;
      gap: 12px;
    }
    .cms-header-mobile-drawer.is-open { display: flex; }
    @media (max-width: 768px) {
      .cms-header-nav { display: none; }
      .cms-header-burger { display: flex; }
      .cms-header-block.layout-centered .cms-header-inner {
        flex-direction: row;
        justify-content: space-between;
      }
    }

    /* Subsections: Top Announcement Bar */
    .cms-header-topbar {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 16px;
      font-size: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 10px;
      background: linear-gradient(90deg, rgba(99, 102, 241, 0.15), rgba(168, 85, 247, 0.15));
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      text-align: center;
    }
    .cms-header-topbar-badge {
      display: inline-block;
      padding: 2px 7px;
      font-size: 10px;
      font-weight: 700;
      letter-spacing: 0.5px;
      border-radius: 20px;
      background: #6366f1;
      color: #ffffff;
      text-transform: uppercase;
    }
    .cms-header-topbar-link {
      color: rgba(255, 255, 255, 0.9);
      text-decoration: none;
      font-weight: 500;
      transition: color 0.15s ease;
    }
    .cms-header-topbar-link:hover {
      color: #ffffff;
      text-decoration: underline;
    }

    /* Interactive Search Bar */
    .cms-header-search {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 20px;
      color: rgba(255, 255, 255, 0.7);
      transition: all 0.2s ease;
    }
    .cms-header-search:focus-within {
      background: rgba(255, 255, 255, 0.09);
      border-color: #6366f1;
      box-shadow: 0 0 12px rgba(99, 102, 241, 0.35);
      color: #ffffff;
    }
    .cms-header-search-input {
      background: transparent;
      border: none;
      outline: none;
      color: inherit;
      font-size: 12.5px;
      width: 130px;
      transition: width 0.2s ease;
    }
    .cms-header-search:focus-within .cms-header-search-input {
      width: 170px;
    }
    .cms-header-search.mobile {
      width: 100%;
      box-sizing: border-box;
      margin-bottom: 6px;
    }
    .cms-header-search.mobile .cms-header-search-input {
      width: 100%;
    }

    /* Custom Header Carousel */
    .cms-header-carousel-wrapper {
      position: relative;
      width: 100%;
      box-sizing: border-box;
      padding: 6px 14px 14px;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .cms-header-carousel-viewport {
      position: relative;
      width: 100%;
      overflow: hidden;
      border-radius: 10px;
    }
    .cms-header-carousel-track {
      display: flex;
      align-items: stretch;
      gap: 14px;
      overflow-x: auto;
      scroll-behavior: smooth;
      scroll-snap-type: x mandatory;
      padding: 6px 4px 10px;
      box-sizing: border-box;
      width: 100%;
      scrollbar-width: thin;
      user-select: none;
    }
    .cms-header-carousel-slide {
      flex-shrink: 0;
      scroll-snap-align: start;
      box-sizing: border-box;
    }
    .cms-header-carousel-slide.slide-width-compact { width: 220px; min-width: 220px; }
    .cms-header-carousel-slide.slide-width-medium { width: 320px; min-width: 320px; }
    .cms-header-carousel-slide.slide-width-wide { width: 440px; min-width: 440px; }
    .cms-header-carousel-slide.slide-width-full { width: 100%; min-width: 100%; }
    .cms-header-carousel-slide.slide-width-auto { width: auto; max-width: 440px; }

    /* Navigation Arrow Buttons & Variants */
    .cms-header-carousel-arrow {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      z-index: 100 !important;
      pointer-events: auto !important;
      width: 34px;
      height: 34px;
      border-radius: 50%;
      background: rgba(15, 23, 42, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(255, 255, 255, 0.22);
      color: #ffffff;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer !important;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
      transition: all 0.15s ease;
    }
    .cms-header-carousel-arrow:hover {
      background: #6366f1;
      transform: translateY(-50%) scale(1.1);
      box-shadow: 0 0 16px rgba(99, 102, 241, 0.5);
    }
    .cms-header-carousel-arrow.prev { left: 6px; }
    .cms-header-carousel-arrow.next { right: 6px; }

    .cms-header-carousel-arrow.arrow-style-square {
      border-radius: 8px;
    }
    .cms-header-carousel-arrow.arrow-style-pill {
      width: 38px;
      border-radius: 20px;
    }
    .cms-header-carousel-arrow.arrow-style-ghost {
      background: transparent;
      border-color: rgba(255, 255, 255, 0.28);
      box-shadow: none;
    }
    .cms-header-carousel-arrow.arrow-style-glow {
      box-shadow: 0 0 14px rgba(99, 102, 241, 0.6);
      border-color: #818cf8;
    }

    /* Carousel Presentation Layouts: fullscreen, stack, vertical */
    .cms-header-carousel-track.layout-fullscreen .cms-header-carousel-slide {
      width: 100% !important;
      min-width: 100% !important;
      max-width: 100% !important;
      scroll-snap-align: center;
    }

    .cms-header-carousel-track.layout-stack {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 16px;
    }

    .cms-header-carousel-track.layout-vertical {
      flex-direction: column !important;
      overflow-x: hidden !important;
      overflow-y: auto !important;
      max-height: 240px;
      scroll-snap-type: y mandatory !important;
    }

    .cms-header-carousel-track.layout-vertical .cms-header-carousel-slide {
      width: 100% !important;
      min-width: 100% !important;
      scroll-snap-align: start;
    }

    /* Carousel Controls Bar (Dots & Slide Counter) */
    .cms-header-carousel-controls {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 14px;
      margin-top: 8px;
      width: 100%;
      position: relative;
      z-index: 50 !important;
      pointer-events: auto !important;
    }

    .cms-header-carousel-counter {
      font-size: 11px;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      color: rgba(255, 255, 255, 0.7);
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      padding: 2px 8px;
      border-radius: 12px;
      letter-spacing: 0.5px;
    }

    /* Pagination Dots & Style Variants */
    .cms-header-carousel-dots {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .cms-header-carousel-dot {
      background: rgba(255, 255, 255, 0.2);
      border: none;
      cursor: pointer;
      padding: 0;
      transition: all 0.2s ease;
      color: rgba(255, 255, 255, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .cms-header-carousel-dot:hover {
      background: rgba(255, 255, 255, 0.4);
    }

    /* Dot style: bars (default) */
    .cms-header-carousel-dots.dot-style-bars .cms-header-carousel-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }
    .cms-header-carousel-dots.dot-style-bars .cms-header-carousel-dot.active {
      width: 18px;
      border-radius: 4px;
      background: #6366f1;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
    }

    /* Dot style: dots */
    .cms-header-carousel-dots.dot-style-dots .cms-header-carousel-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
    }
    .cms-header-carousel-dots.dot-style-dots .cms-header-carousel-dot.active {
      background: #6366f1;
      transform: scale(1.3);
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
    }

    /* Dot style: numbers */
    .cms-header-carousel-dots.dot-style-numbers .cms-header-carousel-dot {
      width: 20px;
      height: 20px;
      border-radius: 50%;
      font-size: 10px;
      font-weight: 700;
    }
    .cms-header-carousel-dots.dot-style-numbers .cms-header-carousel-dot.active {
      background: #6366f1;
      color: #ffffff;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
    }

    /* Dot style: lines */
    .cms-header-carousel-dots.dot-style-lines .cms-header-carousel-dot {
      width: 16px;
      height: 3px;
      border-radius: 2px;
    }
    .cms-header-carousel-dots.dot-style-lines .cms-header-carousel-dot.active {
      background: #6366f1;
      width: 24px;
      box-shadow: 0 0 8px rgba(99, 102, 241, 0.6);
    }

    /* Custom Footer / Site Bottom */
    .cms-footer-block {
      width: 100%;
      box-sizing: border-box;
      margin: 24px 0 0;
      border-radius: 14px;
      padding: 28px 24px 18px;
      font-size: 14px;
      line-height: 1.6;
      transition: all 0.25s ease;
    }
    .cms-footer-block.variant-dark {
      background: #0b1220;
      border: 1px solid rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.82);
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
    }
    .cms-footer-block.variant-light {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      color: #334155;
    }
    .cms-footer-block.variant-transparent {
      background: transparent;
      border-top: 1px solid rgba(255, 255, 255, 0.07);
      color: rgba(255, 255, 255, 0.75);
    }
    .cms-footer-top {
      display: flex;
      gap: 32px;
      flex-wrap: wrap;
      justify-content: space-between;
    }
    .cms-footer-brand {
      min-width: 220px;
      flex: 1;
    }
    .cms-footer-brand-name {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 17px;
      font-weight: 800;
      color: #ffffff;
    }
    .cms-footer-block.variant-light .cms-footer-brand-name { color: #0f172a; }
    .cms-footer-block.variant-transparent .cms-footer-brand-name { color: #ffffff; }
    .cms-footer-brand-icon { font-size: 18px; line-height: 1; }
    .cms-footer-tagline {
      margin-top: 8px;
      font-size: 13px;
      color: rgba(255, 255, 255, 0.55);
      max-width: 300px;
    }
    .cms-footer-block.variant-light .cms-footer-tagline { color: #64748b; }
    .cms-footer-block.variant-transparent .cms-footer-tagline { color: rgba(255, 255, 255, 0.55); }
    .cms-footer-cols {
      display: grid;
      gap: 28px;
      flex: 2;
    }
    .cms-footer-col { min-width: 120px; }
    .cms-footer-col-title {
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: rgba(255, 255, 255, 0.55);
      margin-bottom: 10px;
    }
    .cms-footer-block.variant-light .cms-footer-col-title { color: #64748b; }
    .cms-footer-col-links {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 7px;
    }
    .cms-footer-col-links li { margin: 0; }
    .cms-footer-link {
      color: rgba(255, 255, 255, 0.7);
      text-decoration: none;
      font-size: 13px;
      transition: color 0.15s ease;
    }
    .cms-footer-link:hover { color: #6366f1; text-decoration: underline; }
    .cms-footer-block.variant-light .cms-footer-link { color: #475569; }
    .cms-footer-newsletter {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 22px;
      padding: 14px 16px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }
    .cms-footer-block.variant-light .cms-footer-newsletter {
      background: #ffffff;
      border-color: #e2e8f0;
    }
    .cms-footer-newsletter-info { min-width: 220px; flex: 1; }
    .cms-footer-newsletter-title { font-weight: 700; font-size: 15px; color: #ffffff; }
    .cms-footer-block.variant-light .cms-footer-newsletter-title { color: #0f172a; }
    .cms-footer-newsletter-text { font-size: 12.5px; color: rgba(255, 255, 255, 0.5); }
    .cms-footer-block.variant-light .cms-footer-newsletter-text { color: #64748b; }
    .cms-footer-newsletter-form { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
    .cms-footer-newsletter-input {
      padding: 9px 12px;
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.14);
      background: rgba(255, 255, 255, 0.06);
      color: #ffffff;
      font-size: 13px;
      min-width: 200px;
      outline: none;
    }
    .cms-footer-block.variant-light .cms-footer-newsletter-input {
      border-color: #e2e8f0;
      background: #f8fafc;
      color: #0f172a;
    }
    .cms-footer-newsletter-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.2); }
    .cms-footer-newsletter-btn {
      padding: 9px 16px;
      border-radius: 8px;
      border: none;
      background: #6366f1;
      color: #ffffff;
      font-size: 13px;
      font-weight: 700;
      cursor: pointer;
      transition: background 0.15s ease;
    }
    .cms-footer-newsletter-btn:hover { background: #4f46e5; }
    .cms-footer-bottom {
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 12.5px;
    }
    .cms-footer-block.variant-light .cms-footer-bottom { border-top-color: #e2e8f0; }
    .cms-footer-copyright { color: rgba(255, 255, 255, 0.5); flex: 1; }
    .cms-footer-block.variant-light .cms-footer-copyright { color: #64748b; }
    .cms-footer-bottom-links { display: flex; gap: 14px; }
    .cms-footer-social { display: flex; gap: 8px; }
    .cms-footer-social-link {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
      transition: all 0.15s ease;
    }
    .cms-footer-social-link:hover {
      background: #6366f1;
      border-color: #6366f1;
      color: #ffffff;
      transform: translateY(-2px);
    }
    .cms-footer-block.variant-light .cms-footer-social-link {
      background: #f1f5f9;
      border-color: #e2e8f0;
      color: #475569;
    }

    @media (max-width: 768px) {
      [style*="background-attachment:fixed"],
      [style*="background-attachment: fixed"] {
        background-attachment: scroll !important;
      }
      .wrap {
        min-width: 0 !important;
        max-width: 100% !important;
        padding: 16px 14px !important;
        margin: 0 auto !important;
        border-radius: 0 !important;
      }
      .cms-container[style*="grid-template-columns"] {
        display: flex !important;
        flex-direction: column !important;
        grid-template-columns: 1fr !important;
        gap: 12px !important;
        padding: 12px 10px !important;
      }
      .cms-container[style*="flex-direction"] {
        flex-direction: column !important;
        align-items: stretch !important;
        gap: 12px !important;
        padding: 12px 10px !important;
      }
      .cms-bento-grid {
        display: flex !important;
        flex-direction: column !important;
        grid-template-columns: 1fr !important;
        gap: 12px !important;
      }
      .cms-bento-card {
        grid-column: span 1 !important;
        grid-row: auto !important;
        width: 100% !important;
        padding: 18px 16px !important;
      }
      .cms-footer-cols {
        grid-template-columns: 1fr !important;
        gap: 16px !important;
      }
      .cms-footer-top {
        flex-direction: column !important;
        gap: 16px !important;
      }
      .cms-footer-newsletter-form {
        flex-direction: column !important;
        width: 100% !important;
        gap: 8px !important;
      }
      .cms-footer-newsletter-input {
        width: 100% !important;
        min-width: 0 !important;
      }
      .cms-footer-newsletter-btn {
        width: 100% !important;
      }
      .cms-footer-bottom {
        flex-direction: column !important;
        align-items: flex-start !important;
        gap: 12px !important;
      }
    }
  </style>
</head>
<body>
  ${draftBanner}
  <div class="wrap">
    ${body}
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

    // Accordion expand/collapse
    document.querySelectorAll('.cms-accordion-trigger').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = btn.nextElementSibling;
        const arrow = btn.querySelector('.cms-accordion-arrow');
        const isClosed = panel.style.display === 'none';
        panel.style.display = isClosed ? 'block' : 'none';
        if (arrow) arrow.style.transform = isClosed ? 'rotate(180deg)' : 'rotate(0deg)';
      });
    });

    // Tab switcher
    document.querySelectorAll('.cms-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const wrap = btn.closest('.cms-tabs-wrap');
        const targetId = btn.dataset.target;
        if (!wrap || !targetId) return;
        wrap.querySelectorAll('.cms-tab-btn').forEach(b => {
          b.classList.remove('active');
          if (b.style.borderBottomColor) b.style.borderBottomColor = 'transparent';
          else b.style.background = 'rgba(255,255,255,0.06)';
        });
        btn.classList.add('active');
        if (btn.style.borderBottomColor) btn.style.borderBottomColor = '#6366f1';
        else btn.style.background = '#6366f1';
        wrap.querySelectorAll('.cms-tab-pane').forEach(p => {
          p.style.display = p.id === targetId ? 'block' : 'none';
        });
      });
    });

    // Code copy to clipboard
    document.querySelectorAll('.cms-copy-code-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const codeEl = btn.closest('.cms-code-block').querySelector('code');
        if (codeEl) {
          navigator.clipboard.writeText(codeEl.innerText).then(() => {
            const orig = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = orig, 1800);
          });
        }
      });
    });

    // Before/After comparison slider
    document.querySelectorAll('.cms-comparison-container').forEach(container => {
      const overlay = container.querySelector('.cms-comparison-overlay');
      const handle = container.querySelector('.cms-comparison-handle');
      const beforeImg = container.querySelector('.cms-before-full-img');
      if (!overlay || !handle) return;

      const updateWidth = () => {
        if (beforeImg) beforeImg.style.width = container.offsetWidth + 'px';
      };
      window.addEventListener('resize', updateWidth);
      updateWidth();

      let isDown = false;
      const setPos = (clientX) => {
        const rect = container.getBoundingClientRect();
        let pct = ((clientX - rect.left) / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        overlay.style.width = pct + '%';
        handle.style.left = pct + '%';
      };

      container.addEventListener('mousedown', (e) => { isDown = true; setPos(e.clientX); });
      window.addEventListener('mouseup', () => { isDown = false; });
      window.addEventListener('mousemove', (e) => { if (isDown) setPos(e.clientX); });
      container.addEventListener('touchstart', (e) => { isDown = true; setPos(e.touches[0].clientX); }, { passive: true });
      window.addEventListener('touchend', () => { isDown = false; });
      window.addEventListener('touchmove', (e) => { if (isDown) setPos(e.touches[0].clientX); }, { passive: true });
    });

    // 3D Tilt Card interaction
    document.querySelectorAll('.cms-tilt-wrap').forEach(wrap => {
      const card = wrap.querySelector('.cms-tilt-card');
      const glare = wrap.querySelector('.cms-tilt-glare');
      if (!card) return;

      wrap.addEventListener('mousemove', e => {
        const rect = wrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const rotX = ((y - cy) / cy) * -12;
        const rotY = ((x - cx) / cx) * 12;
        card.style.transform = 'rotateX(' + rotX + 'deg) rotateY(' + rotY + 'deg) scale3d(1.02, 1.02, 1.02)';
        if (glare) {
          glare.style.opacity = '1';
          glare.style.background = 'radial-gradient(circle at ' + x + 'px ' + y + 'px, rgba(255,255,255,0.22), transparent 60%)';
        }
      });
      wrap.addEventListener('mouseleave', () => {
        card.style.transform = 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
        if (glare) glare.style.opacity = '0';
      });
    });

    // Live Countdown Timer
    document.querySelectorAll('.cms-countdown-container').forEach(cnt => {
      const targetStr = cnt.dataset.target;
      if (!targetStr) return;
      const target = new Date(targetStr).getTime();
      const daysEl = cnt.querySelector('.cd-days');
      const hoursEl = cnt.querySelector('.cd-hours');
      const minsEl = cnt.querySelector('.cd-minutes');
      const secsEl = cnt.querySelector('.cd-seconds');

      const updateCountdown = () => {
        const now = Date.now();
        const diff = Math.max(0, target - now);
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / (1000 * 60)) % 60);
        const s = Math.floor((diff / 1000) % 60);

        if (daysEl) daysEl.textContent = String(d).padStart(2, '0');
        if (hoursEl) hoursEl.textContent = String(h).padStart(2, '0');
        if (minsEl) minsEl.textContent = String(m).padStart(2, '0');
        if (secsEl) secsEl.textContent = String(s).padStart(2, '0');
      };
      updateCountdown();
      setInterval(updateCountdown, 1000);
    });

    // Audio Player play/pause toggle
    document.querySelectorAll('.cms-audio-card').forEach(card => {
      const btn = card.querySelector('.cms-audio-play-btn');
      const bars = card.querySelectorAll('.cms-waveform-bar span');
      let playing = false;
      if (btn) {
        btn.addEventListener('click', () => {
          playing = !playing;
          btn.textContent = playing ? '❚❚' : '▶';
          btn.style.background = playing ? '#ec4899' : '#6366f1';
          bars.forEach((b, i) => {
            b.style.animation = playing ? 'wave 0.6s ease-in-out infinite alternate ' + (i * 0.1) + 's' : 'none';
          });
        });
      }
    });

    // Custom Header mobile menu toggle
    document.querySelectorAll('.cms-header-block').forEach(header => {
      const burger = header.querySelector('.cms-header-burger');
      const drawer = header.querySelector('.cms-header-mobile-drawer');
      if (burger && drawer) {
        burger.addEventListener('click', () => {
          burger.classList.toggle('is-active');
          drawer.classList.toggle('is-open');
        });
      }
    });

    // Custom Header Carousel scrolling & autoplay
    document.querySelectorAll('.cms-header-carousel-wrapper').forEach(wrapper => {
      const track = wrapper.querySelector('.cms-header-carousel-track');
      const prev = wrapper.querySelector('.cms-header-carousel-arrow.prev');
      const next = wrapper.querySelector('.cms-header-carousel-arrow.next');
      const dots = wrapper.querySelectorAll('.cms-header-carousel-dot');
      const counter = wrapper.querySelector('.cms-header-carousel-counter');
      if (!track) return;

      const getSlideWidth = () => {
        const slide = track.querySelector('.cms-header-carousel-slide');
        return slide ? (slide.offsetWidth + 14) : 320;
      };

      const arrowBehavior = wrapper.dataset.arrowBehavior || 'smooth';
      const dotBehavior = wrapper.dataset.dotBehavior || 'smooth';

      if (prev) {
        prev.addEventListener('click', () => {
          if (arrowBehavior === 'loop' && track.scrollLeft <= 5) {
            track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
          } else {
            track.scrollBy({ left: -getSlideWidth(), behavior: 'smooth' });
          }
        });
      }
      if (next) {
        next.addEventListener('click', () => {
          if (arrowBehavior === 'loop' && (track.scrollLeft + track.clientWidth >= track.scrollWidth - 10)) {
            track.scrollTo({ left: 0, behavior: 'smooth' });
          } else {
            track.scrollBy({ left: getSlideWidth(), behavior: 'smooth' });
          }
        });
      }

      dots.forEach((d, idx) => {
        d.addEventListener('click', () => {
          const slides = track.querySelectorAll('.cms-header-carousel-slide');
          if (slides[idx]) {
            slides[idx].scrollIntoView({ behavior: dotBehavior === 'instant' ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
          }
        });
      });

      track.addEventListener('scroll', () => {
        const slides = Array.from(track.querySelectorAll('.cms-header-carousel-slide'));
        if (!slides.length) return;
        const tRect = track.getBoundingClientRect();
        let closestIdx = 0;
        let minDiff = Infinity;
        slides.forEach((s, idx) => {
          const sRect = s.getBoundingClientRect();
          const diff = Math.abs((sRect.left + sRect.width / 2) - (tRect.left + tRect.width / 2));
          if (diff < minDiff) {
            minDiff = diff;
            closestIdx = idx;
          }
        });
        if (dots.length) {
          dots.forEach((d, idx) => d.classList.toggle('active', idx === closestIdx));
        }
        if (counter) {
          const curStr = String(closestIdx + 1).padStart(2, '0');
          const totalStr = String(slides.length).padStart(2, '0');
          counter.textContent = curStr + ' / ' + totalStr;
        }
      }, { passive: true });

      if (wrapper.dataset.autoplay === 'true') {
        const interval = (Math.max(2, parseFloat(wrapper.dataset.interval) || 4)) * 1000;
        let timer = setInterval(() => {
          if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 10) {
            track.scrollTo({ left: 0, behavior: 'smooth' });
          } else {
            track.scrollBy({ left: getSlideWidth(), behavior: 'smooth' });
          }
        }, interval);
        wrapper.addEventListener('mouseenter', () => clearInterval(timer));
        wrapper.addEventListener('mouseleave', () => {
          clearInterval(timer);
          timer = setInterval(() => {
            if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 10) {
              track.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
              track.scrollBy({ left: getSlideWidth(), behavior: 'smooth' });
            }
          }, interval);
        });
      }
    });

    // Custom Header Search Input Handler
    document.querySelectorAll('.cms-header-search-input').forEach(input => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const q = input.value.trim();
          if (q) {
            alert('Search query: ' + q);
          }
        }
      });
    });
  </script>
</body>
</html>`;
}

const PORT = process.env.PORT || 3456;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Kanban app running on http://localhost:${PORT}`);
  });
}

module.exports = { app, renderBlockHtml, renderPublishedPage };
