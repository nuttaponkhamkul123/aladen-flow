/**
 * Safe, resilient, zero-dependency Markdown to HTML parser for Aladenflow Studio.
 * Sanitizes input and compiles Markdown blocks into clean semantic HTML.
 */

export function parseMarkdown(md: string | null | undefined): string {
  if (!md || !md.trim()) {
    return '';
  }

  // 1. Escape HTML special characters to prevent XSS
  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Extract code blocks first so their contents aren't modified by other regexes
  const codeBlocks: string[] = [];
  let processed = md.replace(/```([a-zA-Z0-9_-]*)\r?\n([\s\S]*?)```/g, (_, lang, code) => {
    const safeCode = escapeHtml(code.trimEnd());
    const langLabel = lang ? `<span class="md-code-lang">${escapeHtml(lang)}</span>` : '';
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
    codeBlocks.push(
      `<div class="md-code-wrapper">${langLabel}<pre class="md-code-block"><code>${safeCode}</code></pre></div>`
    );
    return placeholder;
  });

  // Extract inline code
  const inlineCodes: string[] = [];
  processed = processed.replace(/`([^`\n]+)`/g, (_, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // Lines processing
  const lines = processed.split(/\r?\n/);
  const output: string[] = [];

  let inList: 'ul' | 'ol' | null = null;
  let inBlockquote = false;
  let inTable = false;
  let tableHeaderParsed = false;

  const closeList = () => {
    if (inList) {
      output.push(inList === 'ul' ? '</ul>' : '</ol>');
      inList = null;
    }
  };

  const closeBlockquote = () => {
    if (inBlockquote) {
      output.push('</blockquote>');
      inBlockquote = false;
    }
  };

  const closeTable = () => {
    if (inTable) {
      output.push('</tbody></table></div>');
      inTable = false;
      tableHeaderParsed = false;
    }
  };

  const parseInline = (text: string): string => {
    let s = text;
    // Images: ![alt](url)
    s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (__, alt, url) => {
      const cleanUrl = url.trim().replace(/"/g, '&quot;');
      if (/^(https?:|\/|data:image)/i.test(cleanUrl)) {
        return `<img src="${cleanUrl}" alt="${escapeHtml(alt)}" class="md-img" />`;
      }
      return '';
    });

    // Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (__, textContent, url) => {
      const cleanUrl = url.trim().replace(/"/g, '&quot;');
      if (/^(https?:|\/|mailto:)/i.test(cleanUrl)) {
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${escapeHtml(textContent)}</a>`;
      }
      return escapeHtml(textContent);
    });

    // Bold + Italic: ***text***
    s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

    // Bold: **text** or __text__
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');

    // Strikethrough: ~~text~~
    s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

    return s;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Check code block placeholder
    if (trimmed.startsWith('__CODE_BLOCK_')) {
      closeList();
      closeBlockquote();
      closeTable();
      output.push(trimmed);
      continue;
    }

    // Blank line
    if (!trimmed) {
      closeList();
      closeBlockquote();
      closeTable();
      continue;
    }

    // Horizontal Rule: --- or ***
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      closeList();
      closeBlockquote();
      closeTable();
      output.push('<hr class="md-hr" />');
      continue;
    }

    // Headings: #, ##, ###, ####, #####, ######
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      closeBlockquote();
      closeTable();
      const level = headingMatch[1].length;
      const content = parseInline(escapeHtml(headingMatch[2]));
      output.push(`<h${level} class="md-heading md-h${level}">${content}</h${level}>`);
      continue;
    }

    // Blockquote: > text
    if (trimmed.startsWith('>')) {
      closeList();
      closeTable();
      if (!inBlockquote) {
        output.push('<blockquote class="md-blockquote">');
        inBlockquote = true;
      }
      const quoteText = parseInline(escapeHtml(trimmed.replace(/^>\s?/, '')));
      output.push(`<p>${quoteText}</p>`);
      continue;
    } else {
      closeBlockquote();
    }

    // Table row: | a | b |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      closeList();
      closeBlockquote();
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map(c => c.trim());

      // Check if it's separator line (e.g. |---|---|)
      const isSeparator = cells.every(c => /^:?-+:?$/.test(c));

      if (!inTable) {
        output.push('<div class="md-table-wrap"><table class="md-table"><thead><tr>');
        for (const c of cells) {
          output.push(`<th>${parseInline(escapeHtml(c))}</th>`);
        }
        output.push('</tr></thead><tbody>');
        inTable = true;
        tableHeaderParsed = true;
        continue;
      } else if (isSeparator) {
        continue;
      } else {
        output.push('<tr>');
        for (const c of cells) {
          output.push(`<td>${parseInline(escapeHtml(c))}</td>`);
        }
        output.push('</tr>');
        continue;
      }
    } else {
      closeTable();
    }

    // Task Checklist items: - [ ] or - [x]
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s+(.+)$/);
    if (taskMatch) {
      closeBlockquote();
      closeTable();
      if (inList !== 'ul') {
        closeList();
        output.push('<ul class="md-list md-task-list">');
        inList = 'ul';
      }
      const isChecked = taskMatch[1].toLowerCase() === 'x';
      const itemContent = parseInline(escapeHtml(taskMatch[2]));
      output.push(
        `<li class="md-task-item ${isChecked ? 'completed' : ''}">` +
        `<input type="checkbox" disabled ${isChecked ? 'checked' : ''} class="md-task-checkbox" />` +
        `<span class="md-task-text">${itemContent}</span></li>`
      );
      continue;
    }

    // Unordered List: - item or * item
    const ulMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      closeBlockquote();
      closeTable();
      if (inList !== 'ul') {
        closeList();
        output.push('<ul class="md-list">');
        inList = 'ul';
      }
      output.push(`<li>${parseInline(escapeHtml(ulMatch[1]))}</li>`);
      continue;
    }

    // Ordered List: 1. item
    const olMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
    if (olMatch) {
      closeBlockquote();
      closeTable();
      if (inList !== 'ol') {
        closeList();
        output.push('<ol class="md-list md-ordered-list">');
        inList = 'ol';
      }
      output.push(`<li>${parseInline(escapeHtml(olMatch[2]))}</li>`);
      continue;
    }

    // Regular paragraph
    closeList();
    closeBlockquote();
    closeTable();
    output.push(`<p class="md-p">${parseInline(escapeHtml(trimmed))}</p>`);
  }

  closeList();
  closeBlockquote();
  closeTable();

  let result = output.join('\n');

  // Restore inline codes
  for (let i = 0; i < inlineCodes.length; i++) {
    result = result.replace(`__INLINE_CODE_${i}__`, inlineCodes[i]);
  }

  // Restore code blocks
  for (let i = 0; i < codeBlocks.length; i++) {
    result = result.replace(`__CODE_BLOCK_${i}__`, codeBlocks[i]);
  }

  return result;
}

export interface MarkdownBlock {
  id: string;
  type: 'text' | 'h1' | 'h2' | 'h3' | 'todo' | 'bullet' | 'quote' | 'code' | 'callout' | 'divider';
  text: string;
  checked?: boolean;
  lang?: string;
  level?: number;
  parentId?: string | null;
  collapsed?: boolean;
}

let blockCounter = 0;
export function generateBlockId(): string {
  blockCounter++;
  return `block_${Date.now()}_${blockCounter}`;
}

export function markdownToBlocks(md: string | null | undefined): MarkdownBlock[] {
  if (!md || !md.trim()) {
    return [{ id: generateBlockId(), type: 'text', text: '', level: 0, parentId: null }];
  }

  const lines = md.split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  const parentStack: { [level: number]: string } = {};
  let i = 0;

  const pushBlock = (block: MarkdownBlock) => {
    block.level = Math.max(0, Math.min(block.level || 0, 4));
    block.parentId = block.level > 0 ? (parentStack[block.level - 1] || null) : null;
    parentStack[block.level] = block.id;
    for (let l = block.level + 1; l <= 6; l++) {
      delete parentStack[l];
    }
    blocks.push(block);
  };

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    // Calculate indentation level (2 spaces or 1 tab = 1 level)
    const indentMatch = raw.match(/^([ \t]+)/);
    let level = 0;
    if (indentMatch) {
      const whitespace = indentMatch[1];
      const spaceCount = whitespace.replace(/\t/g, '  ').length;
      level = Math.min(Math.floor(spaceCount / 2), 4);
    }

    // Code blocks
    if (trimmed.startsWith('```')) {
      const lang = trimmed.slice(3).trim() || 'ts';
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      pushBlock({
        id: generateBlockId(),
        type: 'code',
        text: codeLines.join('\n'),
        lang,
        level
      });
      i++;
      continue;
    }

    // Callout note: > [!NOTE] or > [!TIP] or > [!IMPORTANT]
    const calloutMatch = trimmed.match(/^>\s*\[!(NOTE|TIP|IMPORTANT)\]\s*(.*)$/i);
    if (calloutMatch) {
      const noteLines: string[] = [];
      if (calloutMatch[2]) {
        noteLines.push(calloutMatch[2]);
      }
      i++;
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        noteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      pushBlock({
        id: generateBlockId(),
        type: 'callout',
        text: noteLines.join('\n'),
        level
      });
      continue;
    }

    // Quote: > text
    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = [trimmed.replace(/^>\s?/, '')];
      i++;
      while (i < lines.length && lines[i].trim().startsWith('>') && !lines[i].trim().startsWith('> [!')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      pushBlock({
        id: generateBlockId(),
        type: 'quote',
        text: quoteLines.join('\n'),
        level
      });
      continue;
    }

    // Horizontal Rule / Divider
    if (/^(\-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      pushBlock({ id: generateBlockId(), type: 'divider', text: '', level });
      i++;
      continue;
    }

    // Headings
    if (trimmed.startsWith('# ')) {
      pushBlock({ id: generateBlockId(), type: 'h1', text: trimmed.slice(2), level });
      i++;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      pushBlock({ id: generateBlockId(), type: 'h2', text: trimmed.slice(3), level });
      i++;
      continue;
    }
    if (trimmed.startsWith('### ')) {
      pushBlock({ id: generateBlockId(), type: 'h3', text: trimmed.slice(4), level });
      i++;
      continue;
    }

    // Task Checklist
    const taskMatch = trimmed.match(/^[-*]\s+\[([ xX])\]\s*(.*)$/);
    if (taskMatch) {
      pushBlock({
        id: generateBlockId(),
        type: 'todo',
        checked: taskMatch[1].toLowerCase() === 'x',
        text: taskMatch[2],
        level
      });
      i++;
      continue;
    }

    // Bullet List
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ') || trimmed.startsWith('•')) {
      const cleanText = trimmed.replace(/^([-*•])\s*/, '');
      pushBlock({ id: generateBlockId(), type: 'bullet', text: cleanText, level });
      i++;
      continue;
    }

    // Empty line: skip if multiple, or ignore
    if (!trimmed) {
      i++;
      continue;
    }

    // Plain text block
    pushBlock({ id: generateBlockId(), type: 'text', text: trimmed, level });
    i++;
  }

  if (blocks.length === 0) {
    blocks.push({ id: generateBlockId(), type: 'text', text: '', level: 0, parentId: null });
  }

  return blocks;
}

export function blocksToMarkdown(blocks: MarkdownBlock[]): string {
  if (!blocks || blocks.length === 0) return '';
  let result = '';
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let serialized = '';
    switch (b.type) {
      case 'h1': serialized = `# ${b.text || ''}`; break;
      case 'h2': serialized = `## ${b.text || ''}`; break;
      case 'h3': serialized = `### ${b.text || ''}`; break;
      case 'todo': serialized = `- [${b.checked ? 'x' : ' '}] ${b.text || ''}`; break;
      case 'bullet': serialized = `- ${b.text || ''}`; break;
      case 'quote': serialized = (b.text || '').split('\n').map(l => `> ${l}`).join('\n'); break;
      case 'callout': serialized = `> [!NOTE]\n${(b.text || '').split('\n').map(l => `> ${l}`).join('\n')}`; break;
      case 'code': serialized = `\`\`\`${b.lang || 'ts'}\n${b.text || ''}\n\`\`\``; break;
      case 'divider': serialized = `---`; break;
      case 'text':
      default:
        serialized = b.text || '';
        break;
    }

    const indentStr = '  '.repeat(b.level || 0);
    if (indentStr) {
      serialized = serialized
        .split('\n')
        .map(line => line.trim() ? indentStr + line : line)
        .join('\n');
    }

    if (i === 0) {
      result = serialized;
    } else {
      const prev = blocks[i - 1];
      const isCompactList = (prev.type === 'todo' && b.type === 'todo') ||
                            (prev.type === 'bullet' && b.type === 'bullet');
      result += (isCompactList ? '\n' : '\n\n') + serialized;
    }
  }
  return result;
}

export function parseInlineMarkdown(text: string | null | undefined): string {
  if (!text) return '';

  const escapeHtml = (str: string): string => {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  };

  // Protect inline code
  const inlineCodes: string[] = [];
  let s = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const placeholder = `__INLINE_CODE_${inlineCodes.length}__`;
    inlineCodes.push(`<code class="md-inline-code">${escapeHtml(code)}</code>`);
    return placeholder;
  });

  // Escape normal text
  s = escapeHtml(s);

  // Numbered list prefix: e.g. "1. " or "2. "
  s = s.replace(/^(\d+)\.\s+/, '<strong class="md-num-prefix">$1.</strong> ');

  // Links: [text](url)
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (__, textContent, url) => {
    const cleanUrl = url.trim().replace(/"/g, '&quot;');
    if (/^(https?:|\/|mailto:)/i.test(cleanUrl)) {
      return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="md-link">${textContent}</a>`;
    }
    return textContent;
  });

  // Bold + Italic: ***text***
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');

  // Bold: **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic: *text* or _text_
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');

  // Strikethrough: ~~text~~
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Restore inline codes
  inlineCodes.forEach((codeHtml, idx) => {
    s = s.replace(`__INLINE_CODE_${idx}__`, codeHtml);
  });

  return s;
}
