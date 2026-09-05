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
  del: (u) => api.req('DELETE', u),
  delete: (u) => api.req('DELETE', u)
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
    indicator: null,
    clipboardBlock: null,
    sidebarTab: 'blocks',
    blocksSubTab: 'standard',
    reusableBlocks: [],
    pageDrag: null,
    pageCollapsed: {},
    viewportMode: 'desktop',
    viewportWidth: null,
    viewportOrientation: 'portrait',
    deviceFrame: true,
    isPreviewMode: false
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

function createSvg(html) {
  const div = document.createElement('div');
  div.innerHTML = html.trim();
  return div.firstElementChild;
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = el('div', { class: `toast toast-${type}` }, [
    createSvg(type === 'success' 
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : type === 'danger'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f43f5e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>'
    ),
    el('span', {}, message)
  ]);
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 250);
  }, 2500);
}

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
    const circ = 44;
    const offset = Math.round(circ - (pct / 100) * circ);
    const strokeColor = pct === 100 ? '#10b981' : '#6366f1';

    const ringSvg = createSvg(`<svg class="card-progress-ring-svg" width="18" height="18" viewBox="0 0 20 20">
      <circle class="card-progress-ring-bg" cx="10" cy="10" r="7" />
      <circle class="card-progress-ring-fill" cx="10" cy="10" r="7" stroke="${strokeColor}" stroke-dasharray="${circ}" stroke-dashoffset="${offset}" />
    </svg>`);

    const ringWrap = el('div', {
      class: 'card-progress-ring-wrap',
      title: `Checklist: ${doneChecklist}/${totalChecklist} completed (${pct}%)`
    }, [
      ringSvg,
      el('span', { class: 'card-progress-ring-text' }, `${doneChecklist}/${totalChecklist}`)
    ]);

    meta.appendChild(ringWrap);
  }

  meta.appendChild(el('span', { class: `badge priority-${card.priority}` }, [
    el('span', { style: 'font-size:9px' }, '●'),
    card.priority
  ]));

  if (due.label) {
    const calSvg = createSvg('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>');
    meta.appendChild(el('span', { class: `due ${due.cls}` }, [calSvg, due.label]));
  }

  const cardElements = [];
  if (card.cover) {
    const isImg = card.cover.startsWith('http') || card.cover.startsWith('data:image');
    const coverStyle = isImg ? `background-image:url("${card.cover}");` : `background:${card.cover};`;
    cardElements.push(el('div', { class: 'card-cover-banner', style: coverStyle }));
  }
  cardElements.push(labels);
  cardElements.push(el('div', { class: 'card-title-text' }, card.title));
  cardElements.push(meta);

  const cardNode = el('div', {
    class: 'card',
    dataset: { id: card.id, columnId: card.column_id },
    draggable: 'true'
  }, cardElements);

  cardNode.addEventListener('click', e => {
    if (cardNode.classList.contains('dragging')) return;
    openCard(card.id);
  });
  cardNode.addEventListener('dragstart', onCardDragStart);
  cardNode.addEventListener('dragend', onCardDragEnd);
  return cardNode;
}

function renderAddCardForm(columnId) {
  const textarea = el('textarea', { placeholder: 'Enter a card title...' });
  const form = el('div', { class: 'add-card-form' }, [
    textarea,
    el('div', { class: 'form-actions' }, [
      el('button', {
        class: 'btn primary btn-sm',
        onclick: async () => {
          const title = textarea.value.trim();
          if (!title) return;
          await api.post(`/api/columns/${columnId}/cards`, { title });
          textarea.value = '';
          form.classList.remove('open');
          showToast('Card added', 'success');
          await loadBoard();
        }
      }, 'Add Card'),
      el('button', {
        class: 'btn ghost btn-sm',
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
    title: 'Double-click to rename',
    ondblclick: e => { e.target.removeAttribute('readonly'); e.target.focus(); e.target.select(); },
    onblur: async e => {
      e.target.setAttribute('readonly', 'readonly');
      const newName = e.target.value.trim() || col.name;
      if (newName !== col.name) {
        await api.patch(`/api/columns/${col.id}`, { name: newName });
        col.name = newName;
        showToast('Column renamed');
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

  const plusIcon = createSvg('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  const addBtn = el('button', {
    class: 'add-card-btn',
    onclick: () => {
      const form = columnEl.querySelector('.add-card-form');
      form.classList.add('open');
      form.querySelector('textarea').focus();
    }
  }, [plusIcon, el('span', {}, 'Add a card')]);

  const form = renderAddCardForm(col.id);

  const deleteBtn = el('button', {
    class: 'column-menu',
    title: 'Delete column',
    onclick: async () => {
      if (!confirm(`Delete column "${col.name}" and its cards?`)) return;
      await api.del(`/api/columns/${col.id}`);
      showToast('Column deleted', 'danger');
      await loadBoard();
    }
  }, [createSvg('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>')]);

  const headerLeft = el('div', { class: 'column-header-left' }, [
    el('div', { class: 'column-dot' }),
    titleEl,
    el('span', { class: 'column-count' }, String(cards.length))
  ]);

  const header = el('div', {
    class: 'column-header',
    draggable: 'true'
  }, [
    headerLeft,
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

  // Interactive Ghost Add Column Card
  const ghostPlus = createSvg('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>');
  const ghostCol = el('div', {
    class: 'add-column-ghost',
    title: 'Add new column',
    onclick: () => {
      document.getElementById('addColumnBtn').click();
    }
  }, [
    el('div', { class: 'ghost-icon' }, [ghostPlus]),
    el('span', {}, 'Add New Column')
  ]);
  board.appendChild(ghostCol);
}

function setBoardEvents() {
  const sel = document.getElementById('boardSelect');
  sel.onchange = async e => {
    state.currentBoardId = Number(e.target.value);
    await loadBoard();
  };

  document.getElementById('newBoardBtn').onclick = async () => {
    const name = prompt('Enter new board name:');
    if (!name || !name.trim()) return;
    const b = await api.post('/api/boards', { name: name.trim() });
    await loadBoards();
    state.currentBoardId = b.id;
    sel.value = b.id;
    showToast(`Board "${b.name}" created`, 'success');
    await loadBoard();
  };

  document.getElementById('deleteBoardBtn').onclick = async () => {
    if (!state.currentBoardId) return;
    if (!confirm('Delete this board and all its data?')) return;
    await api.del(`/api/boards/${state.currentBoardId}`);
    state.currentBoardId = null;
    showToast('Board deleted', 'danger');
    await loadBoards();
    await loadBoard();
  };

  document.getElementById('addColumnBtn').onclick = async () => {
    if (!state.currentBoardId) return alert('Please create or select a board first');
    const name = prompt('Enter column name:');
    if (!name || !name.trim()) return;
    await api.post(`/api/boards/${state.currentBoardId}/columns`, { name: name.trim() });
    showToast('Column added', 'success');
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
        resultsEl.appendChild(el('div', { class: 'result muted' }, 'No matching cards found'));
      } else {
        results.forEach(r => {
          const div = el('div', { class: 'result' }, [
            el('div', { style: 'font-weight:600;font-size:13px;color:var(--text-primary)' }, r.title),
            el('div', { class: 'muted', style: 'font-size:11.5px;margin-top:2px' }, (r.description || '').slice(0, 80))
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

  // Global Keyboard Shortcuts (Cmd+K / Ctrl+K, Escape)
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
    }
  });

  document.getElementById('activityBtn').onclick = openActivityPanel;
  document.getElementById('closeActivityBtn').onclick = () => {
    document.getElementById('activityPanel').classList.add('hidden');
  };

  document.getElementById('themeBtn').onclick = () => {
    document.body.classList.toggle('theme-light');
    document.body.classList.toggle('theme-dark');
  };

  // Kanban Canvas Ambient Theme Picker
  const boardThemeSelect = document.getElementById('boardThemeSelect');
  if (boardThemeSelect) {
    const savedTheme = localStorage.getItem('aladen_board_theme') || 'default';
    boardThemeSelect.value = savedTheme;
    applyBoardTheme(savedTheme);
    boardThemeSelect.onchange = () => {
      const val = boardThemeSelect.value;
      localStorage.setItem('aladen_board_theme', val);
      applyBoardTheme(val);
    };
  }

  document.querySelectorAll('.close-modal, .modal-backdrop').forEach(n => {
    n.onclick = closeCardModal;
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closeCardModal();
      document.getElementById('activityPanel').classList.add('hidden');
      resultsEl.classList.add('hidden');
    }
  });

  document.getElementById('cardTitle').onblur = saveCardFields;
  document.getElementById('cardDescription').onblur = saveCardFields;
  document.getElementById('cardDueDate').onchange = saveCardFields;
  document.getElementById('cardPriority').onchange = saveCardFields;

  const cardCoverInput = document.getElementById('cardCoverInput');
  if (cardCoverInput) {
    cardCoverInput.onchange = async () => {
      if (!state.openCardId) return;
      const card = findCard(state.openCardId);
      if (!card) return;
      const coverVal = cardCoverInput.value.trim();
      card.cover = coverVal;
      await api.patch(`/api/cards/${state.openCardId}`, { cover: coverVal });
      renderBoard();
      showToast('Card cover updated');
    };
  }
  document.querySelectorAll('.cover-preset-dot:not(#cardClearCoverBtn)').forEach(btn => {
    btn.onclick = async () => {
      if (!state.openCardId) return;
      const card = findCard(state.openCardId);
      if (!card) return;
      const coverVal = btn.dataset.cover || '';
      card.cover = coverVal;
      if (cardCoverInput) cardCoverInput.value = coverVal;
      await api.patch(`/api/cards/${state.openCardId}`, { cover: coverVal });
      renderBoard();
      showToast('Card cover gradient applied');
    };
  });
  const cardClearCoverBtn = document.getElementById('cardClearCoverBtn');
  if (cardClearCoverBtn) {
    cardClearCoverBtn.onclick = async () => {
      if (!state.openCardId) return;
      const card = findCard(state.openCardId);
      if (!card) return;
      card.cover = '';
      if (cardCoverInput) cardCoverInput.value = '';
      await api.patch(`/api/cards/${state.openCardId}`, { cover: '' });
      renderBoard();
      showToast('Card cover removed');
    };
  }

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
    showToast('Card archived');
    await loadBoard();
  };
  document.getElementById('deleteCardBtn').onclick = async () => {
    if (!state.openCardId) return;
    if (!confirm('Delete this card permanently?')) return;
    await api.del(`/api/cards/${state.openCardId}`);
    closeCardModal();
    showToast('Card deleted', 'danger');
    await loadBoard();
  };
}

function applyBoardTheme(theme) {
  const board = document.getElementById('board');
  if (!board) return;
  board.classList.remove('board-theme-aurora', 'board-theme-nebula', 'board-theme-cyberpunk', 'board-theme-blueprint');
  if (theme && theme !== 'default') {
    board.classList.add(`board-theme-${theme}`);
  }
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
  const coverInput = document.getElementById('cardCoverInput');
  if (coverInput) coverInput.value = card.cover || '';
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

// ---------- Tabs & Pages Popup ----------
function togglePagesPopup() {
  const popup = document.getElementById('cmsPagesPopup');
  const trigger = document.getElementById('cmsPagesDropdownTrigger');
  if (!popup) return;
  const isHidden = popup.classList.contains('hidden');
  if (isHidden) {
    popup.classList.remove('hidden');
    if (trigger) {
      trigger.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
    }
    renderCmsPages();
    const search = document.getElementById('cmsSearchInput');
    if (search) search.focus();
  } else {
    closePagesPopup();
  }
}

function closePagesPopup() {
  const popup = document.getElementById('cmsPagesPopup');
  const trigger = document.getElementById('cmsPagesDropdownTrigger');
  if (popup) popup.classList.add('hidden');
  if (trigger) {
    trigger.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
  }
}

function updateCurrentPageTopbarLabel() {
  const labelEl = document.getElementById('cmsCurrentPageLabel');
  if (!labelEl) return;
  if (state.cms.openPage) {
    const title = (state.cms.openPage.title || '').trim();
    labelEl.textContent = title ? title : 'Untitled';
    labelEl.title = title ? `Current Page: ${title}` : 'Current Page: Untitled';
  } else {
    labelEl.textContent = 'Pages';
    labelEl.title = 'Pages & Documents Explorer';
  }
}

function setupTabs() {
  document.querySelectorAll('.main-tabs-group .tab').forEach(t => {
    t.onclick = () => switchTab(t.dataset.tab);
  });

  const trigger = document.getElementById('cmsPagesDropdownTrigger');
  if (trigger) {
    trigger.onclick = e => {
      e.stopPropagation();
      togglePagesPopup();
    };
  }

  const closeBtn = document.getElementById('cmsClosePagesPopupBtn');
  if (closeBtn) {
    closeBtn.onclick = e => {
      e.stopPropagation();
      closePagesPopup();
    };
  }

  document.addEventListener('click', e => {
    const popup = document.getElementById('cmsPagesPopup');
    const group = document.querySelector('.cms-sub-tabs-group');
    if (popup && !popup.classList.contains('hidden') && group && !group.contains(e.target)) {
      closePagesPopup();
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      closePagesPopup();
    }
  });
}

function switchTab(name) {
  state.currentTab = name;
  document.querySelectorAll('.main-tabs-group .tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('[data-tab-panel]').forEach(p => {
    p.classList.toggle('hidden', p.dataset.tabPanel !== name);
  });
  document.querySelectorAll('[data-tab-show]').forEach(s => {
    s.classList.toggle('hidden', s.dataset.tabShow !== name);
  });
  if (name === 'cms') {
    loadCms();
  }
}

// ---------- CMS (block-based site builder) ----------
const BLOCK_DEFAULTS = {
  header: {
    brandName: 'Aladen Studio',
    brandLogo: '',
    brandIcon: '✦',
    brandUrl: '#',
    logoHeight: 28,
    layout: 'spread',
    styleVariant: 'glass',
    sticky: false,
    showTopBar: false,
    topBarBadge: 'NEW',
    topBarText: 'Spring 2.0 release is now live with drag & drop header carousel',
    topBarLink: '#',
    showSearch: false,
    searchPlaceholder: 'Search...',
    showCta: true,
    ctaLabel: 'Get Started',
    ctaUrl: '#',
    ctaVariant: 'filled',
    links: [
      { label: 'Home', url: '#' },
      { label: 'Features', url: '#features' },
      { label: 'Showcase', url: '#showcase' },
      { label: 'Pricing', url: '#pricing' }
    ],
    enableCarousel: true,
    carouselItemWidth: 'medium',
    carouselAutoplay: false,
    carouselInterval: 4,
    carouselShowArrows: true,
    carouselShowPrevNext: true,
    carouselArrowStyle: 'circle',
    carouselArrowBehavior: 'smooth',
    carouselShowDots: true,
    carouselDotStyle: 'bars',
    carouselDotBehavior: 'smooth',
    showSlideCounter: true,
    children: [
      {
        id: 'hdr_c1',
        type: 'callout',
        props: {
          type: 'info',
          icon: '🚀',
          title: 'Spring 2.0 Released',
          text: 'Modular website composition with drag & drop carousel slots.'
        }
      },
      {
        id: 'hdr_c2',
        type: 'button',
        props: {
          label: '✦ Explore Live Showcase',
          url: '#showcase',
          variant: 'filled',
          color: '#6366f1',
          size: 'medium'
        }
      },
      {
        id: 'hdr_c3',
        type: 'stat',
        props: {
          label: 'Workflow Boost',
          value: '10x Faster',
          subtext: 'Built with Aladenflow',
          trend: '+99%',
          trendDirection: 'up'
        }
      }
    ]
  },
  heading: {
    level: 2,
    text: 'New heading',
    align: 'left',
    color: '',
    margin: 12
  },
  paragraph: {
    text: 'New paragraph. Click to edit.',
    align: 'left',
    size: 'normal',
    color: '',
    bold: false,
    italic: false
  },
  button: {
    label: 'Click me',
    url: 'https://example.com',
    color: '#6366f1',
    textColor: '#ffffff',
    variant: 'filled',
    size: 'medium',
    align: 'left',
    borderRadius: 8,
    newTab: true
  },
  image: {
    url: '',
    alt: '',
    caption: '',
    linkUrl: '',
    width: '100%',
    align: 'center',
    objectFit: 'cover',
    borderRadius: 8,
    shadow: false,
    border: false
  },
  carousel: {
    slides: [
      { url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1000&auto=format&fit=crop', caption: 'Dynamic Abstract Composition' },
      { url: 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=1000&auto=format&fit=crop', caption: 'Cyberpunk Neon Horizon' },
      { url: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=1000&auto=format&fit=crop', caption: 'Tropical Ocean Sunset' }
    ],
    aspectRatio: '16/9',
    autoplay: false,
    interval: 4,
    showArrows: true,
    showDots: true,
    showCaptions: true,
    borderRadius: 10
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
    text: 'You can combine Kanban project tracking with full visual site publishing on one canvas.',
    color: ''
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
      { title: 'Overview', content: 'Explore our core capabilities and workflows designed for modern creators and agile teams.' },
      { title: 'Features', content: 'Real-time drag-and-drop, responsive layout previews, AI-assisted generation, and Kanban boards.' },
      { title: 'Roadmap', content: 'Upcoming integrations include cloud syncing, webhook notifications, and multi-user collaboration.' }
    ]
  },
  pricing: {
    plan: 'Pro Plan',
    price: '$29',
    period: '/month',
    description: 'Everything you need to launch and scale your online presence.',
    features: [
      'Unlimited visual pages & blocks',
      'Integrated Kanban task tracking',
      'Local Ollama & Cloud AI generation',
      'Custom styling & responsive previews'
    ],
    ctaLabel: 'Get Started Today',
    ctaUrl: '#',
    isPopular: true,
    badge: 'Most Popular'
  },
  stat: {
    label: 'Monthly Active Users',
    value: '128.4K',
    subtext: 'vs previous month',
    trend: '+24.8%',
    trendDirection: 'up'
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

const BLOCK_LABELS = {
  header: 'Custom Header (Navbar)',
  heading: 'Heading',
  paragraph: 'Paragraph',
  button: 'Button',
  image: 'Image',
  carousel: 'Carousel (Slider)',
  divider: 'Divider',
  spacer: 'Spacer',
  table: 'Table',
  container: 'Container (Grid / Flex)',
  callout: 'Callout Box',
  accordion: 'Accordion (FAQ)',
  tabs: 'Tabs (Panels)',
  pricing: 'Pricing Card',
  stat: 'Stats & Metric',
  testimonial: 'Testimonial Card',
  video: 'Video Embed',
  code: 'Code Block',
  bento: 'Bento Grid',
  comparison: 'Before / After Slider',
  'tilt-card': '3D Tilt Card',
  marquee: 'Infinite Marquee',
  countdown: 'Countdown Timer',
  timeline: 'Roadmap Timeline',
  form: 'Contact Form',
  audio: 'Audio Player'
};

function newBlockId() {
  return 'b' + Math.random().toString(36).slice(2, 10);
}

function makeBlock(type) {
  const defaults = BLOCK_DEFAULTS[type] ? JSON.parse(JSON.stringify(BLOCK_DEFAULTS[type])) : {};
  if (Array.isArray(defaults.children)) {
    defaults.children = defaults.children.map(child => cloneBlockWithNewIds(child));
  }
  return {
    id: newBlockId(),
    type,
    props: defaults
  };
}

async function loadCms() {
  await Promise.all([loadCmsPages(), loadCmsTags(), loadReusableBlocks()]);
}

async function loadReusableBlocks() {
  try {
    state.cms.reusableBlocks = await api.get('/api/reusable-blocks');
    renderReusableBlocks();
  } catch (err) {
    console.error('Failed to load reusable blocks:', err);
  }
}

function renderReusableBlocks() {
  const list = document.getElementById('cmsCustomBlocksList');
  const countBadge = document.getElementById('cmsReusableCountBadge');
  if (!list) return;
  list.innerHTML = '';

  const count = (state.cms.reusableBlocks || []).length;
  if (countBadge) countBadge.textContent = String(count);

  if (!count) {
    list.appendChild(el('div', { class: 'tree-empty-state', style: 'padding:24px 12px;' }, [
      createSvg('<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px;display:block;opacity:0.6;"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'),
      el('p', { style: 'font-size:11.5px;line-height:1.4;' }, 'No saved components yet.'),
      el('p', { style: 'font-size:10.5px;color:var(--text-tertiary);margin-top:4px;' }, 'Select any component on canvas and click "Save Reusable" in the inspector.')
    ]));
    return;
  }

  state.cms.reusableBlocks.forEach(r => {
    const rootType = r.block_data?.type || 'container';
    const isContainer = rootType === 'container';
    let subSnippet = `Custom ${BLOCK_LABELS[rootType] || rootType}`;
    if (isContainer && Array.isArray(r.block_data?.props?.children)) {
      subSnippet = `${r.block_data.props.children.length} nested item(s)`;
    }

    const item = el('div', {
      class: 'palette-item',
      draggable: 'true',
      dataset: { blockType: 'reusable', reusableId: String(r.id) },
      ondragstart: onPaletteDragStart,
      ondragend: onPaletteDragEnd
    }, [
      el('div', { class: `palette-icon-wrap ${rootType}-icon` }, [
        getBlockIconSvg(rootType)
      ]),
      el('div', { class: 'palette-info' }, [
        el('span', { class: 'palette-label', title: r.name }, r.name),
        el('span', { class: 'palette-sub' }, subSnippet)
      ]),
      el('button', {
        type: 'button',
        class: 'custom-block-delete',
        title: 'Delete saved component',
        onclick: e => {
          e.stopPropagation();
          deleteReusableBlock(r.id, r.name);
        }
      }, [
        createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>')
      ])
    ]);

    list.appendChild(item);
  });
}

async function deleteReusableBlock(id, name) {
  if (!confirm(`Delete saved reusable component "${name}"?`)) return;
  try {
    await api.delete(`/api/reusable-blocks/${id}`);
    await loadReusableBlocks();
    showToast('Reusable component deleted', 'info');
  } catch (err) {
    console.error(err);
    showToast('Failed to delete reusable component', 'error');
  }
}

function switchBlocksSubTab(tab) {
  state.cms.blocksSubTab = tab;
  const stdBtn = document.getElementById('cmsSubTabStandard');
  const customBtn = document.getElementById('cmsSubTabCustom');
  const stdView = document.getElementById('cmsStandardBlocksView');
  const customView = document.getElementById('cmsCustomBlocksView');

  if (tab === 'custom') {
    if (stdBtn) stdBtn.classList.remove('active');
    if (customBtn) customBtn.classList.add('active');
    if (stdView) stdView.classList.add('hidden');
    if (customView) customView.classList.remove('hidden');
    renderReusableBlocks();
  } else {
    if (customBtn) customBtn.classList.remove('active');
    if (stdBtn) stdBtn.classList.add('active');
    if (customView) customView.classList.add('hidden');
    if (stdView) stdView.classList.remove('hidden');
  }
}

async function saveSelectedAsReusableBlock(blockId) {
  const block = findBlock(blockId);
  if (!block) return;
  const defaultName = (block.props && (block.props.text || block.props.label || block.props.caption))
    ? `${BLOCK_LABELS[block.type] || block.type}: ${(block.props.text || block.props.label || block.props.caption).slice(0, 20)}`
    : `Custom ${BLOCK_LABELS[block.type] || block.type}`;

  const name = prompt('Enter a name for this reusable component:', defaultName);
  if (!name || !name.trim()) return;

  try {
    const cleanBlock = JSON.parse(JSON.stringify(block));
    await api.post('/api/reusable-blocks', {
      name: name.trim(),
      category: block.type,
      block_data: cleanBlock
    });
    await loadReusableBlocks();
    switchBlocksSubTab('custom');
    showToast(`Saved "${name.trim()}" to Reusable Blocks!`, 'success');
  } catch (err) {
    console.error(err);
    showToast('Failed to save reusable block', 'error');
  }
}

async function loadCmsPages() {
  const params = new URLSearchParams();
  if (state.cms.searchQ) params.set('q', state.cms.searchQ);
  if (state.cms.statusFilter) params.set('status', state.cms.statusFilter);
  if (state.cms.selectedTag) params.set('tag', state.cms.selectedTag);
  state.cms.pages = await api.get(`/api/pages?${params.toString()}`);
  renderCmsPages();
  if (!state.cms.openPageId && state.cms.pages.length > 0) {
    const firstPage = state.cms.pages.find(p => p.is_first_page) || state.cms.pages[0];
    if (firstPage) {
      openCmsPage(firstPage.id);
    }
  }
}

async function loadCmsTags() {
  state.cms.tags = await api.get('/api/tags');
  renderCmsTags();
}

function getPageFullPath(pageId) {
  const segments = [];
  let curr = state.cms.pages.find(p => p.id === pageId);
  const visited = new Set();
  while (curr && !visited.has(curr.id)) {
    visited.add(curr.id);
    segments.unshift(curr.slug || 'untitled');
    curr = curr.parent_id != null ? state.cms.pages.find(p => p.id === curr.parent_id) : null;
  }
  return '/' + segments.join('/');
}

function showPathTooltip(e, pathText) {
  let tip = document.getElementById('cmsPathTooltip');
  if (!tip) {
    tip = el('div', { id: 'cmsPathTooltip', class: 'cms-path-tooltip' });
    document.body.appendChild(tip);
  }
  tip.textContent = pathText;
  tip.classList.add('visible');

  const rect = e.currentTarget.getBoundingClientRect();
  const tipWidth = tip.offsetWidth;
  let top = rect.top - tip.offsetHeight - 6;
  let left = rect.left + (rect.width / 2) - (tipWidth / 2);

  if (top < 10) top = rect.bottom + 6;
  if (left < 10) left = 10;

  tip.style.top = `${top}px`;
  tip.style.left = `${left}px`;
}

function hidePathTooltip() {
  const tip = document.getElementById('cmsPathTooltip');
  if (tip) tip.classList.remove('visible');
}

function isPageDescendant(parentPageId, testPageId) {
  if (Number(parentPageId) === Number(testPageId)) return true;
  const children = state.cms.pages.filter(p => Number(p.parent_id) === Number(parentPageId));
  for (const child of children) {
    if (Number(child.id) === Number(testPageId) || isPageDescendant(child.id, testPageId)) {
      return true;
    }
  }
  return false;
}

function renderCmsPages() {
  const list = document.getElementById('cmsPagesList');
  if (!list) return;
  list.innerHTML = '';

  if (!state.cms.pages.length) {
    list.appendChild(el('div', { class: 'muted', style: 'font-size:12px; padding:12px;' }, 'No pages yet. Click "+ New Page" to create one.'));
    return;
  }

  // Build tree hierarchy
  const topCount = document.getElementById('cmsTopPagesCount');
  if (topCount) topCount.textContent = String(state.cms.pages.length);

  const pageMap = new Map();
  state.cms.pages.forEach(p => {
    pageMap.set(p.id, { ...p, children: [] });
  });

  const roots = [];
  state.cms.pages.forEach(p => {
    const node = pageMap.get(p.id);
    if (p.parent_id != null && pageMap.has(Number(p.parent_id))) {
      pageMap.get(Number(p.parent_id)).children.push(node);
    } else {
      roots.push(node);
    }
  });

  function sortNodes(nodes) {
    nodes.sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
    nodes.forEach(n => sortNodes(n.children));
  }
  sortNodes(roots);

  function renderPageNode(pageNode, depth = 0) {
    const hasChildren = pageNode.children && pageNode.children.length > 0;
    const isSelected = pageNode.id === state.cms.openPageId;
    const isCollapsed = !!state.cms.pageCollapsed?.[pageNode.id];

    const wrap = el('div', { class: `cms-page-tree-node ${isSelected ? 'selected' : ''}` });
    const row = el('div', {
      class: `cms-page-item ${isSelected ? 'selected' : ''}`,
      draggable: 'true',
      dataset: { pageId: String(pageNode.id) },
      onclick: () => openCmsPage(pageNode.id),
      ondragstart: e => {
        e.stopPropagation();
        state.cms.pageDrag = { id: pageNode.id };
        wrap.classList.add('dragging');
        e.dataTransfer.setData('text/plain', String(pageNode.id));
        e.dataTransfer.effectAllowed = 'move';
      },
      ondragend: e => {
        e.stopPropagation();
        document.querySelectorAll('.cms-page-tree-node.dragging').forEach(n => n.classList.remove('dragging'));
        document.querySelectorAll('.cms-page-item').forEach(r => {
          r.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
          delete r.dataset.dropPos;
        });
        state.cms.pageDrag = null;
      },
      ondragover: e => {
        if (!state.cms.pageDrag || Number(state.cms.pageDrag.id) === Number(pageNode.id) || isPageDescendant(state.cms.pageDrag.id, pageNode.id)) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';

        const rect = row.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;

        row.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
        if (relY >= 0.25 && relY <= 0.75) {
          row.classList.add('drag-target-inside');
          row.dataset.dropPos = 'inside';
        } else if (relY < 0.25) {
          row.classList.add('drag-target-before');
          row.dataset.dropPos = 'before';
        } else {
          row.classList.add('drag-target-after');
          row.dataset.dropPos = 'after';
        }
      },
      ondragleave: e => {
        if (e.relatedTarget && row.contains(e.relatedTarget)) return;
        row.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
        delete row.dataset.dropPos;
      },
      ondrop: async e => {
        e.preventDefault();
        e.stopPropagation();
        const dropPos = row.dataset.dropPos || 'after';
        row.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
        delete row.dataset.dropPos;

        if (!state.cms.pageDrag || Number(state.cms.pageDrag.id) === Number(pageNode.id) || isPageDescendant(state.cms.pageDrag.id, pageNode.id)) {
          return;
        }

        const draggedId = Number(state.cms.pageDrag.id);
        state.cms.pageDrag = null;

        let newParentId = null;
        let newSiblings = [];

        if (dropPos === 'inside') {
          newParentId = Number(pageNode.id);
          if (!state.cms.pageCollapsed) state.cms.pageCollapsed = {};
          state.cms.pageCollapsed[pageNode.id] = false;
          const currentChildren = state.cms.pages
            .filter(p => (p.parent_id != null ? Number(p.parent_id) : null) === newParentId && Number(p.id) !== draggedId)
            .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
          newSiblings = [...currentChildren, { id: draggedId }];
        } else {
          newParentId = pageNode.parent_id != null ? Number(pageNode.parent_id) : null;
          const currentSiblings = state.cms.pages
            .filter(p => (p.parent_id != null ? Number(p.parent_id) : null) === newParentId && Number(p.id) !== draggedId)
            .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));
          
          const targetIndex = currentSiblings.findIndex(p => Number(p.id) === Number(pageNode.id));
          if (targetIndex >= 0) {
            const insertIdx = dropPos === 'before' ? targetIndex : targetIndex + 1;
            currentSiblings.splice(insertIdx, 0, { id: draggedId });
            newSiblings = currentSiblings;
          } else {
            newSiblings = [...currentSiblings, { id: draggedId }];
          }
        }

        const items = newSiblings.map((item, idx) => ({
          id: Number(item.id),
          parent_id: newParentId,
          position: idx
        }));

        try {
          await api.post('/api/pages/reorder', { items });
          await loadCmsPages();
          showToast('Page order updated', 'success');
        } catch (err) {
          console.error(err);
          showToast('Failed to move page', 'error');
        }
      }
    });

    // Left Toggle Arrow or Spacer
    if (hasChildren) {
      const toggle = el('button', {
        type: 'button',
        class: `page-tree-toggle ${isCollapsed ? 'collapsed' : ''}`,
        title: isCollapsed ? 'Expand subpages' : 'Collapse subpages',
        onclick: e => {
          e.stopPropagation();
          if (!state.cms.pageCollapsed) state.cms.pageCollapsed = {};
          state.cms.pageCollapsed[pageNode.id] = !isCollapsed;
          renderCmsPages();
        }
      }, [createSvg('<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>')]);
      row.appendChild(toggle);
    } else {
      row.appendChild(el('span', { class: 'page-tree-spacer' }));
    }

    // Page Icon
    const isFirstPage = !!pageNode.is_first_page;
    const iconSvg = hasChildren
      ? createSvg('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>')
      : isFirstPage
        ? createSvg('<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>')
        : createSvg('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>');
    row.appendChild(el('span', { class: `page-node-icon ${hasChildren ? 'folder-icon' : ''} ${isFirstPage ? 'first-page' : ''}` }, [iconSvg]));

    // Content
    const fullPath = getPageFullPath(pageNode.id);
    const metaBadges = [
      isFirstPage ? el('span', { class: 'p-first-badge' }, [
        el('span', {}, '★ First')
      ]) : null,
      el('span', { class: `p-status ${pageNode.status}` }, pageNode.status),
      el('span', {
        class: 'p-slug',
        onmouseenter: e => showPathTooltip(e, fullPath),
        onmouseleave: hidePathTooltip
      }, `/${pageNode.slug}`)
    ].filter(Boolean);

    const info = el('div', { class: 'page-node-info' }, [
      el('div', { class: 'p-title', title: pageNode.title || '(untitled)' }, pageNode.title || '(untitled)'),
      el('div', { class: 'p-meta' }, metaBadges)
    ]);
    row.appendChild(info);

    // Actions (Set First, Add subpage & Delete)
    const actions = el('div', { class: 'page-node-actions' }, [
      el('button', {
        type: 'button',
        class: `page-action-btn first-page ${isFirstPage ? 'is-active' : ''}`,
        title: isFirstPage ? 'Current First Page (Homepage)' : 'Set as First Page (Homepage)',
        onclick: async e => {
          e.stopPropagation();
          if (!isFirstPage) await setFirstPage(pageNode.id);
        }
      }, [createSvg(`<svg width="11" height="11" viewBox="0 0 24 24" fill="${isFirstPage ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`)]),
      el('button', {
        type: 'button',
        class: 'page-action-btn',
        title: 'Add child subpage inside this page',
        onclick: e => {
          e.stopPropagation();
          newCmsPage(pageNode.id);
        }
      }, [createSvg('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>')]),
      el('button', {
        type: 'button',
        class: 'page-action-btn delete-btn',
        title: 'Delete page',
        onclick: e => {
          e.stopPropagation();
          deleteCmsPage(pageNode.id);
        }
      }, [createSvg('<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>')])
    ]);
    row.appendChild(actions);

    wrap.appendChild(row);

    // Render child subpages
    if (hasChildren && !isCollapsed) {
      const childWrap = el('div', { class: 'page-tree-children' });
      pageNode.children.forEach(child => {
        childWrap.appendChild(renderPageNode(child, depth + 1));
      });
      wrap.appendChild(childWrap);
    }

    return wrap;
  }

  roots.forEach(rootNode => {
    list.appendChild(renderPageNode(rootNode, 0));
  });

  // Root drop target for moving back to top level
  const rootDropzone = el('div', {
    class: 'page-root-dropzone',
    ondragover: e => {
      if (!state.cms.pageDrag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      rootDropzone.classList.add('active');
    },
    ondragleave: () => {
      rootDropzone.classList.remove('active');
    },
    ondrop: async e => {
      e.preventDefault();
      rootDropzone.classList.remove('active');
      if (!state.cms.pageDrag) return;
      const draggedId = Number(state.cms.pageDrag.id);
      state.cms.pageDrag = null;

      const topLevelPages = state.cms.pages
        .filter(p => (p.parent_id == null || p.parent_id === '') && Number(p.id) !== draggedId)
        .sort((a, b) => (Number(a.position) || 0) - (Number(b.position) || 0));

      topLevelPages.push({ id: draggedId });

      const items = topLevelPages.map((item, idx) => ({
        id: Number(item.id),
        parent_id: null,
        position: idx
      }));

      try {
        await api.post('/api/pages/reorder', { items });
        await loadCmsPages();
        showToast('Moved page to top level', 'success');
      } catch (err) {
        console.error(err);
        showToast('Failed to move page', 'error');
      }
    }
  }, 'Drop here to move to top level (no parent)');

  list.appendChild(rootDropzone);
}

async function deleteCmsPage(id = null) {
  const targetId = id != null ? Number(id) : (state.cms.openPageId ? Number(state.cms.openPageId) : null);
  if (!targetId) {
    state.cms.openPageId = null;
    state.cms.openPage = null;
    document.getElementById('cmsEmpty')?.classList.remove('hidden');
    document.getElementById('cmsEditorWrap')?.classList.add('hidden');
    return;
  }
  const targetPage = state.cms.pages.find(x => Number(x.id) === targetId) || (Number(state.cms.openPageId) === targetId ? state.cms.openPage : null);
  const title = targetPage ? targetPage.title || 'Untitled' : 'this page';
  if (!confirm(`Are you sure you want to delete "${title}"?`)) return;
  try {
    await api.del(`/api/pages/${targetId}`);
    if (Number(state.cms.openPageId) === targetId) {
      state.cms.openPageId = null;
      state.cms.openPage = null;
      state.cms.selectedBlockId = null;
      document.getElementById('cmsEditorWrap')?.classList.add('hidden');
      document.getElementById('cmsEmpty')?.classList.remove('hidden');
      updateCurrentPageTopbarLabel();
      switchSidebarTab('blocks');
    }
    await loadCms();
    showToast('Page deleted', 'info');
  } catch (err) {
    console.error(err);
    showToast('Failed to delete page', 'error');
  }
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
  page.settings = (page.settings && typeof page.settings === 'object') ? page.settings : {
    maxWidth: '820px',
    bg: 'default',
    customBg: '#0f172a',
    paddingX: 36,
    paddingY: 44,
    marginY: 0,
    marginX: 0,
    borderRadius: 16,
    fontFamily: 'system',
    align: 'center'
  };
  document.getElementById('cmsEmpty').classList.add('hidden');
  document.getElementById('cmsEditorWrap').classList.remove('hidden');
  document.getElementById('cmsTitle').value = page.title || '';
  document.getElementById('cmsSlug').value = page.slug || '';
  document.getElementById('cmsStatus').value = page.status || 'draft';
  document.getElementById('cmsTagsInput').value = (page.tags || []).join(', ');
  const previewLink = document.getElementById('cmsPreviewLink');
  if (previewLink) {
    if (page.slug) {
      previewLink.href = `/p/${page.slug}`;
      previewLink.classList.remove('hidden');
      previewLink.title = page.status === 'published' ? 'View live published website' : 'Open live draft preview in new tab';
    } else {
      previewLink.classList.add('hidden');
    }
  }
  setSaveStatus('saved');
  updateViewportUI();
  updateFirstPageUI();
  applyCanvasSettings();
  renderCanvas();
  renderProps();
  renderCmsPages();
  updateCurrentPageTopbarLabel();
  closePagesPopup();
  switchSidebarTab('blocks');
}

function updateFirstPageUI() {
  const btn = document.getElementById('cmsFirstPageToggleBtn');
  if (!btn) return;
  if (!state.cms.openPage) {
    btn.classList.add('hidden');
    return;
  }
  btn.classList.remove('hidden');
  const isFirst = !!state.cms.openPage.is_first_page;
  btn.classList.toggle('is-first', isFirst);
  const icon = btn.querySelector('.first-page-icon');
  const text = btn.querySelector('.first-page-text');
  if (icon) icon.textContent = isFirst ? '★' : '☆';
  if (text) text.textContent = isFirst ? 'First Page' : 'Set First';
  btn.title = isFirst
    ? 'This is the First Page (Homepage) of your website (/p)'
    : 'Click to set this page as the First Page (Homepage)';
}

async function setFirstPage(pageId) {
  const id = Number(pageId);
  try {
    await api.post(`/api/pages/${id}/set-first`);
    state.cms.pages.forEach(p => {
      p.is_first_page = (p.id === id ? 1 : 0);
    });
    if (state.cms.openPage) {
      state.cms.openPage.is_first_page = (state.cms.openPage.id === id ? 1 : 0);
    }
    renderCmsPages();
    updateFirstPageUI();
    renderProps();
    const pg = state.cms.pages.find(p => p.id === id);
    showToast(`"${pg?.title || 'Page'}" set as First Page (Homepage)`, 'success');
  } catch (err) {
    showToast('Failed to set first page: ' + (err.message || err), 'error');
  }
}

function newCmsPage(parentId = null) {
  state.cms.openPageId = null;
  state.cms.openPage = {
    title: '',
    slug: '',
    status: 'draft',
    parent_id: parentId != null ? Number(parentId) : null,
    tags: [],
    blocks: [],
    settings: {
      maxWidth: '820px',
      bg: 'default',
      customBg: '#0f172a',
      paddingX: 36,
      paddingY: 44,
      marginY: 0,
      marginX: 0,
      borderRadius: 16,
      fontFamily: 'system',
      align: 'center'
    }
  };
  state.cms.selectedBlockId = null;
  document.getElementById('cmsEmpty').classList.add('hidden');
  document.getElementById('cmsEditorWrap').classList.remove('hidden');
  document.getElementById('cmsTitle').value = '';
  document.getElementById('cmsSlug').value = '';
  document.getElementById('cmsStatus').value = 'draft';
  document.getElementById('cmsTagsInput').value = '';
  document.getElementById('cmsPreviewLink').classList.add('hidden');
  setSaveStatus('saved');
  updateFirstPageUI();
  updateViewportUI();
  applyCanvasSettings();
  renderCanvas();
  renderProps();
  document.getElementById('cmsTitle').focus();
  renderCmsPages();
  updateCurrentPageTopbarLabel();
  closePagesPopup();
  switchSidebarTab('blocks');
}

let autoSaveTimer = null;

function setSaveStatus(status) {
  const badge = document.getElementById('cmsAutoSaveBadge');
  if (!badge) return;
  badge.className = `auto-save-badge ${status}`;
  const txt = badge.querySelector('.save-status-text');
  if (txt) {
    if (status === 'saving') txt.textContent = 'Saving...';
    else if (status === 'saved') txt.textContent = 'Saved';
    else if (status === 'error') txt.textContent = 'Save error';
  }
}

function triggerAutoSave(delay = 350) {
  if (!state.cms.openPage) return;
  setSaveStatus('saving');
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    await autoSaveCmsPage();
  }, delay);
}

async function autoSaveCmsPage() {
  if (!state.cms.openPage) return;
  const titleInput = document.getElementById('cmsTitle');
  const title = (titleInput && titleInput.value ? titleInput.value : state.cms.openPage.title || '').trim() || 'Untitled Page';
  const statusEl = document.getElementById('cmsStatus');
  const status = statusEl && statusEl.value ? statusEl.value : (state.cms.openPage.status || 'draft');
  const tagsInput = document.getElementById('cmsTagsInput');
  const tags = tagsInput ? tagsInput.value.split(',').map(t => t.trim()).filter(Boolean) : (state.cms.openPage.tags || []);
  const blocks = state.cms.openPage.blocks || [];
  const settings = state.cms.openPage.settings || {};

  const parent_id = state.cms.openPage.parent_id ?? null;

  try {
    if (state.cms.openPageId) {
      await api.patch(`/api/pages/${state.cms.openPageId}`, { title, blocks, status, tags, settings, parent_id });
    } else {
      const r = await api.post('/api/pages', { title, blocks, status, tags, settings, parent_id });
      state.cms.openPageId = r.id;
      state.cms.openPage.slug = r.slug;
      const slugInput = document.getElementById('cmsSlug');
      if (slugInput) slugInput.value = r.slug;
    }
    state.cms.openPage.title = title;
    state.cms.openPage.status = status;
    state.cms.openPage.tags = tags;
    state.cms.openPage.settings = settings;
    state.cms.openPage.parent_id = parent_id;

    const previewLink = document.getElementById('cmsPreviewLink');
    if (previewLink) {
      if (state.cms.openPage.slug) {
        previewLink.href = `/p/${state.cms.openPage.slug}`;
        previewLink.classList.remove('hidden');
        previewLink.title = status === 'published' ? 'View live published website' : 'Open live draft preview in new tab';
      } else {
        previewLink.classList.add('hidden');
      }
    }

    setSaveStatus('saved');
    // Silently update page list
    state.cms.pages = await api.get('/api/pages');
    renderCmsPages();
  } catch (err) {
    console.error('Auto-save error:', err);
    setSaveStatus('error');
  }
}

async function saveCmsPage() {
  clearTimeout(autoSaveTimer);
  const title = document.getElementById('cmsTitle').value.trim();
  const status = document.getElementById('cmsStatus').value;
  const tags = document.getElementById('cmsTagsInput').value
    .split(',').map(t => t.trim()).filter(Boolean);
  const blocks = state.cms.openPage ? state.cms.openPage.blocks : [];
  const settings = state.cms.openPage ? state.cms.openPage.settings || {} : {};
  const parent_id = state.cms.openPage ? (state.cms.openPage.parent_id ?? null) : null;
  if (!title) return alert('Title is required');
  setSaveStatus('saving');
  if (state.cms.openPageId) {
    await api.patch(`/api/pages/${state.cms.openPageId}`, { title, blocks, status, tags, settings, parent_id });
  } else {
    const r = await api.post('/api/pages', { title, blocks, status, tags, settings, parent_id });
    state.cms.openPageId = r.id;
    state.cms.openPage.slug = r.slug;
    const slugInput = document.getElementById('cmsSlug');
    if (slugInput) slugInput.value = r.slug;
  }
  state.cms.openPage.title = title;
  state.cms.openPage.status = status;
  state.cms.openPage.tags = tags;
  state.cms.openPage.settings = settings;
  state.cms.openPage.parent_id = parent_id;
  await loadCms();
  const previewLink = document.getElementById('cmsPreviewLink');
  if (status === 'published' && state.cms.openPage.slug) {
    previewLink.href = `/p/${state.cms.openPage.slug}`;
    previewLink.classList.remove('hidden');
  } else {
    previewLink.classList.add('hidden');
  }
  setSaveStatus('saved');
  flashSaved();
  showToast('Page saved successfully', 'success');
}

function flashSaved() {
  const btn = document.getElementById('cmsSaveBtn');
  const orig = btn.innerHTML;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> <span>Saved</span>';
  btn.disabled = true;
  setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 1400);
}


// ---------- Canvas ----------
// ---------- Canvas ----------
function getBlocks() {
  return state.cms.openPage && state.cms.openPage.blocks ? state.cms.openPage.blocks : [];
}

function findBlock(id, list = getBlocks()) {
  for (const b of list) {
    if (b.id === id) return b;
    if ((b.type === 'container' || b.type === 'header') && Array.isArray(b.props && b.props.children)) {
      const found = findBlock(id, b.props.children);
      if (found) return found;
    }
  }
  return null;
}

function findBlockLocation(id, list = getBlocks(), parentBlock = null) {
  for (let i = 0; i < list.length; i++) {
    if (list[i].id === id) {
      return { parentArray: list, index: i, parentBlock, parentContainerId: parentBlock ? parentBlock.id : null };
    }
    if ((list[i].type === 'container' || list[i].type === 'header') && Array.isArray(list[i].props && list[i].props.children)) {
      const loc = findBlockLocation(id, list[i].props.children, list[i]);
      if (loc) return loc;
    }
  }
  return null;
}

function isDescendant(parentBlockId, testBlockId) {
  if (parentBlockId === testBlockId) return true;
  const parent = findBlock(parentBlockId);
  if (!parent || (parent.type !== 'container' && parent.type !== 'header') || !Array.isArray(parent.props && parent.props.children)) {
    return false;
  }
  for (const child of parent.props.children) {
    if (child.id === testBlockId || isDescendant(child.id, testBlockId)) {
      return true;
    }
  }
  return false;
}

function handleComponentNavigation(url, newTab = false, e = null) {
  if (!url || url === '#' || url === 'javascript:void(0)') return;
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }

  // Check internal page navigation: e.g., /p/slug or /p/
  if (url.startsWith('/p/')) {
    const slug = url.slice(3).split('?')[0].split('#')[0];
    const targetPage = state.cms.pages.find(p => p.slug === slug);
    if (targetPage) {
      showToast(`Navigating to "${targetPage.title || targetPage.slug}"`, 'info');
      openCmsPage(targetPage.id);
      return;
    }
  }

  // Check anchor scroll:
  if (url.startsWith('#')) {
    const targetEl = document.querySelector(url);
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: 'smooth' });
      return;
    }
  }

  // External URL
  if (newTab) {
    window.open(url, '_blank', 'noopener,noreferrer');
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
    showToast(`Opening external link: ${url}`, 'info');
  }
}

function applyCustomCssOverride(targetElement, customCssString) {
  if (!targetElement || !customCssString || typeof customCssString !== 'string') return;
  const cleaned = customCssString.trim();
  if (!cleaned) return;

  const declarations = cleaned.split(';');
  declarations.forEach(decl => {
    const colonIdx = decl.indexOf(':');
    if (colonIdx === -1) return;
    const prop = decl.slice(0, colonIdx).trim();
    let val = decl.slice(colonIdx + 1).trim();
    if (!prop || !val) return;

    let priority = 'important';
    if (val.toLowerCase().includes('!important')) {
      val = val.replace(/!important/gi, '').trim();
    }

    try {
      targetElement.style.setProperty(prop, val, priority);
    } catch (_) {
      try { targetElement.style[prop] = val; } catch (__) {}
    }
  });
}

function parseRichText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let s = raw;

  // 1. Shorthand: [gradient](text) or [gradient:from-to](text)
  s = s.replace(/\[gradient(?::([^\]]+))?\]\(([\s\S]*?)\)/gi, (match, colors, text) => {
    let grad = 'linear-gradient(135deg, #818cf8, #ec4899, #f43f5e)';
    if (colors) {
      const parts = colors.split('-').map(c => c.trim()).filter(Boolean);
      if (parts.length >= 2) grad = `linear-gradient(135deg, ${parts.join(', ')})`;
    }
    return `<span style="background:${grad};-webkit-background-clip:text;-webkit-text-fill-color:transparent;font-weight:bold;display:inline-block;">${text}</span>`;
  });

  // 2. Shorthand: [color:#hex](text) or [color:rgb(...)](text)
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

function renderBlockContent(block) {
  const p = block.props || {};
  switch (block.type) {
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, Number(p.level) || 2));
      const align = p.align || 'left';
      const colorStyle = p.color ? `color:${p.color};` : '';
      const marginStyle = p.margin != null ? `margin-bottom:${p.margin}px;` : '';
      const hasLink = !!p.linkUrl;
      const headingEl = el('div', {
        class: `block block-heading lvl-${lvl}${hasLink ? ' has-nav-link' : ''}`,
        style: `text-align:${align};${colorStyle}${marginStyle}${hasLink ? 'cursor:pointer;' : ''}`
      });
      headingEl.innerHTML = parseRichText(p.text || '');
      if (hasLink) {
        headingEl.addEventListener('click', e => {
          if (state.cms.isPreviewMode) {
            handleComponentNavigation(p.linkUrl, p.newTab, e);
          }
        });
      }
      applyCustomCssOverride(headingEl, p.customCss);
      return headingEl;
    }
    case 'paragraph': {
      const align = p.align || 'left';
      const sizeMap = { small: '13px', normal: '15px', large: '18px', lead: '21px' };
      const fontSize = sizeMap[p.size] || '15px';
      const colorStyle = p.color ? `color:${p.color};` : '';
      const hasLink = !!p.linkUrl;
      const cls = `block block-paragraph${p.text ? '' : ' empty'}${p.italic ? ' is-italic' : ''}${p.bold ? ' is-bold' : ''}${hasLink ? ' has-nav-link' : ''}`;
      const pEl = el('div', {
        class: cls,
        style: `text-align:${align};font-size:${fontSize};${colorStyle}${hasLink ? 'cursor:pointer;text-decoration:underline;' : ''}`
      });
      pEl.innerHTML = parseRichText(p.text || '');
      if (hasLink) {
        pEl.addEventListener('click', e => {
          if (state.cms.isPreviewMode) {
            handleComponentNavigation(p.linkUrl, p.newTab, e);
          }
        });
      }
      applyCustomCssOverride(pEl, p.customCss);
      return pEl;
    }
    case 'button': {
      const align = p.align || 'left';
      const variant = p.variant || 'filled';
      const size = p.size || 'medium';
      const color = p.color || '#6366f1';
      const textColor = p.textColor || '#ffffff';
      const rad = p.borderRadius != null ? p.borderRadius : 8;

      let btnStyle = `border-radius:${rad}px;`;
      if (variant === 'filled') {
        btnStyle += `background:${color};color:${textColor};border:1px solid transparent;`;
      } else if (variant === 'outline') {
        btnStyle += `background:transparent;color:${color};border:1.5px solid ${color};`;
      } else if (variant === 'soft') {
        btnStyle += `background:${color}22;color:${color};border:1px solid ${color}44;`;
      }

      const alignWrapperStyle = align === 'full'
        ? 'display:block;width:100%;'
        : `display:flex;justify-content:${align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start'};`;
      const fullClass = align === 'full' ? ' btn-full-width' : '';

      const btnEl = el('span', {
        class: `btn-render size-${size} variant-${variant}${fullClass}`,
        style: btnStyle
      }, p.label || 'Button');

      applyCustomCssOverride(btnEl, p.customCss);

      if (p.url) {
        btnEl.addEventListener('click', e => {
          if (state.cms.isPreviewMode) {
            handleComponentNavigation(p.url, p.newTab, e);
          }
        });
      }

      const wrapEl = el('div', { class: 'block block-button-wrap', style: alignWrapperStyle }, [btnEl]);
      return wrapEl;
    }
    case 'image': {
      if (p.url) {
        const align = p.align || 'center';
        const width = p.width || '100%';
        const rad = p.borderRadius != null ? p.borderRadius : 8;
        const fit = p.objectFit || 'cover';
        const shadowStyle = p.shadow ? 'box-shadow: 0 10px 25px -5px rgba(0,0,0,0.35);' : '';
        const borderStyle = p.border ? 'border: 1px solid var(--border-medium);' : '';
        const justify = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';

        const imgEl = el('img', {
          src: p.url,
          alt: p.alt || '',
          style: `width:${width};max-width:100%;border-radius:${rad}px;object-fit:${fit};${shadowStyle}${borderStyle}display:block;`
        });

        applyCustomCssOverride(imgEl, p.customCss);

        if (p.linkUrl) {
          imgEl.style.cursor = 'pointer';
          imgEl.addEventListener('click', e => {
            if (state.cms.isPreviewMode) {
              handleComponentNavigation(p.linkUrl, p.newTab, e);
            }
          });
        }

        const wrapChildren = [imgEl];
        if (p.caption) {
          wrapChildren.push(el('div', { class: 'image-caption-text' }, p.caption));
        }

        return el('div', {
          class: `block block-image-wrap${p.linkUrl ? ' has-nav-link' : ''}`,
          style: `display:flex;flex-direction:column;align-items:${justify};`
        }, wrapChildren);
      }
      return el('div', { class: 'block block-image placeholder' }, 'Image placeholder \u2014 set URL in properties');
    }
    case 'carousel': {
      const slides = Array.isArray(p.slides) ? p.slides : [];
      if (!slides.length) {
        return el('div', { class: 'block block-carousel placeholder' }, 'Carousel placeholder \u2014 add slides in properties');
      }
      if (!state.cms.carouselIdx) state.cms.carouselIdx = {};
      let currentIdx = state.cms.carouselIdx[block.id] || 0;
      if (currentIdx >= slides.length) currentIdx = 0;
      if (currentIdx < 0) currentIdx = slides.length - 1;
      state.cms.carouselIdx[block.id] = currentIdx;

      const activeSlide = slides[currentIdx] || slides[0] || {};
      const ratioStyle = p.aspectRatio && p.aspectRatio !== 'auto' ? `aspect-ratio:${p.aspectRatio};` : 'min-height:220px;';
      const radStyle = `border-radius:${p.borderRadius != null ? p.borderRadius : 10}px;`;

      const carouselWrap = el('div', {
        class: 'block block-carousel',
        style: `${ratioStyle}${radStyle}`
      });

      applyCustomCssOverride(carouselWrap, p.customCss);

      const slideEl = el('div', { class: 'carousel-slide-view' });
      if (activeSlide.url) {
        slideEl.appendChild(el('img', { src: activeSlide.url, alt: activeSlide.caption || '' }));
      } else {
        slideEl.appendChild(el('div', { class: 'carousel-no-img' }, 'No image URL provided for this slide'));
      }

      if (activeSlide.linkUrl) {
        slideEl.style.cursor = 'pointer';
        slideEl.addEventListener('click', e => {
          if (state.cms.isPreviewMode) {
            handleComponentNavigation(activeSlide.linkUrl, activeSlide.newTab, e);
          }
        });
      }

      if (p.showCaptions !== false && activeSlide.caption) {
        slideEl.appendChild(el('div', { class: 'carousel-caption-overlay' }, [
          el('span', { class: 'carousel-caption-text' }, activeSlide.caption)
        ]));
      }

      carouselWrap.appendChild(slideEl);

      // Slide counter badge
      carouselWrap.appendChild(el('div', { class: 'carousel-badge' }, `${currentIdx + 1} / ${slides.length}`));

      // Navigation arrows
      if (p.showArrows !== false && slides.length > 1) {
        const prevBtn = el('button', {
          type: 'button',
          class: 'carousel-nav-btn prev',
          title: 'Previous slide',
          onclick: (e) => {
            e.stopPropagation();
            state.cms.carouselIdx[block.id] = (currentIdx - 1 + slides.length) % slides.length;
            renderCanvas();
          }
        }, [createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>')]);

        const nextBtn = el('button', {
          type: 'button',
          class: 'carousel-nav-btn next',
          title: 'Next slide',
          onclick: (e) => {
            e.stopPropagation();
            state.cms.carouselIdx[block.id] = (currentIdx + 1) % slides.length;
            renderCanvas();
          }
        }, [createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>')]);

        carouselWrap.appendChild(prevBtn);
        carouselWrap.appendChild(nextBtn);
      }

      // Indicator dots
      if (p.showDots !== false && slides.length > 1) {
        const dotsWrap = el('div', { class: 'carousel-dots-wrap' });
        slides.forEach((_, idx) => {
          const dot = el('button', {
            type: 'button',
            class: `carousel-dot${idx === currentIdx ? ' active' : ''}`,
            title: `Go to slide ${idx + 1}`,
            onclick: (e) => {
              e.stopPropagation();
              state.cms.carouselIdx[block.id] = idx;
              renderCanvas();
            }
          });
          dotsWrap.appendChild(dot);
        });
        carouselWrap.appendChild(dotsWrap);
      }

      return carouselWrap;
    }
    case 'divider': {
      const style = p.style || 'solid';
      const thickness = Math.max(1, Math.min(8, Number(p.thickness) || 1));
      const width = p.width || '100%';
      const margin = p.margin != null ? Number(p.margin) : 16;
      const color = p.color || 'var(--border-subtle)';

      const hrEl = el('hr', {
        class: `block-divider style-${style}`,
        style: `width:${width};border-top-width:${thickness}px;border-top-style:${style};border-top-color:${color};`
      });

      applyCustomCssOverride(hrEl, p.customCss);

      return el('div', {
        class: 'block block-divider-wrap',
        style: `padding:${margin}px 0;display:flex;justify-content:center;`
      }, [hrEl]);
    }
    case 'spacer': {
      const h = Number(p.height) || 24;
      const spEl = el('div', {
        class: 'block block-spacer',
        style: `height:${h}px;`,
        dataset: { height: `${h}px` }
      });
      applyCustomCssOverride(spEl, p.customCss);
      return spEl;
    }
    case 'table': {
      const headers = Array.isArray(p.headers) ? p.headers : ['Header 1', 'Header 2'];
      const rows = Array.isArray(p.rows) ? p.rows : [['Cell 1', 'Cell 2']];
      const hasHeader = p.hasHeader !== false;
      const striped = p.striped ? ' striped' : '';
      const bordered = p.bordered ? ' bordered' : '';
      const compact = p.compact ? ' compact' : '';

      const tableEl = el('table', { class: `block-table cms-table${striped}${bordered}${compact}` });

      if (hasHeader && headers.length) {
        const thead = el('thead');
        const tr = el('tr');
        headers.forEach(h => tr.appendChild(el('th', {}, h)));
        thead.appendChild(tr);
        tableEl.appendChild(thead);
      }

      const tbody = el('tbody');
      rows.forEach(row => {
        const tr = el('tr');
        const rowCells = Array.isArray(row) ? row : [];
        const cols = headers.length ? headers : rowCells;
        cols.forEach((_, cIdx) => {
          tr.appendChild(el('td', {}, rowCells[cIdx] || ''));
        });
        tbody.appendChild(tr);
      });
      tableEl.appendChild(tbody);

      applyCustomCssOverride(tableEl, p.customCss);

      return el('div', { class: 'block block-table-wrap cms-table-wrap' }, [tableEl]);
    }
    case 'callout': {
      const type = p.type || 'info';
      const icon = p.icon || (type === 'tip' ? '💡' : type === 'warning' ? '⚠️' : type === 'danger' ? '🚨' : 'ℹ️');
      const customColor = p.color ? `color:${p.color};border-color:${p.color};` : '';
      const calloutEl = el('div', {
        class: `block block-callout callout-${type}`,
        style: customColor
      }, [
        el('div', { class: 'callout-icon-wrap' }, icon),
        el('div', { class: 'callout-body' }, [
          p.title ? el('div', { class: 'callout-title' }, p.title) : false,
          el('div', { class: 'callout-text' })
        ])
      ]);
      calloutEl.querySelector('.callout-text').innerHTML = parseRichText(p.text || '');
      applyCustomCssOverride(calloutEl, p.customCss);
      return calloutEl;
    }
    case 'accordion': {
      const items = Array.isArray(p.items) ? p.items : [];
      if (!state.cms.accordionOpen) state.cms.accordionOpen = {};
      const openSet = state.cms.accordionOpen[block.id] || new Set([0]);
      state.cms.accordionOpen[block.id] = openSet;

      const accordionEl = el('div', { class: 'block block-accordion' });
      items.forEach((item, idx) => {
        const isOpen = openSet.has(idx);
        const itemEl = el('div', { class: `cms-accordion-item${isOpen ? ' is-open' : ''}` });

        const trigger = el('button', {
          type: 'button',
          class: 'cms-accordion-trigger',
          onclick: (e) => {
            e.stopPropagation();
            if (openSet.has(idx)) {
              openSet.delete(idx);
            } else {
              openSet.add(idx);
            }
            itemEl.classList.toggle('is-open', openSet.has(idx));
          }
        }, [
          el('span', {}, item.title || `Section ${idx + 1}`),
          el('span', { class: 'cms-accordion-chevron' }, [
            createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>')
          ])
        ]);

        const panel = el('div', { class: 'cms-accordion-panel' });
        panel.innerHTML = parseRichText(item.content || '');

        itemEl.appendChild(trigger);
        itemEl.appendChild(panel);
        accordionEl.appendChild(itemEl);
      });

      applyCustomCssOverride(accordionEl, p.customCss);
      return accordionEl;
    }
    case 'tabs': {
      const tabs = Array.isArray(p.tabs) ? p.tabs : [];
      if (!state.cms.tabIdx) state.cms.tabIdx = {};
      let activeIdx = state.cms.tabIdx[block.id] != null ? state.cms.tabIdx[block.id] : 0;
      if (activeIdx >= tabs.length) activeIdx = 0;
      state.cms.tabIdx[block.id] = activeIdx;

      const tabsWrap = el('div', { class: 'block block-tabs' });
      const navEl = el('div', { class: 'cms-tabs-nav' });
      const contentEl = el('div', { class: 'cms-tabs-content' });

      tabs.forEach((tab, idx) => {
        const isActive = idx === activeIdx;
        const btn = el('button', {
          type: 'button',
          class: `cms-tab-btn${isActive ? ' active' : ''}`,
          onclick: (e) => {
            e.stopPropagation();
            state.cms.tabIdx[block.id] = idx;
            renderCanvas();
          }
        }, tab.title || `Tab ${idx + 1}`);
        navEl.appendChild(btn);

        const pane = el('div', { class: `cms-tab-pane${isActive ? ' active' : ''}` });
        pane.innerHTML = parseRichText(tab.content || '');
        contentEl.appendChild(pane);
      });

      tabsWrap.appendChild(navEl);
      tabsWrap.appendChild(contentEl);
      applyCustomCssOverride(tabsWrap, p.customCss);
      return tabsWrap;
    }
    case 'pricing': {
      const isPopular = !!p.isPopular;
      const cardEl = el('div', {
        class: `block block-pricing${isPopular ? ' is-popular' : ''}`
      });

      if (isPopular && p.badge) {
        cardEl.appendChild(el('div', { class: 'pricing-badge' }, p.badge));
      }

      const header = el('div', { class: 'pricing-header' }, [
        el('h3', { class: 'pricing-plan' }, p.plan || 'Plan Name'),
        el('div', { class: 'pricing-price-wrap' }, [
          el('span', { class: 'pricing-price' }, p.price || '$0'),
          p.period ? el('span', { class: 'pricing-period' }, p.period) : false
        ]),
        p.description ? el('p', { class: 'pricing-desc' }, p.description) : false
      ]);
      cardEl.appendChild(header);

      const features = Array.isArray(p.features) ? p.features : [];
      if (features.length > 0) {
        const featList = el('ul', { class: 'pricing-features' });
        features.forEach(f => {
          featList.appendChild(el('li', { class: 'pricing-feat-item' }, [
            el('span', { class: 'pricing-feat-icon' }, '✓'),
            el('span', {}, f)
          ]));
        });
        cardEl.appendChild(featList);
      }

      if (p.ctaLabel) {
        const cta = el('button', {
          type: 'button',
          class: 'pricing-cta',
          onclick: (e) => {
            if (state.cms.isPreviewMode && p.ctaUrl) {
              handleComponentNavigation(p.ctaUrl, true, e);
            }
          }
        }, p.ctaLabel);
        cardEl.appendChild(cta);
      }

      applyCustomCssOverride(cardEl, p.customCss);
      return cardEl;
    }
    case 'stat': {
      const trendDir = p.trendDirection || (p.trend && p.trend.startsWith('-') ? 'down' : 'up');
      const trendIcon = trendDir === 'down' ? '↓' : '↑';
      const statEl = el('div', { class: 'block block-stat' }, [
        el('div', { class: 'stat-header-row' }, [
          el('span', { class: 'stat-label' }, p.label || 'Metric'),
          p.trend ? el('span', { class: `stat-trend trend-${trendDir}` }, `${trendIcon} ${p.trend}`) : false
        ]),
        el('div', { class: 'stat-value' }, p.value || '0'),
        p.subtext ? el('div', { class: 'stat-desc' }, p.subtext) : false
      ]);
      applyCustomCssOverride(statEl, p.customCss);
      return statEl;
    }
    case 'testimonial': {
      const rating = Math.max(1, Math.min(5, Number(p.rating) || 5));
      const starsStr = '★'.repeat(rating) + '☆'.repeat(5 - rating);

      const cardEl = el('div', { class: 'block block-testimonial' }, [
        el('div', { class: 'testimonial-stars' }, starsStr),
        el('p', { class: 'testimonial-quote' }, `"${p.quote || 'No review quote provided.'}"`),
        el('div', { class: 'testimonial-author-row' }, [
          p.avatar ? el('img', {
            src: p.avatar,
            alt: p.author || 'Avatar',
            class: 'testimonial-avatar',
            onerror: e => { e.target.style.display = 'none'; }
          }) : false,
          el('div', { class: 'testimonial-info' }, [
            el('span', { class: 'testimonial-name' }, p.author || 'Anonymous User'),
            p.role ? el('span', { class: 'testimonial-role' }, p.role) : false
          ])
        ])
      ]);
      applyCustomCssOverride(cardEl, p.customCss);
      return cardEl;
    }
    case 'video': {
      let rawUrl = (p.url || '').trim();
      let embedUrl = rawUrl;
      if (rawUrl.includes('youtube.com/watch?v=')) {
        const id = rawUrl.split('watch?v=')[1]?.split('&')[0];
        if (id) embedUrl = `https://www.youtube.com/embed/${id}`;
      } else if (rawUrl.includes('youtu.be/')) {
        const id = rawUrl.split('youtu.be/')[1]?.split('?')[0];
        if (id) embedUrl = `https://www.youtube.com/embed/${id}`;
      } else if (rawUrl.includes('vimeo.com/')) {
        const id = rawUrl.split('vimeo.com/')[1]?.split('?')[0];
        if (id) embedUrl = `https://player.vimeo.com/video/${id}`;
      }

      const videoWrap = el('div', { class: 'block block-video' }, [
        el('div', { class: 'video-responsive-wrap' }, [
          embedUrl ? el('iframe', {
            src: embedUrl,
            frameborder: '0',
            allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture',
            allowfullscreen: ''
          }) : el('div', { style: 'color:var(--text-tertiary);position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:13px;' }, 'Enter a YouTube or Vimeo URL in settings')
        ])
      ]);
      if (p.caption) {
        videoWrap.appendChild(el('div', { style: 'font-size:12px;color:var(--text-tertiary);text-align:center;margin-top:6px;' }, p.caption));
      }
      applyCustomCssOverride(videoWrap, p.customCss);
      return videoWrap;
    }
    case 'code': {
      const lang = (p.language || 'javascript').toLowerCase();
      const codeSnippet = p.code || '// Enter your code snippet here';

      const copyBtn = el('button', {
        type: 'button',
        class: 'copy-code-btn',
        onclick: (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(codeSnippet).then(() => {
            copyBtn.textContent = '✓ Copied!';
            setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
          }).catch(() => {
            showToast('Failed to copy', 'danger');
          });
        }
      }, 'Copy');

      const codeBlock = el('div', { class: 'block block-code' }, [
        el('div', { class: 'code-block-header' }, [
          el('div', { class: 'code-window-dots' }, [
            el('span', { class: 'code-dot dot-red' }),
            el('span', { class: 'code-dot dot-yellow' }),
            el('span', { class: 'code-dot dot-green' })
          ]),
          el('span', { class: 'code-lang-label' }, lang),
          copyBtn
        ]),
        el('pre', { class: 'code-pre' }, [
          el('code', {}, codeSnippet)
        ])
      ]);
      applyCustomCssOverride(codeBlock, p.customCss);
      return codeBlock;
    }
    case 'bento': {
      const items = Array.isArray(p.items) ? p.items : [];
      const cards = items.map(item => {
        const spanStyle = item.span === 2 ? 'grid-column: span 2;' : '';
        const tallStyle = item.tall ? 'grid-row: span 2;' : '';
        const bg = item.bg || 'rgba(255,255,255,0.03)';
        const cardEl = el('div', {
          class: 'cms-bento-card',
          style: `background:${bg};border:1px solid rgba(255,255,255,0.08);border-radius:18px;padding:24px;display:flex;flex-direction:column;justify-content:space-between;box-shadow:0 10px 30px rgba(0,0,0,0.25);position:relative;overflow:hidden;${spanStyle}${tallStyle}`
        });

        const topContent = el('div', {});
        const headerRow = el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;' });
        if (item.icon) {
          headerRow.appendChild(el('div', { style: 'font-size:24px;margin-bottom:12px;' }, item.icon));
        }
        if (item.tag) {
          headerRow.appendChild(el('span', { style: 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#818cf8;background:rgba(99,102,241,0.15);padding:3px 8px;border-radius:999px;border:1px solid rgba(99,102,241,0.3);' }, item.tag));
        }
        topContent.appendChild(headerRow);

        topContent.appendChild(el('h4', { style: 'font-size:18px;font-weight:700;color:#fff;margin:0 0 6px 0;' }, item.title || 'Feature Tile'));
        const subEl = el('p', { style: 'font-size:13.5px;color:#94a3b8;line-height:1.5;margin:0;' });
        subEl.innerHTML = parseRichText(item.subtitle || '');
        topContent.appendChild(subEl);

        if (item.metric) {
          topContent.appendChild(el('div', { style: 'font-size:32px;font-weight:800;color:#fff;margin:8px 0;letter-spacing:-0.02em;' }, item.metric));
        }
        cardEl.appendChild(topContent);

        if (item.image) {
          cardEl.appendChild(el('div', { style: `width:100%;height:140px;border-radius:10px;background-image:url('${item.image}');background-size:cover;background-position:center;margin-top:14px;` }));
        }
        return cardEl;
      });

      const gridEl = el('div', {
        class: 'block cms-bento-grid',
        style: 'display:grid;grid-template-columns:repeat(auto-fit, minmax(260px, 1fr));gap:16px;margin:24px 0;'
      }, cards);
      applyCustomCssOverride(gridEl, p.customCss);
      return gridEl;
    }
    case 'comparison': {
      const beforeImg = p.beforeImage || 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=800&auto=format&fit=crop';
      const afterImg = p.afterImage || 'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?w=800&auto=format&fit=crop';
      const beforeLabel = p.beforeLabel || 'Before';
      const afterLabel = p.afterLabel || 'After';

      const afterImgEl = el('img', { src: afterImg, alt: afterLabel, style: 'position:absolute;top:0;left:0;width:100%;height:100%;object-fit:cover;' });
      const afterBadge = el('div', { style: 'position:absolute;top:12px;right:16px;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);z-index:2;' }, afterLabel);

      const beforeFullImg = el('img', { src: beforeImg, alt: beforeLabel, class: 'cms-before-full-img', style: 'position:absolute;top:0;left:0;height:100%;max-width:none;width:100%;object-fit:cover;' });
      const beforeBadge = el('div', { style: 'position:absolute;top:12px;left:16px;background:rgba(0,0,0,0.65);backdrop-filter:blur(4px);color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:999px;border:1px solid rgba(255,255,255,0.15);' }, beforeLabel);

      const overlay = el('div', { class: 'cms-comparison-overlay', style: 'position:absolute;top:0;left:0;bottom:0;width:50%;overflow:hidden;z-index:3;' }, [
        beforeFullImg,
        beforeBadge
      ]);

      const handleGrip = el('div', { style: 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:36px;height:36px;border-radius:50%;background:#6366f1;color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 14px rgba(0,0,0,0.5);font-size:14px;font-weight:bold;' }, '⇄');
      const handle = el('div', { class: 'cms-comparison-handle', style: 'position:absolute;top:0;bottom:0;left:50%;width:3px;background:#ffffff;box-shadow:0 0 12px rgba(99,102,241,0.8);z-index:5;cursor:ew-resize;transform:translateX(-50%);' }, [handleGrip]);

      const container = el('div', {
        class: 'block cms-comparison-container',
        style: 'position:relative;width:100%;aspect-ratio:16/9;border-radius:16px;overflow:hidden;user-select:none;margin:24px 0;box-shadow:0 16px 40px rgba(0,0,0,0.4);border:1px solid rgba(255,255,255,0.12);'
      }, [afterImgEl, afterBadge, overlay, handle]);

      // Interactive slider movement in preview & canvas
      let isDown = false;
      const setPos = (clientX) => {
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        let pct = ((clientX - rect.left) / rect.width) * 100;
        pct = Math.max(0, Math.min(100, pct));
        overlay.style.width = pct + '%';
        handle.style.left = pct + '%';
        beforeFullImg.style.width = rect.width + 'px';
      };

      container.addEventListener('mousedown', e => { isDown = true; setPos(e.clientX); });
      window.addEventListener('mouseup', () => { isDown = false; });
      window.addEventListener('mousemove', e => { if (isDown) setPos(e.clientX); });
      container.addEventListener('touchstart', e => { isDown = true; setPos(e.touches[0].clientX); }, { passive: true });
      window.addEventListener('touchend', () => { isDown = false; });
      window.addEventListener('touchmove', e => { if (isDown) setPos(e.touches[0].clientX); }, { passive: true });

      applyCustomCssOverride(container, p.customCss);
      return container;
    }
    case 'tilt-card': {
      const title = p.title || 'Interactive 3D Card';
      const badge = p.badge;
      const cta = p.ctaLabel;

      const card = el('div', {
        class: 'cms-tilt-card',
        style: 'position:relative;background:linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.01));border:1px solid rgba(255,255,255,0.12);border-radius:20px;padding:36px 30px;box-shadow:0 20px 50px rgba(0,0,0,0.5);transform-style:preserve-3d;transition:transform 0.1s ease-out;overflow:hidden;'
      });

      const glare = el('div', {
        class: 'cms-tilt-glare',
        style: 'position:absolute;top:0;left:0;right:0;bottom:0;background:radial-gradient(circle at 50% 50%, rgba(255,255,255,0.15), transparent 70%);opacity:0;pointer-events:none;transition:opacity 0.2s;'
      });
      card.appendChild(glare);

      const inner = el('div', { style: 'transform:translateZ(30px);' });
      if (badge) {
        inner.appendChild(el('div', { style: 'margin-bottom:12px;' }, [
          el('span', { style: 'font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.6px;color:#38bdf8;background:rgba(56,189,248,0.15);padding:3px 9px;border-radius:999px;border:1px solid rgba(56,189,248,0.3);' }, badge)
        ]));
      }

      inner.appendChild(el('h3', { style: 'font-size:22px;font-weight:800;color:#fff;margin:0 0 8px 0;letter-spacing:-0.01em;' }, title));
      const sub = el('p', { style: 'font-size:14.5px;color:#94a3b8;line-height:1.6;margin:0;' });
      sub.innerHTML = parseRichText(p.subtitle || '');
      inner.appendChild(sub);

      if (cta) {
        inner.appendChild(el('a', {
          href: p.ctaUrl || '#',
          style: 'display:inline-flex;align-items:center;gap:6px;background:#6366f1;color:#fff;text-decoration:none;font-size:13px;font-weight:600;padding:10px 20px;border-radius:8px;margin-top:16px;box-shadow:0 4px 14px rgba(99,102,241,0.4);'
        }, `${cta} →`));
      }
      card.appendChild(inner);

      const wrap = el('div', {
        class: 'block cms-tilt-wrap',
        style: 'perspective:1000px;margin:24px 0;'
      }, [card]);

      wrap.addEventListener('mousemove', e => {
        const rect = wrap.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const cx = rect.width / 2;
        const cy = rect.height / 2;
        const rotX = ((y - cy) / cy) * -12;
        const rotY = ((x - cx) / cx) * 12;
        card.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.02, 1.02, 1.02)`;
        glare.style.opacity = '1';
        glare.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255,255,255,0.22), transparent 60%)`;
      });
      wrap.addEventListener('mouseleave', () => {
        card.style.transform = 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
        glare.style.opacity = '0';
      });

      applyCustomCssOverride(wrap, p.customCss);
      return wrap;
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

      const createPills = () => items.map(it => {
        const pill = el('div', {
          style: 'display:inline-flex;align-items:center;gap:8px;padding:8px 18px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:999px;color:#f1f5f9;font-size:13.5px;font-weight:600;white-space:nowrap;margin-right:14px;flex-shrink:0;user-select:none;'
        });
        if (it.icon) pill.appendChild(el('span', { style: 'font-size:16px;' }, it.icon));
        else pill.appendChild(el('span', {}, '✦'));
        pill.appendChild(el('span', {}, it.text || 'Item'));
        return pill;
      });

      // Repeat items across two identical halves so translateX(-50%) loops infinitely without gaps
      const half1 = el('div', { style: 'display:flex;flex-shrink:0;align-items:center;' }, [
        el('div', { style: 'display:flex;flex-shrink:0;' }, createPills()),
        el('div', { style: 'display:flex;flex-shrink:0;' }, createPills())
      ]);
      const half2 = el('div', { style: 'display:flex;flex-shrink:0;align-items:center;' }, [
        el('div', { style: 'display:flex;flex-shrink:0;' }, createPills()),
        el('div', { style: 'display:flex;flex-shrink:0;' }, createPills())
      ]);

      const track = el('div', {
        class: 'cms-marquee-track',
        style: `display:flex;width:max-content;flex-shrink:0;will-change:transform;animation:marqueeScroll ${speed} linear infinite;`
      }, [half1, half2]);

      const marqueeWrap = el('div', {
        class: 'block cms-marquee-wrap',
        style: 'position:relative;width:100%;overflow:hidden;padding:14px 0;margin:24px 0;mask-image:linear-gradient(to right, transparent, black 10%, black 90%, transparent);-webkit-mask-image:linear-gradient(to right, transparent, black 10%, black 90%, transparent);'
      }, [track]);

      applyCustomCssOverride(marqueeWrap, p.customCss);
      return marqueeWrap;
    }
    case 'countdown': {
      const targetDate = p.targetDate || '2026-12-31T23:59:59';
      const daysVal = el('div', { class: 'cd-val cd-days', style: 'font-size:32px;font-weight:800;color:#6366f1;line-height:1;' }, '00');
      const hoursVal = el('div', { class: 'cd-val cd-hours', style: 'font-size:32px;font-weight:800;color:#6366f1;line-height:1;' }, '00');
      const minsVal = el('div', { class: 'cd-val cd-minutes', style: 'font-size:32px;font-weight:800;color:#6366f1;line-height:1;' }, '00');
      const secsVal = el('div', { class: 'cd-val cd-seconds', style: 'font-size:32px;font-weight:800;color:#6366f1;line-height:1;' }, '00');

      const makeBox = (valEl, label) => el('div', { style: 'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:14px 18px;min-width:70px;text-align:center;' }, [
        valEl,
        el('div', { style: 'font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-top:4px;' }, label)
      ]);
      const makeSep = () => el('div', { style: 'font-size:24px;font-weight:bold;color:#6366f1;opacity:0.6;' }, ':');

      const boxesRow = el('div', { style: 'display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;' }, [
        makeBox(daysVal, 'Days'),
        makeSep(),
        makeBox(hoursVal, 'Hours'),
        makeSep(),
        makeBox(minsVal, 'Mins'),
        makeSep(),
        makeBox(secsVal, 'Secs')
      ]);

      const container = el('div', {
        class: 'block cms-countdown-container',
        style: 'text-align:center;padding:32px 24px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.08);border-radius:20px;margin:24px 0;box-shadow:0 14px 40px rgba(0,0,0,0.3);'
      }, [
        el('h3', { style: 'font-size:20px;font-weight:800;color:#fff;margin:0 0 6px 0;' }, p.title || 'Next Milestone Launch'),
        el('p', { style: 'font-size:13px;color:#94a3b8;margin:0 0 20px 0;' }, p.subtitle || 'Counting down every second to release'),
        boxesRow
      ]);

      const updateTicker = () => {
        const target = new Date(targetDate).getTime();
        const diff = Math.max(0, target - Date.now());
        const d = Math.floor(diff / (1000 * 60 * 60 * 24));
        const h = Math.floor((diff / (1000 * 60 * 60)) % 24);
        const m = Math.floor((diff / (1000 * 60)) % 60);
        const s = Math.floor((diff / 1000) % 60);
        daysVal.textContent = String(d).padStart(2, '0');
        hoursVal.textContent = String(h).padStart(2, '0');
        minsVal.textContent = String(m).padStart(2, '0');
        secsVal.textContent = String(s).padStart(2, '0');
      };
      updateTicker();
      const timer = setInterval(updateTicker, 1000);
      container._cdTimer = timer;

      applyCustomCssOverride(container, p.customCss);
      return container;
    }
    case 'timeline': {
      const items = Array.isArray(p.items) ? p.items : [];
      const spine = el('div', { style: 'position:absolute;top:10px;bottom:10px;left:7px;width:2px;background:rgba(255,255,255,0.1);z-index:1;' });
      const nodes = items.map(item => {
        const status = item.status || 'upcoming';
        const statusColor = status === 'completed' ? '#10b981' : status === 'current' ? '#6366f1' : '#94a3b8';
        const statusLabel = status === 'completed' ? 'Completed' : status === 'current' ? 'In Progress' : 'Planned';

        const node = el('div', { style: 'position:relative;padding-left:36px;margin-bottom:28px;' }, [
          el('div', { style: `position:absolute;left:0;top:4px;width:16px;height:16px;border-radius:50%;background:#0d1117;border:3px solid ${statusColor};box-shadow:0 0 10px ${statusColor}66;z-index:2;` })
        ]);

        if (item.date) {
          node.appendChild(el('div', { style: `font-size:12px;font-weight:700;color:${statusColor};text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;` }, item.date));
        }

        const titleRow = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:6px;' }, [
          el('h4', { style: 'font-size:16px;font-weight:700;color:#fff;margin:0;' }, item.title || 'Milestone'),
          el('span', { style: `font-size:10.5px;font-weight:700;text-transform:uppercase;padding:2px 7px;border-radius:999px;background:${statusColor}22;color:${statusColor};border:1px solid ${statusColor}44;` }, statusLabel)
        ]);
        node.appendChild(titleRow);

        const desc = el('p', { style: 'font-size:13.5px;color:#94a3b8;line-height:1.5;margin:0;' });
        desc.innerHTML = parseRichText(item.description || '');
        node.appendChild(desc);

        return node;
      });

      const timelineWrap = el('div', {
        class: 'block cms-timeline-wrap',
        style: 'position:relative;padding:10px 0;margin:24px 0;'
      }, [spine, ...nodes]);

      applyCustomCssOverride(timelineWrap, p.customCss);
      return timelineWrap;
    }
    case 'form': {
      const formCard = el('div', {
        class: 'block cms-form-card',
        style: 'background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:20px;padding:32px 28px;margin:24px 0;box-shadow:0 16px 40px rgba(0,0,0,0.35);'
      }, [
        el('h3', { style: 'font-size:20px;font-weight:800;color:#fff;margin:0 0 6px 0;' }, p.title || 'Get in Touch'),
        el('p', { style: 'font-size:13.5px;color:#94a3b8;margin:0 0 20px 0;line-height:1.5;' }, p.description || 'We would love to hear from you. Leave your details below.')
      ]);

      const form = el('form', {
        class: 'cms-contact-form',
        style: 'display:flex;flex-direction:column;gap:14px;',
        onsubmit: e => {
          e.preventDefault();
          successAlert.style.display = 'block';
          form.reset();
        }
      });

      const nameGroup = el('div', {}, [
        el('label', { style: 'display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;' }, 'Your Name'),
        el('input', { type: 'text', required: true, placeholder: 'Alex Mercer', style: 'width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 14px;color:#fff;font-size:13.5px;outline:none;' })
      ]);

      const emailGroup = el('div', {}, [
        el('label', { style: 'display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;' }, 'Email Address'),
        el('input', { type: 'email', required: true, placeholder: 'alex@example.com', style: 'width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 14px;color:#fff;font-size:13.5px;outline:none;' })
      ]);

      const msgGroup = el('div', {}, [
        el('label', { style: 'display:block;font-size:12px;font-weight:600;color:#cbd5e1;margin-bottom:6px;' }, 'Message'),
        el('textarea', { rows: '3', required: true, placeholder: 'How can we help you?', style: 'width:100%;box-sizing:border-box;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.12);border-radius:8px;padding:10px 14px;color:#fff;font-size:13.5px;outline:none;resize:vertical;' })
      ]);

      const submitBtn = el('button', {
        type: 'submit',
        style: 'background:#6366f1;color:#fff;border:none;border-radius:8px;padding:12px 18px;font-weight:700;font-size:14px;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.4);transition:background 0.15s;'
      }, p.buttonLabel || 'Send Message');

      const successAlert = el('div', {
        class: 'form-success-alert',
        style: 'display:none;padding:10px 14px;background:rgba(16,185,129,0.15);border:1px solid rgba(16,185,129,0.3);color:#34d399;font-size:13px;border-radius:8px;text-align:center;'
      }, '✓ Thank you! Your message has been received.');

      form.appendChild(nameGroup);
      form.appendChild(emailGroup);
      form.appendChild(msgGroup);
      form.appendChild(submitBtn);
      form.appendChild(successAlert);

      formCard.appendChild(form);
      applyCustomCssOverride(formCard, p.customCss);
      return formCard;
    }
    case 'audio': {
      const cover = p.cover
        ? el('img', { src: p.cover, style: 'width:52px;height:52px;border-radius:10px;object-fit:cover;' })
        : el('div', { style: 'width:52px;height:52px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#ec4899);display:flex;align-items:center;justify-content:center;font-size:22px;color:#fff;' }, '🎵');

      const info = el('div', { style: 'flex:1;overflow:hidden;' }, [
        el('h4', { style: 'font-size:14.5px;font-weight:700;color:#fff;margin:0 0 4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;' }, p.title || 'Track Title'),
        el('div', { style: 'font-size:12px;color:#94a3b8;' }, [
          document.createTextNode(`${p.artist || 'Podcast Host / Artist'} • `),
          el('span', { style: 'color:#6366f1;' }, p.duration || '04:15')
        ])
      ]);

      const waveformBars = [40, 70, 100, 50, 80, 30, 90, 60].map((h, i) => {
        return el('span', { style: `width:3px;height:${h}%;background:#6366f1;border-radius:2px;` });
      });
      const waveform = el('div', { class: 'cms-waveform-bar', style: 'display:flex;align-items:flex-end;gap:3px;height:18px;margin-top:8px;' }, waveformBars);
      info.appendChild(waveform);

      let isPlaying = false;
      const playBtn = el('button', {
        type: 'button',
        class: 'cms-audio-play-btn',
        style: 'width:42px;height:42px;border-radius:50%;background:#6366f1;border:none;color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 4px 14px rgba(99,102,241,0.4);flex-shrink:0;',
        onclick: (e) => {
          e.stopPropagation();
          isPlaying = !isPlaying;
          playBtn.textContent = isPlaying ? '❚❚' : '▶';
          playBtn.style.background = isPlaying ? '#ec4899' : '#6366f1';
          waveformBars.forEach((bar, idx) => {
            bar.style.animation = isPlaying ? `wave 0.6s ease-in-out infinite alternate ${idx * 0.1}s` : 'none';
          });
        }
      }, '▶');

      const audioCard = el('div', {
        class: 'block cms-audio-card',
        style: 'display:flex;align-items:center;gap:16px;background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.1);border-radius:16px;padding:16px 20px;margin:20px 0;box-shadow:0 10px 30px rgba(0,0,0,0.25);'
      }, [cover, info, playBtn]);

      applyCustomCssOverride(audioCard, p.customCss);
      return audioCard;
    }
    case 'header': {
      const layout = p.layout || 'spread';
      const variant = p.styleVariant || 'glass';
      const isSticky = !!p.sticky;
      const links = Array.isArray(p.links) ? p.links : [];
      const children = Array.isArray(p.children) ? p.children : [];
      const enableCarousel = p.enableCarousel !== false;

      const headerChildren = [];

      // Subsection 1: Top Announcement Bar
      if (p.showTopBar) {
        const topBarChildren = [];
        if (p.topBarBadge) {
          topBarChildren.push(el('span', { class: 'cms-header-topbar-badge' }, p.topBarBadge));
        }
        topBarChildren.push(el('a', {
          class: 'cms-header-topbar-link',
          href: p.topBarLink || '#'
        }, p.topBarText || 'Announcement text'));
        headerChildren.push(el('div', { class: 'cms-header-topbar' }, topBarChildren));
      }

      // Subsection 2: Main Navigation Bar
      // Brand Logo & Text
      const logoHeightStyle = p.logoHeight ? `height:${p.logoHeight}px;max-height:${p.logoHeight}px;` : '';
      const brandLogo = p.brandLogo
        ? el('img', { src: p.brandLogo, alt: p.brandName || 'Logo', class: 'cms-header-logo-img', style: logoHeightStyle })
        : (p.brandIcon ? el('span', { class: 'cms-header-brand-icon' }, p.brandIcon) : null);
      const brandText = el('span', { class: 'cms-header-brand-name' }, p.brandName || 'Brand');
      const brandEl = el('a', { class: 'cms-header-brand', href: p.brandUrl || '#' }, brandLogo ? [brandLogo, brandText] : [brandText]);

      // Desktop Nav Links
      const navLinks = links.map(link => el('a', {
        class: 'cms-header-link',
        href: link.url || '#'
      }, link.label || 'Link'));
      const navEl = el('nav', { class: 'cms-header-nav' }, navLinks);

      // Actions / Search / CTA / Mobile burger
      const actionsEl = el('div', { class: 'cms-header-actions' });

      if (p.showSearch) {
        const searchInput = el('input', {
          type: 'text',
          class: 'cms-header-search-input',
          placeholder: p.searchPlaceholder || 'Search...',
          onkeydown: (e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              showToast(`Search: ${e.target.value}`, 'info');
            }
          }
        });
        const searchBox = el('div', { class: 'cms-header-search' }, [
          createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'),
          searchInput
        ]);
        actionsEl.appendChild(searchBox);
      }

      if (p.showCta !== false) {
        const ctaBtn = el('a', {
          class: `cms-header-cta-btn cta-${p.ctaVariant || 'filled'}`,
          href: p.ctaUrl || '#'
        }, p.ctaLabel || 'Get Started');
        actionsEl.appendChild(ctaBtn);
      }

      // Mobile Hamburger
      const burger = el('button', {
        type: 'button',
        class: 'cms-header-burger',
        title: 'Toggle Navigation',
        'aria-label': 'Toggle Navigation'
      }, [
        el('span'),
        el('span'),
        el('span')
      ]);
      actionsEl.appendChild(burger);

      const headerInner = el('div', { class: 'cms-header-inner' }, [
        brandEl,
        navEl,
        actionsEl
      ]);
      headerChildren.push(headerInner);

      // Mobile Drawer
      const mobileNavChildren = links.map(link => el('a', {
        class: 'cms-header-link',
        href: link.url || '#'
      }, link.label || 'Link'));

      if (p.showSearch) {
        mobileNavChildren.unshift(el('div', { class: 'cms-header-search mobile' }, [
          createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>'),
          el('input', {
            type: 'text',
            class: 'cms-header-search-input',
            placeholder: p.searchPlaceholder || 'Search...'
          })
        ]));
      }

      if (p.showCta !== false) {
        mobileNavChildren.push(el('a', {
          class: `cms-header-cta-btn cta-${p.ctaVariant || 'filled'}`,
          style: 'width:100%;text-align:center;box-sizing:border-box;margin-top:6px;',
          href: p.ctaUrl || '#'
        }, p.ctaLabel || 'Get Started'));
      }

      const mobileDrawer = el('div', { class: 'cms-header-mobile-drawer' }, mobileNavChildren);
      burger.addEventListener('click', (e) => {
        e.stopPropagation();
        burger.classList.toggle('is-active');
        mobileDrawer.classList.toggle('is-open');
      });
      headerChildren.push(mobileDrawer);

      // Subsection 3: Interactive Carousel Track & Nested Component Dropzone
      if (enableCarousel) {
        const itemWidth = p.carouselItemWidth || 'medium';
        const showArrows = p.carouselShowArrows !== false;
        const showPrevNext = p.carouselShowPrevNext || 'both';
        const arrowStyle = p.carouselArrowStyle || 'circle';
        const arrowBehavior = p.carouselArrowBehavior || 'smooth';
        const showDots = p.carouselShowDots !== false;
        const dotStyle = p.carouselDotStyle || 'bars';
        const dotBehavior = p.carouselDotBehavior || 'smooth';
        const showSlideCounter = p.showSlideCounter !== false;

        const carouselWrapper = el('div', { class: 'cms-header-carousel-wrapper' });
        const viewport = el('div', { class: 'cms-header-carousel-viewport' });
        const track = el('div', {
          class: 'cms-header-carousel-track',
          dataset: { containerId: block.id }
        });

        if (!children.length) {
          const dropzone = el('div', { class: 'header-carousel-dropzone empty' }, [
            createSvg('<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m9 9 3 3 3-3"/></svg>'),
            el('span', {}, 'Header Carousel Track — Drag & drop components from the palette here')
          ]);
          track.appendChild(dropzone);
        } else {
          children.forEach(childBlock => {
            const childWrap = renderBlockWrap(childBlock, block.id);
            childWrap.classList.add('cms-header-carousel-slide', `slide-width-${itemWidth}`);
            track.appendChild(childWrap);
          });
        }

        // Attach drag and drop listeners for nested components
        track.addEventListener('dragover', e => onContainerDragOver(e, block));
        track.addEventListener('dragleave', e => onContainerDragLeave(e, block));
        track.addEventListener('drop', e => onContainerDrop(e, block));

        viewport.appendChild(track);

        const getSlideStep = () => {
          const firstSlide = track.querySelector('.cms-header-carousel-slide');
          return firstSlide ? (firstSlide.offsetWidth + 14) : 320;
        };

        // Navigation Arrows
        let prevArrow = null;
        let nextArrow = null;
        const canShowArrows = showArrows && children.length > 1;
        const showPrev = canShowArrows && (showPrevNext === 'both' || showPrevNext === 'prev-only');
        const showNext = canShowArrows && (showPrevNext === 'both' || showPrevNext === 'next-only');

        if (showPrev) {
          prevArrow = el('button', {
            type: 'button',
            class: `cms-header-carousel-arrow prev arrow-style-${arrowStyle}`,
            title: 'Previous Slide',
            onclick: (e) => {
              e.stopPropagation();
              const step = getSlideStep();
              if (arrowBehavior === 'loop' && track.scrollLeft <= 5) {
                track.scrollTo({ left: track.scrollWidth, behavior: 'smooth' });
              } else {
                track.scrollBy({ left: -step, behavior: 'smooth' });
              }
            }
          }, [createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>')]);
          carouselWrapper.appendChild(prevArrow);
        }

        carouselWrapper.appendChild(viewport);

        if (showNext) {
          nextArrow = el('button', {
            type: 'button',
            class: `cms-header-carousel-arrow next arrow-style-${arrowStyle}`,
            title: 'Next Slide',
            onclick: (e) => {
              e.stopPropagation();
              const step = getSlideStep();
              if (arrowBehavior === 'loop' && (track.scrollLeft + track.clientWidth >= track.scrollWidth - 10)) {
                track.scrollTo({ left: 0, behavior: 'smooth' });
              } else {
                track.scrollBy({ left: step, behavior: 'smooth' });
              }
            }
          }, [createSvg('<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>')]);
          carouselWrapper.appendChild(nextArrow);
        }

        // Bottom Controls Bar (Pagination Dots + Slide Counter)
        let counterEl = null;
        let dotsWrap = null;
        let dots = [];

        if (children.length > 0 && (showDots || showSlideCounter)) {
          const controlsBar = el('div', { class: 'cms-header-carousel-controls' });

          if (showDots && children.length > 1) {
            dotsWrap = el('div', { class: `cms-header-carousel-dots dot-style-${dotStyle}` });
            dots = children.map((_, idx) => {
              const dot = el('button', {
                type: 'button',
                class: `cms-header-carousel-dot${idx === 0 ? ' active' : ''}`,
                title: `Slide ${idx + 1}`,
                onclick: (e) => {
                  e.stopPropagation();
                  const slides = track.querySelectorAll('.cms-header-carousel-slide');
                  if (slides[idx]) {
                    const scrollBehavior = dotBehavior === 'instant' ? 'auto' : 'smooth';
                    slides[idx].scrollIntoView({ behavior: scrollBehavior, inline: 'center', block: 'nearest' });
                  }
                }
              }, dotStyle === 'numbers' ? [el('span', {}, String(idx + 1))] : []);
              return dot;
            });
            dots.forEach(d => dotsWrap.appendChild(d));
            controlsBar.appendChild(dotsWrap);
          }

          if (showSlideCounter && children.length > 0) {
            const totalStr = String(children.length).padStart(2, '0');
            counterEl = el('div', { class: 'cms-header-carousel-counter' }, `01 / ${totalStr}`);
            controlsBar.appendChild(counterEl);
          }

          carouselWrapper.appendChild(controlsBar);
        }

        // Update active dot and counter on scroll
        let scrollTimer;
        track.addEventListener('scroll', () => {
          clearTimeout(scrollTimer);
          scrollTimer = setTimeout(() => {
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
            if (counterEl) {
              const curStr = String(closestIdx + 1).padStart(2, '0');
              const totalStr = String(children.length).padStart(2, '0');
              counterEl.textContent = `${curStr} / ${totalStr}`;
            }
          }, 40);
        }, { passive: true });

        // Drag to scroll
        let isDown = false;
        let startX, sLeft;
        track.addEventListener('mousedown', e => {
          if (e.target.closest('.block-wrap, .block-toolbar, button, input, textarea, a, .container-insert-indicator')) return;
          isDown = true;
          startX = e.pageX - track.offsetLeft;
          sLeft = track.scrollLeft;
        });
        window.addEventListener('mouseup', () => { isDown = false; });
        track.addEventListener('mousemove', e => {
          if (!isDown) return;
          e.preventDefault();
          const x = e.pageX - track.offsetLeft;
          const walk = (x - startX) * 1.5;
          track.scrollLeft = sLeft - walk;
        });

        // Autoplay
        if (p.carouselAutoplay && children.length > 1) {
          const interval = (Math.max(2, Number(p.carouselInterval) || 4)) * 1000;
          let autoTimer = setInterval(() => {
            if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 10) {
              track.scrollTo({ left: 0, behavior: 'smooth' });
            } else {
              track.scrollBy({ left: getSlideStep(), behavior: 'smooth' });
            }
          }, interval);
          track.addEventListener('mouseenter', () => clearInterval(autoTimer));
          track.addEventListener('mouseleave', () => {
            clearInterval(autoTimer);
            autoTimer = setInterval(() => {
              if (track.scrollLeft + track.clientWidth >= track.scrollWidth - 10) {
                track.scrollTo({ left: 0, behavior: 'smooth' });
              } else {
                track.scrollBy({ left: getSlideStep(), behavior: 'smooth' });
              }
            }, interval);
          });
        }

        headerChildren.push(carouselWrapper);
      }

      const headerEl = el('header', {
        class: `cms-header-block layout-${layout} variant-${variant}${isSticky ? ' is-sticky' : ''}`
      }, headerChildren);

      applyCustomCssOverride(headerEl, p.customCss);
      return headerEl;
    }
    default:
      return el('div', { class: 'block' }, 'Unknown block');
  }
}

function renderBlockWrap(block, parentContainerId = null) {
  const isSelected = block.id === state.cms.selectedBlockId;
  const isContainer = block.type === 'container';
  const hasLink = !!block.props?.linkUrl;
  const wrap = el('div', {
    id: block.id,
    class: `block-wrap${isContainer ? ' is-container' : ''}${isSelected ? ' selected' : ''}${hasLink ? ' has-nav-link' : ''}`,
    dataset: { blockId: block.id },
    draggable: 'true'
  });

  const toolbar = el('div', { class: 'block-toolbar' }, [
    el('span', {
      class: 'drag-handle',
      title: 'Drag to reorder'
    }, [createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/></svg>')]),
    el('button', {
      title: 'Move up/left',
      onclick: e => { e.stopPropagation(); moveBlock(block.id, -1); }
    }, [createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>')]),
    el('button', {
      title: 'Move down/right',
      onclick: e => { e.stopPropagation(); moveBlock(block.id, +1); }
    }, [createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>')]),
    el('button', {
      title: 'Duplicate / Copy component (Ctrl+D)',
      onclick: e => { e.stopPropagation(); duplicateBlock(block.id); }
    }, [createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>')]),
    el('button', {
      class: 'delete-btn',
      title: 'Delete block',
      onclick: e => { e.stopPropagation(); deleteBlock(block.id); }
    }, [createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>')])
  ]);

  wrap.appendChild(toolbar);

  if (isContainer) {
    const p = block.props || {};
    const mode = p.mode || 'grid';
    const children = Array.isArray(p.children) ? p.children : [];
    const containerEl = el('div', {
      class: `block-container mode-${mode}${p.border ? ' has-border' : ''}${p.shadow ? ' has-shadow' : ''}${p.bg && p.bg !== 'transparent' ? ' bg-' + p.bg : ''}${p.linkUrl ? ' is-clickable-card' : ''}`,
      dataset: { containerId: block.id }
    });

    let style = `padding:${p.padding ?? 16}px;border-radius:${p.borderRadius ?? 8}px;gap:${p.gap ?? 16}px;`;
    if (mode === 'grid') {
      style += `grid-template-columns:repeat(${p.columns || 2}, minmax(0, 1fr));`;
    } else {
      style += `flex-direction:${p.direction || 'row'};justify-content:${p.justify || 'flex-start'};align-items:${p.align || 'stretch'};flex-wrap:${p.wrap || 'wrap'};`;
    }
    containerEl.style.cssText = style;

    if (p.linkUrl) {
      containerEl.addEventListener('click', e => {
        if (state.cms.isPreviewMode) {
          handleComponentNavigation(p.linkUrl, p.newTab, e);
        }
      });
    }

    applyCustomCssOverride(containerEl, p.customCss);

    if (!children.length) {
      const dropzone = el('div', { class: 'container-dropzone empty' }, [
        createSvg('<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>'),
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
    const rendered = renderBlockContent(block);
    applyCustomCssOverride(rendered, block.props?.customCss);
    wrap.appendChild(rendered);
  }

  wrap.addEventListener('click', e => {
    e.stopPropagation();
    if (state.cms.isPreviewMode) {
      if (block.props?.url) {
        handleComponentNavigation(block.props.url, block.props.newTab, e);
      } else if (block.props?.linkUrl) {
        handleComponentNavigation(block.props.linkUrl, block.props.newTab, e);
      }
      return;
    }
    selectBlock(block.id);
  });
  wrap.addEventListener('dragstart', e => onBlockDragStart(e, block));
  wrap.addEventListener('dragend', onBlockDragEnd);

  wrap.addEventListener('mouseenter', () => {
    const treeRow = document.querySelector(`.tree-node-row[data-tree-block-id="${block.id}"]`);
    if (treeRow) treeRow.classList.add('canvas-hover-highlight');
  });
  wrap.addEventListener('mouseleave', () => {
    const treeRow = document.querySelector(`.tree-node-row[data-tree-block-id="${block.id}"]`);
    if (treeRow) treeRow.classList.remove('canvas-hover-highlight');
  });

  return wrap;
}

function setViewportMode(mode) {
  state.cms.viewportMode = mode;
  state.cms.viewportWidth = null;
  updateViewportUI();
  applyCanvasSettings();
}

function toggleViewportOrientation() {
  state.cms.viewportOrientation = state.cms.viewportOrientation === 'portrait' ? 'landscape' : 'portrait';
  updateViewportUI();
  applyCanvasSettings();
}

function toggleDeviceFrame() {
  state.cms.deviceFrame = !state.cms.deviceFrame;
  updateViewportUI();
  applyCanvasSettings();
}

function togglePreviewMode(enable) {
  state.cms.isPreviewMode = typeof enable === 'boolean' ? enable : !state.cms.isPreviewMode;
  if (state.cms.isPreviewMode) {
    state.cms.selectedBlockId = null;
  }
  updateViewportUI();
  renderCanvas();
  renderProps();
}

function getViewportWidthDisplay() {
  const mode = state.cms.viewportMode || 'desktop';
  const isLandscape = state.cms.viewportOrientation === 'landscape';
  if (state.cms.viewportWidth != null) {
    return `${Math.round(state.cms.viewportWidth)}px`;
  }
  if (mode === 'mobile') {
    return isLandscape ? '667px' : '375px';
  }
  if (mode === 'tablet') {
    return isLandscape ? '1024px' : '768px';
  }
  const pageMaxWidth = state.cms.openPage?.settings?.maxWidth || '820px';
  return pageMaxWidth === '100%' ? '100% (Full)' : pageMaxWidth;
}

function updateViewportUI() {
  const mode = state.cms.viewportMode || 'desktop';
  const isLandscape = state.cms.viewportOrientation === 'landscape';
  const isPreview = !!state.cms.isPreviewMode;

  document.getElementById('cmsViewportDesktopBtn')?.classList.toggle('active', mode === 'desktop');
  document.getElementById('cmsViewportTabletBtn')?.classList.toggle('active', mode === 'tablet');
  document.getElementById('cmsViewportMobileBtn')?.classList.toggle('active', mode === 'mobile');

  const rotateBtn = document.getElementById('cmsViewportRotateBtn');
  if (rotateBtn) {
    rotateBtn.classList.toggle('hidden', mode === 'desktop');
    rotateBtn.classList.toggle('active', isLandscape);
  }

  const frameBtn = document.getElementById('cmsViewportFrameToggle');
  if (frameBtn) {
    frameBtn.classList.toggle('hidden', mode === 'desktop');
    frameBtn.classList.toggle('active', state.cms.deviceFrame);
  }

  const dimText = document.getElementById('cmsViewportDimText');
  if (dimText) {
    dimText.textContent = getViewportWidthDisplay();
  }

  document.getElementById('cmsEditModeBtn')?.classList.toggle('active', !isPreview);
  document.getElementById('cmsPreviewModeBtn')?.classList.toggle('active', isPreview);

  const workspace = document.querySelector('.cms-workspace');
  if (workspace) {
    workspace.classList.toggle('is-preview-mode', isPreview);
  }
  const cmsMain = document.getElementById('cms');
  if (cmsMain) {
    cmsMain.classList.toggle('is-preview-mode', isPreview);
  }

  const banner = document.getElementById('cmsPreviewBanner');
  if (banner) {
    banner.classList.toggle('hidden', !isPreview);
    const infoText = document.getElementById('cmsPreviewInfoText');
    if (infoText) {
      let label = mode.toUpperCase();
      if (mode !== 'desktop') {
        label += ` (${isLandscape ? 'Landscape' : 'Portrait'})`;
      }
      infoText.textContent = `${label} · ${getViewportWidthDisplay()}`;
    }
  }
}

function initViewportResizers() {
  const container = document.getElementById('canvasViewportContainer');
  const viewport = document.querySelector('.canvas-viewport');
  const leftResizer = document.querySelector('.viewport-resizer.left');
  const rightResizer = document.querySelector('.viewport-resizer.right');
  if (!container || !viewport || !leftResizer || !rightResizer) return;

  let isResizing = false;
  let startX = 0;
  let startWidth = 0;
  let activeHandle = null;

  const onMouseDown = (e, handle) => {
    e.preventDefault();
    isResizing = true;
    activeHandle = handle;
    startX = e.clientX;
    startWidth = viewport.getBoundingClientRect().width;
    handle.classList.add('is-resizing');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  leftResizer.addEventListener('mousedown', e => onMouseDown(e, leftResizer));
  rightResizer.addEventListener('mousedown', e => onMouseDown(e, rightResizer));

  window.addEventListener('mousemove', e => {
    if (!isResizing) return;
    const deltaX = e.clientX - startX;
    const multiplier = activeHandle === rightResizer ? 2 : -2;
    let newWidth = Math.max(320, Math.min(1400, startWidth + deltaX * multiplier));
    state.cms.viewportMode = 'custom';
    state.cms.viewportWidth = newWidth;
    updateViewportUI();
    applyCanvasSettings();
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      leftResizer.classList.remove('is-resizing');
      rightResizer.classList.remove('is-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
  });
}

function applyCanvasSettings() {
  const settings = (state.cms.openPage && state.cms.openPage.settings) || {};
  const viewport = document.querySelector('.canvas-viewport');
  const canvas = document.getElementById('cmsCanvas');
  const frameTop = document.getElementById('cmsDeviceFrameTop');
  const frameBottom = document.getElementById('cmsDeviceFrameBottom');
  if (!canvas || !viewport) return;

  const mode = state.cms.viewportMode || 'desktop';
  const isLandscape = state.cms.viewportOrientation === 'landscape';
  const showFrame = state.cms.deviceFrame && (mode === 'mobile' || mode === 'tablet');

  let targetWidth;
  if (state.cms.viewportWidth != null) {
    targetWidth = `${Math.round(state.cms.viewportWidth)}px`;
  } else if (mode === 'mobile') {
    targetWidth = isLandscape ? '667px' : '375px';
  } else if (mode === 'tablet') {
    targetWidth = isLandscape ? '1024px' : '768px';
  } else {
    targetWidth = settings.maxWidth || '820px';
  }

  viewport.style.maxWidth = targetWidth;

  viewport.classList.toggle('has-device-frame', showFrame);
  viewport.classList.toggle('is-mobile-viewport', mode === 'mobile');
  viewport.classList.toggle('is-tablet-viewport', mode === 'tablet');
  viewport.classList.toggle('is-landscape', isLandscape);
  if (frameTop) frameTop.classList.toggle('hidden', !showFrame);
  if (frameBottom) frameBottom.classList.toggle('hidden', !showFrame);

  const paddingX = settings.paddingX != null ? Number(settings.paddingX) : (mode === 'mobile' ? 20 : 36);
  const paddingY = settings.paddingY != null ? Number(settings.paddingY) : (mode === 'mobile' ? 28 : 44);
  const marginY = settings.marginY != null ? Number(settings.marginY) : 0;
  const marginX = settings.marginX != null ? Number(settings.marginX) : 0;
  const borderRadius = settings.borderRadius != null ? Number(settings.borderRadius) : (showFrame ? 24 : 16);
  const bgType = settings.bg || 'default';
  const align = settings.align || 'center';
  const fontFamily = settings.fontFamily || 'system';

  if (align === 'left' && mode === 'desktop') {
    viewport.style.margin = `${marginY}px auto ${marginY}px ${marginX}px`;
  } else if (marginX > 0 && mode === 'desktop') {
    viewport.style.margin = `${marginY}px ${marginX}px`;
  } else {
    viewport.style.margin = `${marginY}px auto`;
  }

  const fontMap = {
    inter: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    outfit: "'Outfit', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    roboto: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: "'JetBrains Mono', 'Fira Code', monospace",
    system: "inherit"
  };
  canvas.style.fontFamily = fontMap[fontFamily] || 'inherit';

  let bgCss = 'var(--bg-surface)';
  let borderCss = '1px solid var(--border-subtle)';
  let textCss = 'var(--text-primary)';

  if (bgType === 'pure-black') {
    bgCss = '#000000';
    borderCss = '1px solid rgba(255, 255, 255, 0.12)';
  } else if (bgType === 'dark-card') {
    bgCss = '#111827';
    borderCss = '1px solid #1f2937';
  } else if (bgType === 'deep-navy') {
    bgCss = '#0a1324';
    borderCss = '1px solid #1e293b';
  } else if (bgType === 'light') {
    bgCss = '#ffffff';
    borderCss = '1px solid #e2e8f0';
    textCss = '#0f172a';
  } else if (bgType === 'custom' && settings.customBg) {
    bgCss = settings.customBg;
    borderCss = '1px solid rgba(255, 255, 255, 0.18)';
  }

  canvas.style.background = bgCss;
  canvas.style.border = borderCss;
  canvas.style.borderRadius = `${borderRadius}px`;
  canvas.style.padding = `${paddingY}px ${paddingX}px`;

  const isCanvasActive = !state.cms.selectedBlockId && !!state.cms.openPage && !state.cms.isPreviewMode;
  canvas.classList.toggle('is-active', isCanvasActive);
}

function getBlockIconSvg(type) {
  switch (type) {
    case 'heading':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 12h12"/><path d="M6 4v16"/><path d="M18 4v16"/></svg>');
    case 'paragraph':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="21" y1="6" x2="3" y2="6"/><line x1="15" y1="12" x2="3" y2="12"/><line x1="17" y1="18" x2="3" y2="18"/></svg>');
    case 'button':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="4"/><circle cx="8" cy="12" r="1.5"/><line x1="12" y1="12" x2="16" y2="12"/></svg>');
    case 'image':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>');
    case 'carousel':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="16" y1="4" x2="16" y2="20"/><path d="m10 9 4 3-4 3"/></svg>');
    case 'container':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18"/><path d="M3 12h18"/></svg>');
    case 'table':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18"/><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/></svg>');
    case 'divider':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/></svg>');
    case 'spacer':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 7 12 3 16 7"/><polyline points="8 17 12 21 16 17"/><line x1="12" y1="3" x2="12" y2="21"/></svg>');
    case 'callout':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="M2 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="M12 22v-4"/><path d="m19.07 19.07-2.83-2.83"/><path d="M22 12h-4"/><path d="m19.07 4.93-2.83 2.83"/></svg>');
    case 'accordion':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 8h10"/><path d="M7 12h10"/><path d="m15 16-3-3-3 3"/></svg>');
    case 'tabs':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 6a2 2 0 0 1 2-2h4l2 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/></svg>');
    case 'pricing':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>');
    case 'stat':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>');
    case 'testimonial':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/></svg>');
    case 'video':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>');
    case 'code':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>');
    case 'bento':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>');
    case 'comparison':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><line x1="12" y1="3" x2="12" y2="21"/><circle cx="12" cy="12" r="2"/></svg>');
    case 'tilt-card':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="3"/><path d="m3 9 18-3"/><path d="m9 21 3-18"/></svg>');
    case 'marquee':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="12" x="2" y="6" rx="2"/><path d="M12 12h.01"/><path d="M17 12h.01"/><path d="M7 12h.01"/></svg>');
    case 'countdown':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>');
    case 'timeline':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><circle cx="12" cy="12" r="3"/><circle cx="12" cy="19" r="3"/><line x1="12" y1="8" x2="12" y2="9"/><line x1="12" y1="15" x2="12" y2="16"/></svg>');
    case 'form':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>');
    case 'audio':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>');
    case 'header':
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="M2 10h20"/><circle cx="6" cy="7" r="1"/><path d="M14 7h4"/></svg>');
    default:
      return createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/></svg>');
  }
}

function switchSidebarTab(tab) {
  state.cms.sidebarTab = tab;
  const blocksBtn = document.getElementById('cmsTabBlocksBtn');
  const treeBtn = document.getElementById('cmsTabTreeBtn');

  const blocksView = document.getElementById('cmsPaletteView');
  const treeView = document.getElementById('cmsTreeView');

  if (blocksBtn) blocksBtn.classList.toggle('active', tab === 'blocks');
  if (treeBtn) treeBtn.classList.toggle('active', tab === 'tree');

  if (blocksView) blocksView.classList.toggle('hidden', tab !== 'blocks');
  if (treeView) treeView.classList.toggle('hidden', tab !== 'tree');

  if (tab === 'tree') {
    renderComponentTree();
  } else if (tab === 'blocks') {
    if (state.cms.blocksSubTab === 'custom') {
      renderReusableBlocks();
    }
  }
}

function renderComponentTree() {
  const root = document.getElementById('cmsTreeRoot');
  const countBadge = document.getElementById('cmsTreeCountBadge');
  if (!root) return;
  root.innerHTML = '';

  const blocks = getBlocks();
  let totalCount = 0;
  function tally(list) {
    list.forEach(b => {
      totalCount++;
      if ((b.type === 'container' || b.type === 'header') && Array.isArray(b.props?.children)) {
        tally(b.props.children);
      }
    });
  }
  tally(blocks);
  if (countBadge) countBadge.textContent = String(totalCount);
  const topLayersCount = document.getElementById('cmsTopLayersCount');
  if (topLayersCount) topLayersCount.textContent = String(totalCount);

  if (!blocks.length) {
    root.appendChild(el('div', { class: 'tree-empty-state' }, [
      createSvg('<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="margin:0 auto 8px;display:block;"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>'),
      el('p', {}, 'No components on this page yet.'),
      el('button', {
        type: 'button',
        class: 'btn-sm-ghost',
        style: 'margin-top:6px;',
        onclick: () => switchSidebarTab('blocks')
      }, '+ Add from Blocks')
    ]));
    return;
  }

function scrollToBlock(id) {
  setTimeout(() => {
    const blockEl = document.getElementById(id) || document.querySelector(`[data-block-id="${id}"]`);
    if (!blockEl) return;
    blockEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
    blockEl.classList.remove('pulse-highlight');
    void blockEl.offsetWidth; // Reflow to re-trigger animation
    blockEl.classList.add('pulse-highlight');
    setTimeout(() => {
      blockEl.classList.remove('pulse-highlight');
    }, 1200);
  }, 40);
}

  function renderTreeNode(block, depth = 0) {
    const isContainer = (block.type === 'container' || block.type === 'header') && Array.isArray(block.props?.children);
    const isSelected = state.cms.selectedBlockId === block.id;
    const children = Array.isArray(block.props?.children) ? block.props.children : [];

    let snippet = '';
    if (block.props) {
      if (block.type === 'heading') snippet = block.props.text || 'Heading';
      else if (block.type === 'paragraph') snippet = block.props.text ? block.props.text.slice(0, 18) + (block.props.text.length > 18 ? '...' : '') : '';
      else if (block.type === 'button') snippet = block.props.label || 'Button';
      else if (block.type === 'image') snippet = block.props.caption || '';
      else if (block.type === 'carousel') snippet = `${(block.props.slides || []).length} slides`;
      else if (block.type === 'container') snippet = block.props.mode === 'grid' ? `${block.props.columns || 2} cols` : (block.props.direction || 'row');
      else if (block.type === 'header') snippet = `${(block.props.children || []).length} slides • ${block.props.brandName || 'Brand'}`;
    }

    const nodeWrap = el('div', { class: `tree-node ${isSelected ? 'selected' : ''}` });
    const row = el('div', {
      class: 'tree-node-row',
      draggable: 'true',
      dataset: { treeBlockId: block.id },
      onclick: e => {
        e.stopPropagation();
        selectBlock(block.id);
        scrollToBlock(block.id);
      },
      onmouseenter: () => {
        const blockEl = document.getElementById(block.id) || document.querySelector(`[data-block-id="${block.id}"]`);
        if (blockEl) blockEl.classList.add('tree-hover-highlight');
      },
      onmouseleave: () => {
        const blockEl = document.getElementById(block.id) || document.querySelector(`[data-block-id="${block.id}"]`);
        if (blockEl) blockEl.classList.remove('tree-hover-highlight');
      },
      ondragstart: e => {
        e.stopPropagation();
        state.cms.drag = { kind: 'block', id: block.id, fromTree: true };
        nodeWrap.classList.add('dragging');
        e.dataTransfer.setData('text/plain', block.id);
        e.dataTransfer.effectAllowed = 'move';
      },
      ondragend: e => {
        e.stopPropagation();
        document.querySelectorAll('.tree-node.dragging').forEach(n => n.classList.remove('dragging'));
        document.querySelectorAll('.tree-node-row').forEach(r => {
          r.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
          delete r.dataset.dropPos;
        });
        state.cms.drag = null;
      },
      ondragover: e => {
        if (!state.cms.drag) return;
        if (state.cms.drag.kind === 'block' && (state.cms.drag.id === block.id || isDescendant(state.cms.drag.id, block.id))) {
          return;
        }
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = (state.cms.drag.kind === 'palette' || state.cms.drag.kind === 'reusable') ? 'copy' : 'move';

        const rect = row.getBoundingClientRect();
        const relY = (e.clientY - rect.top) / rect.height;

        row.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
        if (isContainer && relY > 0.25 && relY < 0.75) {
          row.classList.add('drag-target-inside');
          row.dataset.dropPos = 'inside';
        } else if (relY <= 0.5) {
          row.classList.add('drag-target-before');
          row.dataset.dropPos = 'before';
        } else {
          row.classList.add('drag-target-after');
          row.dataset.dropPos = 'after';
        }
      },
      ondragleave: e => {
        if (e.relatedTarget && row.contains(e.relatedTarget)) return;
        row.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
        delete row.dataset.dropPos;
      },
      ondrop: e => {
        e.preventDefault();
        e.stopPropagation();
        const dropPos = row.dataset.dropPos || 'after';
        row.classList.remove('drag-target-before', 'drag-target-after', 'drag-target-inside');
        delete row.dataset.dropPos;

        if (!state.cms.drag) return;
        if (state.cms.drag.kind === 'block' && (state.cms.drag.id === block.id || isDescendant(state.cms.drag.id, block.id))) {
          return;
        }

        const drag = state.cms.drag;
        state.cms.drag = null;

        let targetParentId = null;
        let targetIdx = 0;

        if (dropPos === 'inside' && isContainer) {
          targetParentId = block.id;
          const container = findBlock(block.id);
          targetIdx = (container && container.props && Array.isArray(container.props.children)) ? container.props.children.length : 0;
          block._treeCollapsed = false;
        } else {
          const targetLoc = findBlockLocation(block.id);
          if (targetLoc) {
            targetParentId = targetLoc.parentContainerId || (targetLoc.parentBlock ? targetLoc.parentBlock.id : null);
            targetIdx = dropPos === 'before' ? targetLoc.index : targetLoc.index + 1;
          }
        }

        if (drag.kind === 'palette') {
          insertBlockAt(drag.type, targetParentId, targetIdx);
        } else if (drag.kind === 'reusable') {
          insertReusableBlockAt(drag.reusableId, targetParentId, targetIdx);
        } else if (drag.kind === 'block') {
          moveBlockTo(drag.id, targetParentId, targetIdx);
          showToast('Component moved', 'info');
        }
        renderCanvas();
        renderProps();
        renderComponentTree();
      }
    });

    if (isContainer) {
      const isCollapsed = !!block._treeCollapsed;
      const toggle = el('button', {
        type: 'button',
        class: `tree-toggle-btn ${isCollapsed ? 'collapsed' : ''}`,
        onclick: e => {
          e.stopPropagation();
          block._treeCollapsed = !block._treeCollapsed;
          renderComponentTree();
        }
      }, [createSvg('<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>')]);
      row.appendChild(toggle);
    } else {
      row.appendChild(el('span', { style: 'width:16px;' }));
    }

    const iconWrap = el('div', { class: `tree-node-icon ${block.type}-icon` }, [
      getBlockIconSvg(block.type)
    ]);
    row.appendChild(iconWrap);

    const labelWrap = el('div', { class: 'tree-node-label' }, [
      BLOCK_LABELS[block.type] || block.type,
      snippet ? el('span', { class: 'tree-node-sub' }, ` (${snippet})`) : null
    ]);
    row.appendChild(labelWrap);

    const actions = el('div', { class: 'tree-node-actions' }, [
      el('button', {
        type: 'button',
        class: 'tree-node-btn',
        title: 'Duplicate (Ctrl+D)',
        onclick: e => { e.stopPropagation(); duplicateBlock(block.id); }
      }, [createSvg('<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>')]),
      el('button', {
        type: 'button',
        class: 'tree-node-btn delete-btn',
        title: 'Delete block',
        onclick: e => { e.stopPropagation(); deleteBlock(block.id); }
      }, [createSvg('<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>')])
    ]);
    row.appendChild(actions);

    nodeWrap.appendChild(row);

    if (isContainer && children.length > 0) {
      const childrenWrap = el('div', { class: `tree-children ${block._treeCollapsed ? 'collapsed' : ''}` });
      children.forEach(child => {
        childrenWrap.appendChild(renderTreeNode(child, depth + 1));
      });
      nodeWrap.appendChild(childrenWrap);
    }

    return nodeWrap;
  }

  blocks.forEach(b => {
    root.appendChild(renderTreeNode(b, 0));
  });
}

function renderCanvas() {
  applyCanvasSettings();
  const canvas = document.getElementById('cmsCanvas');
  canvas.innerHTML = '';
  const blocks = getBlocks();
  if (!blocks.length) {
    canvas.appendChild(el('div', { class: 'cms-empty-canvas' }, 'Drag a block from the palette to get started.'));
  } else {
    blocks.forEach(block => {
      canvas.appendChild(renderBlockWrap(block));
    });
  }
  renderComponentTree();
}

function selectBlock(id) {
  state.cms.selectedBlockId = id;
  renderCanvas();
  renderProps();
  renderComponentTree();
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
  triggerAutoSave(100);
}

function deleteBlock(id) {
  const loc = findBlockLocation(id);
  if (!loc) return;
  const { parentArray, index } = loc;
  parentArray.splice(index, 1);
  if (state.cms.selectedBlockId === id) state.cms.selectedBlockId = null;
  renderCanvas();
  renderProps();
  triggerAutoSave(100);
}

function cloneBlockWithNewIds(originalBlock) {
  const cloned = JSON.parse(JSON.stringify(originalBlock));
  cloned.id = 'b_' + Math.random().toString(36).slice(2, 9);
  if (cloned.type === 'container' && Array.isArray(cloned.props?.children)) {
    cloned.props.children = cloned.props.children.map(child => cloneBlockWithNewIds(child));
  }
  return cloned;
}

function copySelectedBlock(id) {
  const blockId = id || state.cms.selectedBlockId;
  if (!blockId) return;
  const block = findBlock(blockId);
  if (!block) return;
  state.cms.clipboardBlock = JSON.parse(JSON.stringify(block));
  showToast(`Copied "${BLOCK_LABELS[block.type] || block.type}" (Ctrl+V to paste)`, 'info');
}

function pasteCopiedBlock() {
  if (!state.cms.clipboardBlock) {
    showToast('Clipboard is empty. Select a component and press Ctrl+C first.', 'warning');
    return;
  }
  const cloned = cloneBlockWithNewIds(state.cms.clipboardBlock);

  if (state.cms.selectedBlockId) {
    const loc = findBlockLocation(state.cms.selectedBlockId);
    if (loc) {
      const selected = loc.parentArray[loc.index];
      if (selected.type === 'container' && Array.isArray(selected.props?.children)) {
        selected.props.children.push(cloned);
      } else {
        loc.parentArray.splice(loc.index + 1, 0, cloned);
      }
    } else {
      const blocks = getBlocks();
      blocks.push(cloned);
    }
  } else {
    const blocks = getBlocks();
    blocks.push(cloned);
  }

  state.cms.selectedBlockId = cloned.id;
  renderCanvas();
  renderProps();
  triggerAutoSave(100);
  showToast(`Pasted "${BLOCK_LABELS[cloned.type] || cloned.type}"`, 'success');
}

function duplicateBlock(id) {
  const loc = findBlockLocation(id);
  if (!loc) return;
  const { parentArray, index } = loc;
  const original = parentArray[index];
  const cloned = cloneBlockWithNewIds(original);
  parentArray.splice(index + 1, 0, cloned);
  state.cms.selectedBlockId = cloned.id;
  renderCanvas();
  renderProps();
  triggerAutoSave(100);
  showToast('Component duplicated', 'success');
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
  triggerAutoSave(100);
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
    if (!container.props) container.props = {};
    if (!Array.isArray(container.props.children)) container.props.children = [];
    targetArray = container.props.children;
  } else {
    targetArray = getBlocks();
  }

  let targetIdx = idx == null ? targetArray.length : idx;
  if (loc.parentArray === targetArray && loc.index < targetIdx) {
    targetIdx = Math.max(0, targetIdx - 1);
  }
  targetIdx = Math.max(0, Math.min(targetIdx, targetArray.length));
  targetArray.splice(targetIdx, 0, b);

  state.cms.selectedBlockId = blockId;
  renderCanvas();
  renderProps();
  renderComponentTree();
  triggerAutoSave(100);
}

function insertReusableBlockAt(reusableId, targetContainerId, idx) {
  const r = (state.cms.reusableBlocks || []).find(x => x.id === Number(reusableId));
  if (!r || !r.block_data) return;
  const cloned = cloneBlockWithNewIds(r.block_data);
  if (targetContainerId) {
    const container = findBlock(targetContainerId);
    if (container) {
      if (!container.props) container.props = {};
      if (!Array.isArray(container.props.children)) container.props.children = [];
      const safeIdx = Math.max(0, Math.min(idx ?? container.props.children.length, container.props.children.length));
      container.props.children.splice(safeIdx, 0, cloned);
    }
  } else {
    const blocks = getBlocks();
    const safeIdx = Math.max(0, Math.min(idx ?? blocks.length, blocks.length));
    blocks.splice(safeIdx, 0, cloned);
  }
  state.cms.selectedBlockId = cloned.id;
  renderCanvas();
  renderProps();
  triggerAutoSave(100);
  showToast(`Added reusable component "${r.name}"`, 'success');
}

// ---------- Drag & Drop ----------
function onPaletteDragStart(e) {
  const t = e.currentTarget;
  if (t.dataset.blockType === 'reusable') {
    state.cms.drag = { kind: 'reusable', reusableId: Number(t.dataset.reusableId) };
    e.dataTransfer.setData('text/plain', `reusable:${t.dataset.reusableId}`);
  } else {
    state.cms.drag = { kind: 'palette', type: t.dataset.blockType };
    e.dataTransfer.setData('text/plain', t.dataset.blockType);
  }
  t.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'copy';
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

function getContainerInsertIndex(containerEl, clientX, clientY, isGridOrWrap) {
  const childWraps = Array.from(containerEl.querySelectorAll(':scope > .block-wrap:not(.container-insert-indicator)'));
  if (!childWraps.length) return 0;

  // 1D Vertical Flex Column
  if (!isGridOrWrap) {
    for (let i = 0; i < childWraps.length; i++) {
      const rect = childWraps[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return i;
    }
    return childWraps.length;
  }

  // 2D Multi-row Grid or Wrapping Flex:
  // Group elements by visual rows based on top coordinate
  const rows = [];
  childWraps.forEach((wrap, i) => {
    const rect = wrap.getBoundingClientRect();
    const existingRow = rows.find(r => Math.abs(r.top - rect.top) < 20);
    if (existingRow) {
      existingRow.items.push({ index: i, rect });
      existingRow.bottom = Math.max(existingRow.bottom, rect.bottom);
    } else {
      rows.push({ top: rect.top, bottom: rect.bottom, items: [{ index: i, rect }] });
    }
  });

  rows.sort((a, b) => a.top - b.top);

  // If client is vertically above the first row's center
  if (clientY < rows[0].top + (rows[0].bottom - rows[0].top) / 2) {
    for (const item of rows[0].items) {
      if (clientX < item.rect.left + item.rect.width / 2) return item.index;
    }
    return rows[0].items[rows[0].items.length - 1].index + 1;
  }

  // If client is vertically below the last row's center
  const lastRow = rows[rows.length - 1];
  if (clientY > lastRow.top + (lastRow.bottom - lastRow.top) / 2) {
    for (const item of lastRow.items) {
      if (clientX < item.rect.left + item.rect.width / 2) return item.index;
    }
    return childWraps.length;
  }

  // Find the closest visual row
  let targetRow = rows[0];
  let minRowDist = Infinity;
  for (const r of rows) {
    const rowCenterY = (r.top + r.bottom) / 2;
    const dist = Math.abs(clientY - rowCenterY);
    if (dist < minRowDist) {
      minRowDist = dist;
      targetRow = r;
    }
  }

  // Find target item in that row
  for (const item of targetRow.items) {
    if (clientX < item.rect.left + item.rect.width / 2) {
      return item.index;
    }
  }

  return targetRow.items[targetRow.items.length - 1].index + 1;
}

function showContainerDropIndicator(containerEl, idx, isGridOrWrap) {
  if (!state.cms.containerIndicator) {
    state.cms.containerIndicator = el('div', { class: 'container-insert-indicator' });
  }

  const childWraps = Array.from(containerEl.querySelectorAll(':scope > .block-wrap:not(.container-insert-indicator)'));
  if (!childWraps.length) {
    if (state.cms.containerIndicator.parentNode) {
      state.cms.containerIndicator.parentNode.removeChild(state.cms.containerIndicator);
    }
    return;
  }

  const cRect = containerEl.getBoundingClientRect();
  let left, top, width, height;

  if (idx < childWraps.length) {
    const target = childWraps[idx];
    const tRect = target.getBoundingClientRect();
    if (isGridOrWrap) {
      // Place a vertical bar on the left edge of the target element
      left = tRect.left - cRect.left - 3;
      top = tRect.top - cRect.top;
      width = 4;
      height = tRect.height;
    } else {
      // Place a horizontal bar on top edge of target element
      left = tRect.left - cRect.left;
      top = tRect.top - cRect.top - 3;
      width = tRect.width;
      height = 4;
    }
  } else {
    const last = childWraps[childWraps.length - 1];
    const lRect = last.getBoundingClientRect();
    if (isGridOrWrap) {
      // Place a vertical bar on the right edge of last element
      left = lRect.right - cRect.left - 1;
      top = lRect.top - cRect.top;
      width = 4;
      height = lRect.height;
    } else {
      // Place a horizontal bar on bottom edge of last element
      left = lRect.left - cRect.left;
      top = lRect.bottom - cRect.top - 1;
      width = lRect.width;
      height = 4;
    }
  }

  state.cms.containerIndicator.style.cssText = `
    position: absolute;
    left: ${Math.max(0, Math.round(left))}px;
    top: ${Math.max(0, Math.round(top))}px;
    width: ${Math.round(width)}px;
    height: ${Math.round(height)}px;
    pointer-events: none;
    z-index: 40;
  `;

  if (state.cms.containerIndicator.parentNode !== containerEl) {
    containerEl.appendChild(state.cms.containerIndicator);
  }
}

function hideDropIndicator() {
  if (state.cms.indicator && state.cms.indicator.parentNode) {
    state.cms.indicator.parentNode.removeChild(state.cms.indicator);
  }
  if (state.cms.containerIndicator && state.cms.containerIndicator.parentNode) {
    state.cms.containerIndicator.parentNode.removeChild(state.cms.containerIndicator);
  }
  document.querySelectorAll('.block-container.drag-over, .cms-header-carousel-track.drag-over').forEach(el => el.classList.remove('drag-over'));
}

function onCanvasDragOver(e) {
  if (!state.cms.drag) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = (state.cms.drag.kind === 'palette' || state.cms.drag.kind === 'reusable') ? 'copy' : 'move';
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
  } else if (state.cms.drag.kind === 'reusable') {
    insertReusableBlockAt(state.cms.drag.reusableId, null, idx);
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
  e.dataTransfer.dropEffect = (state.cms.drag.kind === 'palette' || state.cms.drag.kind === 'reusable') ? 'copy' : 'move';

  const containerEl = e.currentTarget;
  containerEl.classList.add('drag-over');

  const p = containerBlock.props || {};
  const isGridOrWrap = (p.mode === 'grid') || (p.mode === 'flex' && (!p.direction || p.direction.startsWith('row'))) || containerBlock.type === 'header';
  const idx = getContainerInsertIndex(containerEl, e.clientX, e.clientY, isGridOrWrap);
  showContainerDropIndicator(containerEl, idx, isGridOrWrap);
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
  const isGridOrWrap = (p.mode === 'grid') || (p.mode === 'flex' && (!p.direction || p.direction.startsWith('row'))) || containerBlock.type === 'header';
  const idx = getContainerInsertIndex(containerEl, e.clientX, e.clientY, isGridOrWrap);

  if (state.cms.drag.kind === 'palette') {
    insertBlockAt(state.cms.drag.type, containerBlock.id, idx);
  } else if (state.cms.drag.kind === 'reusable') {
    insertReusableBlockAt(state.cms.drag.reusableId, containerBlock.id, idx);
  } else if (state.cms.drag.kind === 'block') {
    moveBlockTo(state.cms.drag.id, containerBlock.id, idx);
  }
  state.cms.drag = null;
}

function renderCanvasSettings(body) {
  if (!state.cms.openPage) {
    body.appendChild(el('div', { class: 'no-selection-state' }, [
      createSvg('<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>'),
      el('p', {}, 'Open a page to edit canvas settings.')
    ]));
    return;
  }

  if (!state.cms.openPage.settings || typeof state.cms.openPage.settings !== 'object') {
    state.cms.openPage.settings = {
      maxWidth: '820px',
      bg: 'default',
      customBg: '#0f172a',
      paddingX: '36px',
      paddingY: '44px',
      fontFamily: 'system',
      align: 'center'
    };
  }
  const s = state.cms.openPage.settings;

  const onSettingsChange = (delay = 80) => {
    applyCanvasSettings();
    renderProps();
    triggerAutoSave(delay);
  };

  const onSettingsInput = (delay = 300) => {
    applyCanvasSettings();
    triggerAutoSave(delay);
  };

  const header = el('div', { class: 'props-header-actions', style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;' }, [
    el('div', { class: 'block-type-label', style: 'margin-bottom:0;' }, [
      createSvg('<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:-2px;margin-right:4px;"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>'),
      el('span', { class: 'type-name' }, 'Canvas Settings')
    ]),
    el('span', { class: 'badge', style: 'font-size:10px;padding:2px 6px;background:var(--bg-surface-hover);border-radius:4px;color:var(--text-tertiary);' }, state.cms.openPage.status === 'published' ? '● Published' : '● Draft')
  ]);
  body.appendChild(header);

  const wrap = el('div', { class: 'fields' });

  // First Page / Homepage Setting
  const isFirstPage = !!state.cms.openPage.is_first_page;
  const firstPageCard = el('div', {
    class: `first-page-card ${isFirstPage ? 'is-first' : ''}`,
    style: `background:${isFirstPage ? 'rgba(245,158,11,0.08)' : 'var(--bg-surface-hover)'};border:1px solid ${isFirstPage ? 'rgba(245,158,11,0.35)' : 'var(--border-subtle)'};border-radius:var(--radius-md);padding:12px 14px;margin-bottom:14px;transition:all 0.2s;`
  }, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;' }, [
      el('div', { style: 'display:flex;align-items:center;gap:6px;' }, [
        el('span', { style: `font-size:15px;color:${isFirstPage ? '#f59e0b' : 'var(--text-tertiary)'};` }, isFirstPage ? '★' : '☆'),
        el('strong', { style: `font-size:12.5px;color:${isFirstPage ? '#fbbf24' : 'var(--text-primary)'};` }, 'First Page (Homepage)')
      ]),
      isFirstPage
        ? el('span', { class: 'badge', style: 'background:#f59e0b;color:#1e1b4b;font-weight:700;font-size:10px;padding:2px 7px;border-radius:999px;' }, 'Root /p')
        : null
    ]),
    el('p', { style: 'font-size:11.5px;color:var(--text-secondary);margin:0 0 10px 0;line-height:1.4;' },
      isFirstPage
        ? 'This page serves as your site homepage. It is served automatically at /p and opens first in the studio.'
        : 'Set this page as the default homepage. Visitors landing on /p will see this page first.'
    ),
    !isFirstPage ? el('button', {
      type: 'button',
      class: 'btn primary btn-sm',
      style: 'width:100%;justify-content:center;background:#f59e0b;border-color:#f59e0b;color:#1e1b4b;font-weight:700;',
      onclick: async () => {
        await setFirstPage(state.cms.openPage.id);
      }
    }, '★ Set as First Page') : null
  ]);
  wrap.appendChild(firstPageCard);

  // 1. Max Width
  const widthPresets = [
    ['640px', 'Narrow (640px)'],
    ['760px', 'Standard (760px)'],
    ['820px', 'Default (820px)'],
    ['960px', 'Wide (960px)'],
    ['100%', 'Full Width (100% of Viewport)']
  ];
  wrap.appendChild(field('Canvas Max Width', select(
    widthPresets.map(([val, label]) => [val, label, s.maxWidth || '820px']),
    v => { s.maxWidth = v; onSettingsChange(); }
  )));

  // 2. Alignment
  wrap.appendChild(field('Canvas Alignment', select([
    ['center', 'Center Aligned in Editor', s.align || 'center'],
    ['left', 'Left Aligned in Editor', s.align || 'center']
  ], v => { s.align = v; onSettingsChange(); })));

  // 3. Background Theme
  wrap.appendChild(field('Canvas Background Theme', select([
    ['default', 'Default Studio Dark', s.bg || 'default'],
    ['pure-black', 'OLED Pure Black (#000000)', s.bg || 'default'],
    ['deep-navy', 'Deep Navy (#0a1324)', s.bg || 'default'],
    ['dark-card', 'Slate Card (#111827)', s.bg || 'default'],
    ['light', 'Clean Light Card (#ffffff)', s.bg || 'default'],
    ['custom', 'Custom Background Color...', s.bg || 'default']
  ], v => { s.bg = v; onSettingsChange(); })));

  if (s.bg === 'custom') {
    wrap.appendChild(colorField('Custom Background Color', s.customBg || '#0f172a', '#0f172a', v => {
      s.customBg = v;
      onSettingsInput();
    }));
  }

  // 4. Typography
  wrap.appendChild(field('Typography Font Family', select([
    ['system', 'System Default (San Francisco / Segoe UI)', s.fontFamily || 'system'],
    ['inter', 'Inter (Modern Tech / Clean)', s.fontFamily || 'system'],
    ['outfit', 'Outfit (Modern Geometric / Display)', s.fontFamily || 'system'],
    ['roboto', 'Roboto (Classic Sans)', s.fontFamily || 'system'],
    ['mono', 'JetBrains Mono (Code / Editorial)', s.fontFamily || 'system']
  ], v => { s.fontFamily = v; onSettingsChange(); })));

  // 5. Canvas Inner Padding
  wrap.appendChild(el('div', { class: 'field-group-title', style: 'font-size:11px;font-weight:700;color:var(--accent-primary);text-transform:uppercase;margin:16px 0 6px;letter-spacing:0.5px;display:flex;align-items:center;gap:4px;' }, [
    createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><rect x="7" y="7" width="10" height="10" rx="1"/></svg>'),
    el('span', {}, 'Canvas Inner Padding')
  ]));
  
  const padYInput = input('number', s.paddingY != null ? s.paddingY : 44, v => {
    s.paddingY = Math.max(0, Number(v) || 0);
    onSettingsInput();
  }, { min: 0, max: 300, step: 4 });
  wrap.appendChild(field('Padding Top & Bottom (px)', padYInput));

  const padXInput = input('number', s.paddingX != null ? s.paddingX : 36, v => {
    s.paddingX = Math.max(0, Number(v) || 0);
    onSettingsInput();
  }, { min: 0, max: 200, step: 4 });
  wrap.appendChild(field('Padding Left & Right (px)', padXInput));

  // 6. Canvas Outer Margin
  wrap.appendChild(el('div', { class: 'field-group-title', style: 'font-size:11px;font-weight:700;color:var(--accent-primary);text-transform:uppercase;margin:16px 0 6px;letter-spacing:0.5px;display:flex;align-items:center;gap:4px;' }, [
    createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"/></svg>'),
    el('span', {}, 'Canvas Outer Margin')
  ]));

  const marginYInput = input('number', s.marginY != null ? s.marginY : 0, v => {
    s.marginY = Math.max(0, Number(v) || 0);
    onSettingsInput();
  }, { min: 0, max: 200, step: 4 });
  wrap.appendChild(field('Margin Top & Bottom (px)', marginYInput));

  const marginXInput = input('number', s.marginX != null ? s.marginX : 0, v => {
    s.marginX = Math.max(0, Number(v) || 0);
    onSettingsInput();
  }, { min: 0, max: 200, step: 4 });
  wrap.appendChild(field('Margin Left & Right (px)', marginXInput));

  // 7. Canvas Frame & Corners
  wrap.appendChild(el('div', { class: 'field-group-title', style: 'font-size:11px;font-weight:700;color:var(--accent-primary);text-transform:uppercase;margin:16px 0 6px;letter-spacing:0.5px;display:flex;align-items:center;gap:4px;' }, [
    createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/></svg>'),
    el('span', {}, 'Canvas Frame & Corners')
  ]));

  const radiusInput = input('number', s.borderRadius != null ? s.borderRadius : 16, v => {
    s.borderRadius = Math.max(0, Number(v) || 0);
    onSettingsInput();
  }, { min: 0, max: 64, step: 2 });
  wrap.appendChild(field('Corner Border Radius (px)', radiusInput));

  // 6. Page Statistics
  const blocks = state.cms.openPage.blocks || [];
  let wordCount = 0;
  function countWords(b) {
    if (b.props) {
      if (b.props.text) wordCount += String(b.props.text).trim().split(/\s+/).filter(Boolean).length;
      if (b.props.label) wordCount += String(b.props.label).trim().split(/\s+/).filter(Boolean).length;
      if (b.props.caption) wordCount += String(b.props.caption).trim().split(/\s+/).filter(Boolean).length;
      if (Array.isArray(b.props.slides)) {
        b.props.slides.forEach(s => { if (s.caption) wordCount += String(s.caption).trim().split(/\s+/).filter(Boolean).length; });
      }
      if (Array.isArray(b.props.children)) {
        b.props.children.forEach(countWords);
      }
    }
  }
  blocks.forEach(countWords);
  const readTimeMin = Math.max(1, Math.ceil(wordCount / 200));

  const statsCard = el('div', {
    class: 'canvas-stats-card',
    style: 'background:var(--bg-surface-hover);border:1px solid var(--border-subtle);border-radius:var(--radius-md);padding:12px;margin:16px 0;'
  }, [
    el('div', { style: 'font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:8px;' }, 'Page Summary'),
    el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12px;' }, [
      el('div', {}, [el('span', { style: 'color:var(--text-tertiary);display:block;font-size:11px;' }, 'Total Blocks'), el('strong', { style: 'color:var(--text-primary);font-size:14px;' }, `${blocks.length}`)]),
      el('div', {}, [el('span', { style: 'color:var(--text-tertiary);display:block;font-size:11px;' }, 'Word Count'), el('strong', { style: 'color:var(--text-primary);font-size:14px;' }, `${wordCount}`)]),
      el('div', {}, [el('span', { style: 'color:var(--text-tertiary);display:block;font-size:11px;' }, 'Read Time'), el('strong', { style: 'color:var(--text-primary);font-size:14px;' }, `~${readTimeMin} min`)]),
      el('div', {}, [el('span', { style: 'color:var(--text-tertiary);display:block;font-size:11px;' }, 'Live Status'), el('strong', { style: 'color:var(--accent-primary);font-size:13px;' }, state.cms.openPage.status === 'published' ? 'Published' : 'Draft')])
    ])
  ]);
  wrap.appendChild(statsCard);

  // 7. Quick Actions
  const actionsWrap = el('div', { style: 'margin-top:14px;' }, [
    el('label', { style: 'font-weight:700;font-size:11px;color:var(--text-tertiary);text-transform:uppercase;display:block;margin-bottom:6px;' }, 'Canvas Actions'),
    el('div', { style: 'display:flex;flex-direction:column;gap:6px;' }, [
      el('button', {
        type: 'button',
        class: 'btn ghost btn-sm',
        style: 'width:100%;justify-content:center;',
        onclick: () => {
          if (state.cms.openPage.slug && state.cms.openPage.status === 'published') {
            window.open(`/p/${state.cms.openPage.slug}`, '_blank');
          } else {
            showToast('Publish the page to view standalone live URL', 'info');
          }
        }
      }, 'Open Live Preview \u2197'),
      el('button', {
        type: 'button',
        class: 'btn ghost danger btn-sm',
        style: 'width:100%;justify-content:center;',
        onclick: () => {
          if (!blocks.length) return;
          if (confirm('Clear all blocks from this canvas?')) {
            state.cms.openPage.blocks = [];
            state.cms.selectedBlockId = null;
            renderCanvas();
            renderProps();
            triggerAutoSave(100);
            showToast('Canvas cleared', 'info');
          }
        }
      }, 'Clear All Blocks')
    ])
  ]);
  wrap.appendChild(actionsWrap);

  body.appendChild(wrap);
}

// ---------- Properties panel ----------
function renderProps() {
  const body = document.getElementById('cmsPropsBody');
  body.innerHTML = '';
  const block = findBlock(state.cms.selectedBlockId);
  if (!block) {
    renderCanvasSettings(body);
    return;
  }
  const headerActions = el('div', { class: 'props-header-actions', style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;' }, [
    el('div', { class: 'block-type-label', style: 'margin-bottom:0;' }, [
      'Type: ',
      el('span', { class: 'type-name' }, BLOCK_LABELS[block.type] || block.type)
    ]),
    el('div', { style: 'display:flex;gap:5px;' }, [
      el('button', {
        type: 'button',
        class: 'btn-sm-ghost',
        title: 'Open Canvas / Page Settings',
        onclick: () => {
          state.cms.selectedBlockId = null;
          renderCanvas();
          renderProps();
        }
      }, [
        createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>'),
        el('span', { style: 'margin-left:3px;font-size:11px;' }, 'Canvas')
      ]),
      el('button', {
        type: 'button',
        class: 'btn-sm-ghost',
        title: 'Save as Reusable Block / Template',
        onclick: () => saveSelectedAsReusableBlock(block.id)
      }, [
        createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>'),
        el('span', { style: 'margin-left:3px;font-size:11px;' }, 'Save Reusable')
      ]),
      el('button', {
        type: 'button',
        class: 'btn-sm-ghost',
        title: 'Copy component (Ctrl+C)',
        onclick: () => copySelectedBlock(block.id)
      }, [
        createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="13" height="13" x="9" y="9" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>'),
        el('span', { style: 'margin-left:3px;font-size:11px;' }, 'Copy')
      ]),
      el('button', {
        type: 'button',
        class: 'btn-sm-danger',
        title: 'Delete component',
        onclick: () => deleteBlock(block.id)
      }, [
        createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>')
      ])
    ])
  ]);
  body.appendChild(headerActions);

  const wrap = el('div', { class: 'fields' });
  const p = block.props;

  const onChange = (delay = 80) => {
    renderCanvas();
    renderProps();
    triggerAutoSave(delay);
  };

  const onPropInput = (delay = 350) => {
    renderCanvas();
    triggerAutoSave(delay);
  };

  switch (block.type) {
    case 'heading': {
      wrap.appendChild(field('Level', select([
        ['1', 'Heading 1 (H1)', String(p.level || 2)],
        ['2', 'Heading 2 (H2)', String(p.level || 2)],
        ['3', 'Heading 3 (H3)', String(p.level || 2)],
        ['4', 'Heading 4 (H4)', String(p.level || 2)],
        ['5', 'Heading 5 (H5)', String(p.level || 2)],
        ['6', 'Heading 6 (H6)', String(p.level || 2)]
      ], v => { p.level = Number(v); onChange(); })));

      wrap.appendChild(richTextField('Text Content', p.text || '', v => { p.text = v; onPropInput(); }));

      wrap.appendChild(field('Alignment', select([
        ['left', 'Left Aligned', p.align || 'left'],
        ['center', 'Centered', p.align || 'left'],
        ['right', 'Right Aligned', p.align || 'left']
      ], v => { p.align = v; onChange(); })));

      wrap.appendChild(colorField('Text Color', p.color || '', '#ffffff', v => {
        p.color = v;
        onPropInput();
      }));

      wrap.appendChild(field('Bottom Spacing (px)', input('number', String(p.margin != null ? p.margin : 12), v => {
        p.margin = Math.max(0, Math.min(64, Number(v) || 0));
        onPropInput();
      })));

      wrap.appendChild(navigationLinkField('Click Action (Link to Page / URL)', p, onPropInput, 'linkUrl'));
      break;
    }
    case 'paragraph': {
      wrap.appendChild(richTextField('Body Text', p.text || '', v => { p.text = v; onPropInput(); }));

      wrap.appendChild(field('Text Alignment', select([
        ['left', 'Left', p.align || 'left'],
        ['center', 'Center', p.align || 'left'],
        ['right', 'Right', p.align || 'left'],
        ['justify', 'Justify', p.align || 'left']
      ], v => { p.align = v; onChange(); })));

      wrap.appendChild(field('Font Size', select([
        ['small', 'Small (13px)', p.size || 'normal'],
        ['normal', 'Normal (15px)', p.size || 'normal'],
        ['large', 'Large (18px)', p.size || 'normal'],
        ['lead', 'Lead Text (21px)', p.size || 'normal']
      ], v => { p.size = v; onChange(); })));

      wrap.appendChild(colorField('Text Color', p.color || '', '#94a3b8', v => {
        p.color = v;
        onPropInput();
      }));

      wrap.appendChild(checkbox('Bold Text', !!p.bold, v => {
        p.bold = v;
        onChange();
      }));

      wrap.appendChild(checkbox('Italic Style', !!p.italic, v => {
        p.italic = v;
        onChange();
      }));

      wrap.appendChild(navigationLinkField('Click Action (Link to Page / URL)', p, onPropInput, 'linkUrl'));
      break;
    }
    case 'button': {
      wrap.appendChild(field('Button Label', input('text', p.label || '', v => { p.label = v; onPropInput(); })));
      
      wrap.appendChild(navigationLinkField('Button Click Destination (Page / URL)', p, onPropInput, 'url'));

      wrap.appendChild(field('Button Style', select([
        ['filled', 'Solid Filled', p.variant || 'filled'],
        ['outline', 'Outline / Ghost', p.variant || 'filled'],
        ['soft', 'Soft Tint', p.variant || 'filled']
      ], v => { p.variant = v; onChange(); })));

      wrap.appendChild(field('Button Size', select([
        ['small', 'Small', p.size || 'medium'],
        ['medium', 'Medium', p.size || 'medium'],
        ['large', 'Large', p.size || 'medium']
      ], v => { p.size = v; onChange(); })));

      wrap.appendChild(field('Alignment', select([
        ['left', 'Left', p.align || 'left'],
        ['center', 'Center', p.align || 'left'],
        ['right', 'Right', p.align || 'left'],
        ['full', 'Full Width', p.align || 'left']
      ], v => { p.align = v; onChange(); })));

      wrap.appendChild(colorField('Button Color', p.color || '#6366f1', '#6366f1', v => {
        p.color = v || '#6366f1';
        onPropInput();
      }));

      wrap.appendChild(colorField('Text Color', p.textColor || '#ffffff', '#ffffff', v => {
        p.textColor = v || '#ffffff';
        onPropInput();
      }));

      wrap.appendChild(field('Border Radius (px)', input('number', String(p.borderRadius != null ? p.borderRadius : 8), v => {
        p.borderRadius = Math.max(0, Math.min(32, Number(v) || 0));
        onPropInput();
      })));
      break;
    }
    case 'image': {
      wrap.appendChild(field('Image URL', input('text', p.url || '', v => { p.url = v; onPropInput(); })));
      wrap.appendChild(field('Alt Description', input('text', p.alt || '', v => { p.alt = v; onPropInput(); })));
      wrap.appendChild(field('Caption (optional)', input('text', p.caption || '', v => { p.caption = v; onPropInput(); })));
      
      wrap.appendChild(navigationLinkField('Image Click Destination (Page / URL)', p, onPropInput, 'linkUrl'));

      wrap.appendChild(field('Image Width', select([
        ['100%', '100% (Full)', p.width || '100%'],
        ['75%', '75% (Wide)', p.width || '100%'],
        ['50%', '50% (Medium)', p.width || '100%'],
        ['33%', '33% (Small)', p.width || '100%'],
        ['auto', 'Auto / Original', p.width || '100%']
      ], v => { p.width = v; onChange(); })));

      wrap.appendChild(field('Alignment', select([
        ['center', 'Center', p.align || 'center'],
        ['left', 'Left', p.align || 'center'],
        ['right', 'Right', p.align || 'center']
      ], v => { p.align = v; onChange(); })));

      wrap.appendChild(field('Object Fit', select([
        ['cover', 'Cover (Fill Frame)', p.objectFit || 'cover'],
        ['contain', 'Contain (Full Aspect)', p.objectFit || 'cover'],
        ['fill', 'Stretch', p.objectFit || 'cover']
      ], v => { p.objectFit = v; onChange(); })));

      wrap.appendChild(field('Border Radius (px)', input('number', String(p.borderRadius != null ? p.borderRadius : 8), v => {
        p.borderRadius = Math.max(0, Math.min(48, Number(v) || 0));
        onPropInput();
      })));

      wrap.appendChild(checkbox('Drop Shadow', !!p.shadow, v => {
        p.shadow = v;
        onChange();
      }));

      wrap.appendChild(checkbox('Subtle Border', !!p.border, v => {
        p.border = v;
        onChange();
      }));
      break;
    }
    case 'carousel': {
      if (!Array.isArray(p.slides)) p.slides = [];

      wrap.appendChild(field('Aspect Ratio', select([
        ['16/9', '16:9 (Widescreen)', p.aspectRatio || '16/9'],
        ['4/3', '4:3 (Standard Photo)', p.aspectRatio || '16/9'],
        ['21/9', '21:9 (Cinematic Banner)', p.aspectRatio || '16/9'],
        ['1/1', '1:1 (Square)', p.aspectRatio || '16/9'],
        ['auto', 'Auto / Variable', p.aspectRatio || '16/9']
      ], v => { p.aspectRatio = v; onChange(); })));

      wrap.appendChild(field('Border Radius (px)', input('number', String(p.borderRadius != null ? p.borderRadius : 10), v => {
        p.borderRadius = Math.max(0, Math.min(32, Number(v) || 0));
        onPropInput();
      })));

      wrap.appendChild(checkbox('Autoplay Slides', !!p.autoplay, v => {
        p.autoplay = v;
        onChange();
      }));

      if (p.autoplay) {
        wrap.appendChild(field('Interval (seconds)', input('number', String(p.interval || 4), v => {
          p.interval = Math.max(1, Math.min(30, Number(v) || 4));
          onChange();
        })));
      }

      wrap.appendChild(checkbox('Show Navigation Arrows', p.showArrows !== false, v => {
        p.showArrows = v;
        onChange();
      }));

      wrap.appendChild(checkbox('Show Indicator Dots', p.showDots !== false, v => {
        p.showDots = v;
        onChange();
      }));

      wrap.appendChild(checkbox('Show Captions', p.showCaptions !== false, v => {
        p.showCaptions = v;
        onChange();
      }));

      wrap.appendChild(el('div', { class: 'props-section-header' }, [
        el('label', { style: 'font-weight:600;' }, `Slides (${p.slides.length})`),
        el('button', {
          type: 'button',
          class: 'btn-sm-primary',
          onclick: () => {
            p.slides.push({
              url: 'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1000&auto=format&fit=crop',
              caption: `Slide ${p.slides.length + 1}`
            });
            onChange();
          }
        }, '+ Add Slide')
      ]));

      const slidesList = el('div', { class: 'carousel-slides-editor' });
      p.slides.forEach((slide, sIdx) => {
        const slideItem = el('div', { class: 'carousel-slide-edit-item' });

        const headerRow = el('div', { class: 'slide-edit-header' }, [
          el('span', { class: 'slide-num' }, `Slide #${sIdx + 1}`),
          el('div', { class: 'slide-actions' }, [
            el('button', {
              type: 'button',
              title: 'Move up',
              disabled: sIdx === 0,
              onclick: () => {
                const [item] = p.slides.splice(sIdx, 1);
                p.slides.splice(sIdx - 1, 0, item);
                onChange();
              }
            }, '\u2191'),
            el('button', {
              type: 'button',
              title: 'Move down',
              disabled: sIdx === p.slides.length - 1,
              onclick: () => {
                const [item] = p.slides.splice(sIdx, 1);
                p.slides.splice(sIdx + 1, 0, item);
                onChange();
              }
            }, '\u2193'),
            el('button', {
              type: 'button',
              class: 'del',
              title: 'Delete slide',
              onclick: () => {
                p.slides.splice(sIdx, 1);
                onChange();
              }
            }, '\u00d7')
          ])
        ]);

        const previewThumb = slide.url
          ? el('div', { class: 'slide-preview-thumb', style: `background-image:url("${slide.url}")` })
          : el('div', { class: 'slide-preview-thumb empty' }, 'No img');

        const inputsWrap = el('div', { class: 'slide-inputs' }, [
          field('Image URL', input('text', slide.url || '', v => {
            slide.url = v;
            onPropInput();
            if (previewThumb) previewThumb.style.backgroundImage = v ? `url("${v}")` : 'none';
          })),
          field('Caption', input('text', slide.caption || '', v => {
            slide.caption = v;
            onPropInput();
          })),
          navigationLinkField('Slide Navigation Link', slide, () => { onPropInput(); }, 'linkUrl')
        ]);

        slideItem.appendChild(headerRow);
        const rowBody = el('div', { class: 'slide-edit-body' }, [previewThumb, inputsWrap]);
        slideItem.appendChild(rowBody);
        slidesList.appendChild(slideItem);
      });

      wrap.appendChild(slidesList);
      break;
    }
    case 'divider': {
      wrap.appendChild(field('Line Style', select([
        ['solid', 'Solid Line', p.style || 'solid'],
        ['dashed', 'Dashed Line', p.style || 'solid'],
        ['dotted', 'Dotted Line', p.style || 'solid'],
        ['double', 'Double Line', p.style || 'solid']
      ], v => { p.style = v; onChange(); })));

      wrap.appendChild(field('Line Thickness (px)', select([
        ['1', '1px (Hairline)', String(p.thickness || 1)],
        ['2', '2px (Medium)', String(p.thickness || 1)],
        ['3', '3px (Bold)', String(p.thickness || 1)],
        ['4', '4px (Heavy)', String(p.thickness || 1)]
      ], v => { p.thickness = Number(v); onChange(); })));

      wrap.appendChild(field('Divider Width', select([
        ['100%', '100% (Full)', p.width || '100%'],
        ['75%', '75% (Wide)', p.width || '100%'],
        ['50%', '50% (Centered)', p.width || '100%'],
        ['25%', '25% (Short)', p.width || '100%']
      ], v => { p.width = v; onChange(); })));

      wrap.appendChild(field('Vertical Spacing (px)', input('number', String(p.margin != null ? p.margin : 16), v => {
        p.margin = Math.max(4, Math.min(64, Number(v) || 16));
        onPropInput();
      })));

      wrap.appendChild(colorField('Line Color', p.color || '', 'rgba(255,255,255,0.15)', v => {
        p.color = v;
        onPropInput();
      }));
      break;
    }
    case 'spacer': {
      wrap.appendChild(field('Height (px)', input('number', String(p.height || 24), v => {
        const n = Math.max(8, Math.min(300, Number(v) || 24));
        p.height = n;
        onPropInput();
      })));

      const presetRow = el('div', { class: 'quick-presets-row' }, [
        el('label', { style: 'font-size:11px;color:var(--text-tertiary);' }, 'Presets:'),
        ...[12, 24, 48, 96].map(h => el('button', {
          type: 'button',
          class: `quick-preset-chip${p.height === h ? ' active' : ''}`,
          onclick: () => { p.height = h; onChange(); }
        }, `${h}px`))
      ]);
      wrap.appendChild(presetRow);
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
            onPropInput();
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
            onPropInput();
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
        onPropInput();
      })));

      wrap.appendChild(field('Padding (px)', input('number', String(p.padding ?? 16), v => {
        p.padding = Math.max(0, Math.min(64, Number(v) || 0));
        onPropInput();
      })));

      wrap.appendChild(field('Background Style', select([
        ['surface', 'Card Surface', p.bg || 'surface'],
        ['subtle', 'Subtle Tint', p.bg || 'surface'],
        ['transparent', 'Transparent', p.bg || 'surface'],
        ['dark', 'Deep Dark', p.bg || 'surface']
      ], v => { p.bg = v; onChange(); })));

      wrap.appendChild(checkbox('Show Container Border', !!p.border, v => {
        p.border = v;
        onChange();
      }));

      wrap.appendChild(field('Border Radius (px)', input('number', String(p.borderRadius ?? 8), v => {
        p.borderRadius = Math.max(0, Math.min(32, Number(v) || 0));
        onPropInput();
      })));

      wrap.appendChild(checkbox('Drop Shadow', !!p.shadow, v => {
        p.shadow = v;
        onChange();
      }));

      wrap.appendChild(navigationLinkField('Card Click Destination (Link Entire Container)', p, onPropInput, 'linkUrl'));

      wrap.appendChild(el('label', { style: 'font-weight:600;margin-top:14px;display:block;' }, 'Add Block Inside:'));
      const quickAdd = el('div', { class: 'container-quick-add' }, [
        el('button', { type: 'button', onclick: () => insertBlockAt('heading', block.id) }, '+ Heading'),
        el('button', { type: 'button', onclick: () => insertBlockAt('paragraph', block.id) }, '+ Text'),
        el('button', { type: 'button', onclick: () => insertBlockAt('button', block.id) }, '+ Button'),
        el('button', { type: 'button', onclick: () => insertBlockAt('image', block.id) }, '+ Image'),
        el('button', { type: 'button', onclick: () => insertBlockAt('carousel', block.id) }, '+ Carousel'),
        el('button', { type: 'button', onclick: () => insertBlockAt('table', block.id) }, '+ Table'),
        el('button', { type: 'button', onclick: () => insertBlockAt('divider', block.id) }, '+ Divider'),
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
    case 'callout': {
      wrap.appendChild(field('Callout Style', select([
        ['info', 'Information (Blue)', p.type || 'info'],
        ['tip', 'Tip / Success (Green)', p.type || 'info'],
        ['warning', 'Warning (Amber)', p.type || 'info'],
        ['danger', 'Danger / Alert (Red)', p.type || 'info']
      ], v => { p.type = v; onChange(); })));

      wrap.appendChild(field('Icon (Emoji or Symbol)', input('text', p.icon || '💡', v => {
        p.icon = v;
        onPropInput();
      })));

      wrap.appendChild(field('Title (Optional)', input('text', p.title || '', v => {
        p.title = v;
        onPropInput();
      })));

      wrap.appendChild(richTextField('Body Text', p.text || '', v => {
        p.text = v;
        onPropInput();
      }));

      wrap.appendChild(colorField('Custom Border Color', p.color || '', '', v => {
        p.color = v;
        onPropInput();
      }));
      break;
    }
    case 'accordion': {
      if (!Array.isArray(p.items)) p.items = [];

      const itemsHeader = el('div', {
        style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;'
      }, [
        el('label', { style: 'font-weight:600;margin:0;' }, `Accordion Items (${p.items.length})`),
        el('button', {
          type: 'button',
          class: 'btn primary btn-sm',
          style: 'padding:3px 8px;font-size:11px;',
          onclick: () => {
            p.items.push({
              title: `Question ${p.items.length + 1}`,
              content: 'Add your detailed answer or description here.'
            });
            onChange();
          }
        }, '+ Add Item')
      ]);
      wrap.appendChild(itemsHeader);

      const itemsList = el('div', { class: 'slides-list' });
      p.items.forEach((item, idx) => {
        const itemBox = el('div', { class: 'slide-edit-item', style: 'padding:10px;margin-bottom:10px;' }, [
          el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' }, [
            el('span', { style: 'font-weight:700;font-size:12px;color:var(--text-secondary);' }, `#${idx + 1} Item`),
            el('button', {
              type: 'button',
              class: 'btn-icon-sm',
              title: 'Delete Item',
              onclick: () => {
                p.items.splice(idx, 1);
                onChange();
              }
            }, '\u2715')
          ]),
          field('Section Title', input('text', item.title || '', v => {
            item.title = v;
            onPropInput();
          })),
          richTextField('Content', item.content || '', v => {
            item.content = v;
            onPropInput();
          })
        ]);
        itemsList.appendChild(itemBox);
      });
      wrap.appendChild(itemsList);
      break;
    }
    case 'tabs': {
      if (!Array.isArray(p.tabs)) p.tabs = [];

      const tabsHeader = el('div', {
        style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;'
      }, [
        el('label', { style: 'font-weight:600;margin:0;' }, `Tabs (${p.tabs.length})`),
        el('button', {
          type: 'button',
          class: 'btn primary btn-sm',
          style: 'padding:3px 8px;font-size:11px;',
          onclick: () => {
            p.tabs.push({
              title: `Tab ${p.tabs.length + 1}`,
              content: 'Tab panel content here.'
            });
            onChange();
          }
        }, '+ Add Tab')
      ]);
      wrap.appendChild(tabsHeader);

      const tabsList = el('div', { class: 'slides-list' });
      p.tabs.forEach((tab, idx) => {
        const tabBox = el('div', { class: 'slide-edit-item', style: 'padding:10px;margin-bottom:10px;' }, [
          el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;' }, [
            el('span', { style: 'font-weight:700;font-size:12px;color:var(--text-secondary);' }, `#${idx + 1} Tab`),
            el('button', {
              type: 'button',
              class: 'btn-icon-sm',
              title: 'Delete Tab',
              onclick: () => {
                p.tabs.splice(idx, 1);
                onChange();
              }
            }, '\u2715')
          ]),
          field('Tab Label', input('text', tab.title || '', v => {
            tab.title = v;
            onPropInput();
          })),
          richTextField('Panel Content', tab.content || '', v => {
            tab.content = v;
            onPropInput();
          })
        ]);
        tabsList.appendChild(tabBox);
      });
      wrap.appendChild(tabsList);
      break;
    }
    case 'pricing': {
      wrap.appendChild(field('Plan Name', input('text', p.plan || '', v => {
        p.plan = v;
        onPropInput();
      })));

      wrap.appendChild(field('Price', input('text', p.price || '', v => {
        p.price = v;
        onPropInput();
      })));

      wrap.appendChild(field('Billing Period', input('text', p.period || '', v => {
        p.period = v;
        onPropInput();
      })));

      wrap.appendChild(field('Plan Description', input('text', p.description || '', v => {
        p.description = v;
        onPropInput();
      })));

      wrap.appendChild(checkbox('Highlight as Most Popular', !!p.isPopular, v => {
        p.isPopular = v;
        onChange();
      }));

      if (p.isPopular) {
        wrap.appendChild(field('Badge Text', input('text', p.badge || 'Most Popular', v => {
          p.badge = v;
          onPropInput();
        })));
      }

      if (!Array.isArray(p.features)) p.features = [];
      const featText = p.features.join('\n');
      const featArea = el('textarea', {
        class: 'input',
        style: 'height:90px;font-size:12px;line-height:1.4;',
        placeholder: 'One feature per line...'
      }, featText);
      featArea.oninput = () => {
        p.features = featArea.value.split('\n').map(s => s.trim()).filter(Boolean);
        onPropInput();
      };
      wrap.appendChild(field('Plan Features (1 per line)', featArea));

      wrap.appendChild(field('CTA Button Text', input('text', p.ctaLabel || 'Get Started', v => {
        p.ctaLabel = v;
        onPropInput();
      })));

      wrap.appendChild(navigationLinkField('CTA Click Destination', p, onPropInput, 'ctaUrl'));
      break;
    }
    case 'stat': {
      wrap.appendChild(field('Metric Value', input('text', p.value || '', v => {
        p.value = v;
        onPropInput();
      })));

      wrap.appendChild(field('Metric Label', input('text', p.label || '', v => {
        p.label = v;
        onPropInput();
      })));

      wrap.appendChild(field('Subtext / Context', input('text', p.subtext || '', v => {
        p.subtext = v;
        onPropInput();
      })));

      wrap.appendChild(field('Trend Pill Text', input('text', p.trend || '', v => {
        p.trend = v;
        onPropInput();
      })));

      wrap.appendChild(field('Trend Direction', select([
        ['up', 'Up / Growth (Green)', p.trendDirection || 'up'],
        ['down', 'Down / Decline (Red)', p.trendDirection || 'up']
      ], v => { p.trendDirection = v; onChange(); })));
      break;
    }
    case 'testimonial': {
      wrap.appendChild(richTextField('Quote', p.quote || '', v => {
        p.quote = v;
        onPropInput();
      }));

      wrap.appendChild(field('Author Name', input('text', p.author || '', v => {
        p.author = v;
        onPropInput();
      })));

      wrap.appendChild(field('Author Role / Company', input('text', p.role || '', v => {
        p.role = v;
        onPropInput();
      })));

      wrap.appendChild(field('Avatar Image URL', input('text', p.avatar || '', v => {
        p.avatar = v;
        onPropInput();
      })));

      wrap.appendChild(field('Rating Stars', select([
        ['5', '★★★★★ (5 Stars)', String(p.rating || 5)],
        ['4', '★★★★☆ (4 Stars)', String(p.rating || 5)],
        ['3', '★★★☆☆ (3 Stars)', String(p.rating || 5)],
        ['2', '★★☆☆☆ (2 Stars)', String(p.rating || 5)],
        ['1', '★☆☆☆☆ (1 Star)', String(p.rating || 5)]
      ], v => { p.rating = Number(v); onChange(); })));
      break;
    }
    case 'video': {
      wrap.appendChild(field('Video URL (YouTube or Vimeo)', input('text', p.url || '', v => {
        p.url = v;
        onPropInput();
      })));

      wrap.appendChild(field('Video Caption (Optional)', input('text', p.caption || '', v => {
        p.caption = v;
        onPropInput();
      })));
      break;
    }
    case 'code': {
      wrap.appendChild(field('Language Label', input('text', p.language || 'javascript', v => {
        p.language = v;
        onPropInput();
      })));

      const codeArea = el('textarea', {
        class: 'input',
        style: 'height:140px;font-family:var(--font-mono, monospace);font-size:12px;line-height:1.4;',
        placeholder: '// Type or paste your code snippet here...'
      }, p.code || '');
      codeArea.oninput = () => {
        p.code = codeArea.value;
        onPropInput();
      };
      wrap.appendChild(field('Code Snippet', codeArea));
      break;
    }
    case 'bento': {
      if (!Array.isArray(p.items)) p.items = [];
      const addBtn = el('button', {
        type: 'button',
        class: 'btn secondary btn-sm',
        style: 'margin-bottom:12px;',
        onclick: () => {
          p.items.push({ title: 'New Tile', subtitle: 'Tile description...', icon: '✦', tag: 'New', metric: '', span: 1, tall: false, image: '' });
          onChange();
        }
      }, '+ Add Bento Card');
      wrap.appendChild(addBtn);

      p.items.forEach((item, idx) => {
        const itemBox = el('div', { class: 'accordion-item-box', style: 'padding:12px;border:1px solid var(--border-subtle);border-radius:8px;margin-bottom:12px;background:rgba(255,255,255,0.02);' }, [
          el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' }, [
            el('span', { style: 'font-weight:600;font-size:12px;' }, `Card #${idx + 1}`),
            el('button', {
              type: 'button',
              class: 'btn ghost btn-sm danger',
              style: 'padding:2px 6px;font-size:11px;',
              onclick: () => { p.items.splice(idx, 1); onChange(); }
            }, 'Remove')
          ]),
          field('Title', input('text', item.title || '', v => { item.title = v; onPropInput(); })),
          field('Subtitle', input('text', item.subtitle || '', v => { item.subtitle = v; onPropInput(); })),
          field('Icon (Emoji or Text)', input('text', item.icon || '', v => { item.icon = v; onPropInput(); })),
          field('Metric Highlight (e.g. 99.9%)', input('text', item.metric || '', v => { item.metric = v; onPropInput(); })),
          field('Tag Pill', input('text', item.tag || '', v => { item.tag = v; onPropInput(); })),
          field('Image URL (Optional)', input('text', item.image || '', v => { item.image = v; onPropInput(); })),
          field('Column Width Span', select([
            ['1', 'Single Column (1 Col)', String(item.span || 1)],
            ['2', 'Wide Span (2 Cols)', String(item.span || 1)]
          ], v => { item.span = Number(v); onChange(); }))
        ]);
        wrap.appendChild(itemBox);
      });
      break;
    }
    case 'comparison': {
      wrap.appendChild(field('Before Image URL', input('text', p.beforeImage || '', v => { p.beforeImage = v; onPropInput(); })));
      wrap.appendChild(field('Before Label', input('text', p.beforeLabel || 'Before', v => { p.beforeLabel = v; onPropInput(); })));
      wrap.appendChild(field('After Image URL', input('text', p.afterImage || '', v => { p.afterImage = v; onPropInput(); })));
      wrap.appendChild(field('After Label', input('text', p.afterLabel || 'After', v => { p.afterLabel = v; onPropInput(); })));
      break;
    }
    case 'tilt-card': {
      wrap.appendChild(field('Badge Text', input('text', p.badge || '', v => { p.badge = v; onPropInput(); })));
      wrap.appendChild(field('Card Title', input('text', p.title || '', v => { p.title = v; onPropInput(); })));
      const subArea = el('textarea', { class: 'input', style: 'height:80px;' }, p.subtitle || '');
      subArea.oninput = () => { p.subtitle = subArea.value; onPropInput(); };
      wrap.appendChild(field('Card Description', subArea));
      wrap.appendChild(field('CTA Button Text (Optional)', input('text', p.ctaLabel || '', v => { p.ctaLabel = v; onPropInput(); })));
      wrap.appendChild(field('CTA Link URL', input('text', p.ctaUrl || '', v => { p.ctaUrl = v; onPropInput(); })));
      break;
    }
    case 'marquee': {
      wrap.appendChild(field('Scroll Speed', select([
        ['slow', 'Gentle & Slow (30s)', p.speed || 'normal'],
        ['normal', 'Standard Pace (20s)', p.speed || 'normal'],
        ['fast', 'Dynamic & Fast (12s)', p.speed || 'normal']
      ], v => { p.speed = v; onChange(); })));

      if (!Array.isArray(p.items)) p.items = [];
      const addBtn = el('button', {
        type: 'button',
        class: 'btn secondary btn-sm',
        style: 'margin-bottom:12px;',
        onclick: () => {
          p.items.push({ text: 'New Item', icon: '✦' });
          onChange();
        }
      }, '+ Add Marquee Pill');
      wrap.appendChild(addBtn);

      p.items.forEach((item, idx) => {
        const iconInp = input('text', item.icon || '', v => { item.icon = v; onPropInput(); });
        iconInp.style.width = '46px';
        iconInp.style.textAlign = 'center';

        const row = el('div', { style: 'display:flex;gap:6px;align-items:center;margin-bottom:8px;' }, [
          iconInp,
          input('text', item.text || '', v => { item.text = v; onPropInput(); }),
          el('button', {
            type: 'button',
            class: 'btn ghost btn-sm danger',
            style: 'padding:4px 8px;',
            onclick: () => { p.items.splice(idx, 1); onChange(); }
          }, '✕')
        ]);
        wrap.appendChild(row);
      });
      break;
    }
    case 'countdown': {
      wrap.appendChild(field('Headline', input('text', p.title || '', v => { p.title = v; onPropInput(); })));
      wrap.appendChild(field('Subtitle', input('text', p.subtitle || '', v => { p.subtitle = v; onPropInput(); })));
      wrap.appendChild(field('Target Date & Time (ISO 8601)', input('text', p.targetDate || '2026-12-31T23:59:59', v => {
        p.targetDate = v;
        onPropInput();
      })));
      break;
    }
    case 'timeline': {
      if (!Array.isArray(p.items)) p.items = [];
      const addBtn = el('button', {
        type: 'button',
        class: 'btn secondary btn-sm',
        style: 'margin-bottom:12px;',
        onclick: () => {
          p.items.push({ title: 'New Milestone', date: 'Upcoming', description: 'Milestone goals and outcomes...', status: 'upcoming' });
          onChange();
        }
      }, '+ Add Milestone');
      wrap.appendChild(addBtn);

      p.items.forEach((item, idx) => {
        const itemBox = el('div', { class: 'accordion-item-box', style: 'padding:12px;border:1px solid var(--border-subtle);border-radius:8px;margin-bottom:12px;background:rgba(255,255,255,0.02);' }, [
          el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;' }, [
            el('span', { style: 'font-weight:600;font-size:12px;' }, `Milestone #${idx + 1}`),
            el('button', {
              type: 'button',
              class: 'btn ghost btn-sm danger',
              style: 'padding:2px 6px;font-size:11px;',
              onclick: () => { p.items.splice(idx, 1); onChange(); }
            }, 'Remove')
          ]),
          field('Title', input('text', item.title || '', v => { item.title = v; onPropInput(); })),
          field('Date / Period', input('text', item.date || '', v => { item.date = v; onPropInput(); })),
          field('Description', input('text', item.description || '', v => { item.description = v; onPropInput(); })),
          field('Status Stage', select([
            ['completed', 'Completed', item.status || 'upcoming'],
            ['current', 'In Progress (Active)', item.status || 'upcoming'],
            ['upcoming', 'Planned / Upcoming', item.status || 'upcoming']
          ], v => { item.status = v; onChange(); }))
        ]);
        wrap.appendChild(itemBox);
      });
      break;
    }
    case 'form': {
      wrap.appendChild(field('Form Title', input('text', p.title || '', v => { p.title = v; onPropInput(); })));
      wrap.appendChild(field('Description Subtitle', input('text', p.description || '', v => { p.description = v; onPropInput(); })));
      wrap.appendChild(field('Button Label', input('text', p.buttonLabel || 'Send Message', v => { p.buttonLabel = v; onPropInput(); })));
      break;
    }
    case 'audio': {
      wrap.appendChild(field('Track Title', input('text', p.title || '', v => { p.title = v; onPropInput(); })));
      wrap.appendChild(field('Artist / Host', input('text', p.artist || '', v => { p.artist = v; onPropInput(); })));
      wrap.appendChild(field('Duration Label (e.g. 03:45)', input('text', p.duration || '03:45', v => { p.duration = v; onPropInput(); })));
      wrap.appendChild(field('Cover Artwork Image URL', input('text', p.cover || '', v => { p.cover = v; onPropInput(); })));
      break;
    }
    case 'header': {
      if (!Array.isArray(p.links)) p.links = [];

      // Save as Custom Header button
      const saveCustomHeaderBtn = el('button', {
        type: 'button',
        class: 'btn primary btn-sm',
        style: 'width:100%;display:flex;align-items:center;justify-content:center;gap:7px;margin:4px 0 16px;padding:9px 14px;font-weight:700;font-size:12.5px;background:linear-gradient(135deg, #4f46e5, #7c3aed);border:none;border-radius:8px;box-shadow:0 4px 14px rgba(99,102,241,0.35);color:#fff;cursor:pointer;',
        onclick: () => saveSelectedAsReusableBlock(block.id)
      }, [
        createSvg('<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>'),
        el('span', {}, '💾 Save as Custom Header')
      ]);
      wrap.appendChild(saveCustomHeaderBtn);

      // Subsections Management
      const subsectionTitle = el('div', { style: 'margin:8px 0 8px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'Header Subsections');
      wrap.appendChild(subsectionTitle);

      const showTopBarLabel = el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-bottom:10px;' }, [
        el('input', {
          type: 'checkbox',
          checked: !!p.showTopBar,
          onchange: e => { p.showTopBar = e.target.checked; onChange(); }
        }),
        el('span', {}, 'Top Announcement Bar (Subsection)')
      ]);
      wrap.appendChild(showTopBarLabel);

      if (p.showTopBar) {
        wrap.appendChild(field('Announcement Badge', input('text', p.topBarBadge || 'NEW', v => { p.topBarBadge = v; onPropInput(); })));
        wrap.appendChild(field('Announcement Text', input('text', p.topBarText || '', v => { p.topBarText = v; onPropInput(); })));
        wrap.appendChild(field('Announcement Target Link', input('text', p.topBarLink || '#', v => { p.topBarLink = v; onPropInput(); })));
      }

      // Brand settings
      const brandSectionTitle = el('div', { style: 'margin:16px 0 8px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'Brand & Logo');
      wrap.appendChild(brandSectionTitle);
      wrap.appendChild(field('Brand Name', input('text', p.brandName || '', v => { p.brandName = v; onPropInput(); })));
      wrap.appendChild(field('Brand Logo Image URL (Optional)', input('text', p.brandLogo || '', v => { p.brandLogo = v; onPropInput(); })));
      wrap.appendChild(field('Logo Height (px)', input('number', String(p.logoHeight || 28), v => { p.logoHeight = Number(v) || 28; onPropInput(); }, { min: 16, max: 80 })));
      wrap.appendChild(field('Brand Icon / Emoji', input('text', p.brandIcon || '✦', v => { p.brandIcon = v; onPropInput(); })));
      wrap.appendChild(field('Brand Target URL', input('text', p.brandUrl || '#', v => { p.brandUrl = v; onPropInput(); })));

      // Layout & Appearance
      const layoutSectionTitle = el('div', { style: 'margin:16px 0 8px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'Header Layout & Styling');
      wrap.appendChild(layoutSectionTitle);

      wrap.appendChild(field('Header Layout', select([
        ['spread', 'Spread (Logo Left, Links & CTA Right)', p.layout || 'spread'],
        ['centered', 'Centered (Stacked Brand & Navigation)', p.layout || 'spread'],
        ['floating', 'Floating Island (Modern Pill Nav)', p.layout || 'spread']
      ], v => { p.layout = v; onChange(); })));

      wrap.appendChild(field('Visual Variant', select([
        ['glass', 'Frosted Glassmorphism (Blur & Border)', p.styleVariant || 'glass'],
        ['solid', 'Solid Surface (Clean Elevated)', p.styleVariant || 'glass'],
        ['transparent', 'Transparent Overlay', p.styleVariant || 'glass'],
        ['bordered', 'Bordered Outline', p.styleVariant || 'glass']
      ], v => { p.styleVariant = v; onChange(); })));

      const stickyLabel = el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-bottom:12px;' }, [
        el('input', {
          type: 'checkbox',
          checked: !!p.sticky,
          onchange: e => { p.sticky = e.target.checked; onChange(); }
        }),
        el('span', {}, 'Sticky Header (stays fixed at top on scroll)')
      ]);
      wrap.appendChild(stickyLabel);

      // Search Bar Settings
      const searchSectionTitle = el('div', { style: 'margin:16px 0 8px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'Search Bar');
      wrap.appendChild(searchSectionTitle);

      const showSearchLabel = el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-bottom:10px;' }, [
        el('input', {
          type: 'checkbox',
          checked: !!p.showSearch,
          onchange: e => { p.showSearch = e.target.checked; onChange(); }
        }),
        el('span', {}, 'Enable Interactive Search Bar')
      ]);
      wrap.appendChild(showSearchLabel);

      if (p.showSearch) {
        wrap.appendChild(field('Search Placeholder', input('text', p.searchPlaceholder || 'Search...', v => { p.searchPlaceholder = v; onPropInput(); })));
      }

      // Links Manager
      const linksSectionTitle = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin:16px 0 8px;' }, [
        el('label', { style: 'font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'Navigation Links'),
        el('button', {
          type: 'button',
          class: 'btn secondary btn-sm',
          style: 'padding:2px 8px;font-size:11px;',
          onclick: () => {
            p.links.push({ label: `Link ${p.links.length + 1}`, url: '#' });
            onChange();
          }
        }, '+ Add Link')
      ]);
      wrap.appendChild(linksSectionTitle);

      const linksList = el('div', { class: 'header-links-list', style: 'display:flex;flex-direction:column;gap:8px;margin-bottom:14px;' });
      p.links.forEach((link, idx) => {
        const row = el('div', { style: 'display:flex;gap:6px;align-items:center;background:rgba(255,255,255,0.02);padding:6px;border-radius:6px;border:1px solid var(--border-subtle);' }, [
          el('input', {
            type: 'text',
            placeholder: 'Label',
            value: link.label || '',
            style: 'flex:1;min-width:0;',
            oninput: e => { link.label = e.target.value; onPropInput(); }
          }),
          el('input', {
            type: 'text',
            placeholder: 'URL (#/page)',
            value: link.url || '',
            style: 'flex:1;min-width:0;',
            oninput: e => { link.url = e.target.value; onPropInput(); }
          }),
          el('button', {
            type: 'button',
            class: 'btn ghost btn-sm danger',
            style: 'padding:4px 6px;font-size:11px;',
            title: 'Remove Link',
            onclick: () => { p.links.splice(idx, 1); onChange(); }
          }, '✕')
        ]);
        linksList.appendChild(row);
      });
      wrap.appendChild(linksList);

      // Call to Action Settings
      const ctaSectionTitle = el('div', { style: 'margin:14px 0 8px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'CTA Action Button');
      wrap.appendChild(ctaSectionTitle);

      const showCtaLabel = el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-bottom:10px;' }, [
        el('input', {
          type: 'checkbox',
          checked: p.showCta !== false,
          onchange: e => { p.showCta = e.target.checked; onChange(); }
        }),
        el('span', {}, 'Show Call-to-Action Button')
      ]);
      wrap.appendChild(showCtaLabel);

      if (p.showCta !== false) {
        wrap.appendChild(field('Button Label', input('text', p.ctaLabel || 'Get Started', v => { p.ctaLabel = v; onPropInput(); })));
        wrap.appendChild(field('Button Target URL', input('text', p.ctaUrl || '#', v => { p.ctaUrl = v; onPropInput(); })));
        wrap.appendChild(field('Button Style Variant', select([
          ['filled', 'Gradient Accent (Filled)', p.ctaVariant || 'filled'],
          ['outline', 'Outline Border', p.ctaVariant || 'filled'],
          ['glow', 'Neon Glowing Accent', p.ctaVariant || 'filled']
        ], v => { p.ctaVariant = v; onChange(); })));
      }

      // Carousel & Nested Component Slot Settings
      const carouselSectionTitle = el('div', { style: 'margin:18px 0 8px;font-weight:700;font-size:11.5px;text-transform:uppercase;color:var(--text-secondary);letter-spacing:0.5px;' }, 'Header Component Carousel');
      wrap.appendChild(carouselSectionTitle);

      const enableCarouselLabel = el('label', { style: 'display:flex;align-items:center;gap:8px;font-size:12.5px;cursor:pointer;margin-bottom:10px;' }, [
        el('input', {
          type: 'checkbox',
          checked: p.enableCarousel !== false,
          onchange: e => { p.enableCarousel = e.target.checked; onChange(); }
        }),
        el('span', {}, 'Enable Carousel Track (Draggable Component Strip)')
      ]);
      wrap.appendChild(enableCarouselLabel);

      if (p.enableCarousel !== false) {
        wrap.appendChild(field('Slide Card Width', select([
          ['compact', 'Compact Cards (220px)', p.carouselItemWidth || 'medium'],
          ['medium', 'Medium Cards (320px - Default)', p.carouselItemWidth || 'medium'],
          ['wide', 'Wide Banners (440px)', p.carouselItemWidth || 'medium'],
          ['full', 'Full Width (100% per slide)', p.carouselItemWidth || 'medium'],
          ['auto', 'Auto Content Width', p.carouselItemWidth || 'medium']
        ], v => { p.carouselItemWidth = v; onChange(); })));

        // Rotation controls
        const rotationControls = el('div', { style: 'margin:10px 0 8px;background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;border:1px solid var(--border-subtle);' }, [
          el('div', { style: 'font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px;' }, 'Carousel Rotation'),
          el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:8px;' }, [
            el('input', {
              type: 'checkbox',
              checked: !!p.carouselAutoplay,
              onchange: e => { p.carouselAutoplay = e.target.checked; onChange(); }
            }),
            el('span', {}, 'Autoplay (Rotate Automatically)')
          ])
        ]);
        if (p.carouselAutoplay) {
          rotationControls.appendChild(field('Autoplay Speed (Seconds)', input('number', String(p.carouselInterval || 4), v => { p.carouselInterval = Number(v) || 4; onPropInput(); }, { min: 2, max: 20 })));
        }
        wrap.appendChild(rotationControls);

        // Arrow controls & behavior
        const arrowBox = el('div', { style: 'margin:10px 0 8px;background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;border:1px solid var(--border-subtle);' }, [
          el('div', { style: 'font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px;' }, 'Arrow Buttons & Behavior'),
          el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:8px;' }, [
            el('input', {
              type: 'checkbox',
              checked: p.carouselShowArrows !== false,
              onchange: e => { p.carouselShowArrows = e.target.checked; onChange(); }
            }),
            el('span', {}, 'Show Navigation Arrows')
          ])
        ]);

        if (p.carouselShowArrows !== false) {
          arrowBox.appendChild(field('Show Prev / Next Buttons', select([
            ['both', 'Show Both Prev & Next Buttons', p.carouselShowPrevNext || 'both'],
            ['prev-only', 'Show Prev Button Only', p.carouselShowPrevNext || 'both'],
            ['next-only', 'Show Next Button Only', p.carouselShowPrevNext || 'both']
          ], v => { p.carouselShowPrevNext = v; onChange(); })));

          arrowBox.appendChild(field('Arrow Button Style', select([
            ['circle', 'Circle Button (Modern Glass)', p.carouselArrowStyle || 'circle'],
            ['square', 'Rounded Square Button', p.carouselArrowStyle || 'circle'],
            ['pill', 'Elongated Pill Button', p.carouselArrowStyle || 'circle'],
            ['ghost', 'Ghost Minimalist Button', p.carouselArrowStyle || 'circle'],
            ['glow', 'Neon Glowing Accent Button', p.carouselArrowStyle || 'circle']
          ], v => { p.carouselArrowStyle = v; onChange(); })));

          arrowBox.appendChild(field('Arrow Navigation Behavior', select([
            ['smooth', 'Smooth Step Scroll (Standard)', p.carouselArrowBehavior || 'smooth'],
            ['loop', 'Loop Around (Wrap to Start / End)', p.carouselArrowBehavior || 'smooth']
          ], v => { p.carouselArrowBehavior = v; onChange(); })));
        }
        wrap.appendChild(arrowBox);

        // Dot controls & behavior
        const dotBox = el('div', { style: 'margin:10px 0 8px;background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;border:1px solid var(--border-subtle);' }, [
          el('div', { style: 'font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px;' }, 'Pagination Dots & Behavior'),
          el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-bottom:8px;' }, [
            el('input', {
              type: 'checkbox',
              checked: p.carouselShowDots !== false,
              onchange: e => { p.carouselShowDots = e.target.checked; onChange(); }
            }),
            el('span', {}, 'Show Pagination Dots')
          ])
        ]);

        if (p.carouselShowDots !== false) {
          dotBox.appendChild(field('Dot Button Style', select([
            ['bars', 'Expanding Accent Bars (Default)', p.carouselDotStyle || 'bars'],
            ['dots', 'Classic Circular Dots', p.carouselDotStyle || 'bars'],
            ['numbers', 'Slide Numbers (1, 2, 3...)', p.carouselDotStyle || 'bars'],
            ['lines', 'Slim Minimalist Dashes', p.carouselDotStyle || 'bars']
          ], v => { p.carouselDotStyle = v; onChange(); })));

          dotBox.appendChild(field('Dot Click Behavior', select([
            ['smooth', 'Smooth Centered Scroll', p.carouselDotBehavior || 'smooth'],
            ['instant', 'Instant Jump to Slide', p.carouselDotBehavior || 'smooth']
          ], v => { p.carouselDotBehavior = v; onChange(); })));
        }
        wrap.appendChild(dotBox);

        // Slide Indicator / Counter
        const counterBox = el('div', { style: 'margin:10px 0 8px;background:rgba(255,255,255,0.02);padding:10px;border-radius:8px;border:1px solid var(--border-subtle);' }, [
          el('div', { style: 'font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-tertiary);margin-bottom:8px;' }, 'Slide Counter Display'),
          el('label', { style: 'display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;' }, [
            el('input', {
              type: 'checkbox',
              checked: p.showSlideCounter !== false,
              onchange: e => { p.showSlideCounter = e.target.checked; onChange(); }
            }),
            el('span', {}, 'Show Current Slide Counter (e.g. 01 / 03)')
          ])
        ]);
        wrap.appendChild(counterBox);

        // Quick add buttons for carousel slot
        const addComponentsTitle = el('div', { style: 'margin:14px 0 6px;font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;' }, 'Quick Add Component to Carousel:');
        wrap.appendChild(addComponentsTitle);

        const quickBtns = el('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-bottom:12px;' }, [
          el('button', { type: 'button', class: 'btn secondary btn-sm', style: 'font-size:11px;padding:3px 7px;', onclick: () => insertBlockAt('callout', block.id) }, '+ Callout'),
          el('button', { type: 'button', class: 'btn secondary btn-sm', style: 'font-size:11px;padding:3px 7px;', onclick: () => insertBlockAt('button', block.id) }, '+ Button'),
          el('button', { type: 'button', class: 'btn secondary btn-sm', style: 'font-size:11px;padding:3px 7px;', onclick: () => insertBlockAt('stat', block.id) }, '+ Metric'),
          el('button', { type: 'button', class: 'btn secondary btn-sm', style: 'font-size:11px;padding:3px 7px;', onclick: () => insertBlockAt('image', block.id) }, '+ Image'),
          el('button', { type: 'button', class: 'btn secondary btn-sm', style: 'font-size:11px;padding:3px 7px;', onclick: () => insertBlockAt('paragraph', block.id) }, '+ Text')
        ]);
        wrap.appendChild(quickBtns);
      }
      break;
    }
  }

  // Universal Custom CSS Style setting on every component
  wrap.appendChild(customCssField(block, onPropInput));

  body.appendChild(wrap);
}

function customCssField(block, onPropChange) {
  const p = block.props || {};
  if (!p) block.props = {};

  const fieldWrap = el('div', {
    class: 'field custom-css-field-wrap',
    style: 'margin-top:16px;padding-top:14px;border-top:1px solid var(--border-subtle);'
  });

  const titleRow = el('div', {
    style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;'
  }, [
    el('label', { style: 'font-weight:700;font-size:11.5px;color:var(--accent-primary);text-transform:uppercase;letter-spacing:0.5px;margin:0;display:flex;align-items:center;gap:5px;' }, [
      createSvg('<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>'),
      el('span', {}, 'Custom CSS Style')
    ]),
    p.customCss ? el('button', {
      type: 'button',
      class: 'btn-icon-sm',
      title: 'Clear Custom CSS',
      onclick: () => {
        p.customCss = '';
        txt.value = '';
        onPropChange();
      }
    }, '\u2715') : false
  ]);

  const txt = el('textarea', {
    placeholder: 'e.g., box-shadow: 0 0 20px rgba(99,102,241,0.5); transform: rotate(-1deg); letter-spacing: 1px;',
    style: 'font-family:var(--font-mono);font-size:11px;line-height:1.45;min-height:58px;resize:vertical;width:100%;box-sizing:border-box;background:rgba(0,0,0,0.35);color:#38bdf8;border:1px solid var(--border-medium);border-radius:var(--radius-md);padding:8px 10px;',
    oninput: e => {
      p.customCss = e.target.value;
      onPropChange();
    }
  }, p.customCss || '');

  const appendSnippet = (snippet) => {
    p.customCss = (p.customCss ? p.customCss.trim().replace(/;?$/, '; ') : '') + snippet;
    txt.value = p.customCss;
    onPropChange();
  };

  const presetsRow = el('div', {
    class: 'quick-presets-row',
    style: 'margin-top:6px;display:flex;gap:4px;flex-wrap:wrap;'
  }, [
    el('span', { style: 'font-size:10px;color:var(--text-tertiary);align-self:center;margin-right:2px;' }, 'Presets:'),
    el('button', {
      type: 'button',
      class: 'quick-preset-chip',
      onclick: () => appendSnippet('box-shadow: 0 0 25px rgba(99, 102, 241, 0.6);')
    }, '\u2728 Glow'),
    el('button', {
      type: 'button',
      class: 'quick-preset-chip',
      onclick: () => appendSnippet('backdrop-filter: blur(12px); background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.18);')
    }, '\ud83d\udc8e Glass'),
    el('button', {
      type: 'button',
      class: 'quick-preset-chip',
      onclick: () => appendSnippet('background: linear-gradient(135deg, #818cf8, #ec4899); -webkit-background-clip: text; -webkit-text-fill-color: transparent;')
    }, '\ud83c\udf08 Gradient'),
    el('button', {
      type: 'button',
      class: 'quick-preset-chip',
      onclick: () => appendSnippet('transform: rotate(-1.5deg);')
    }, '\ud83d\udcd0 Tilt'),
    el('button', {
      type: 'button',
      class: 'quick-preset-chip',
      onclick: () => appendSnippet('border-color: #38bdf8; box-shadow: 0 0 15px rgba(56, 189, 248, 0.5);')
    }, '\u26a1 Neon')
  ]);

  fieldWrap.appendChild(titleRow);
  fieldWrap.appendChild(txt);
  fieldWrap.appendChild(presetsRow);
  return fieldWrap;
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

function colorField(label, value, defaultVal, onChange) {
  const container = el('div', { class: 'field color-picker-field' });
  const labelEl = el('label', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [
    el('span', {}, label),
    value ? el('span', { style: 'font-size:11px;font-family:var(--font-mono);color:var(--accent-primary);' }, value) : false
  ]);
  container.appendChild(labelEl);

  const curVal = value || defaultVal || '#6366f1';
  
  // Custom Color Picker Swatch Box
  const swatchBox = el('div', {
    class: 'color-swatch-box',
    title: 'Click to open color picker',
    style: `background-color:${curVal};`
  });
  
  const hiddenColorInput = el('input', {
    type: 'color',
    class: 'hidden-color-input',
    value: curVal.startsWith('#') && curVal.length === 7 ? curVal : '#6366f1',
    oninput: e => {
      textInput.value = e.target.value.toUpperCase();
      swatchBox.style.backgroundColor = e.target.value;
      onChange(e.target.value);
    }
  });

  swatchBox.onclick = () => hiddenColorInput.click();

  // Hex Text Input
  const textInput = input('text', value || '', v => {
    let formatted = v.trim();
    if (formatted && !formatted.startsWith('#') && /^[0-9a-fA-F]{3,8}$/.test(formatted)) {
      formatted = '#' + formatted;
    }
    swatchBox.style.backgroundColor = formatted || defaultVal || '#6366f1';
    if (formatted.startsWith('#') && formatted.length === 7) {
      hiddenColorInput.value = formatted;
    }
    onChange(formatted);
  });
  textInput.placeholder = defaultVal ? `Default (${defaultVal})` : 'e.g. #6366F1';
  textInput.className = 'form-input color-hex-input';

  // Reset Button
  const resetBtn = el('button', {
    type: 'button',
    class: 'btn ghost btn-sm color-reset-btn',
    title: 'Reset to default color',
    onclick: () => {
      textInput.value = '';
      swatchBox.style.backgroundColor = defaultVal || '#6366f1';
      hiddenColorInput.value = defaultVal && defaultVal.startsWith('#') ? defaultVal : '#6366f1';
      onChange('');
    }
  }, 'Reset');

  const mainRow = el('div', { class: 'color-input-main-row' }, [
    swatchBox,
    hiddenColorInput,
    textInput,
    resetBtn
  ]);
  container.appendChild(mainRow);

  // Quick Palette Swatches Row
  const paletteRow = el('div', { class: 'color-quick-palette' }, [
    ...[
      { c: '#ffffff', name: 'White' },
      { c: '#94a3b8', name: 'Slate' },
      { c: '#6366f1', name: 'Indigo' },
      { c: '#818cf8', name: 'Light Indigo' },
      { c: '#38bdf8', name: 'Sky Cyan' },
      { c: '#34d399', name: 'Emerald' },
      { c: '#fbbf24', name: 'Amber' },
      { c: '#f43f5e', name: 'Rose' },
      { c: '#ec4899', name: 'Pink' },
      { c: '#a855f7', name: 'Purple' },
      { c: '#0f172a', name: 'Navy' },
      { c: '#000000', name: 'Black' }
    ].map(p => el('button', {
      type: 'button',
      class: 'color-palette-dot',
      style: `background-color:${p.c};`,
      title: `${p.name} (${p.c})`,
      onclick: () => {
        textInput.value = p.c.toUpperCase();
        swatchBox.style.backgroundColor = p.c;
        if (p.c.startsWith('#') && p.c.length === 7) hiddenColorInput.value = p.c;
        onChange(p.c);
      }
    }))
  ]);
  container.appendChild(paletteRow);

  return container;
}

function input(type, value, onInput) {
  return el('input', {
    type,
    value: value != null ? value : '',
    oninput: e => onInput(e.target.value)
  });
}

function textarea(value, onInput) {
  return el('textarea', {
    oninput: e => onInput(e.target.value)
  }, value != null ? value : '');
}

function richTextField(label, value, onInput) {
  const container = el('div', { class: 'field rich-text-field-container' });
  const labelEl = el('label', { style: 'display:flex;justify-content:space-between;align-items:center;' }, [
    el('span', {}, label),
    el('span', { style: 'font-size:10px;color:var(--text-tertiary);font-weight:normal;' }, '✨ Partial styling enabled')
  ]);
  container.appendChild(labelEl);

  const ta = textarea(value || '', onInput);
  ta.style.minHeight = '72px';

  // Helper to wrap selected text in textarea
  function wrapSelection(prefix, suffix, defaultText = 'highlighted text') {
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const val = ta.value;
    const selected = val.substring(start, end) || defaultText;
    const replacement = `${prefix}${selected}${suffix}`;
    const newVal = val.substring(0, start) + replacement + val.substring(end);
    ta.value = newVal;
    onInput(newVal);
    ta.focus();
    ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length);
  }

  // Formatting Toolbar
  const toolbar = el('div', { class: 'rich-text-toolbar' });

  // Row 1: Formatting buttons
  const toolsRow = el('div', { class: 'rich-tools-row' });

  // 1. Bold Button
  const boldBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Bold selection (**text**)',
    onclick: () => wrapSelection('**', '**', 'bold text')
  }, [el('strong', {}, 'B')]);

  // 2. Italic Button
  const italicBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Italic selection (*text*)',
    onclick: () => wrapSelection('*', '*', 'italic text')
  }, [el('em', {}, 'I')]);

  // 3. Underline Button
  const uBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Underline selection (__text__)',
    onclick: () => wrapSelection('__', '__', 'underline')
  }, [el('u', {}, 'U')]);

  // 4. Code Button
  const codeBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Inline code snippet (`code`)',
    onclick: () => wrapSelection('`', '`', 'code')
  }, '</>');

  // 5. Gradient Button
  const gradBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Rainbow gradient text ([gradient](text))',
    style: 'background:linear-gradient(135deg,rgba(129,140,248,0.25),rgba(236,72,153,0.25));border:1px solid rgba(129,140,248,0.4);color:#c7d2fe;',
    onclick: () => wrapSelection('[gradient](', ')', 'Gradient Phrase')
  }, '🌈 Gradient');

  // 6. Glow Button
  const glowBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Glowing neon text ([glow:#818cf8](text))',
    style: 'color:#818cf8;',
    onclick: () => wrapSelection('[glow:#818cf8](', ')', 'Glowing Text')
  }, '✨ Glow');

  // 7. Highlight / Background Mark Button
  const hlBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Highlighted background ([bg:rgba(245,158,11,0.25)](text))',
    style: 'color:#fbbf24;',
    onclick: () => wrapSelection('[bg:rgba(245,158,11,0.25)](', ')', 'highlighted text')
  }, '🖍️ Mark');

  // 8. Badge Pill Button
  const badgeBtn = el('button', {
    type: 'button',
    class: 'rich-text-btn',
    title: 'Badge pill badge ([badge:#38bdf8](text))',
    style: 'color:#38bdf8;',
    onclick: () => wrapSelection('[badge:#38bdf8](', ')', 'Badge')
  }, '🏷️ Pill');

  toolsRow.appendChild(boldBtn);
  toolsRow.appendChild(italicBtn);
  toolsRow.appendChild(uBtn);
  toolsRow.appendChild(codeBtn);
  toolsRow.appendChild(el('div', { class: 'rich-btn-divider' }));
  toolsRow.appendChild(gradBtn);
  toolsRow.appendChild(glowBtn);
  toolsRow.appendChild(hlBtn);
  toolsRow.appendChild(badgeBtn);

  // Row 2: Color Swatches Row
  const colorsRow = el('div', { class: 'rich-colors-row' });
  colorsRow.appendChild(el('span', { class: 'rich-colors-label' }, '🎨 Color:'));

  const swatches = [
    { color: '#ffffff', name: 'White' },
    { color: '#818cf8', name: 'Indigo' },
    { color: '#ec4899', name: 'Pink' },
    { color: '#34d399', name: 'Emerald' },
    { color: '#38bdf8', name: 'Cyan' },
    { color: '#fbbf24', name: 'Amber' },
    { color: '#f43f5e', name: 'Rose' },
    { color: '#a855f7', name: 'Purple' }
  ];

  swatches.forEach(s => {
    const dot = el('button', {
      type: 'button',
      class: 'rich-swatch-dot',
      style: `background-color:${s.color};`,
      title: `Color: ${s.name} ([color:${s.color}](text))`,
      onclick: () => wrapSelection(`[color:${s.color}](`, ')', `${s.name} text`)
    });
    colorsRow.appendChild(dot);
  });

  // Custom Color Input in toolbar
  const customColorInput = el('input', {
    type: 'color',
    value: '#6366f1',
    style: 'width:20px;height:20px;border:none;background:transparent;cursor:pointer;padding:0;vertical-align:middle;',
    title: 'Custom color for selected text',
    onchange: e => {
      wrapSelection(`[color:${e.target.value}](`, ')', 'colored text');
    }
  });
  colorsRow.appendChild(customColorInput);

  toolbar.appendChild(toolsRow);
  toolbar.appendChild(colorsRow);

  const hint = el('div', { class: 'rich-text-helper-hint' }, [
    '💡 Tip: Select any text and click a style above to format only that specific part.'
  ]);

  container.appendChild(toolbar);
  container.appendChild(ta);
  container.appendChild(hint);
  return container;
}

function select(options, onChange) {
  const sel = el('select', { onchange: e => onChange(e.target.value) });
  options.forEach(([val, lbl, sel2]) => {
    sel.appendChild(el('option', { value: val, ...(val === sel2 ? { selected: '' } : {}) }, lbl));
  });
  return sel;
}

function navigationLinkField(label, propObj, onPropChange, urlKey = 'url', newTabKey = 'newTab') {
  const currentUrl = propObj[urlKey] || '';
  const isPage = currentUrl.startsWith('/p/');
  const currentMode = !currentUrl ? 'none' : (isPage ? 'page' : 'custom');

  const container = el('div', { class: 'field nav-link-field-wrap' }, [
    el('label', { style: 'display:flex;align-items:center;justify-content:space-between;' }, [
      el('span', {}, label || 'Click Navigation Action'),
      currentUrl ? el('span', { class: 'link-type-tag' }, isPage ? 'Internal Page' : 'External Link') : false
    ])
  ]);

  const modeSelect = select([
    ['none', 'None (No click action)', currentMode === 'none' ? 'none' : ''],
    ['page', '📄 Internal Document / Page', currentMode === 'page' ? 'page' : ''],
    ['custom', '🔗 Custom URL / External Link', currentMode === 'custom' ? 'custom' : '']
  ], mode => {
    if (mode === 'none') {
      propObj[urlKey] = '';
    } else if (mode === 'page') {
      const otherPages = state.cms.pages.filter(p => p.id !== state.cms.openPageId);
      const target = otherPages[0] || state.cms.pages[0];
      propObj[urlKey] = target ? `/p/${target.slug}` : '/p/';
    } else if (mode === 'custom') {
      propObj[urlKey] = 'https://';
    }
    onPropChange();
    renderProps();
  });

  container.appendChild(modeSelect);

  if (currentMode === 'page') {
    const pageOptions = state.cms.pages.map(p => [
      `/p/${p.slug}`,
      `📄 ${p.title || 'Untitled'} (/p/${p.slug})`,
      currentUrl === `/p/${p.slug}` ? `/p/${p.slug}` : ''
    ]);
    if (!pageOptions.some(opt => opt[0] === currentUrl) && currentUrl) {
      pageOptions.unshift([currentUrl, `Current: ${currentUrl}`, currentUrl]);
    }
    if (!pageOptions.length) {
      pageOptions.push(['/p/', 'No pages available yet', '/p/']);
    }

    const pageSelect = select(pageOptions, v => {
      propObj[urlKey] = v;
      onPropChange();
    });
    pageSelect.style.marginTop = '6px';
    container.appendChild(pageSelect);
  } else if (currentMode === 'custom') {
    const customInput = input('text', currentUrl, v => {
      propObj[urlKey] = v;
      onPropChange();
    });
    customInput.placeholder = 'https://example.com or #section';
    customInput.style.marginTop = '6px';
    container.appendChild(customInput);
  }

  if (currentUrl) {
    const newTabChk = checkbox('Open in New Tab', propObj[newTabKey] !== false, v => {
      propObj[newTabKey] = v;
      onPropChange();
    });
    newTabChk.style.marginTop = '6px';
    container.appendChild(newTabChk);
  }

  return container;
}

// AI Website Generator State & Handlers
state.cms.aiMode = 'prompt';
state.cms.aiPreset = 'saas';

const PRESET_PROMPTS = {
  saas: 'A high-converting SaaS landing page for an AI cloud platform with a bold hero section, call-to-action buttons, 3 feature cards, customer quote carousel, and transparent pricing comparison table.',
  portfolio: 'A modern design studio and product portfolio with an aesthetic hero header, project carousel showcase, client deliverables table, and a direct inquiry contact button.',
  docs: 'A clean developer documentation portal with a getting started guide, protocol specification table, module overview cards, and an API reference explorer.',
  custom: ''
};

function loadStoredAiSettings() {
  const provider = localStorage.getItem('aladen_ai_provider') || 'opencode';
  const apiKey = localStorage.getItem('aladen_ai_api_key') || '';
  let baseUrl = localStorage.getItem('aladen_ai_base_url') || 'https://api.groq.com/openai/v1';
  if (provider === 'ollama') {
    baseUrl = localStorage.getItem('aladen_ai_ollama_base_url') || 'http://localhost:11434';
  } else if (baseUrl.includes('api.opencode.ai/v1') || baseUrl.includes('opencode.ai/zen/v1')) {
    baseUrl = 'https://api.groq.com/openai/v1';
  }
  let model = localStorage.getItem('aladen_ai_model') || 'qwen/qwen3.8-27b';
  if (provider === 'ollama') {
    model = localStorage.getItem('aladen_ai_ollama_model') || 'llama3.2';
  } else if (model === 'opencode-1' || model === 'minimax-01' || model === 'minimax-text-01' || model === 'big-pickle' || model === 'llama-3.3-70b-versatile' || model === 'llama-3.1-8b-instant') {
    model = 'qwen/qwen3.8-27b';
  }

  const provSelect = document.getElementById('aiProviderSelect');
  const keyInput = document.getElementById('aiApiKeyInput');
  const baseInput = document.getElementById('aiBaseUrlInput');
  const modelInput = document.getElementById('aiModelInput');

  if (provSelect) provSelect.value = provider;
  if (keyInput) keyInput.value = apiKey;
  if (baseInput) baseInput.value = baseUrl;
  if (modelInput) modelInput.value = model;

  updateAiProviderUI(provider);
}

function saveStoredAiSettings() {
  const provider = document.getElementById('aiProviderSelect')?.value || 'opencode';
  const apiKey = document.getElementById('aiApiKeyInput')?.value.trim() || '';
  const baseUrl = document.getElementById('aiBaseUrlInput')?.value.trim() || (provider === 'ollama' ? 'http://localhost:11434' : 'https://api.groq.com/openai/v1');
  const model = document.getElementById('aiModelInput')?.value.trim() || (provider === 'ollama' ? 'llama3.2' : 'qwen/qwen3.8-27b');

  localStorage.setItem('aladen_ai_provider', provider);
  if (provider === 'ollama') {
    localStorage.setItem('aladen_ai_ollama_base_url', baseUrl);
    localStorage.setItem('aladen_ai_ollama_model', model);
  } else {
    localStorage.setItem('aladen_ai_api_key', apiKey);
    localStorage.setItem('aladen_ai_base_url', baseUrl);
    localStorage.setItem('aladen_ai_model', model);
  }

  const badge = document.getElementById('aiKeyStatusBadge');
  if (badge) {
    if (provider === 'ollama') {
      badge.textContent = '🦙 Ollama Local (No Key Needed)';
      badge.style.background = 'rgba(99, 102, 241, 0.18)';
      badge.style.color = '#818cf8';
      badge.style.borderColor = 'rgba(99, 102, 241, 0.35)';
      badge.style.display = 'inline-block';
    } else if (provider === 'smart-archetype') {
      badge.textContent = 'Built-in Engine';
      badge.style.background = 'rgba(16, 185, 129, 0.15)';
      badge.style.color = '#34d399';
      badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
      badge.style.display = 'inline-block';
    } else if (apiKey) {
      badge.textContent = 'API Key Saved';
      badge.style.background = 'rgba(34, 197, 94, 0.15)';
      badge.style.color = '#4ade80';
      badge.style.borderColor = 'rgba(34, 197, 94, 0.3)';
      badge.style.display = 'inline-block';
    } else {
      badge.textContent = 'No Key (Archetype Fallback)';
      badge.style.background = 'rgba(245, 158, 11, 0.15)';
      badge.style.color = '#fbbf24';
      badge.style.borderColor = 'rgba(245, 158, 11, 0.3)';
      badge.style.display = 'inline-block';
    }
  }
}

async function checkOllamaStatus(autoSelect = true) {
  const statusBox = document.getElementById('ollamaStatusBox');
  const dot = document.getElementById('ollamaStatusDot');
  const text = document.getElementById('ollamaStatusText');
  const select = document.getElementById('ollamaModelSelect');
  const baseInput = document.getElementById('aiBaseUrlInput');
  const modelInput = document.getElementById('aiModelInput');
  const baseUrl = baseInput?.value.trim() || 'http://localhost:11434';

  if (!statusBox || !dot || !text) return;
  dot.style.background = '#eab308';
  dot.style.boxShadow = '0 0 6px rgba(234, 179, 8, 0.5)';
  text.textContent = 'Checking local Ollama connection...';

  try {
    const res = await fetch(`/api/ai/ollama/models?baseUrl=${encodeURIComponent(baseUrl)}`);
    const data = await res.json();

    if (data.ok && data.models && data.models.length > 0) {
      dot.classList.add('connected');
      dot.style.background = '#22c55e';
      dot.style.boxShadow = '0 0 8px rgba(34, 197, 94, 0.7)';
      text.textContent = `🟢 Connected (${data.models.length} model${data.models.length > 1 ? 's' : ''} available)`;

      if (select) {
        select.style.display = 'inline-block';
        select.innerHTML = '<option value="">Select local model...</option>';
        data.models.forEach(m => {
          const opt = document.createElement('option');
          opt.value = m.name;
          const sizeGb = m.size ? ` (${(m.size / (1024 * 1024 * 1024)).toFixed(1)}GB)` : '';
          opt.textContent = `${m.name}${sizeGb}`;
          select.appendChild(opt);
        });

        const currentModel = modelInput?.value.trim();
        const match = data.models.find(m => m.name === currentModel || m.name.startsWith(currentModel + ':') || (currentModel && currentModel.startsWith(m.name.split(':')[0])));
        if (match) {
          select.value = match.name;
          if (modelInput) modelInput.value = match.name;
        } else if (autoSelect && data.models[0]) {
          select.value = data.models[0].name;
          if (modelInput) modelInput.value = data.models[0].name;
          saveStoredAiSettings();
        }
      }
    } else if (data.ok && (!data.models || data.models.length === 0)) {
      dot.classList.remove('connected');
      dot.style.background = '#f59e0b';
      dot.style.boxShadow = '0 0 6px rgba(245, 158, 11, 0.6)';
      text.textContent = '🟡 Ollama online (no models pulled yet: run "ollama run llama3.2")';
      if (select) select.style.display = 'none';
    } else {
      dot.classList.remove('connected');
      dot.style.background = '#ef4444';
      dot.style.boxShadow = '0 0 6px rgba(239, 68, 68, 0.6)';
      text.textContent = '🔴 Offline (Run "ollama serve" or open Ollama)';
      if (select) select.style.display = 'none';
    }
  } catch (err) {
    dot.classList.remove('connected');
    dot.style.background = '#ef4444';
    dot.style.boxShadow = '0 0 6px rgba(239, 68, 68, 0.6)';
    text.textContent = '🔴 Offline (Ensure Ollama is running)';
    if (select) select.style.display = 'none';
  }
}

function updateAiProviderUI(provider) {
  const keyGroup = document.getElementById('aiApiKeyGroup');
  const baseGroup = document.getElementById('aiBaseUrlGroup');
  const baseLabel = baseGroup?.querySelector('label');
  const baseInput = document.getElementById('aiBaseUrlInput');
  const modelInput = document.getElementById('aiModelInput');
  const ollamaBox = document.getElementById('ollamaStatusBox');

  if (provider === 'smart-archetype') {
    if (keyGroup) keyGroup.style.display = 'none';
    if (baseGroup) baseGroup.style.display = 'none';
    if (ollamaBox) ollamaBox.style.display = 'none';
  } else if (provider === 'ollama') {
    if (keyGroup) keyGroup.style.display = 'none';
    if (baseGroup) baseGroup.style.display = 'block';
    if (baseLabel) baseLabel.textContent = 'Ollama Host Base URL';
    if (baseInput && (!baseInput.value || baseInput.value.includes('groq.com') || baseInput.value.includes('opencode.ai'))) {
      baseInput.value = localStorage.getItem('aladen_ai_ollama_base_url') || 'http://localhost:11434';
    }
    if (modelInput && (!modelInput.value || modelInput.value.includes('qwen3.8') || modelInput.value.includes('gpt-oss') || modelInput.value.includes('gemini'))) {
      modelInput.value = localStorage.getItem('aladen_ai_ollama_model') || 'llama3.2';
    }
    if (ollamaBox) ollamaBox.style.display = 'flex';
    checkOllamaStatus(true);
  } else if (provider === 'gemini') {
    if (keyGroup) keyGroup.style.display = 'block';
    if (baseGroup) baseGroup.style.display = 'none';
    if (ollamaBox) ollamaBox.style.display = 'none';
    if (modelInput && (!modelInput.value || modelInput.value === 'big-pickle' || modelInput.value === 'llama3.2')) modelInput.value = 'gemini-1.5-flash';
  } else {
    // OpenCode / Groq / OpenAI-Compatible
    if (keyGroup) keyGroup.style.display = 'block';
    if (baseGroup) baseGroup.style.display = 'block';
    if (baseLabel) baseLabel.textContent = 'API Base URL';
    if (ollamaBox) ollamaBox.style.display = 'none';
    if (baseInput && baseInput.value.includes('localhost:11434')) {
      baseInput.value = localStorage.getItem('aladen_ai_base_url') || 'https://api.groq.com/openai/v1';
    }
    if (modelInput && (!modelInput.value || modelInput.value === 'gemini-1.5-flash' || modelInput.value === 'llama3.2')) {
      modelInput.value = 'qwen/qwen3.8-27b';
    }
  }
}

function openAiGenerateModal() {
  const modal = document.getElementById('aiGenerateModal');
  if (!modal) return;
  modal.classList.remove('hidden');

  loadStoredAiSettings();

  // Populate board selector
  const boardSelect = document.getElementById('aiBoardSelect');
  if (boardSelect) {
    boardSelect.innerHTML = '<option value="">Choose a Kanban board...</option>';
    (state.boards || []).forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `📋 ${b.name || b.title || 'Untitled Board'}`;
      if (b.id === state.currentBoardId) opt.selected = true;
      boardSelect.appendChild(opt);
    });
  }

  // Set default prompt if empty
  const promptInput = document.getElementById('aiPromptInput');
  if (promptInput && !promptInput.value.trim()) {
    promptInput.value = PRESET_PROMPTS[state.cms.aiPreset] || PRESET_PROMPTS.saas;
  }

  const overlay = document.getElementById('aiGeneratingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

function closeAiGenerateModal() {
  const modal = document.getElementById('aiGenerateModal');
  if (modal) modal.classList.add('hidden');
}

function setAiMode(mode) {
  state.cms.aiMode = mode;
  document.getElementById('aiModePromptBtn')?.classList.toggle('active', mode === 'prompt');
  document.getElementById('aiModeBoardBtn')?.classList.toggle('active', mode === 'board');
  document.getElementById('aiPromptSection')?.classList.toggle('hidden', mode !== 'prompt');
  document.getElementById('aiBoardSection')?.classList.toggle('hidden', mode !== 'board');
}

function selectAiPreset(preset) {
  state.cms.aiPreset = preset;
  document.querySelectorAll('.ai-chip').forEach(chip => {
    chip.classList.toggle('active', chip.dataset.preset === preset);
  });
  const promptInput = document.getElementById('aiPromptInput');
  if (promptInput && PRESET_PROMPTS[preset]) {
    promptInput.value = PRESET_PROMPTS[preset];
  }
}

async function submitAiGenerate() {
  const prompt = document.getElementById('aiPromptInput')?.value.trim() || '';
  const theme = document.getElementById('aiThemeSelect')?.value || 'dark-card';
  const provider = document.getElementById('aiProviderSelect')?.value || 'opencode';
  const apiKey = document.getElementById('aiApiKeyInput')?.value.trim() || '';
  const baseUrl = document.getElementById('aiBaseUrlInput')?.value.trim() || 'https://api.opencode.ai/v1';
  const model = document.getElementById('aiModelInput')?.value.trim() || 'opencode-1';
  const boardId = state.cms.aiMode === 'board' ? document.getElementById('aiBoardSelect')?.value : null;

  saveStoredAiSettings();

  if (state.cms.aiMode === 'prompt' && !prompt && state.cms.aiPreset === 'custom') {
    showToast('Please describe what you want to build.', 'warning');
    return;
  }
  if (state.cms.aiMode === 'board' && !boardId) {
    showToast('Please select a Kanban board to convert.', 'warning');
    return;
  }

  const overlay = document.getElementById('aiGeneratingOverlay');
  const submitBtn = document.getElementById('submitAiGenerateBtn');
  const loadingTitle = document.getElementById('aiLoadingTitle');
  const loadingSub = document.getElementById('aiLoadingSub');

  if (overlay) overlay.classList.remove('hidden');
  if (submitBtn) submitBtn.disabled = true;

  if (loadingTitle) {
    loadingTitle.textContent = provider === 'ollama'
      ? `Generating with Ollama (${model})...`
      : provider === 'opencode'
        ? `Generating with OpenCode (${model})...`
        : provider === 'gemini'
          ? `Generating with Gemini (${model})...`
          : 'Synthesizing Website Layout...';
  }
  if (loadingSub) {
    loadingSub.textContent = provider === 'ollama'
      ? 'Composing website blocks locally via Ollama neural model...'
      : 'Composing responsive visual components, structure, and theme...';
  }

  try {
    const res = await fetch('/api/ai/generate-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: state.cms.aiMode === 'prompt' ? prompt : '',
        preset: state.cms.aiPreset,
        theme,
        boardId: boardId ? Number(boardId) : null,
        provider,
        apiKey,
        baseUrl,
        model
      })
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `HTTP ${res.status}`);
    }

    const data = await res.json();
    const newPage = data.page;

    if (data.warning) {
      showToast(`⚠️ ${data.warning} (Generated via Smart Archetype)`, 'warning');
    } else if (data.source === 'ollama-ai') {
      showToast(`🦙 Generated "${newPage.title}" locally with Ollama (${model})!`, 'success');
    } else if (data.source === 'opencode-ai') {
      showToast(`✨ Generated "${newPage.title}" with OpenCode (${model})!`, 'success');
    } else {
      showToast(`✨ Generated "${newPage.title}" successfully!`, 'success');
    }
    closeAiGenerateModal();

    await loadCmsPages();
    openCmsPage(newPage.id);
  } catch (err) {
    console.error('AI Generation Error:', err);
    showToast(`Generation failed: ${err.message}`, 'danger');
  } finally {
    if (overlay) overlay.classList.add('hidden');
    if (submitBtn) submitBtn.disabled = false;
  }
}

function initPaletteCategoryCollapsing() {
  const STORAGE_KEY = 'aladen_collapsed_categories';
  const categories = document.querySelectorAll('.palette-category[data-category]');
  const toggleAllBtn = document.getElementById('cmsToggleAllSectionsBtn');
  if (!categories.length) return;

  let collapsedCategories = new Set();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) {
        collapsedCategories = new Set(parsed);
      }
    }
  } catch (e) {
    console.warn('Failed to parse collapsed categories from localStorage', e);
  }

  const saveState = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(collapsedCategories)));
    } catch (e) {
      console.warn('Failed to save collapsed categories to localStorage', e);
    }
  };

  const updateToggleAllBtnState = () => {
    if (!toggleAllBtn) return;
    const allCollapsed = Array.from(categories).every(cat => cat.classList.contains('collapsed'));
    toggleAllBtn.textContent = allCollapsed ? 'Expand All' : 'Collapse All';
    toggleAllBtn.setAttribute('aria-expanded', allCollapsed ? 'false' : 'true');
  };

  categories.forEach(cat => {
    const catId = cat.dataset.category;
    if (collapsedCategories.has(catId)) {
      cat.classList.add('collapsed');
    }

    const titleEl = cat.querySelector('.category-title');
    if (titleEl) {
      titleEl.setAttribute('aria-expanded', cat.classList.contains('collapsed') ? 'false' : 'true');

      const toggle = (e) => {
        if (e) e.preventDefault();
        const isCollapsed = cat.classList.toggle('collapsed');
        titleEl.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
        if (isCollapsed) {
          collapsedCategories.add(catId);
        } else {
          collapsedCategories.delete(catId);
        }
        saveState();
        updateToggleAllBtnState();
      };

      titleEl.addEventListener('click', toggle);
      titleEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          toggle();
        }
      });
    }
  });

  if (toggleAllBtn) {
    toggleAllBtn.addEventListener('click', () => {
      const allCollapsed = Array.from(categories).every(cat => cat.classList.contains('collapsed'));
      if (allCollapsed) {
        categories.forEach(cat => {
          cat.classList.remove('collapsed');
          const title = cat.querySelector('.category-title');
          if (title) title.setAttribute('aria-expanded', 'true');
          collapsedCategories.delete(cat.dataset.category);
        });
      } else {
        categories.forEach(cat => {
          cat.classList.add('collapsed');
          const title = cat.querySelector('.category-title');
          if (title) title.setAttribute('aria-expanded', 'false');
          collapsedCategories.add(cat.dataset.category);
        });
      }
      saveState();
      updateToggleAllBtnState();
    });
  }

  updateToggleAllBtnState();
}

function setupCmsEvents() {
  initPaletteCategoryCollapsing();
  document.getElementById('newPageBtn').onclick = newCmsPage;
  document.getElementById('cmsSaveBtn').onclick = saveCmsPage;
  document.getElementById('cmsDeleteBtn').onclick = deleteCmsPage;
  document.getElementById('cmsFirstPageToggleBtn')?.addEventListener('click', async () => {
    if (!state.cms.openPage || !state.cms.openPage.id) return;
    if (state.cms.openPage.is_first_page) {
      showToast('This page is already the First Page (Homepage)', 'info');
      return;
    }
    await setFirstPage(state.cms.openPage.id);
  });

  // AI Website Generator Triggers
  document.getElementById('cmsAiGenerateBtn')?.addEventListener('click', openAiGenerateModal);
  document.getElementById('cmsPopupAiBtn')?.addEventListener('click', () => {
    closePagesPopup();
    openAiGenerateModal();
  });
  document.getElementById('closeAiModalBtn')?.addEventListener('click', closeAiGenerateModal);
  document.getElementById('cancelAiModalBtn')?.addEventListener('click', closeAiGenerateModal);
  document.getElementById('aiModalBackdrop')?.addEventListener('click', closeAiGenerateModal);
  document.getElementById('aiModePromptBtn')?.addEventListener('click', () => setAiMode('prompt'));
  document.getElementById('aiModeBoardBtn')?.addEventListener('click', () => setAiMode('board'));
  document.getElementById('submitAiGenerateBtn')?.addEventListener('click', submitAiGenerate);

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      const modal = document.getElementById('aiGenerateModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeAiGenerateModal();
      }
    }
  });

  document.getElementById('aiProviderSelect')?.addEventListener('change', e => {
    updateAiProviderUI(e.target.value);
    saveStoredAiSettings();
  });
  document.getElementById('aiApiKeyInput')?.addEventListener('input', saveStoredAiSettings);
  document.getElementById('aiBaseUrlInput')?.addEventListener('input', () => {
    saveStoredAiSettings();
    if (document.getElementById('aiProviderSelect')?.value === 'ollama') {
      clearTimeout(window._ollamaCheckDebounce);
      window._ollamaCheckDebounce = setTimeout(() => checkOllamaStatus(false), 500);
    }
  });
  document.getElementById('aiModelInput')?.addEventListener('input', saveStoredAiSettings);

  document.getElementById('ollamaRefreshBtn')?.addEventListener('click', () => checkOllamaStatus(true));
  document.getElementById('ollamaModelSelect')?.addEventListener('change', e => {
    if (e.target.value) {
      const inp = document.getElementById('aiModelInput');
      if (inp) inp.value = e.target.value;
      saveStoredAiSettings();
    }
  });

  document.getElementById('aiToggleKeyVisibility')?.addEventListener('click', () => {
    const inp = document.getElementById('aiApiKeyInput');
    if (inp) inp.type = inp.type === 'password' ? 'text' : 'password';
  });

  document.querySelectorAll('.ai-chip').forEach(chip => {
    chip.addEventListener('click', () => selectAiPreset(chip.dataset.preset));
  });

  state.cms.indicator = el('div', { class: 'drop-indicator' });

  const canvas = document.getElementById('cmsCanvas');
  const canvasWrap = document.querySelector('.cms-canvas-wrap');
  const viewport = document.querySelector('.canvas-viewport');

  const onDeselectCanvas = e => {
    if (e.target === canvas || e.target === canvasWrap || e.target === viewport || e.target.classList.contains('cms-empty-canvas')) {
      state.cms.selectedBlockId = null;
      renderCanvas();
      renderProps();
    }
  };

  canvas.addEventListener('dragover', onCanvasDragOver);
  canvas.addEventListener('dragleave', onCanvasDragLeave);
  canvas.addEventListener('drop', onCanvasDrop);
  canvas.addEventListener('click', onDeselectCanvas);
  if (canvasWrap) {
    canvasWrap.addEventListener('click', onDeselectCanvas);
    canvasWrap.addEventListener('dragover', onCanvasDragOver);
    canvasWrap.addEventListener('dragleave', onCanvasDragLeave);
    canvasWrap.addEventListener('drop', onCanvasDrop);
  }

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
    if (state.cms.openPage) {
      state.cms.openPage.title = e.target.value;
      updateCurrentPageTopbarLabel();
      triggerAutoSave(350);
    }
  };
  document.getElementById('cmsTagsInput').oninput = e => {
    if (state.cms.openPage) {
      triggerAutoSave(350);
    }
  };
  document.getElementById('cmsStatus').onchange = e => {
    if (state.cms.openPage) {
      state.cms.openPage.status = e.target.value;
      triggerAutoSave(50);
    }
    const link = document.getElementById('cmsPreviewLink');
    if (e.target.value === 'published' && state.cms.openPage && state.cms.openPage.slug) {
      link.href = `/p/${state.cms.openPage.slug}`;
      link.classList.remove('hidden');
    } else {
      link.classList.add('hidden');
    }
  };

  const blocksTabBtn = document.getElementById('cmsTabBlocksBtn');
  const treeTabBtn = document.getElementById('cmsTabTreeBtn');
  if (blocksTabBtn) blocksTabBtn.onclick = () => switchSidebarTab('blocks');
  if (treeTabBtn) treeTabBtn.onclick = () => switchSidebarTab('tree');

  const subTabStd = document.getElementById('cmsSubTabStandard');
  const subTabCustom = document.getElementById('cmsSubTabCustom');
  if (subTabStd) subTabStd.onclick = () => switchBlocksSubTab('standard');
  if (subTabCustom) subTabCustom.onclick = () => switchBlocksSubTab('custom');

  // Viewport Device Switcher & Preview Controls
  document.getElementById('cmsViewportDesktopBtn')?.addEventListener('click', () => setViewportMode('desktop'));
  document.getElementById('cmsViewportTabletBtn')?.addEventListener('click', () => setViewportMode('tablet'));
  document.getElementById('cmsViewportMobileBtn')?.addEventListener('click', () => setViewportMode('mobile'));
  document.getElementById('cmsViewportRotateBtn')?.addEventListener('click', toggleViewportOrientation);
  document.getElementById('cmsViewportFrameToggle')?.addEventListener('click', toggleDeviceFrame);
  
  document.getElementById('cmsEditModeBtn')?.addEventListener('click', () => togglePreviewMode(false));
  document.getElementById('cmsPreviewModeBtn')?.addEventListener('click', () => togglePreviewMode(true));
  document.getElementById('cmsExitPreviewBtn')?.addEventListener('click', () => togglePreviewMode(false));

  initViewportResizers();

  document.addEventListener('keydown', e => {
    if (state.currentTab !== 'cms') return;
    const isInput = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;

    if (e.key === 'Escape') {
      const modal = document.getElementById('aiGenerateModal');
      if (modal && !modal.classList.contains('hidden')) {
        e.preventDefault();
        closeAiGenerateModal();
        return;
      }
      if (state.cms.isPreviewMode) {
        e.preventDefault();
        togglePreviewMode(false);
        return;
      }
    }

    if (!isInput) {
      if (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        togglePreviewMode();
        return;
      }
      if (e.key === '1' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setViewportMode('desktop');
        return;
      }
      if (e.key === '2' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setViewportMode('tablet');
        return;
      }
      if (e.key === '3' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setViewportMode('mobile');
        return;
      }
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      saveCmsPage();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
      const hasSelection = window.getSelection && window.getSelection().toString().length > 0;
      if (!isInput && !hasSelection && state.cms.selectedBlockId) {
        e.preventDefault();
        copySelectedBlock(state.cms.selectedBlockId);
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      if (!isInput && state.cms.clipboardBlock) {
        e.preventDefault();
        pasteCopiedBlock();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      if (!isInput && state.cms.selectedBlockId) {
        e.preventDefault();
        duplicateBlock(state.cms.selectedBlockId);
      }
    }
  });
}

// ==========================================================================
// Command Palette (Ctrl + K / Cmd + K)
// ==========================================================================
let cmdSelectedIndex = 0;
let currentCmdItems = [];

function openCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  const input = document.getElementById('commandPaletteInput');
  if (!modal || !input) return;
  modal.classList.remove('hidden');
  modal.classList.add('open');
  input.value = '';
  input.focus();
  filterCommandPalette('');
}

function closeCommandPalette() {
  const modal = document.getElementById('commandPaletteModal');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('open');
}

async function filterCommandPalette(q) {
  const resultsEl = document.getElementById('commandPaletteResults');
  if (!resultsEl) return;
  const term = (q || '').toLowerCase().trim();
  currentCmdItems = [];
  cmdSelectedIndex = 0;

  // 1. Core Quick Actions
  const actions = [
    {
      type: 'action',
      title: 'Go to Kanban Board',
      sub: 'Switch to project workflow view',
      badge: 'Action',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>',
      run: () => switchTab('board')
    },
    {
      type: 'action',
      title: 'Go to Site Builder (CMS)',
      sub: 'Design pages and visual layouts',
      badge: 'Action',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>',
      run: () => switchTab('cms')
    },
    {
      type: 'action',
      title: 'Create New Site Page',
      sub: 'Add a new visual CMS webpage',
      badge: 'Create',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
      run: () => { switchTab('cms'); document.getElementById('cmsNewPageBtn')?.click(); }
    },
    {
      type: 'action',
      title: 'AI Generate Website',
      sub: 'Generate full websites with Ollama, Groq, or Gemini',
      badge: 'AI',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/></svg>',
      run: () => { switchTab('cms'); document.getElementById('cmsAiGenBtn')?.click(); }
    },
    {
      type: 'action',
      title: 'Toggle Dark / Light Theme',
      sub: 'Switch application appearance',
      badge: 'Theme',
      icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
      run: () => document.getElementById('themeBtn')?.click()
    }
  ];

  actions.forEach(a => {
    if (!term || a.title.toLowerCase().includes(term) || a.sub.toLowerCase().includes(term)) {
      currentCmdItems.push(a);
    }
  });

  // 2. CMS Pages
  if (state.cms && Array.isArray(state.cms.pages)) {
    state.cms.pages.forEach(pg => {
      if (!term || (pg.title && pg.title.toLowerCase().includes(term)) || (pg.slug && pg.slug.toLowerCase().includes(term))) {
        currentCmdItems.push({
          type: 'page',
          title: pg.title || 'Untitled Page',
          sub: `/${pg.slug || ''} • ${pg.status || 'draft'}`,
          badge: 'Page',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
          run: () => {
            switchTab('cms');
            openCmsPage(pg.id);
          }
        });
      }
    });
  }

  // 3. Boards
  if (Array.isArray(state.boards)) {
    state.boards.forEach(b => {
      if (!term || (b.name && b.name.toLowerCase().includes(term))) {
        currentCmdItems.push({
          type: 'board',
          title: b.name,
          sub: `Kanban Board #${b.id}`,
          badge: 'Board',
          icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/></svg>',
          run: async () => {
            switchTab('board');
            state.currentBoardId = b.id;
            const sel = document.getElementById('boardSelect');
            if (sel) sel.value = b.id;
            await loadBoard();
          }
        });
      }
    });
  }

  // 4. Kanban Cards
  if (term) {
    try {
      const cards = await api.get(`/api/search?q=${encodeURIComponent(term)}`);
      if (Array.isArray(cards)) {
        cards.slice(0, 8).forEach(c => {
          currentCmdItems.push({
            type: 'card',
            title: c.title,
            sub: c.description ? c.description.slice(0, 60) : `Card #${c.id} • ${c.priority || 'medium'}`,
            badge: 'Card',
            icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect width="16" height="20" x="4" y="2" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="12" y2="14"/></svg>',
            run: () => {
              switchTab('board');
              openCard(c.id);
            }
          });
        });
      }
    } catch (e) {
      // ignore
    }
  }

  renderCommandPaletteResults();
}

function renderCommandPaletteResults() {
  const resultsEl = document.getElementById('commandPaletteResults');
  if (!resultsEl) return;
  resultsEl.innerHTML = '';

  if (currentCmdItems.length === 0) {
    resultsEl.appendChild(el('div', { class: 'muted', style: 'padding:24px;text-align:center;font-size:13px;' }, 'No matching items or actions'));
    return;
  }

  currentCmdItems.forEach((item, idx) => {
    const isSelected = idx === cmdSelectedIndex;
    const itemEl = el('div', {
      class: `cmd-item${isSelected ? ' selected' : ''}`,
      onclick: () => {
        closeCommandPalette();
        item.run();
      },
      onmouseenter: () => {
        cmdSelectedIndex = idx;
        renderCommandPaletteSelection();
      }
    }, [
      el('div', { class: 'cmd-item-icon' }, [createSvg(item.icon)]),
      el('div', { class: 'cmd-item-content' }, [
        el('div', { class: 'cmd-item-title' }, item.title),
        el('div', { class: 'cmd-item-sub' }, item.sub)
      ]),
      el('span', { class: 'cmd-item-badge' }, item.badge)
    ]);
    resultsEl.appendChild(itemEl);
  });
}

function renderCommandPaletteSelection() {
  const resultsEl = document.getElementById('commandPaletteResults');
  if (!resultsEl) return;
  const items = resultsEl.querySelectorAll('.cmd-item');
  items.forEach((it, idx) => {
    it.classList.toggle('selected', idx === cmdSelectedIndex);
    if (idx === cmdSelectedIndex) {
      it.scrollIntoView({ block: 'nearest' });
    }
  });
}

function setupCommandPalette() {
  const input = document.getElementById('commandPaletteInput');
  const backdrop = document.getElementById('commandPaletteBackdrop');
  if (backdrop) {
    backdrop.onclick = closeCommandPalette;
  }

  let filterDebounce;
  if (input) {
    input.oninput = () => {
      clearTimeout(filterDebounce);
      filterDebounce = setTimeout(() => {
        filterCommandPalette(input.value);
      }, 120);
    };

    input.onkeydown = e => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (currentCmdItems.length > 0) {
          cmdSelectedIndex = (cmdSelectedIndex + 1) % currentCmdItems.length;
          renderCommandPaletteSelection();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (currentCmdItems.length > 0) {
          cmdSelectedIndex = (cmdSelectedIndex - 1 + currentCmdItems.length) % currentCmdItems.length;
          renderCommandPaletteSelection();
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (currentCmdItems[cmdSelectedIndex]) {
          closeCommandPalette();
          currentCmdItems[cmdSelectedIndex].run();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeCommandPalette();
      }
    };
  }

  // Global listener for Cmd+K / Ctrl+K and Escape
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      const modal = document.getElementById('commandPaletteModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeCommandPalette();
      } else {
        openCommandPalette();
      }
    } else if (e.key === 'Escape') {
      const modal = document.getElementById('commandPaletteModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeCommandPalette();
      }
    }
  });
}

(async () => {
  setBoardEvents();
  setupCmsEvents();
  setupTabs();
  setupCommandPalette();
  await loadBoards();
  await loadBoard();
})();
