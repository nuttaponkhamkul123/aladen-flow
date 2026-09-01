const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./db');

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
  let sql = `SELECT p.id, p.title, p.slug, p.status, p.created_at, p.updated_at,
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
  sql += ' ORDER BY p.updated_at DESC';
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
  res.json(page);
});

app.get('/api/pages/by-slug/:slug', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = ? AND status = 'published'").get(req.params.slug);
  if (!page) return res.status(404).json({ error: 'not found' });
  page.tags = db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(page.id).map(r => r.tag);
  try { page.blocks = JSON.parse(page.blocks || '[]'); }
  catch { page.blocks = []; }
  res.json(page);
});

app.post('/api/pages', (req, res) => {
  const { title, blocks = [], status = 'draft', tags = [] } = req.body;
  if (!title || !title.trim()) return res.status(400).json({ error: 'title required' });
  const slug = uniqueSlug(slugify(title));
  let blocksJson;
  try { blocksJson = JSON.stringify(Array.isArray(blocks) ? blocks : []); }
  catch { return res.status(400).json({ error: 'invalid blocks' }); }
  const info = db
    .prepare('INSERT INTO pages (title, slug, blocks, status) VALUES (?, ?, ?, ?)')
    .run(title.trim(), slug, blocksJson, status);
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
  const { title, blocks, status, tags } = req.body;
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
    if (status && ['draft', 'published'].includes(status)) {
      updates.push('status = ?');
      params.push(status);
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

app.delete('/api/pages/:id', (req, res) => {
  db.prepare('DELETE FROM pages WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/p/:slug', (req, res) => {
  const page = db.prepare("SELECT * FROM pages WHERE slug = ? AND status = 'published'").get(req.params.slug);
  if (!page) return res.status(404).send('<h1>Page not found</h1>');
  let blocks = [];
  try { blocks = JSON.parse(page.blocks || '[]'); } catch {}
  const tags = db.prepare('SELECT tag FROM page_tags WHERE page_id = ?').all(page.id).map(r => r.tag);
  res.set('Content-Type', 'text/html; charset=utf-8');
  res.send(renderPublishedPage(page, blocks, tags));
});

function escHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function renderBlockHtml(b) {
  const p = b.props || {};
  switch (b.type) {
    case 'heading': {
      const lvl = Math.min(3, Math.max(1, Number(p.level) || 2));
      return `<h${lvl} style="margin:18px 0 10px">${escHtml(p.text)}</h${lvl}>`;
    }
    case 'paragraph':
      return `<p style="margin:0 0 12px;line-height:1.6">${escHtml(p.text)}</p>`;
    case 'button': {
      const color = escHtml(p.color || '#6366f1');
      const label = escHtml(p.label || 'Button');
      const url = escHtml(p.url || '#');
      return `<p style="margin:14px 0"><a href="${url}" style="display:inline-block;padding:10px 18px;background:${color};color:#fff;border-radius:8px;text-decoration:none;font-weight:500">${label}</a></p>`;
    }
    case 'image':
      return p.url
        ? `<p style="margin:10px 0"><img src="${escHtml(p.url)}" alt="${escHtml(p.alt)}" style="max-width:100%;border-radius:8px" /></p>`
        : '';
    case 'divider':
      return `<hr style="border:none;border-top:1px solid #e2e8f0;margin:18px 0" />`;
    case 'spacer':
      return `<div style="height:${Number(p.height) || 24}px"></div>`;
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

      return `<div class="cms-table-wrap" style="overflow-x:auto;margin:16px 0;"><table class="cms-table${striped}${bordered}${compact}" style="width:100%;border-collapse:collapse;font-size:14px;line-height:1.5;">${theadHtml}${tbodyHtml}</table></div>`;
    }
    case 'container': {
      const mode = p.mode || 'grid';
      const children = Array.isArray(p.children) ? p.children : [];
      const padding = p.padding != null ? Number(p.padding) : 16;
      const borderRadius = p.borderRadius != null ? Number(p.borderRadius) : 8;
      const gap = p.gap != null ? Number(p.gap) : 16;
      const borderStyle = p.border ? 'border:1px solid #e2e8f0;' : '';
      const bgStyle = p.bg === 'surface' ? 'background:#f1f5f9;' : p.bg === 'subtle' ? 'background:#f8fafc;' : 'background:transparent;';

      let layoutStyle = `display:${mode === 'grid' ? 'grid' : 'flex'};gap:${gap}px;padding:${padding}px;border-radius:${borderRadius}px;${borderStyle}${bgStyle}margin:16px 0;box-sizing:border-box;`;
      if (mode === 'grid') {
        layoutStyle += `grid-template-columns:repeat(${p.columns || 2}, minmax(0, 1fr));`;
      } else {
        layoutStyle += `flex-direction:${p.direction || 'row'};justify-content:${p.justify || 'flex-start'};align-items:${p.align || 'stretch'};flex-wrap:${p.wrap || 'wrap'};`;
      }

      const childrenHtml = children.map(renderBlockHtml).join('\n');
      return `<div class="cms-container" style="${layoutStyle}">${childrenHtml}</div>`;
    }
    default:
      return '';
  }
}

function renderPublishedPage(page, blocks, tags) {
  const body = blocks.map(renderBlockHtml).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escHtml(page.title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 48px 20px; background: #fff; min-height: 100vh; box-shadow: 0 0 0 1px #e2e8f0; }
    .tags { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; }
    .tags span { display: inline-block; background: #e2e8f0; padding: 2px 8px; border-radius: 999px; margin-right: 4px; }
    .cms-table th { background: #f1f5f9; color: #0f172a; font-weight: 600; padding: 10px 14px; text-align: left; border-bottom: 2px solid #e2e8f0; }
    .cms-table td { padding: 9px 14px; border-bottom: 1px solid #e2e8f0; color: #334155; }
    .cms-table.striped tbody tr:nth-child(even) { background: #f8fafc; }
    .cms-table.bordered { border: 1px solid #e2e8f0; }
    .cms-table.bordered th, .cms-table.bordered td { border: 1px solid #e2e8f0; }
    .cms-table.compact th, .cms-table.compact td { padding: 6px 10px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="wrap">
    ${body}
    ${tags.length ? `<div class="tags">${tags.map(t => `<span>${escHtml(t)}</span>`).join('')}</div>` : ''}
  </div>
</body>
</html>`;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kanban app running on http://localhost:${PORT}`);
});
