# Kanban App

A feature-rich Kanban board app with SQLite storage. Built with Node.js + Express + better-sqlite3 on the backend, and a vanilla JS drag-and-drop frontend.

## Features

- **Boards tab**
  - Multiple boards
  - Columns with inline rename, add, and delete
  - Cards with title, description, due date, priority (low/medium/high/urgent)
  - Labels per board with color picker
  - Per-card checklists with progress indicator
  - Drag & drop cards between columns and reorder
  - Drag & drop to reorder columns
  - Search across all cards
  - Activity log (per card and per board)
  - Card archiving
  - Dark / light theme toggle
- **CMS tab** (drag-and-drop website builder)
  - Block-based editor: Heading, Paragraph, Button, Image, Divider, Spacer
  - Drag blocks from the palette onto the canvas
  - Drag blocks on the canvas to reorder; click to select
  - Right-side properties panel for the selected block (level, text, URL, color, height, etc.)
  - Per-block toolbar with drag handle, move up/down, delete
  - Page meta: title, auto-slug, status (draft / published), comma-separated tags
  - Sidebar: search, status filter, tag chips, page list
  - Live "Preview" button (opens the published standalone page)
  - Standalone published pages at `/p/:slug` (server-rendered HTML)
  - Ctrl/Cmd+S to save
- Auto-seeded sample board + 3 sample pages on first run

## Setup

```bash
npm install
npm start
```

Then open http://localhost:3000

## Data

All data is persisted in `data/kanban.db` (SQLite). Delete the file to reset, or remove `data/` for a fresh install.

## Project layout

- `server.js` - Express REST API
- `db.js` - SQLite schema and seed
- `public/index.html` - App shell
- `public/style.css` - Styles (dark + light theme via CSS vars)
- `public/app.js` - SPA logic, drag & drop, modal
