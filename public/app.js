const api = {
  async req(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    const r = await fetch(url, opts);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${r.status}`);
    }
    return r.json();
  },
  get: (u) => api.req('GET', u),
  post: (u, b) => api.req('POST', u, b),
  patch: (u, b) => api.req('PATCH', u, b),
  del: (u) => api.req('DELETE', u)
};

const state = {
  boards: [],
  currentBoardId: null,
  board: null,
  openCardId: null,
  searchTerm: '',
  drag: null,
  currentTab: 'board',
  cms: {
    pages: [],
    tags: [],
    selectedTag: '',
    searchQ: '',
    statusFilter: '',
    openPageId: null,
    openPage: null,
    drag: null,
    dropIdx: 0,
    indicator: null
  }
};

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === false || v == null) continue;
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach(c => {
    if (c == null || c === false) return;
    if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  });
  return node;
};

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function dueStatus(due) {
  if (!due) return { cls: '', label: '' };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due);
  d.setHours(0, 0, 0, 0);
  const diff = Math.round((d - today) / 86400000);
  if (diff < 0) return { cls: 'overdue', label: `Overdue ${formatDate(due)}` };
  if (diff === 0) return { cls: 'soon', label: 'Due today' };
  if (diff <= 2) return { cls: 'soon', label: `Due ${formatDate(due)}` };
  return { cls: '', label: formatDate(due) };
}

function relativeTime(iso) {
  if (!iso) return '';
  const d = new Date(iso.replace(' ', 'T') + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function escapeMdHtml(s) {
  return String(s || '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[m]));
}



async function loadBoards() {
  state.boards = await api.get('/api/boards');
  const sel = document.getElementById('boardSelect');
  sel.innerHTML = '';
  state.boards.forEach(b => {
    const opt = el('option', { value: b.id }, b.name);
    sel.appendChild(opt);
  });
  if (!state.currentBoardId && state.boards.length) {
    state.currentBoardId = state.boards[0].id;
  }
  sel.value = state.currentBoardId || '';
}

async function loadBoard() {
  if (!state.currentBoardId) {
    state.board = null;
    renderBoard();
    return;
  }
  state.board = await api.get(`/api/boards/${state.currentBoardId}`);
  renderBoard();
}

function getCardsByColumn() {
  const map = {};
  if (!state.board) return map;
  state.board.columns.forEach(c => (map[c.id] = []));
  state.board.cards.forEach(card => {
    if (!map[card.column_id]) map[card.column_id] = [];
    map[card.column_id].push(card);
  });
  return map;
}

function renderCard(card) {
  const labels = el('div', { class: 'card-labels' },
    card.labels.map(l => el('span', {
      class: 'card-label',
      style: `background:${l.color}`,
      title: l.name
    }, l.name))
  );

  const due = dueStatus(card.due_date);
  const meta = el('div', { class: 'card-meta' });

  const totalChecklist = (card.checklist || []).length;
  const doneChecklist = (card.checklist || []).filter(i => i.checked).length;
  if (totalChecklist > 0) {
    const pct = Math.round((doneChecklist / totalChecklist) * 100);
    meta.appendChild(el('div', { class: 'checklist-progress', title: `${doneChecklist}/${totalChecklist} done` }, [
      el('div', { class: 'bar' }, el('div', { style: `width:${pct}%` })),
      el('span', {}, `${doneChecklist}/${totalChecklist}`)
    ]));
  }

  meta.appendChild(el('span', { class: `badge priority-${card.priority}` }, card.priority));
  if (due.label) {
    meta.appendChild(el('span', { class: `due ${due.cls}` }, [due.label, el('span', {}, '\ud83d\udcc5')]));
  }

  const cardNode = el('div', {
    class: 'card',
    dataset: { id: card.id, columnId: card.column_id },
    draggable: 'true'
  }, [
    labels,
    el('div', { class: 'card-title-text' }, card.title),
    meta
  ]);

  cardNode.addEventListener('click', e => {
    if (cardNode.classList.contains('dragging')) return;
    openCard(card.id);
  });
  cardNode.addEventListener('dragstart', onCardDragStart);
  cardNode.addEventListener('dragend', onCardDragEnd);
  return cardNode;
}

function renderAddCardForm(columnId) {
  const textarea = el('textarea', { placeholder: 'Enter a title for this card...' });
  const form = el('div', { class: 'add-card-form' }, [
    textarea,
    el('div', { class: 'form-actions' }, [
      el('button', {
        class: 'btn',
        onclick: async () => {
          const title = textarea.value.trim();
          if (!title) return;
          await api.post(`/api/columns/${columnId}/cards`, { title });
          textarea.value = '';
          form.classList.remove('open');
          await loadBoard();
        }
      }, 'Add card'),
      el('button', {
        class: 'btn ghost',
        onclick: () => { form.classList.remove('open'); textarea.value = ''; }
      }, 'Cancel')
    ])
  ]);
  return form;
}

function renderColumn(col) {
  const cardsByCol = getCardsByColumn();
  const cards = cardsByCol[col.id] || [];
  const titleEl = el('input', {
    class: 'column-title',
    value: col.name,
    readonly: 'readonly',
    ondblclick: e => { e.target.removeAttribute('readonly'); e.target.focus(); e.target.select(); },
    onblur: async e => {
      e.target.setAttribute('readonly', 'readonly');
      const newName = e.target.value.trim() || col.name;
      if (newName !== col.name) {
        await api.patch(`/api/columns/${col.id}`, { name: newName });
        col.name = newName;
      }
    },
    onkeydown: e => { if (e.key === 'Enter') e.target.blur(); }
  });

  const listEl = el('div', {
    class: 'card-list',
    dataset: { columnId: col.id }
  });
  cards.forEach(c => listEl.appendChild(renderCard(c)));
  listEl.addEventListener('dragover', onColumnDragOver);
  listEl.addEventListener('drop', onColumnDrop);
  listEl.addEventListener('dragleave', e => {
    if (!listEl.contains(e.relatedTarget)) listEl.classList.remove('drop-target');
  });

  const addBtn = el('button', {
    class: 'add-card-btn',
    onclick: () => {
      const form = columnEl.querySelector('.add-card-form');
      form.classList.add('open');
      form.querySelector('textarea').focus();
    }
  }, '+ Add a card');

  const form = renderAddCardForm(col.id);

  const deleteBtn = el('button', {
    class: 'column-menu',
    title: 'Delete column',
    onclick: async () => {
      if (!confirm(`Delete column "${col.name}" and its cards?`)) return;
      await api.del(`/api/columns/${col.id}`);
      await loadBoard();
    }
  }, '\u00d7');

  const header = el('div', {
    class: 'column-header',
    draggable: 'true'
  }, [
    titleEl,
    el('span', { class: 'column-count' }, String(cards.length)),
    deleteBtn
  ]);
  header.addEventListener('dragstart', onColumnDragStart);
  header.addEventListener('dragend', onColumnDragEnd);

  const columnEl = el('div', {
    class: 'column',
    dataset: { id: col.id }
  }, [header, listEl, addBtn, form]);

  return columnEl;
}

function renderBoard() {
  const board = document.getElementById('board');
  board.innerHTML = '';
  if (!state.board) {
    board.appendChild(el('div', { class: 'muted', style: 'padding:24px' }, 'No boards. Create one to get started.'));
    return;
  }
  state.board.columns.forEach(col => board.appendChild(renderColumn(col)));
}

function setBoardEvents() {
  const sel = document.getElementById('boardSelect');
  sel.onchange = async e => {
    state.currentBoardId = Number(e.target.value);
    await loadBoard();
  };

  document.getElementById('newBoardBtn').onclick = async () => {
    const name = prompt('Board name:');
    if (!name) return;
    const b = await api.post('/api/boards', { name });
    await loadBoards();
    state.currentBoardId = b.id;
    sel.value = b.id;
    await loadBoard();
  };

  document.getElementById('deleteBoardBtn').onclick = async () => {
    if (!state.currentBoardId) return;
    if (!confirm('Delete this board and all its data?')) return;
    await api.del(`/api/boards/${state.currentBoardId}`);
    state.currentBoardId = null;
    await loadBoards();
    await loadBoard();
  };

  document.getElementById('addColumnBtn').onclick = async () => {
    if (!state.currentBoardId) return alert('Create a board first');
    const name = prompt('Column name:');
    if (!name) return;
    await api.post(`/api/boards/${state.currentBoardId}/columns`, { name });
    await loadBoard();
  };

  const searchInput = document.getElementById('searchInput');
  const resultsEl = document.getElementById('searchResults');
  let searchTimer;
  searchInput.oninput = e => {
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    state.searchTerm = q;
    if (!q) { resultsEl.classList.add('hidden'); return; }
    searchTimer = setTimeout(async () => {
      const results = await api.get(`/api/search?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = '';
      if (!results.length) {
        resultsEl.appendChild(el('div', { class: 'result muted' }, 'No results'));
      } else {
        results.forEach(r => {
          const div = el('div', { class: 'result' }, [
            el('div', {}, r.title),
            el('div', { class: 'muted', style: 'font-size:11px' }, (r.description || '').slice(0, 80))
          ]);
          div.onclick = () => {
            resultsEl.classList.add('hidden');
            searchInput.value = '';
            openCard(r.id);
          };
          resultsEl.appendChild(div);
        });
      }
      resultsEl.classList.remove('hidden');
    }, 200);
  };
  document.addEventListener('click', e => {
    if (!e.target.closest('.search-wrap')) resultsEl.classList.add('hidden');
  });

  document.getElementById('activityBtn').onclick = openActivityPanel;
  document.getElementById('closeActivityBtn').onclick = () => {
    document.getElementById('activityPanel').classList.add('hidden');
  };

  document.getElementById('themeBtn').onclick = () => {
    document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-dark');
  };

  document.querySelectorAll('.close-modal, .modal-backdrop').forEach(n => {
    n.onclick = closeCardModal;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeCardModal();
      document.getElementById('activityPanel').classList.add('hidden');
    }
  });

  document.getElementById('cardTitle').onblur = saveCardFields;
  document.getElementById('cardDescription').onblur = saveCardFields;
  document.getElementById('cardDueDate').onchange = saveCardFields;
  document.getElementById('cardPriority').onchange = saveCardFields;

  document.getElementById('addChecklistBtn').onclick = addChecklistItem;
  document.getElementById('newChecklistInput').onkeydown = e => {
    if (e.key === 'Enter') addChecklistItem();
  };

  document.getElementById('addLabelBtn').onclick = addLabel;
  document.getElementById('newLabelName').onkeydown = e => {
    if (e.key === 'Enter') addLabel();
  };

  document.getElementById('archiveCardBtn').onclick = async () => {
    if (!state.openCardId) return;
    await api.patch(`/api/cards/${state.openCardId}`, { archived: 1 });
    closeCardModal();
    await loadBoard();
  };
  document.getElementById('deleteCardBtn').onclick = async () => {
    if (!state.openCardId) return;
    if (!confirm('Delete this card permanently?')) return;
    await api.del(`/api/cards/${state.openCardId}`);
    closeCardModal();
    await loadBoard();
  };
}

let saveCardTimer;
async function saveCardFields() {
  if (!state.openCardId) return;
  clearTimeout(saveCardTimer);
  saveCardTimer = setTimeout(async () => {
    const card = findCard(state.openCardId);
    if (!card) return;
    const updates = {
      title: document.getElementById('cardTitle').value,
      description: document.getElementById('cardDescription').value,
      due_date: document.getElementById('cardDueDate').value || null,
      priority: document.getElementById('cardPriority').value
    };
    await api.patch(`/api/cards/${state.openCardId}`, updates);
    Object.assign(card, updates);
    renderBoard();
    refreshCardMeta();
  }, 250);
}

function findCard(id) {
  if (!state.board) return null;
  return state.board.cards.find(c => c.id === id);
}

async function openCard(cardId) {
  state.openCardId = cardId;
  const card = findCard(cardId);
  if (!card) return;
  document.getElementById('cardTitle').value = card.title;
  document.getElementById('cardDescription').value = card.description || '';
  document.getElementById('cardDueDate').value = card.due_date || '';
  document.getElementById('cardPriority').value = card.priority;
  document.getElementById('cardModal').classList.remove('hidden');
  renderChecklist(card);
  renderCardLabels(card);
  refreshCardMeta();
  loadCardActivity(cardId);
}

function refreshCardMeta() {
  const card = findCard(state.openCardId);
  if (!card) return;
  const badge = document.getElementById('cardPriorityBadge');
  badge.className = `badge priority-${card.priority}`;
  badge.textContent = card.priority;
  document.getElementById('cardCreatedAt').textContent =
    card.created_at ? `Created ${relativeTime(card.created_at)}` : '';
}

function closeCardModal() {
  document.getElementById('cardModal').classList.add('hidden');
  state.openCardId = null;
}

function renderChecklist(card) {
  const list = document.getElementById('cardChecklist');
  list.innerHTML = '';
  (card.checklist || []).forEach(item => {
    const checkbox = el('input', {
      type: 'checkbox',
      checked: item.checked ? '' : null,
      onchange: async e => {
        await api.patch(`/api/checklist/${item.id}`, { checked: e.target.checked });
        item.checked = e.target.checked;
        textSpan.classList.toggle('done', item.checked);
      }
    });
    const textSpan = el('span', {
      class: `text ${item.checked ? 'done' : ''}`,
      contenteditable: 'true',
      onblur: async e => {
        const newText = e.target.textContent.trim();
        if (newText && newText !== item.text) {
          await api.patch(`/api/checklist/${item.id}`, { text: newText });
          item.text = newText;
        }
      }
    }, item.text);
    const delBtn = el('button', {
      class: 'del',
      title: 'Delete',
      onclick: async () => {
        await api.del(`/api/checklist/${item.id}`);
        card.checklist = card.checklist.filter(i => i.id !== item.id);
        renderChecklist(card);
      }
    }, '\u00d7');
    list.appendChild(el('div', { class: 'item' }, [checkbox, textSpan, delBtn]));
  });
}

async function addChecklistItem() {
  if (!state.openCardId) return;
  const input = document.getElementById('newChecklistInput');
  const text = input.value.trim();
  if (!text) return;
  const r = await api.post(`/api/cards/${state.openCardId}/checklist`, { text });
  const card = findCard(state.openCardId);
  if (!card.checklist) card.checklist = [];
  card.checklist.push({ id: r.id, text, checked: false, position: 0 });
  input.value = '';
  renderChecklist(card);
  renderBoard();
}

function renderCardLabels(card) {
  const wrap = document.getElementById('cardLabels');
  wrap.innerHTML = '';
  state.board.labels.forEach(label => {
    const isSelected = card.labels.some(l => l.id === label.id);
    const chip = el('span', {
      class: `label-chip ${isSelected ? 'selected' : ''}`,
      style: `background:${label.color}`,
      onclick: async () => {
        const ids = card.labels.map(l => l.id);
        if (ids.includes(label.id)) {
          card.labels = card.labels.filter(l => l.id !== label.id);
        } else {
          card.labels.push(label);
        }
        await api.patch(`/api/cards/${state.openCardId}`, {
          labelIds: card.labels.map(l => l.id)
        });
        renderCardLabels(card);
        renderBoard();
      }
    }, [
      label.name,
      el('span', {
        class: 'remove',
        title: 'Delete label',
        onclick: async e => {
          e.stopPropagation();
          if (!confirm(`Delete label "${label.name}"?`)) return;
          await api.del(`/api/labels/${label.id}`);
          state.board.labels = state.board.labels.filter(l => l.id !== label.id);
          card.labels = card.labels.filter(l => l.id !== label.id);
          renderCardLabels(card);
        }
      }, '\u00d7')
    ]);
    wrap.appendChild(chip);
  });
}

async function addLabel() {
  const nameInput = document.getElementById('newLabelName');
  const colorInput = document.getElementById('newLabelColor');
  const name = nameInput.value.trim();
  if (!name) return;
  const r = await api.post(`/api/boards/${state.currentBoardId}/labels`, {
    name,
    color: colorInput.value
  });
  state.board.labels.push({ id: r.id, name, color: colorInput.value, board_id: state.currentBoardId });
  nameInput.value = '';
  if (state.openCardId) {
    const card = findCard(state.openCardId);
    renderCardLabels(card);
  }
}

async function loadCardActivity(cardId) {
  const items = await api.get(`/api/cards/${cardId}/activity`);
  const wrap = document.getElementById('cardActivity');
  wrap.innerHTML = '';
  if (!items.length) {
    wrap.appendChild(el('div', { class: 'muted' }, 'No activity yet.'));
    return;
  }
  items.forEach(a => {
    wrap.appendChild(el('div', { class: 'entry' }, [
      el('div', {}, a.message),
      el('div', { class: 'time' }, relativeTime(a.created_at))
    ]));
  });
}

async function openActivityPanel() {
  if (!state.currentBoardId) return;
  const items = await api.get(`/api/boards/${state.currentBoardId}/activity`);
  const wrap = document.getElementById('activityList');
  wrap.innerHTML = '';
  if (!items.length) {
    wrap.appendChild(el('div', { class: 'muted' }, 'No activity yet.'));
  } else {
    items.forEach(a => {
      wrap.appendChild(el('div', { class: 'entry' }, [
        el('div', {}, a.message + (a.card_title ? ` (${a.card_title})` : '')),
        el('div', { class: 'when' }, relativeTime(a.created_at))
      ]));
    });
  }
  document.getElementById('activityPanel').classList.remove('hidden');
}

// Drag & Drop
function onCardDragStart(e) {
  const card = e.currentTarget;
  state.drag = {
    type: 'card',
    id: Number(card.dataset.id),
    fromColumn: Number(card.dataset.columnId)
  };
  card.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('text/plain', card.dataset.id); } catch (_) {}
}

function onCardDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  document.querySelectorAll('.card-list').forEach(l => l.classList.remove('drop-target'));
}

function onColumnDragOver(e) {
  if (!state.drag || state.drag.type !== 'card') return;
  e.preventDefault();
  e.currentTarget.classList.add('drop-target');
}

async function onColumnDrop(e) {
  e.preventDefault();
  const list = e.currentTarget;
  list.classList.remove('drop-target');
  if (!state.drag || state.drag.type !== 'card') return;
  const targetCol = Number(list.dataset.columnId);
  const cardId = state.drag.id;
  const cards = Array.from(list.querySelectorAll('.card'));
  let position = cards.length;
  const afterEl = cards.find(c => {
    const rect = c.getBoundingClientRect();
    return e.clientY < rect.top + rect.height / 2;
  });
  if (afterEl) {
    position = cards.indexOf(afterEl);
  }
  await api.post(`/api/cards/${cardId}/move`, { column_id: targetCol, position });
  state.drag = null;
  await loadBoard();
}

function onColumnDragStart(e) {
  const col = e.currentTarget.parentElement;
  state.drag = { type: 'column', id: Number(col.dataset.id) };
  col.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function onColumnDragEnd(e) {
  const col = e.currentTarget.parentElement;
  col.classList.remove('dragging');
  state.drag = null;
  document.querySelectorAll('.column').forEach(c => c.classList.remove('drop-before', 'drop-after'));
}

document.getElementById('board').addEventListener('dragover', e => {
  if (state.drag && state.drag.type === 'column') {
    e.preventDefault();
    const cols = Array.from(document.querySelectorAll('.column'));
    const target = cols.find(c => {
      const r = c.getBoundingClientRect();
      return e.clientX < r.left + r.width / 2;
    });
    cols.forEach(c => c.classList.remove('drop-before', 'drop-after'));
    if (target) target.classList.add('drop-before');
    else if (cols.length) cols[cols.length - 1].classList.add('drop-after');
  }
});

document.getElementById('board').addEventListener('drop', async e => {
  if (!state.drag || state.drag.type !== 'column') return;
  e.preventDefault();
  const cols = Array.from(document.querySelectorAll('.column'));
  const orderedIds = cols.map(c => Number(c.dataset.id));
  const beforeEl = cols.find(c => c.classList.contains('drop-before'));
  const afterEl = cols.find(c => c.classList.contains('drop-after'));
  let reordered = orderedIds.filter(id => id !== state.drag.id);
  if (beforeEl) {
    const idx = reordered.indexOf(Number(beforeEl.dataset.id));
    reordered.splice(idx, 0, state.drag.id);
  } else if (afterEl) {
    const idx = reordered.indexOf(Number(afterEl.dataset.id));
    reordered.splice(idx + 1, 0, state.drag.id);
  } else {
    reordered.push(state.drag.id);
  }
  cols.forEach(c => c.classList.remove('drop-before', 'drop-after'));
  await api.post(`/api/columns/${state.drag.id}/move`, {
    board_id: state.currentBoardId,
    orderedIds: reordered
  });
  state.drag = null;
  await loadBoard();
});

// ---------- Tabs ----------
function setupTabs() {
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => switchTab(t.dataset.tab);
  });
}

function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('[data-tab-panel]').forEach(p => {
    p.classList.toggle('hidden', p.dataset.tabPanel !== name);
  });
  document.querySelectorAll('[data-tab-show]').forEach(s => {
    s.classList.toggle('hidden', s.dataset.tabShow !== name);
  });
  if (name === 'cms') loadCms();
}

// ---------- CMS (block-based site builder) ----------
const BLOCK_DEFAULTS = {
  heading:   { level: 2, text: 'New heading' },
  paragraph: { text: 'New paragraph. Click to edit.' },
  button:    { label: 'Click me', url: 'https://example.com', color: '#6366f1' },
  image:     { url: '', alt: '' },
  divider:   {},
  spacer:    { height: 24 },
  table:     {
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
    children: []
  }
};

const BLOCK_LABELS = {
  heading: 'Heading',
  paragraph: 'Paragraph',
  button: 'Button',
  image: 'Image',
  divider: 'Divider',
  spacer: 'Spacer',
  table: 'Table',
  container: 'Container (Grid / Flex)'
};

function newBlockId() {
  return 'b' + Math.random().toString(36).slice(2, 10);
}

function makeBlock(type) {
  return {
    id: newBlockId(),
    type,
    props: { ...(BLOCK_DEFAULTS[type] || {}) }
  };
}

async function loadCms() {
  await Promise.all([loadCmsPages(), loadCmsTags()]);
}

async function loadCmsPages() {
  const params = new URLSearchParams();
  if (state.cms.searchQ) params.set('q', state.cms.searchQ);
  if (state.cms.statusFilter) params.set('status', state.cms.statusFilter);
  if (state.cms.selectedTag) params.set('tag', state.cms.selectedTag);
  state.cms.pages = await api.get(`/api/pages?${params.toString()}`);
  renderCmsPages();
}

async function loadCmsTags() {
  state.cms.tags = await api.get('/api/tags');
  renderCmsTags();
}

function renderCmsPages() {
  const list = document.getElementById('cmsPagesList');
  list.innerHTML = '';
  if (!state.cms.pages.length) {
    list.appendChild(el('div', { class: 'muted', style: 'font-size:12px; padding:8px;' }, 'No pages'));
    return;
  }
  state.cms.pages.forEach(p => {
    const item = el('div', {
      class: `cms-page-item ${p.id === state.cms.openPageId ? 'selected' : ''}`,
      onclick: () => openCmsPage(p.id)
    }, [
      el('div', { class: 'p-title' }, p.title || '(untitled)'),
      el('div', { class: 'p-meta' }, [
        el('span', { class: `p-status ${p.status}` }, p.status),
        el('span', {}, `/${p.slug}`),
        el('span', {}, relativeTime(p.updated_at))
      ])
    ]);
    list.appendChild(item);
  });
}

function renderCmsTags() {
  const wrap = document.getElementById('cmsTags');
  wrap.innerHTML = '';
  const allChip = el('span', {
    class: `cms-tag ${state.cms.selectedTag === '' ? 'selected' : ''}`,
    onclick: () => { state.cms.selectedTag = ''; loadCmsPages(); loadCmsTags(); }
  }, 'all');
  wrap.appendChild(allChip);
  state.cms.tags.forEach(t => {
    const chip = el('span', {
      class: `cms-tag ${state.cms.selectedTag === t.tag ? 'selected' : ''}`,
      onclick: () => { state.cms.selectedTag = state.cms.selectedTag === t.tag ? '' : t.tag; loadCmsPages(); loadCmsTags(); }
    }, [t.tag, el('span', { class: 'count' }, String(t.c))]);
    wrap.appendChild(chip);
  });
}

async function openCmsPage(id) {
  const page = await api.get(`/api/pages/${id}`);
  state.cms.openPageId = id;
  state.cms.openPage = page;
  state.cms.selectedBlockId = null;
  page.blocks = Array.isArray(page.blocks) ? page.blocks : [];
  document.getElementById('cmsEmpty').classList.add('hidden');
  document.getElementById('cmsEditorWrap').classList.remove('hidden');
  document.getElementById('cmsTitle').value = page.title || '';
  document.getElementById('cmsSlug').value = page.slug || '';
  document.getElementById('cmsStatus').value = page.status || 'draft';
  document.getElementById('cmsTagsInput').value = (page.tags || []).join(', ');
  const previewLink = document.getElementById('cmsPreviewLink');
  previewLink.href = `/p/${page.slug}`;
  previewLink.classList.toggle('hidden', page.status !== 'published');
  renderCanvas();
  renderProps();
  renderCmsPages();
}

function newCmsPage() {
  state.cms.openPageId = null;
  state.cms.openPage = { title: '', slug: '', status: 'draft', tags: [], blocks: [] };
  state.cms.selectedBlockId = null;
  document.getElementById('cmsEmpty').classList.add('hidden');
  document.getElementById('cmsEditorWrap').classList.remove('hidden');
  document.getElementById('cmsTitle').value = '';
  document.getElementById('cmsSlug').value = '';
  document.getElementById('cmsStatus').value = 'draft';
  document.getElementById('cmsTagsInput').value = '';
  document.getElementById('cmsPreviewLink').classList.add('hidden');
  renderCanvas();
  renderProps();
  document.getElementById('cmsTitle').focus();
  renderCmsPages();
}

async function saveCmsPage() {
  const title = document.getElementById('cmsTitle').value.trim();
  const status = document.getElementById('cmsStatus').value;
  const tags = document.getElementById('cmsTagsInput').value
    .split(',').map(t => t.trim()).filter(Boolean);
  const blocks = state.cms.openPage ? state.cms.openPage.blocks : [];
  if (!title) return alert('Title is required');
  if (state.cms.openPageId) {
    await api.patch(`/api/pages/${state.cms.openPageId}`, { title, blocks, status, tags });
  } else {
    const r = await api.post('/api/pages', { title, blocks, status, tags });
    state.cms.openPageId = r.id;
    state.cms.openPage.slug = r.slug;
  }
  state.cms.openPage.title = title;
  state.cms.openPage.status = status;
  state.cms.openPage.tags = tags;
  await loadCms();
  const previewLink = document.getElementById('cmsPreviewLink');
  if (status === 'published' && state.cms.openPage.slug) {
    previewLink.href = `/p/${state.cms.openPage.slug}`;
    previewLink.classList.remove('hidden');
  } else {
    previewLink.classList.add('hidden');
  }
  flashSaved();
}

function flashSaved() {
  const btn = document.getElementById('cmsSaveBtn');
  const orig = btn.textContent;
  btn.textContent = 'Saved \u2713';
  btn.disabled = true;
  setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1200);
}

async function deleteCmsPage() {
  if (!state.cms.openPageId) {
    state.cms.openPageId = null;
    state.cms.openPage = null;
    document.getElementById('cmsEmpty').classList.remove('hidden');
    document.getElementById('cmsEditorWrap').classList.add('hidden');
    return;
  }
  if (!confirm('Delete this page?')) return;
  await api.del(`/api/pages/${state.cms.openPageId}`);
  state.cms.openPageId = null;
  state.cms.openPage = null;
  state.cms.selectedBlockId = null;
  document.getElementById('cmsEmpty').classList.remove('hidden');
  document.getElementById('cmsEditorWrap').classList.add('hidden');
  await loadCms();
}

// ---------- Canvas ----------
// ---------- Canvas ----------
function getBlocks() {
  return state.cms.openPage && state.cms.openPage.blocks ? state.cms.openPage.blocks : [];
}

function findBlock(id, list = getBlocks()) {
  for (const b of list) {
    if (b.id === id) return b;
    if (b.type === 'container' && Array.isArray(b.props && b.props.children)) {
      const found = findBlock(id, b.props.children);
      if (found) return found;
    }
  }
  return null;
}

function findBlockLocation(id, list = getBlocks(), parentBlock = null) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return { parentArray: list, index: i, parentBlock };
    }
    if (list[i].type === 'container' && Array.isArray(list[i].props && list[i].props.children)) {
      const loc = findBlockLocation(id, list[i].props.children, list[i]);
      if (loc) return loc;
    }
  }
  return null;
}

function isDescendant(parentBlockId, testBlockId) {
  if (parentBlockId === testBlockId) return true;
  const parent = findBlock(parentBlockId);
  if (!parent || parent.type !== 'container' || !Array.isArray(parent.props && parent.props.children)) {
    return false;
  }
  for (const child of parent.props.children) {
    if (child.id === testBlockId || isDescendant(child.id, testBlockId)) {
      return true;
    }
  }
  return false;
}

function renderBlockContent(block) {
  const p = block.props || {};
  switch (block.type) {
    case 'heading': {
      const lvl = Math.min(3, Math.max(1, Number(p.level) || 2));
      return el('div', { class: `block block-heading lvl-${lvl}` }, p.text || '');
    }
    case 'paragraph': {
      const cls = `block block-paragraph${p.text ? '' : ' empty'}`;
      return el('div', { class: cls }, p.text || '');
    }
    case 'button': {
      return el('div', { class: 'block block-button' }, [
        el('span', {
          class: 'btn-render',
          style: `background:${p.color || '#6366f1'}`
        }, p.label || 'Button')
      ]);
    }
    case 'image': {
      if (p.url) {
        return el('div', { class: 'block block-image' }, [
          el('img', { src: p.url, alt: p.alt || '' })
        ]);
      }
      return el('div', { class: 'block block-image placeholder' }, 'Image placeholder \u2014 set URL in properties');
    }
    case 'divider':
      return el('div', { class: 'block block-divider' }, el('hr'));
    case 'spacer': {
      const h = Math.max(8, Math.min(300, Number(p.height) || 24));
      return el('div', { class: 'block block-spacer', style: `height:${h}px` });
    }
    case 'table': {
      const headers = Array.isArray(p.headers) ? p.headers : ['Feature', 'Description', 'Status'];
      const rows = Array.isArray(p.rows) ? p.rows : [];
      const hasHeader = p.hasHeader !== false;
      const classes = ['block-table'];
      if (p.striped) classes.push('striped');
      if (p.bordered) classes.push('bordered');
      if (p.compact) classes.push('compact');

      const thead = hasHeader && headers.length > 0
        ? el('thead', {}, el('tr', {}, headers.map(h => el('th', {}, h))))
        : null;

      const tbody = el('tbody', {}, rows.map(r => {
        const rowCells = Array.isArray(r) ? r : [];
        const cols = headers.length ? headers : rowCells;
        return el('tr', {}, cols.map((_, i) => el('td', {}, rowCells[i] || '')));
      }));

      const tableEl = el('table', { class: classes.join(' ') }, [thead, tbody].filter(Boolean));
      return el('div', { class: 'block block-table-wrap' }, tableEl);
    }
    default:
      return el('div', { class: 'block' }, 'Unknown block');
  }
}

function renderBlockWrap(block, parentContainerId = null) {
  const isSelected = block.id === state.cms.selectedBlockId;
  const isContainer = block.type === 'container';
  const wrap = el('div', {
    class: `block-wrap${isContainer ? ' is-container' : ''}${isSelected ? ' selected' : ''}`,
    dataset: { blockId: block.id },
    draggable: 'true'
  });

  const toolbar = el('div', { class: 'block-toolbar' }, [
    el('span', {
      class: 'drag-handle',
      title: 'Drag to reorder'
    }, '\u2630'),
    el('button', {
      title: 'Move up/left',
      onclick: e => { e.stopPropagation(); moveBlock(block.id, -1); }
    }, '\u2191'),
    el('button', {
      title: 'Move down/right',
      onclick: e => { e.stopPropagation(); moveBlock(block.id, +1); }
    }, '\u2193'),
    el('button', {
      class: 'delete-btn',
      title: 'Delete block',
      onclick: e => { e.stopPropagation(); deleteBlock(block.id); }
    }, '\u00d7')
  ]);

  wrap.appendChild(toolbar);

  if (isContainer) {
    const p = block.props || {};
    const mode = p.mode || 'grid';
    const children = Array.isArray(p.children) ? p.children : [];
    const containerEl = el('div', {
      class: `block-container mode-${mode}${p.border ? ' has-border' : ''}${p.bg && p.bg !== 'transparent' ? ' bg-' + p.bg : ''}`,
      dataset: { containerId: block.id }
    });

    let style = `padding:${p.padding ?? 16}px;border-radius:${p.borderRadius ?? 8}px;gap:${p.gap ?? 16}px;`;
    if (mode === 'grid') {
      style += `grid-template-columns:repeat(${p.columns || 2}, minmax(0, 1fr));`;
    } else {
      style += `flex-direction:${p.direction || 'row'};justify-content:${p.justify || 'flex-start'};align-items:${p.align || 'stretch'};flex-wrap:${p.wrap || 'wrap'};`;
    }
    containerEl.style.cssText = style;

    if (!children.length) {
      const dropzone = el('div', { class: 'container-dropzone empty' }, [
        el('span', { class: 'dropzone-icon' }, '\u2637'),
        el('span', {}, 'Container (' + (mode === 'grid' ? (p.columns || 2) + ' cols' : p.direction || 'row') + ') \u2014 Drag & drop blocks here')
      ]);
      containerEl.appendChild(dropzone);
    } else {
      children.forEach(childBlock => {
        containerEl.appendChild(renderBlockWrap(childBlock, block.id));
      });
    }

    containerEl.addEventListener('dragover', e => onContainerDragOver(e, block));
    containerEl.addEventListener('dragleave', e => onContainerDragLeave(e, block));
    containerEl.addEventListener('drop', e => onContainerDrop(e, block));

    wrap.appendChild(containerEl);
  } else {
    wrap.appendChild(renderBlockContent(block));
  }

  wrap.addEventListener('click', e => {
    e.stopPropagation();
    selectBlock(block.id);
  });
  wrap.addEventListener('dragstart', e => onBlockDragStart(e, block));
  wrap.addEventListener('dragend', onBlockDragEnd);
  return wrap;
}

function renderCanvas() {
  const canvas = document.getElementById('cmsCanvas');
  canvas.innerHTML = '';
  const blocks = getBlocks();
  if (!blocks.length) {
    canvas.appendChild(el('div', { class: 'cms-empty-canvas' }, 'Drag a block from the palette to get started.'));
    return;
  }
  blocks.forEach(block => {
    canvas.appendChild(renderBlockWrap(block));
  });
}

function selectBlock(id) {
  state.cms.selectedBlockId = id;
  renderCanvas();
  renderProps();
}

function moveBlock(id, dir) {
  const loc = findBlockLocation(id);
  if (!loc) return;
  const { parentArray, index } = loc;
  const newIdx = index + dir;
  if (newIdx < 0 || newIdx >= parentArray.length) return;
  const [b] = parentArray.splice(index, 1);
  parentArray.splice(newIdx, 0, b);
  renderCanvas();
}

function deleteBlock(id) {
  const loc = findBlockLocation(id);
  if (!loc) return;
  const { parentArray, index } = loc;
  parentArray.splice(index, 1);
  if (state.cms.selectedBlockId === id) state.cms.selectedBlockId = null;
  renderCanvas();
  renderProps();
}

function insertBlockAt(type, targetContainerId, idx) {
  const block = makeBlock(type);
  if (targetContainerId) {
    const container = findBlock(targetContainerId);
    if (container) {
      if (!Array.isArray(container.props.children)) container.props.children = [];
      const safeIdx = Math.max(0, Math.min(idx ?? container.props.children.length, container.props.children.length));
      container.props.children.splice(safeIdx, 0, block);
    }
  } else {
    const blocks = getBlocks();
    const safeIdx = Math.max(0, Math.min(idx ?? blocks.length, blocks.length));
    blocks.splice(safeIdx, 0, block);
  }
  state.cms.selectedBlockId = block.id;
  renderCanvas();
  renderProps();
}

function moveBlockTo(blockId, targetContainerId, idx) {
  if (targetContainerId && isDescendant(blockId, targetContainerId)) {
    return;
  }
  const loc = findBlockLocation(blockId);
  if (!loc) return;

  const [b] = loc.parentArray.splice(loc.index, 1);

  let targetArray;
  if (targetContainerId) {
    const container = findBlock(targetContainerId);
    if (!container) return;
    if (!Array.isArray(container.props.children)) container.props.children = [];
    targetArray = container.props.children;
  } else {
    targetArray = getBlocks();
  }

  let targetIdx = idx;
  if (loc.parentArray === targetArray && loc.index < idx) {
    targetIdx = Math.max(0, idx - 1);
  }
  targetIdx = Math.max(0, Math.min(targetIdx, targetArray.length));
  targetArray.splice(targetIdx, 0, b);

  state.cms.selectedBlockId = blockId;
  renderCanvas();
  renderProps();
}

// ---------- Drag & Drop ----------
function onPaletteDragStart(e) {
  const t = e.currentTarget;
  state.cms.drag = { kind: 'palette', type: t.dataset.blockType };
  t.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'copy';
  try { e.dataTransfer.setData('application/x-block-type', t.dataset.blockType); } catch (_) {}
  e.dataTransfer.setData('text/plain', t.dataset.blockType);
}

function onPaletteDragEnd() {
  document.querySelectorAll('.palette-item.dragging').forEach(t => t.classList.remove('dragging'));
  state.cms.drag = null;
  hideDropIndicator();
}

function onBlockDragStart(e, block) {
  state.cms.drag = { kind: 'block', id: block.id };
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try { e.dataTransfer.setData('application/x-block-id', block.id); } catch (_) {}
  e.dataTransfer.setData('text/plain', block.id);
  e.stopPropagation();
}

function onBlockDragEnd(e) {
  e.currentTarget.classList.remove('dragging');
  state.cms.drag = null;
  hideDropIndicator();
}

function getTopLevelInsertIndex(canvas, clientY) {
  const wraps = Array.from(canvas.querySelectorAll(':scope > .block-wrap'));
  for (let i = 0; i < wraps.length; i++) {
    const rect = wraps[i].getBoundingClientRect();
    if (clientY < rect.top + rect.height / 2) return i;
  }
  return wraps.length;
}

function showTopLevelDropIndicator(canvas, idx) {
  if (!state.cms.indicator) {
    state.cms.indicator = el('div', { class: 'drop-indicator' });
  }
  state.cms.indicator.className = 'drop-indicator';
  const wraps = canvas.querySelectorAll(':scope > .block-wrap');
  const empty = canvas.querySelector('.cms-empty-canvas');
  if (idx >= wraps.length) {
    if (empty) canvas.insertBefore(state.cms.indicator, empty);
    else canvas.appendChild(state.cms.indicator);
  } else {
    canvas.insertBefore(state.cms.indicator, wraps[idx]);
  }
}

function getContainerInsertIndex(containerEl, clientX, clientY, isHorizontal) {
  const childWraps = Array.from(containerEl.querySelectorAll(':scope > .block-wrap'));
  for (let i = 0; i < childWraps.length; i++) {
    const rect = childWraps[i].getBoundingClientRect();
    if (isHorizontal) {
      if (clientX < rect.left + rect.width / 2) return i;
    } else {
      if (clientY < rect.top + rect.height / 2) return i;
    }
  }
  return childWraps.length;
}

function showContainerDropIndicator(containerEl, idx, isHorizontal) {
  if (!state.cms.indicator) {
    state.cms.indicator = el('div', { class: 'drop-indicator' });
  }
  state.cms.indicator.className = 'drop-indicator' + (isHorizontal ? ' vertical' : '');
  const childWraps = containerEl.querySelectorAll(':scope > .block-wrap');
  const empty = containerEl.querySelector('.container-dropzone');
  if (empty) {
    containerEl.appendChild(state.cms.indicator);
  } else if (idx >= childWraps.length) {
    containerEl.appendChild(state.cms.indicator);
  } else {
    containerEl.insertBefore(state.cms.indicator, childWraps[idx]);
  }
}

function hideDropIndicator() {
  if (state.cms.indicator && state.cms.indicator.parentNode) {
    state.cms.indicator.parentNode.removeChild(state.cms.indicator);
  }
  document.querySelectorAll('.block-container.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function onCanvasDragOver(e) {
  if (!state.cms.drag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = state.cms.drag.kind === 'palette' ? 'copy' : 'move';
  const canvas = document.getElementById('cmsCanvas');
  const idx = getTopLevelInsertIndex(canvas, e.clientY);
  showTopLevelDropIndicator(canvas, idx);
}

function onCanvasDragLeave(e) {
  const canvas = document.getElementById('cmsCanvas');
  if (e.relatedTarget && canvas.contains(e.relatedTarget)) return;
  hideDropIndicator();
}

function onCanvasDrop(e) {
  e.preventDefault();
  hideDropIndicator();
  const canvas = document.getElementById('cmsCanvas');
  const idx = getTopLevelInsertIndex(canvas, e.clientY);
  if (!state.cms.drag) return;
  if (state.cms.drag.kind === 'palette') {
    insertBlockAt(state.cms.drag.type, null, idx);
  } else if (state.cms.drag.kind === 'block') {
    moveBlockTo(state.cms.drag.id, null, idx);
  }
  state.cms.drag = null;
}

function onContainerDragOver(e, containerBlock) {
  if (!state.cms.drag) return;
  if (state.cms.drag.kind === 'block' && isDescendant(state.cms.drag.id, containerBlock.id)) {
    return;
  }
  e.preventDefault();
  e.stopPropagation();
  e.dataTransfer.dropEffect = state.cms.drag.kind === 'palette' ? 'copy' : 'move';

  const containerEl = e.currentTarget;
  containerEl.classList.add('drag-over');

  const p = containerBlock.props || {};
  const isHorizontal = (p.mode === 'grid') || (p.mode === 'flex' && (!p.direction || p.direction.startsWith('row')));
  const idx = getContainerInsertIndex(containerEl, e.clientX, e.clientY, isHorizontal);
  showContainerDropIndicator(containerEl, idx, isHorizontal);
}

function onContainerDragLeave(e, containerBlock) {
  const containerEl = e.currentTarget;
  if (e.relatedTarget && containerEl.contains(e.relatedTarget)) return;
  containerEl.classList.remove('drag-over');
  hideDropIndicator();
}

function onContainerDrop(e, containerBlock) {
  e.preventDefault();
  e.stopPropagation();
  const containerEl = e.currentTarget;
  containerEl.classList.remove('drag-over');
  hideDropIndicator();

  if (!state.cms.drag) return;
  if (state.cms.drag.kind === 'block' && isDescendant(state.cms.drag.id, containerBlock.id)) {
    return;
  }

  const p = containerBlock.props || {};
  const isHorizontal = (p.mode === 'grid') || (p.mode === 'flex' && (!p.direction || p.direction.startsWith('row')));
  const idx = getContainerInsertIndex(containerEl, e.clientX, e.clientY, isHorizontal);

  if (state.cms.drag.kind === 'palette') {
    insertBlockAt(state.cms.drag.type, containerBlock.id, idx);
  } else if (state.cms.drag.kind === 'block') {
    moveBlockTo(state.cms.drag.id, containerBlock.id, idx);
  }
  state.cms.drag = null;
}

// ---------- Properties panel ----------
function renderProps() {
  const body = document.getElementById('cmsPropsBody');
  body.innerHTML = '';
  const block = findBlock(state.cms.selectedBlockId);
  if (!block) {
    body.appendChild(el('p', { class: 'muted' }, 'Select a block to edit its properties.'));
    return;
  }
  body.appendChild(el('div', { class: 'block-type-label' }, [
    'Type: ',
    el('span', { class: 'type-name' }, BLOCK_LABELS[block.type] || block.type)
  ]));

  const wrap = el('div', { class: 'fields' });
  const p = block.props;

  const onChange = () => {
    renderCanvas();
    renderProps();
  };

  switch (block.type) {
    case 'heading': {
      wrap.appendChild(field('Level', select([
        ['1', 'Heading 1', String(p.level || 2)],
        ['2', 'Heading 2', String(p.level || 2)],
        ['3', 'Heading 3', String(p.level || 2)]
      ], v => { p.level = Number(v); onChange(); })));
      wrap.appendChild(field('Text', textarea(p.text || '', v => { p.text = v; renderCanvas(); })));
      break;
    }
    case 'paragraph': {
      wrap.appendChild(field('Text', textarea(p.text || '', v => { p.text = v; renderCanvas(); })));
      break;
    }
    case 'button': {
      wrap.appendChild(field('Label', input('text', p.label || '', v => { p.label = v; renderCanvas(); })));
      wrap.appendChild(field('URL', input('url', p.url || '', v => { p.url = v; renderCanvas(); })));
      wrap.appendChild(field('Color', input('color', p.color || '#6366f1', v => { p.color = v; renderCanvas(); })));
      break;
    }
    case 'image': {
      wrap.appendChild(field('Image URL', input('text', p.url || '', v => { p.url = v; renderCanvas(); })));
      wrap.appendChild(field('Alt text', input('text', p.alt || '', v => { p.alt = v; renderCanvas(); })));
      break;
    }
    case 'divider': {
      wrap.appendChild(el('p', { class: 'muted', style: 'font-size:12px' }, 'No editable properties.'));
      break;
    }
    case 'spacer': {
      wrap.appendChild(field('Height (px)', input('number', String(p.height || 24), v => {
        const n = Math.max(8, Math.min(300, Number(v) || 24));
        p.height = n;
        renderCanvas();
      })));
      break;
    }
    case 'table': {
      if (!Array.isArray(p.headers)) p.headers = ['Feature', 'Description', 'Status'];
      if (!Array.isArray(p.rows)) p.rows = [];

      wrap.appendChild(checkbox('Show Header Row', p.hasHeader !== false, v => {
        p.hasHeader = v;
        onChange();
      }));
      wrap.appendChild(checkbox('Striped Rows', !!p.striped, v => {
        p.striped = v;
        onChange();
      }));
      wrap.appendChild(checkbox('Borders', !!p.bordered, v => {
        p.bordered = v;
        onChange();
      }));
      wrap.appendChild(checkbox('Compact Padding', !!p.compact, v => {
        p.compact = v;
        onChange();
      }));

      const btnGroup = el('div', { class: 'props-btn-group' }, [
        el('button', {
          type: 'button',
          onclick: () => {
            const colNum = p.headers.length + 1;
            p.headers.push(`Column ${colNum}`);
            p.rows.forEach(r => r.push(''));
            onChange();
          }
        }, '+ Add Col'),
        el('button', {
          type: 'button',
          onclick: () => {
            if (p.headers.length > 1) {
              p.headers.pop();
              p.rows.forEach(r => r.pop());
              onChange();
            }
          }
        }, '- Col'),
        el('button', {
          type: 'button',
          onclick: () => {
            p.rows.push(new Array(p.headers.length).fill(''));
            onChange();
          }
        }, '+ Add Row')
      ]);
      wrap.appendChild(btnGroup);

      const matrixEditor = el('div', { class: 'table-matrix-editor' });
      
      if (p.hasHeader !== false) {
        const headerInputs = p.headers.map((h, colIdx) => {
          return input('text', h, v => {
            p.headers[colIdx] = v;
            renderCanvas();
          });
        });
        matrixEditor.appendChild(el('div', { class: 'table-matrix-row', style: 'font-weight:bold;' }, [
          ...headerInputs,
          el('span', { style: 'width:20px;display:inline-block;' })
        ]));
      }

      p.rows.forEach((row, rowIdx) => {
        const rowInputs = p.headers.map((_, colIdx) => {
          return input('text', row[colIdx] || '', v => {
            row[colIdx] = v;
            renderCanvas();
          });
        });

        const delBtn = el('button', {
          class: 'row-del-btn',
          title: 'Delete row',
          type: 'button',
          onclick: () => {
            p.rows.splice(rowIdx, 1);
            onChange();
          }
        }, '\u00d7');

        matrixEditor.appendChild(el('div', { class: 'table-matrix-row' }, [
          ...rowInputs,
          delBtn
        ]));
      });

      wrap.appendChild(field('Table Cells', matrixEditor));
      break;
    }
    case 'container': {
      if (!Array.isArray(p.children)) p.children = [];

      const modeGroup = el('div', { class: 'props-btn-group' }, [
        el('button', {
          type: 'button',
          class: (p.mode !== 'grid') ? 'active' : '',
          onclick: () => { p.mode = 'flex'; onChange(); }
        }, 'Flexbox Mode'),
        el('button', {
          type: 'button',
          class: (p.mode === 'grid') ? 'active' : '',
          onclick: () => { p.mode = 'grid'; onChange(); }
        }, 'CSS Grid Mode')
      ]);
      wrap.appendChild(field('Layout Mode', modeGroup));

      if (p.mode === 'grid') {
        wrap.appendChild(field('Columns', select([
          ['1', '1 Column', String(p.columns || 2)],
          ['2', '2 Columns', String(p.columns || 2)],
          ['3', '3 Columns', String(p.columns || 2)],
          ['4', '4 Columns', String(p.columns || 2)],
          ['6', '6 Columns', String(p.columns || 2)]
        ], v => { p.columns = Number(v); onChange(); })));
      } else {
        wrap.appendChild(field('Direction', select([
          ['row', 'Row (Horizontal)', p.direction || 'row'],
          ['column', 'Column (Vertical)', p.direction || 'row'],
          ['row-reverse', 'Row Reverse', p.direction || 'row'],
          ['column-reverse', 'Column Reverse', p.direction || 'row']
        ], v => { p.direction = v; onChange(); })));

        wrap.appendChild(field('Justify Content', select([
          ['flex-start', 'Start', p.justify || 'flex-start'],
          ['center', 'Center', p.justify || 'flex-start'],
          ['flex-end', 'End', p.justify || 'flex-start'],
          ['space-between', 'Space Between', p.justify || 'flex-start'],
          ['space-around', 'Space Around', p.justify || 'flex-start'],
          ['space-evenly', 'Space Evenly', p.justify || 'flex-start']
        ], v => { p.justify = v; onChange(); })));

        wrap.appendChild(field('Align Items', select([
          ['stretch', 'Stretch', p.align || 'stretch'],
          ['flex-start', 'Start', p.align || 'stretch'],
          ['center', 'Center', p.align || 'stretch'],
          ['flex-end', 'End', p.align || 'stretch']
        ], v => { p.align = v; onChange(); })));

        wrap.appendChild(checkbox('Wrap Items', p.wrap !== 'nowrap', v => {
          p.wrap = v ? 'wrap' : 'nowrap';
          onChange();
        }));
      }

      wrap.appendChild(field('Gap (px)', input('number', String(p.gap ?? 16), v => {
        p.gap = Math.max(0, Math.min(64, Number(v) || 0));
        renderCanvas();
      })));

      wrap.appendChild(field('Padding (px)', input('number', String(p.padding ?? 16), v => {
        p.padding = Math.max(0, Math.min(64, Number(v) || 0));
        renderCanvas();
      })));

      wrap.appendChild(field('Background', select([
        ['surface', 'Card Surface', p.bg || 'surface'],
        ['subtle', 'Subtle Tint', p.bg || 'surface'],
        ['transparent', 'Transparent', p.bg || 'surface']
      ], v => { p.bg = v; onChange(); })));

      wrap.appendChild(checkbox('Show Container Border', !!p.border, v => {
        p.border = v;
        onChange();
      }));

      wrap.appendChild(field('Border Radius (px)', input('number', String(p.borderRadius ?? 8), v => {
        p.borderRadius = Math.max(0, Math.min(32, Number(v) || 0));
        renderCanvas();
      })));

      wrap.appendChild(el('label', { style: 'font-weight:600;margin-top:14px;display:block;' }, 'Add Block Inside:'));
      const quickAdd = el('div', { class: 'container-quick-add' }, [
        el('button', { type: 'button', onclick: () => insertBlockAt('heading', block.id) }, '+ Heading'),
        el('button', { type: 'button', onclick: () => insertBlockAt('paragraph', block.id) }, '+ Text'),
        el('button', { type: 'button', onclick: () => insertBlockAt('button', block.id) }, '+ Button'),
        el('button', { type: 'button', onclick: () => insertBlockAt('image', block.id) }, '+ Image'),
        el('button', { type: 'button', onclick: () => insertBlockAt('table', block.id) }, '+ Table'),
        el('button', { type: 'button', onclick: () => insertBlockAt('spacer', block.id) }, '+ Spacer')
      ]);
      wrap.appendChild(quickAdd);

      if (p.children.length > 0) {
        wrap.appendChild(el('label', { style: 'font-weight:600;display:block;' }, `Nested Blocks (${p.children.length}):`));
        const childList = el('div', { class: 'container-child-list' });
        p.children.forEach((child, cIdx) => {
          const isChildSelected = child.id === state.cms.selectedBlockId;
          const childRow = el('div', {
            class: `container-child-row${isChildSelected ? ' selected' : ''}`,
            onclick: e => {
              e.stopPropagation();
              selectBlock(child.id);
            }
          }, [
            el('div', { class: 'child-info' }, [
              el('span', { style: 'color:var(--primary);' }, `#${cIdx + 1}`),
              BLOCK_LABELS[child.type] || child.type
            ]),
            el('div', { class: 'child-actions' }, [
              el('button', {
                type: 'button',
                title: 'Move up',
                onclick: e => {
                  e.stopPropagation();
                  moveBlock(child.id, -1);
                }
              }, '\u2191'),
              el('button', {
                type: 'button',
                title: 'Move down',
                onclick: e => {
                  e.stopPropagation();
                  moveBlock(child.id, 1);
                }
              }, '\u2193'),
              el('button', {
                type: 'button',
                class: 'del',
                title: 'Delete block',
                onclick: e => {
                  e.stopPropagation();
                  deleteBlock(child.id);
                }
              }, '\u00d7')
            ])
          ]);
          childList.appendChild(childRow);
        });
        wrap.appendChild(childList);
      }
      break;
    }
  }
  body.appendChild(wrap);
}

function checkbox(label, checked, onToggle) {
  const chk = el('input', { type: 'checkbox', onchange: e => onToggle(e.target.checked) });
  if (checked) chk.checked = true;
  return el('label', { class: 'props-checkbox' }, [chk, label]);
}

function field(label, control) {
  return el('div', { class: 'field' }, [
    el('label', {}, label),
    control
  ]);
}

function input(type, value, onInput) {
  return el('input', {
    type,
    value,
    oninput: e => onInput(e.target.value)
  });
}

function textarea(value, onInput) {
  return el('textarea', {
    oninput: e => onInput(e.target.value)
  }, value);
}

function select(options, onChange) {
  const sel = el('select', { onchange: e => onChange(e.target.value) });
  options.forEach(([val, lbl, sel2]) => {
    sel.appendChild(el('option', { value: val, ...(val === sel2 ? { selected: '' } : {}) }, lbl));
  });
  return sel;
}

function setupCmsEvents() {
  document.getElementById('newPageBtn').onclick = newCmsPage;
  document.getElementById('cmsSaveBtn').onclick = saveCmsPage;
  document.getElementById('cmsDeleteBtn').onclick = deleteCmsPage;

  state.cms.indicator = el('div', { class: 'drop-indicator' });

  const canvas = document.getElementById('cmsCanvas');
  canvas.addEventListener('dragover', onCanvasDragOver);
  canvas.addEventListener('dragleave', onCanvasDragLeave);
  canvas.addEventListener('drop', onCanvasDrop);
  canvas.addEventListener('click', e => {
    if (e.target === canvas || e.target.classList.contains('cms-empty-canvas')) {
      state.cms.selectedBlockId = null;
      renderCanvas();
      renderProps();
    }
  });

  document.querySelectorAll('.palette-item').forEach(item => {
    item.addEventListener('dragstart', onPaletteDragStart);
    item.addEventListener('dragend', onPaletteDragEnd);
  });

  let searchTimer;
  document.getElementById('cmsSearchInput').oninput = e => {
    clearTimeout(searchTimer);
    state.cms.searchQ = e.target.value.trim();
    searchTimer = setTimeout(loadCmsPages, 200);
  };
  document.getElementById('cmsStatusFilter').onchange = e => {
    state.cms.statusFilter = e.target.value;
    loadCmsPages();
  };
  document.getElementById('cmsTitle').oninput = e => {
    if (state.cms.openPage) state.cms.openPage.title = e.target.value;
  };
  document.getElementById('cmsStatus').onchange = e => {
    if (state.cms.openPage) state.cms.openPage.status = e.target.value;
    const link = document.getElementById('cmsPreviewLink');
    if (e.target.value === 'published' && state.cms.openPage && state.cms.openPage.slug) {
      link.href = `/p/${state.cms.openPage.slug}`;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  };

  document.addEventListener('keydown', e => {
    if (state.currentTab !== 'cms') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      saveCmsPage();
    }
  });
}

(async () => {
  setBoardEvents();
  setupCmsEvents();
  setupTabs();
  await loadBoards();
  await loadBoard();
})();
