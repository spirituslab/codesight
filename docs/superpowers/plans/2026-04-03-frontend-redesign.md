# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the codesight web frontend from a monolithic vanilla JS app into Lit web components with a VS Code-style layout, Catppuccin Mocha theme, info-card graph nodes, and a right-side chat panel.

**Architecture:** Lit web components with a shared reactive store, Cytoscape.js for graph rendering, CSS custom properties for theming. No build step — Lit loaded via CDN (es module import map). Components communicate through the store and custom events.

**Tech Stack:** Lit 3.x (CDN), Cytoscape.js 3.30 (CDN), vanilla CSS custom properties

**Spec:** `docs/superpowers/specs/2026-04-03-frontend-redesign-design.md`

---

## File Map

### New files to create

```
web/
├── index.html                      # New shell (replaces old index.html)
├── src/
│   ├── store.js                    # Reactive state store (~80 lines)
│   ├── theme.js                    # Catppuccin Mocha CSS vars as shared styles (~60 lines)
│   ├── icons.js                    # SVG icon literals for activity bar (~40 lines)
│   ├── components/
│   │   ├── cs-app.js               # Root shell, layout grid (~120 lines)
│   │   ├── cs-activity-bar.js      # Left icon strip (~80 lines)
│   │   ├── cs-sidebar.js           # Left panel with tab switching (~60 lines)
│   │   ├── cs-breadcrumb.js        # Navigation path (~80 lines)
│   │   ├── cs-graph.js             # Cytoscape wrapper + node rendering (~250 lines)
│   │   ├── cs-chat.js              # Right secondary sidebar (~180 lines)
│   │   ├── cs-status-bar.js        # Bottom stats bar (~50 lines)
│   │   ├── cs-code-popup.js        # Source code modal (~80 lines)
│   │   └── cs-global-search.js     # Ctrl+K search modal (~120 lines)
│   ├── panels/
│   │   ├── cs-explorer.js          # Explorer sidebar content (~200 lines)
│   │   ├── cs-search-panel.js      # Sidebar search (~80 lines)
│   │   └── cs-tour-panel.js        # Tours sidebar content (~120 lines)
│   └── utils/
│       ├── colors.js               # Color palette + helpers (ported from utils.mjs)
│       └── helpers.js              # escHtml, escJs (ported from utils.mjs)
```

### Files to delete (after migration)

```
web/js/main.mjs
web/js/state.mjs
web/js/utils.mjs
web/js/cytoscape-setup.mjs
web/js/idea-layer.mjs
web/js/mapping-canvas.mjs
web/js/tour.mjs
web/js/search.mjs
web/js/chat.mjs
web/js/dom.mjs
```

### Files NOT changed

```
web/data.js              # Generated analysis output — untouched
serve.mjs                # Backend — untouched
src/**                   # Analysis engine — untouched
```

---

## Task 1: Bootstrap — Store, Theme, Utils

**Files:**
- Create: `web/src/store.js`
- Create: `web/src/theme.js`
- Create: `web/src/utils/colors.js`
- Create: `web/src/utils/helpers.js`

These are pure logic modules with no DOM — the foundation everything else builds on.

- [ ] **Step 1: Create the reactive store**

```js
// web/src/store.js
// Minimal reactive store — components subscribe to state changes via events

class Store extends EventTarget {
  constructor() {
    super();
    this._state = {
      DATA: null,
      currentLevel: 'modules',
      currentModule: null,
      currentSubdir: null,
      currentFile: null,
      sidebarTab: 'explorer',
      chatOpen: false,
      sidebarCollapsed: false,
      activeTour: null,
      activeTourStep: 0,
      activeIdeaNode: null,
    };
  }

  get state() {
    return this._state;
  }

  set(key, value) {
    if (this._state[key] === value) return;
    this._state[key] = value;
    this.dispatchEvent(new CustomEvent('state-changed', {
      detail: { key, value },
    }));
  }

  setBatch(updates) {
    let changed = false;
    for (const [key, value] of Object.entries(updates)) {
      if (this._state[key] !== value) {
        this._state[key] = value;
        changed = true;
      }
    }
    if (changed) {
      this.dispatchEvent(new CustomEvent('state-changed', {
        detail: { keys: Object.keys(updates) },
      }));
    }
  }
}

export const store = new Store();
```

- [ ] **Step 2: Create the theme module**

```js
// web/src/theme.js
// Catppuccin Mocha palette as a Lit CSSResult for sharing across components

import { css } from 'lit';

export const theme = css`
  :host {
    /* Catppuccin Mocha */
    --ctp-crust: #11111b;
    --ctp-mantle: #181825;
    --ctp-base: #1e1e2e;
    --ctp-surface0: #313244;
    --ctp-surface1: #45475a;
    --ctp-surface2: #585b70;
    --ctp-overlay0: #6c7086;
    --ctp-overlay1: #7f849c;
    --ctp-subtext0: #a6adc8;
    --ctp-text: #cdd6f4;
    --ctp-lavender: #b4befe;
    --ctp-blue: #89b4fa;
    --ctp-sapphire: #74c7ec;
    --ctp-sky: #89dceb;
    --ctp-teal: #94e2d5;
    --ctp-green: #a6e3a1;
    --ctp-yellow: #f9e2af;
    --ctp-peach: #fab387;
    --ctp-maroon: #eba0ac;
    --ctp-red: #f38ba8;
    --ctp-mauve: #cba6f7;
    --ctp-pink: #f5c2e7;
    --ctp-flamingo: #f2cdcd;
    --ctp-rosewater: #f5e0dc;

    /* Semantic aliases */
    --bg-primary: var(--ctp-base);
    --bg-secondary: var(--ctp-mantle);
    --bg-graph: var(--ctp-crust);
    --border: var(--ctp-surface0);
    --text-primary: var(--ctp-text);
    --text-secondary: var(--ctp-subtext0);
    --text-muted: var(--ctp-overlay0);
    --accent: var(--ctp-blue);
    --accent-secondary: var(--ctp-mauve);

    /* Typography */
    --font-sans: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    --font-size-xs: 9px;
    --font-size-sm: 11px;
    --font-size-base: 13px;
    --font-size-lg: 15px;

    /* Spacing */
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
    --radius-xl: 12px;
  }
`;
```

- [ ] **Step 3: Create color utilities**

```js
// web/src/utils/colors.js
// Module/symbol color palette — ported from web/js/utils.mjs

const COLOR_PALETTE = [
  '#89b4fa', '#cba6f7', '#a6e3a1', '#f9e2af', '#f38ba8',
  '#89dceb', '#a6e3a1', '#f5c2e7', '#fab387', '#94e2d5',
  '#b4befe', '#f5c2e7', '#74c7ec', '#b4befe', '#a6e3a1',
  '#fab387', '#89dceb', '#cba6f7', '#f9e2af', '#94e2d5',
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getColor(name) {
  return COLOR_PALETTE[hashStr(name) % COLOR_PALETTE.length];
}

export function getSymbolColor(kind) {
  const map = {
    function: '#89b4fa', method: '#89b4fa',
    class: '#cba6f7', struct: '#cba6f7',
    type: '#a6e3a1',
    interface: '#94e2d5', trait: '#94e2d5',
    const: '#f9e2af',
    enum: '#f38ba8',
    default: '#a6adc8',
  };
  return map[kind] || '#a6adc8';
}

export function shadeColor(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16) + amount;
  let g = parseInt(hex.slice(3, 5), 16) + amount;
  let b = parseInt(hex.slice(5, 7), 16) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function fadeColor(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
```

- [ ] **Step 4: Create HTML helpers**

```js
// web/src/utils/helpers.js
export function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escJs(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
```

- [ ] **Step 5: Commit**

```bash
git add web/src/store.js web/src/theme.js web/src/utils/colors.js web/src/utils/helpers.js
git commit -m "feat(web): add reactive store, Catppuccin theme, and utility modules"
```

---

## Task 2: App Shell — Layout + Activity Bar + Status Bar

**Files:**
- Create: `web/src/icons.js`
- Create: `web/src/components/cs-app.js`
- Create: `web/src/components/cs-activity-bar.js`
- Create: `web/src/components/cs-status-bar.js`
- Create: `web/index-new.html` (new shell, will replace `index.html` later)

This task produces a working page with the VS Code layout skeleton — activity bar, sidebar placeholder, graph placeholder, status bar. No functionality yet.

- [ ] **Step 1: Create SVG icons**

```js
// web/src/icons.js
import { svg } from 'lit';

export const icons = {
  explorer: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>`,
  search: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  tour: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  chat: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
  settings: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
};
```

- [ ] **Step 2: Create `<cs-activity-bar>`**

```js
// web/src/components/cs-activity-bar.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { icons } from '../icons.js';
import { store } from '../store.js';

export class CsActivityBar extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      flex-direction: column;
      width: 48px;
      background: var(--bg-secondary);
      border-right: 1px solid var(--border);
      padding: 8px 0;
      flex-shrink: 0;
    }
    .top { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .bottom { margin-top: auto; display: flex; flex-direction: column; align-items: center; gap: 4px; }
    button {
      width: 40px; height: 40px; border: none; background: none;
      border-radius: var(--radius-sm); cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      color: var(--text-muted); position: relative;
      transition: color 0.15s;
    }
    button:hover { color: var(--text-primary); }
    button.active {
      color: var(--text-primary);
    }
    button.active::before {
      content: ''; position: absolute; left: 0; top: 8px; bottom: 8px;
      width: 2px; background: var(--accent); border-radius: 0 2px 2px 0;
    }
  `];

  static properties = {
    activeTab: { type: String },
    chatOpen: { type: Boolean },
  };

  constructor() {
    super();
    this.activeTab = 'explorer';
    this.chatOpen = false;
    store.addEventListener('state-changed', (e) => {
      const { key, value } = e.detail;
      if (key === 'sidebarTab') this.activeTab = value;
      if (key === 'chatOpen') this.chatOpen = value;
    });
  }

  _setTab(tab) {
    if (store.state.sidebarTab === tab && !store.state.sidebarCollapsed) {
      store.set('sidebarCollapsed', true);
    } else {
      store.setBatch({ sidebarTab: tab, sidebarCollapsed: false });
    }
  }

  _toggleChat() {
    store.set('chatOpen', !store.state.chatOpen);
  }

  render() {
    return html`
      <div class="top">
        <button class=${this.activeTab === 'explorer' ? 'active' : ''} @click=${() => this._setTab('explorer')} title="Explorer">${icons.explorer}</button>
        <button class=${this.activeTab === 'search' ? 'active' : ''} @click=${() => this._setTab('search')} title="Search">${icons.search}</button>
        <button class=${this.activeTab === 'tours' ? 'active' : ''} @click=${() => this._setTab('tours')} title="Tours">${icons.tour}</button>
      </div>
      <div class="bottom">
        <button class=${this.chatOpen ? 'active' : ''} @click=${this._toggleChat} title="Chat (Ctrl+/)">${icons.chat}</button>
        <button title="Settings">${icons.settings}</button>
      </div>
    `;
  }
}
customElements.define('cs-activity-bar', CsActivityBar);
```

- [ ] **Step 3: Create `<cs-status-bar>`**

```js
// web/src/components/cs-status-bar.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsStatusBar extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      align-items: center;
      height: 24px;
      padding: 0 12px;
      background: var(--bg-secondary);
      border-top: 1px solid var(--border);
      font-size: var(--font-size-sm);
      color: var(--text-muted);
      gap: 16px;
      flex-shrink: 0;
    }
    .spacer { flex: 1; }
    kbd {
      background: var(--ctp-surface0);
      padding: 0 4px;
      border-radius: 2px;
      font-size: var(--font-size-xs);
      font-family: var(--font-mono);
    }
  `];

  static properties = {
    _data: { state: true },
  };

  constructor() {
    super();
    this._data = null;
    store.addEventListener('state-changed', (e) => {
      if (e.detail.key === 'DATA') this._data = store.state.DATA;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    this._data = store.state.DATA;
  }

  render() {
    if (!this._data) return html``;
    const moduleCount = this._data.modules?.length || 0;
    const fileCount = (this._data.rootFiles?.length || 0) +
      (this._data.modules || []).reduce((s, m) => s + m.fileCount, 0);
    const symbolCount = [...(this._data.rootFiles || []), ...(this._data.modules || []).flatMap(m => m.files)]
      .reduce((s, f) => s + (f.symbols?.length || 0), 0);

    return html`
      <span>${moduleCount} modules</span>
      <span>${fileCount} files</span>
      <span>${symbolCount} symbols</span>
      <span class="spacer"></span>
      <span><kbd>Ctrl+/</kbd> Chat</span>
      <span><kbd>Ctrl+K</kbd> Search</span>
      <span><kbd>Esc</kbd> Back</span>
    `;
  }
}
customElements.define('cs-status-bar', CsStatusBar);
```

- [ ] **Step 4: Create `<cs-app>` shell**

```js
// web/src/components/cs-app.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import './cs-activity-bar.js';
import './cs-status-bar.js';

export class CsApp extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-family: var(--font-sans);
      overflow: hidden;
    }
    .main {
      display: flex;
      flex: 1;
      overflow: hidden;
    }
    .sidebar {
      width: 280px;
      background: var(--bg-primary);
      border-right: 1px solid var(--border);
      overflow-y: auto;
      flex-shrink: 0;
      transition: width 0.2s ease;
    }
    .sidebar.collapsed { width: 0; overflow: hidden; border: none; }
    .sidebar::-webkit-scrollbar { width: 6px; }
    .sidebar::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 3px; }
    .graph-area {
      flex: 1;
      background: var(--bg-graph);
      position: relative;
      overflow: hidden;
    }
    .chat-panel {
      width: 320px;
      flex-shrink: 0;
      border-left: 1px solid var(--accent-secondary);
      transition: width 0.2s ease;
      overflow: hidden;
    }
    .chat-panel.closed { width: 0; border: none; }
  `];

  static properties = {
    _sidebarCollapsed: { state: true },
    _chatOpen: { state: true },
  };

  constructor() {
    super();
    this._sidebarCollapsed = false;
    this._chatOpen = false;
    store.addEventListener('state-changed', (e) => {
      const { key } = e.detail;
      if (key === 'sidebarCollapsed') this._sidebarCollapsed = store.state.sidebarCollapsed;
      if (key === 'chatOpen') this._chatOpen = store.state.chatOpen;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    // Load data
    store.set('DATA', window.CODEBASE_DATA);
    if (!window.CODEBASE_DATA) {
      this.renderRoot.innerHTML = '<div style="padding:40px;color:var(--ctp-red);">Error: data.js failed to load. Run <code>node analyze.mjs</code> first.</div>';
    }
    // Global keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        store.set('chatOpen', !store.state.chatOpen);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        store.set('sidebarCollapsed', !store.state.sidebarCollapsed);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('open-global-search', { bubbles: true, composed: true }));
      }
    });
  }

  render() {
    return html`
      <div class="main">
        <cs-activity-bar></cs-activity-bar>
        <div class="sidebar ${this._sidebarCollapsed ? 'collapsed' : ''}">
          <slot name="sidebar"></slot>
        </div>
        <div class="graph-area">
          <slot name="graph"></slot>
        </div>
        <div class="chat-panel ${this._chatOpen ? '' : 'closed'}">
          <slot name="chat"></slot>
        </div>
      </div>
      <cs-status-bar></cs-status-bar>
    `;
  }
}
customElements.define('cs-app', CsApp);
```

- [ ] **Step 5: Create the new `index.html` shell**

```html
<!-- web/index-new.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>codesight</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.30.4/cytoscape.min.js"></script>
<script src="data.js"></script>
<script type="importmap">
{
  "imports": {
    "lit": "https://esm.run/lit@3",
    "lit/": "https://esm.run/lit@3/",
    "@lit/reactive-element": "https://esm.run/@lit/reactive-element@2",
    "@lit/reactive-element/": "https://esm.run/@lit/reactive-element@2/",
    "lit-html": "https://esm.run/lit-html@3",
    "lit-html/": "https://esm.run/lit-html@3/",
    "lit-element/": "https://esm.run/lit-element@4/"
  }
}
</script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #1e1e2e; height: 100vh; overflow: hidden; }
</style>
</head>
<body>
<cs-app>
  <div slot="sidebar" id="sidebar-slot">
    <!-- Sidebar components will render here -->
  </div>
  <div slot="graph" id="graph-slot" style="width:100%;height:100%;position:relative;">
    <!-- Graph component will render here -->
  </div>
  <div slot="chat" id="chat-slot">
    <!-- Chat component will render here -->
  </div>
</cs-app>
<script type="module" src="src/components/cs-app.js"></script>
</body>
</html>
```

- [ ] **Step 6: Verify the shell loads**

Run: `cd /home/andywang/Documents/Projects/codesight && node serve.mjs`

Open browser, navigate to the page. Expected: VS Code-style layout skeleton visible — activity bar on left with icons, empty sidebar area, empty graph area, status bar at bottom showing module/file/symbol counts. Clicking activity bar icons should toggle sidebar tabs. Ctrl+B should collapse/expand sidebar. Ctrl+/ should toggle chat panel width.

- [ ] **Step 7: Commit**

```bash
git add web/src/icons.js web/src/components/cs-app.js web/src/components/cs-activity-bar.js web/src/components/cs-status-bar.js web/index-new.html
git commit -m "feat(web): VS Code layout shell with activity bar and status bar"
```

---

## Task 3: Breadcrumb + Graph Component (Cytoscape Integration)

**Files:**
- Create: `web/src/components/cs-breadcrumb.js`
- Create: `web/src/components/cs-graph.js`

The graph component wraps Cytoscape.js and handles all drill-down rendering. This is the largest and most critical component — it ports the rendering logic from `main.mjs` lines 149-571 (module view, subdir view, file view, symbol view).

- [ ] **Step 1: Create `<cs-breadcrumb>`**

```js
// web/src/components/cs-breadcrumb.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsBreadcrumb extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      font-size: var(--font-size-base);
      background: var(--bg-graph);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
      z-index: 5;
    }
    span {
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      transition: all 0.15s;
    }
    span:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
    span.active { color: var(--accent); cursor: default; }
    span.active:hover { background: none; }
    .sep { color: var(--ctp-surface2); cursor: default; padding: 0; }
    .sep:hover { background: none; }
  `];

  static properties = {
    _level: { state: true },
    _module: { state: true },
    _subdir: { state: true },
    _file: { state: true },
  };

  constructor() {
    super();
    this._update();
    store.addEventListener('state-changed', () => this._update());
  }

  _update() {
    this._level = store.state.currentLevel;
    this._module = store.state.currentModule;
    this._subdir = store.state.currentSubdir;
    this._file = store.state.currentFile;
  }

  _nav(level, module, subdir) {
    this.dispatchEvent(new CustomEvent('navigate', {
      detail: { level, module, subdir },
      bubbles: true, composed: true,
    }));
  }

  render() {
    const projName = store.state.DATA?.projectName || 'Project';
    const parts = [];

    if (this._level === 'modules') {
      parts.push(html`<span class="active">${projName}</span>`);
    } else {
      parts.push(html`<span @click=${() => this._nav('modules')}>${projName}</span>`);
      parts.push(html`<span class="sep">/</span>`);

      if (this._level === 'subdirs' && !this._subdir) {
        parts.push(html`<span class="active">${this._module}</span>`);
      } else {
        parts.push(html`<span @click=${() => this._nav('module', this._module)}>${this._module}</span>`);
      }

      if (this._subdir) {
        const subdirParts = this._subdir.split('/');
        for (let i = 0; i < subdirParts.length; i++) {
          parts.push(html`<span class="sep">/</span>`);
          const partialPath = subdirParts.slice(0, i + 1).join('/');
          const isLast = i === subdirParts.length - 1 && (this._level === 'subdirs' || this._level === 'files');
          if (isLast) {
            parts.push(html`<span class="active">${subdirParts[i]}</span>`);
          } else {
            parts.push(html`<span @click=${() => this._nav('subdir', this._module, partialPath)}>${subdirParts[i]}</span>`);
          }
        }
      }

      if (this._level === 'symbols' && this._file) {
        parts.push(html`<span class="sep">/</span>`);
        parts.push(html`<span class="active">${this._file.name}</span>`);
      }
    }

    return html`${parts}`;
  }
}
customElements.define('cs-breadcrumb', CsBreadcrumb);
```

- [ ] **Step 2: Create `<cs-graph>` — Cytoscape wrapper with all view rendering**

This is the largest component. It ports:
- `renderModuleView()` — module overview graph
- `renderSubdirView()` — subdirectory graph
- `drillToSubdir()` — file-level graph
- `buildSymbolGraph()` — symbol graph
- Cytoscape styles (from `cytoscape-setup.mjs`)
- Highlight/unhighlight logic
- Tooltip rendering
- Idea layer integration (from `idea-layer.mjs`)
- Mapping canvas (from `mapping-canvas.mjs`)
- Minimap (from `utils.mjs`)

**Due to the size of this component, it should be split into logical sections during implementation.** The core graph rendering with Cytoscape setup, styles, and module-level view should be implemented first. Then file-level and symbol-level views can be added incrementally. Refer to the current implementations in:
- `web/js/main.mjs:149-571` for all graph rendering functions
- `web/js/cytoscape-setup.mjs` for Cytoscape styles and event handlers
- `web/js/idea-layer.mjs` for idea layer setup and rendering
- `web/js/mapping-canvas.mjs` for the mapping canvas between idea and code layers
- `web/js/utils.mjs:60-98` for minimap rendering

The component should:
1. Create a Cytoscape instance in its shadow DOM container
2. Listen to store changes and re-render the appropriate view
3. Dispatch `navigate` events when nodes are clicked (handled by `<cs-app>`)
4. Use Catppuccin Mocha colors in all Cytoscape styles
5. Handle the idea layer and mapping canvas if `ideaStructure` exists in data

```js
// web/src/components/cs-graph.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import { getColor, getSymbolColor, shadeColor, fadeColor } from '../utils/colors.js';
import './cs-breadcrumb.js';

export class CsGraph extends LitElement {
  // Port all graph rendering from main.mjs, cytoscape-setup.mjs,
  // idea-layer.mjs, and mapping-canvas.mjs
  //
  // Key methods to port:
  //   _initCytoscape()        — from cytoscape-setup.mjs:initCyCode
  //   _renderModuleView()     — from main.mjs:renderModuleView
  //   _renderSubdirView()     — from main.mjs:renderSubdirView
  //   _renderFileView()       — from main.mjs:drillToSubdir
  //   _renderSymbolView()     — from main.mjs:buildSymbolGraph
  //   _highlightConnected()   — from cytoscape-setup.mjs:highlightConnected
  //   _initIdeaLayer()        — from idea-layer.mjs:initCyIdea
  //   _renderIdeaLayer()      — from idea-layer.mjs:renderIdeaLayer
  //   _drawMappingLines()     — from mapping-canvas.mjs:drawMappingLines
  //   _updateMinimap()        — from utils.mjs:updateMinimap
  //
  // The component listens to store.state.currentLevel changes
  // and calls the appropriate render method.
  //
  // See spec and current source files for complete implementation details.
  // Each view function should be ported 1:1 from the current code,
  // only changing:
  //   - Color values → Catppuccin Mocha vars
  //   - DOM queries → shadow DOM queries (this.renderRoot.querySelector)
  //   - Global state reads → store.state reads
  //   - onclick strings → event dispatches
}
customElements.define('cs-graph', CsGraph);
```

The full implementation of this component should be ~250 lines, porting the existing logic with Catppuccin colors. The implementer should reference the existing source files listed above and translate each function.

- [ ] **Step 3: Wire graph into the app shell**

Update `web/index-new.html` to include the graph component in the graph slot:

```html
<div slot="graph" id="graph-slot" style="width:100%;height:100%;position:relative;">
  <cs-graph></cs-graph>
</div>
```

And add the import:
```html
<script type="module">
  import './src/components/cs-app.js';
  import './src/components/cs-graph.js';
</script>
```

- [ ] **Step 4: Verify graph renders**

Run: `node analyze.mjs . && node serve.mjs`

Open browser. Expected: Module graph visible with Catppuccin-colored info-card nodes. Clicking a module should drill down to files. Escape should go back. Breadcrumb should update at each level. Minimap should show in bottom-left corner.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/cs-breadcrumb.js web/src/components/cs-graph.js
git commit -m "feat(web): graph component with Cytoscape, breadcrumb, and drill-down navigation"
```

---

## Task 4: Explorer Sidebar Panel

**Files:**
- Create: `web/src/panels/cs-explorer.js`
- Create: `web/src/components/cs-sidebar.js`

The explorer panel shows module details, file lists, key files, entry points, and stats — ported from `main.mjs` functions: `renderModuleSidebar`, `renderSubdirSidebar`, `renderFileListSidebar`, `renderSymbolSidebar`, `showExportDetail`, `showImportDetail`.

- [ ] **Step 1: Create `<cs-sidebar>` container with tab switching**

```js
// web/src/components/cs-sidebar.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsSidebar extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
    }
    .header {
      padding: 10px 14px;
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .content {
      flex: 1;
      overflow-y: auto;
      padding: 12px;
    }
    .content::-webkit-scrollbar { width: 6px; }
    .content::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 3px; }
  `];

  static properties = {
    _tab: { state: true },
  };

  constructor() {
    super();
    this._tab = 'explorer';
    store.addEventListener('state-changed', (e) => {
      if (e.detail.key === 'sidebarTab') this._tab = store.state.sidebarTab;
    });
  }

  _tabLabel() {
    return { explorer: 'Explorer', search: 'Search', tours: 'Tours' }[this._tab] || '';
  }

  render() {
    return html`
      <div class="header">${this._tabLabel()}</div>
      <div class="content">
        <slot name=${this._tab}></slot>
      </div>
    `;
  }
}
customElements.define('cs-sidebar', CsSidebar);
```

- [ ] **Step 2: Create `<cs-explorer>` panel**

This is a large panel that should port all sidebar rendering from `main.mjs`. The implementer should reference:
- `renderModuleSidebar()` — main.mjs:199-258
- `renderSubdirSidebar()` — main.mjs:359-396
- `renderFileListSidebar()` — main.mjs:468-494
- `renderSymbolSidebar()` — main.mjs:573-621
- `showExportDetail()` — main.mjs:623-673
- `showImportDetail()` — main.mjs:675-696

The component listens to `store.state.currentLevel` and renders the appropriate view. All `onclick` string handlers become `@click` event listeners. All color references use Catppuccin values.

```js
// web/src/panels/cs-explorer.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import { getColor, getSymbolColor } from '../utils/colors.js';
import { escHtml } from '../utils/helpers.js';

export class CsExplorer extends LitElement {
  // Port all sidebar rendering from main.mjs
  // Listen to store state changes, re-render appropriate view
  // Dispatch navigation events instead of calling global functions
  //
  // Key methods:
  //   _renderModuleOverview()  — port of renderModuleSidebar
  //   _renderSubdirView()     — port of renderSubdirSidebar
  //   _renderFileList()       — port of renderFileListSidebar
  //   _renderSymbolView()     — port of renderSymbolSidebar
  //   _renderExportDetail()   — port of showExportDetail
  //   _renderImportDetail()   — port of showImportDetail
}
customElements.define('cs-explorer', CsExplorer);
```

- [ ] **Step 3: Wire sidebar into app shell**

Update `index-new.html`:
```html
<div slot="sidebar">
  <cs-sidebar>
    <cs-explorer slot="explorer"></cs-explorer>
  </cs-sidebar>
</div>
```

- [ ] **Step 4: Verify sidebar renders**

Expected: Explorer panel shows module list with stats. Clicking a module in the graph updates the sidebar to show module details. Drilling to files shows file list. Drilling to symbols shows exported symbols and imports.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/cs-sidebar.js web/src/panels/cs-explorer.js
git commit -m "feat(web): explorer sidebar with module/file/symbol detail views"
```

---

## Task 5: Chat Right Sidebar

**Files:**
- Create: `web/src/components/cs-chat.js`

Port from `web/js/chat.mjs`. The chat becomes a right secondary sidebar instead of a floating overlay.

- [ ] **Step 1: Create `<cs-chat>` component**

```js
// web/src/components/cs-chat.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsChat extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-primary);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .title {
      font-size: var(--font-size-base);
      font-weight: 600;
      color: var(--accent-secondary);
    }
    .close-btn {
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; font-size: 18px; padding: 2px 6px;
      border-radius: var(--radius-sm); transition: all 0.15s;
    }
    .close-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
    .context {
      padding: 6px 14px;
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .messages {
      flex: 1; overflow-y: auto; padding: 12px 14px; min-height: 200px;
    }
    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 2px; }
    .msg { margin-bottom: 12px; font-size: var(--font-size-base); line-height: 1.6; }
    .msg.user { color: var(--text-primary); }
    .msg.user::before { content: "You: "; font-weight: 600; color: var(--accent); }
    .msg.assistant { color: var(--text-secondary); }
    .msg.assistant::before { content: "AI: "; font-weight: 600; color: var(--ctp-green); }
    .msg.error { color: var(--ctp-red); font-size: var(--font-size-sm); }
    .input-area {
      display: flex; gap: 8px; padding: 12px 14px;
      border-top: 1px solid var(--border);
    }
    textarea {
      flex: 1; padding: 8px 12px; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--bg-graph);
      color: var(--text-primary); font-size: var(--font-size-base);
      outline: none; resize: none; font-family: var(--font-sans);
      min-height: 36px; max-height: 80px;
    }
    textarea:focus { border-color: var(--accent); }
    textarea::placeholder { color: var(--text-muted); }
    button.send {
      padding: 8px 16px; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--ctp-surface0);
      color: var(--accent); font-size: var(--font-size-base);
      cursor: pointer; font-weight: 600; transition: all 0.15s;
      align-self: flex-end;
    }
    button.send:hover { background: var(--ctp-surface1); }
    button.send:disabled { opacity: 0.4; cursor: not-allowed; }
  `];

  static properties = {
    _messages: { state: true },
    _sending: { state: true },
    _context: { state: true },
  };

  constructor() {
    super();
    this._messages = [];
    this._sending = false;
    this._history = [];
    this._updateContext();
    store.addEventListener('state-changed', () => this._updateContext());
  }

  _updateContext() {
    const s = store.state;
    if (s.currentLevel === 'symbols' && s.currentFile) {
      this._context = `Viewing: ${s.currentFile.name}`;
    } else if (s.currentLevel === 'files' && s.currentModule) {
      this._context = `Viewing: ${s.currentModule} (files)`;
    } else if (s.currentModule) {
      this._context = `Viewing: ${s.currentModule}`;
    } else {
      this._context = 'Viewing: project overview';
    }
  }

  async _send() {
    if (this._sending) return;
    const textarea = this.renderRoot.querySelector('textarea');
    const message = textarea.value.trim();
    if (!message) return;

    textarea.value = '';
    textarea.style.height = 'auto';
    this._messages = [...this._messages, { role: 'user', text: message }];
    this._sending = true;

    const context = {
      currentLevel: store.state.currentLevel,
      currentModule: store.state.currentModule,
      currentFile: store.state.currentFile?.path || null,
    };

    const assistantMsg = { role: 'assistant', text: '' };
    this._messages = [...this._messages, assistantMsg];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history: this._history.slice(-10) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        assistantMsg.text = err.error || 'Failed to get response';
        assistantMsg.role = 'error';
        this._messages = [...this._messages];
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              assistantMsg.text += data.text;
              this._messages = [...this._messages];
              this._scrollToBottom();
            }
          } catch {}
        }
      }

      this._history.push({ role: 'user', content: message });
      this._history.push({ role: 'assistant', content: assistantMsg.text });
    } catch (err) {
      assistantMsg.text = 'Connection error: ' + err.message;
      assistantMsg.role = 'error';
      this._messages = [...this._messages];
    } finally {
      this._sending = false;
    }
  }

  _scrollToBottom() {
    const msgs = this.renderRoot.querySelector('.messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
  }

  _onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  _onInput(e) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }

  render() {
    return html`
      <div class="header">
        <span class="title">Chat</span>
        <button class="close-btn" @click=${() => store.set('chatOpen', false)}>&times;</button>
      </div>
      <div class="context">${this._context}</div>
      <div class="messages">
        ${this._messages.map(m => html`<div class="msg ${m.role}">${m.text}</div>`)}
      </div>
      <div class="input-area">
        <textarea placeholder="Ask about this code..." rows="1"
          @keydown=${this._onKeydown} @input=${this._onInput}></textarea>
        <button class="send" @click=${this._send} ?disabled=${this._sending}>Send</button>
      </div>
    `;
  }
}
customElements.define('cs-chat', CsChat);
```

- [ ] **Step 2: Wire chat into app shell**

Update `index-new.html`:
```html
<div slot="chat">
  <cs-chat></cs-chat>
</div>
```

- [ ] **Step 3: Verify chat works**

Expected: Ctrl+/ toggles right sidebar. Chat shows current navigation context. Sending a message streams the response (requires `serve.mjs` running with LLM configured). Close button dismisses the panel.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/cs-chat.js
git commit -m "feat(web): chat as right secondary sidebar with SSE streaming"
```

---

## Task 6: Search and Tours Panels

**Files:**
- Create: `web/src/panels/cs-search-panel.js`
- Create: `web/src/panels/cs-tour-panel.js`
- Create: `web/src/components/cs-global-search.js`

- [ ] **Step 1: Create `<cs-search-panel>` (sidebar search)**

Port from `web/js/search.mjs:20-31` (local inline search). This replaces the old `#search-box` in the topbar. It filters visible graph nodes by name.

```js
// web/src/panels/cs-search-panel.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsSearchPanel extends LitElement {
  static styles = [theme, css`
    :host { display: block; }
    input {
      width: 100%; padding: 8px 12px;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--bg-graph); color: var(--text-primary);
      font-size: var(--font-size-base); outline: none;
      margin-bottom: 12px;
    }
    input:focus { border-color: var(--accent); }
    input::placeholder { color: var(--text-muted); }
    .hint {
      font-size: var(--font-size-sm); color: var(--text-muted);
      margin-bottom: 8px;
    }
    .shortcut {
      margin-top: 12px; font-size: var(--font-size-sm); color: var(--text-muted);
    }
    kbd {
      background: var(--ctp-surface0); padding: 1px 5px;
      border-radius: 2px; font-size: var(--font-size-xs);
      font-family: var(--font-mono);
    }
  `];

  _onInput(e) {
    const query = e.target.value.toLowerCase().trim();
    this.dispatchEvent(new CustomEvent('filter-graph', {
      detail: { query },
      bubbles: true, composed: true,
    }));
  }

  render() {
    return html`
      <div class="hint">Filter visible nodes</div>
      <input type="text" placeholder="Type to filter..." @input=${this._onInput}>
      <div class="shortcut"><kbd>Ctrl+K</kbd> for full project search</div>
    `;
  }
}
customElements.define('cs-search-panel', CsSearchPanel);
```

- [ ] **Step 2: Create `<cs-global-search>` modal**

Port from `web/js/search.mjs:34-107` and `web/index.html:430-435`. The Ctrl+K global search overlay.

```js
// web/src/components/cs-global-search.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import { getColor, getSymbolColor } from '../utils/colors.js';
import { escHtml } from '../utils/helpers.js';

export class CsGlobalSearch extends LitElement {
  static styles = [theme, css`
    :host { display: none; position: fixed; inset: 0; z-index: 100; }
    :host(.open) { display: block; }
    .overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.6); backdrop-filter: blur(2px);
    }
    .panel {
      position: absolute; top: 60px; left: 50%; transform: translateX(-50%);
      width: 600px; max-height: 70vh; background: var(--bg-primary);
      border: 1px solid var(--border); border-radius: var(--radius-xl);
      overflow: hidden; box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    input {
      width: 100%; padding: 14px 20px; border: none;
      border-bottom: 1px solid var(--border);
      background: var(--bg-graph); color: var(--text-primary);
      font-size: var(--font-size-lg); outline: none;
    }
    input::placeholder { color: var(--text-muted); }
    .results {
      max-height: calc(70vh - 52px); overflow-y: auto; padding: 8px;
    }
    .results::-webkit-scrollbar { width: 6px; }
    .results::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 3px; }
    .section-title {
      font-size: var(--font-size-xs); text-transform: uppercase;
      letter-spacing: 1px; color: var(--text-muted); padding: 8px 12px 4px;
    }
    .result-item {
      padding: 8px 12px; border-radius: var(--radius-md); cursor: pointer;
      transition: background 0.1s; margin-bottom: 2px;
    }
    .result-item:hover { background: rgba(137,180,250,0.1); }
    .result-name { font-weight: 600; color: var(--text-primary); }
    .result-path { font-size: var(--font-size-sm); color: var(--text-muted); margin-top: 1px; }
    .kind-badge {
      font-size: var(--font-size-xs); display: inline-block;
      padding: 1px 5px; border-radius: 3px; margin-right: 6px;
    }
  `];

  // Port the search logic from search.mjs:34-91
  // Build allFilesFlat and allSymbolsFlat from store.state.DATA
  // Render matched files, symbols, and modules
  // Dispatch navigate events on result click

  open() {
    this.classList.add('open');
    this.updateComplete.then(() => {
      this.renderRoot.querySelector('input')?.focus();
    });
  }

  close() {
    this.classList.remove('open');
  }
}
customElements.define('cs-global-search', CsGlobalSearch);
```

- [ ] **Step 3: Create `<cs-tour-panel>`**

Port from `web/js/tour.mjs`. Tour list and step-by-step navigation.

```js
// web/src/panels/cs-tour-panel.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsTourPanel extends LitElement {
  static styles = [theme, css`
    :host { display: block; }
    .tour-card {
      padding: 8px 12px; border-radius: var(--radius-lg); cursor: pointer;
      border: 1px solid var(--border); margin-bottom: 6px;
      transition: all 0.15s;
    }
    .tour-card:hover { border-color: var(--accent); background: rgba(137,180,250,0.05); }
    .tour-title { font-weight: 600; font-size: var(--font-size-base); color: var(--text-primary); }
    .tour-meta { font-size: var(--font-size-sm); color: var(--text-muted); margin-top: 2px; }
    .no-tours { color: var(--text-muted); font-size: var(--font-size-base); }
    /* Active tour step styles */
    .step {
      padding: 10px 12px; border-left: 2px solid var(--border);
      margin-left: 8px; margin-bottom: 4px; cursor: pointer;
      transition: all 0.15s; border-radius: 0 var(--radius-md) var(--radius-md) 0;
    }
    .step:hover { background: rgba(137,180,250,0.05); }
    .step.active { border-left-color: var(--accent); background: rgba(137,180,250,0.08); }
    .step-num { font-size: var(--font-size-xs); color: var(--accent); font-weight: 600; }
    .step-sym { font-weight: 600; color: var(--text-primary); font-size: var(--font-size-base); }
    .step-file { font-size: var(--font-size-sm); color: var(--text-muted); }
    .step-explain { font-size: var(--font-size-sm); color: var(--text-secondary); margin-top: 3px; line-height: 1.5; }
    .nav { display: flex; gap: 8px; margin-top: 12px; }
    .nav button {
      flex: 1; padding: 8px; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--bg-graph);
      color: var(--accent); font-size: var(--font-size-sm); cursor: pointer;
      transition: all 0.15s;
    }
    .nav button:hover { background: var(--ctp-surface0); }
    .nav button:disabled { opacity: 0.3; cursor: not-allowed; }
    .exit-link {
      color: var(--text-muted); font-size: var(--font-size-sm);
      cursor: pointer; text-decoration: none;
    }
    .exit-link:hover { color: var(--text-primary); }
  `];

  // Port tour list and step navigation from tour.mjs
  // Listen to store.state.activeTour and store.state.activeTourStep
  // Dispatch navigate events for tour step navigation
}
customElements.define('cs-tour-panel', CsTourPanel);
```

- [ ] **Step 4: Wire all panels into sidebar and app**

Update `index-new.html`:
```html
<div slot="sidebar">
  <cs-sidebar>
    <cs-explorer slot="explorer"></cs-explorer>
    <cs-search-panel slot="search"></cs-search-panel>
    <cs-tour-panel slot="tours"></cs-tour-panel>
  </cs-sidebar>
</div>
```

Add `<cs-global-search>` at the top level of `<body>`.

- [ ] **Step 5: Verify search and tours work**

Expected: Switching to Search tab shows filter input. Typing filters graph nodes. Ctrl+K opens global search modal. Tours tab shows tour list. Clicking a tour starts step-by-step navigation.

- [ ] **Step 6: Commit**

```bash
git add web/src/panels/cs-search-panel.js web/src/panels/cs-tour-panel.js web/src/components/cs-global-search.js
git commit -m "feat(web): search panel, global search modal, and tour panel"
```

---

## Task 7: Code Popup Modal

**Files:**
- Create: `web/src/components/cs-code-popup.js`

Port from `main.mjs:699-718` and `index.html:420-428`.

- [ ] **Step 1: Create `<cs-code-popup>`**

```js
// web/src/components/cs-code-popup.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { escHtml } from '../utils/helpers.js';

export class CsCodePopup extends LitElement {
  static styles = [theme, css`
    :host { display: none; position: fixed; inset: 0; z-index: 100; }
    :host(.open) { display: block; }
    .overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);
    }
    .popup {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 720px; max-width: 90vw; max-height: 80vh;
      background: var(--bg-graph); border: 1px solid var(--border);
      border-radius: var(--radius-xl); overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 18px; background: var(--bg-primary);
      border-bottom: 1px solid var(--border);
    }
    .title { font-weight: 600; color: var(--text-primary); font-size: 14px; }
    .meta { font-size: var(--font-size-sm); color: var(--text-muted); }
    .close-btn {
      background: none; border: 1px solid var(--border);
      border-radius: var(--radius-md); color: var(--text-muted);
      padding: 3px 10px; cursor: pointer; font-size: 12px;
      transition: all 0.15s;
    }
    .close-btn:hover { color: var(--text-primary); border-color: var(--ctp-surface2); }
    .body {
      padding: 16px 0; max-height: calc(80vh - 52px); overflow-y: auto;
    }
    .body::-webkit-scrollbar { width: 8px; }
    .body::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 4px; }
    pre {
      margin: 0; padding: 0 18px;
      font-family: var(--font-mono);
      font-size: 12.5px; line-height: 1.6;
      color: var(--text-primary); white-space: pre; tab-size: 2;
    }
    .line-num {
      display: inline-block; width: 40px; text-align: right;
      padding-right: 16px; color: var(--ctp-surface2);
      user-select: none; font-size: var(--font-size-sm);
    }
  `];

  static properties = {
    symbol: { type: Object },
    filePath: { type: String },
  };

  open(sym, filePath) {
    this.symbol = sym;
    this.filePath = filePath;
    this.classList.add('open');
  }

  close() {
    this.classList.remove('open');
  }

  render() {
    if (!this.symbol?.source) return html``;
    const lines = this.symbol.source.split('\n');
    const startLine = this.symbol.line;

    return html`
      <div class="overlay" @click=${this.close}></div>
      <div class="popup">
        <div class="header">
          <div>
            <div class="title">${this.symbol.name}</div>
            <div class="meta">${this.filePath} : line ${startLine}${this.symbol.returnType ? ` → ${this.symbol.returnType}` : ''}</div>
          </div>
          <button class="close-btn" @click=${this.close}>Esc</button>
        </div>
        <div class="body">
          <pre>${lines.map((line, i) => html`<span class="line-num">${startLine + i}</span>${escHtml(line)}\n`)}</pre>
        </div>
      </div>
    `;
  }
}
customElements.define('cs-code-popup', CsCodePopup);
```

- [ ] **Step 2: Wire into app and test**

Add `<cs-code-popup>` to `index-new.html`. Explorer panel dispatches events to open it when "View source code" is clicked.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/cs-code-popup.js
git commit -m "feat(web): source code popup modal with line numbers"
```

---

## Task 8: Keyboard Navigation + Final Wiring

**Files:**
- Modify: `web/src/components/cs-app.js` — add Escape navigation logic
- Modify: `web/index-new.html` — finalize all imports and wiring

Port keyboard handler from `main.mjs:742-784`.

- [ ] **Step 1: Add Escape key navigation to `<cs-app>`**

Add to the keydown handler in `cs-app.js`:
- Escape: go back one level (same logic as main.mjs:743-778)
- Close code popup if open
- Close global search if open

- [ ] **Step 2: Wire all navigation events**

The `<cs-app>` component should listen for `navigate` events from breadcrumb and other components, and dispatch the appropriate state changes to the store + trigger graph re-rendering.

- [ ] **Step 3: Full integration test**

Run: `node analyze.mjs . && node serve.mjs`

Verify all features:
1. Module graph with Catppuccin colors and info-card nodes
2. Activity bar tab switching (Explorer, Search, Tours)
3. Sidebar collapsing with Ctrl+B
4. Graph drill-down: modules → subdirs → files → symbols
5. Breadcrumb navigation at every level
6. Escape to go back
7. Ctrl+K global search
8. Sidebar search filtering
9. Chat panel with Ctrl+/
10. Tours (if data has tours)
11. Code popup from symbol detail
12. Status bar showing counts

- [ ] **Step 4: Commit**

```bash
git add web/src/components/cs-app.js web/index-new.html
git commit -m "feat(web): keyboard navigation and final integration wiring"
```

---

## Task 9: Swap and Cleanup

**Files:**
- Rename: `web/index.html` → `web/index-legacy.html`
- Rename: `web/index-new.html` → `web/index.html`
- Delete: `web/js/` directory (after verifying new UI works)

- [ ] **Step 1: Swap index files**

```bash
mv web/index.html web/index-legacy.html
mv web/index-new.html web/index.html
```

- [ ] **Step 2: Full verification**

Run: `node analyze.mjs . && node serve.mjs`

Walk through every feature listed in the spec verification section:
1. Visual: Catppuccin Mocha colors, VS Code layout structure
2. Navigation: module → file → symbol drill-down, breadcrumb
3. Graph: info-card nodes, hover highlights
4. Sidebar tabs: Explorer, Search, Tours
5. Chat: open/close, send message
6. Keyboard: Ctrl+/, Ctrl+K, Ctrl+B, Escape, Enter
7. Responsiveness: resize window
8. Data compatibility: all data displays correctly

- [ ] **Step 3: Delete legacy files**

```bash
rm -rf web/js/
rm web/index-legacy.html
```

- [ ] **Step 4: Update .gitignore if needed**

Add `.superpowers/` to `.gitignore` if not already there.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): complete frontend redesign — Lit components, Catppuccin Mocha, VS Code layout"
```

---

## Verification Checklist

After all tasks are complete, run the full verification from the spec:

1. `node analyze.mjs . && node serve.mjs` — analyze codesight itself, open UI
2. Click through module → file → symbol drill-down
3. Verify Catppuccin Mocha colors throughout
4. Test all keyboard shortcuts
5. Switch between Explorer, Search, Tours tabs
6. Open and use chat (requires LLM configured)
7. Resize browser — sidebar should collapse at narrow widths
8. Check console for errors
