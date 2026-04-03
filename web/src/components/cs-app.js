import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

// Import all components so they register as custom elements
import './cs-activity-bar.js';
import './cs-status-bar.js';
import './cs-breadcrumb.js';
import './cs-graph.js';
import './cs-chat.js';
import './cs-sidebar.js';
import './cs-global-search.js';
import './cs-code-popup.js';
import '../panels/cs-explorer.js';
import '../panels/cs-search-panel.js';
import '../panels/cs-tour-panel.js';

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

  // ─── Element references ──────────────────────────────────────────
  get _graph() { return document.querySelector('cs-graph'); }
  get _globalSearch() { return document.querySelector('cs-global-search'); }
  get _codePopup() { return document.querySelector('cs-code-popup'); }

  // ─── Lifecycle ───────────────────────────────────────────────────
  connectedCallback() {
    super.connectedCallback();
    store.set('DATA', window.CODEBASE_DATA);
    if (!window.CODEBASE_DATA) {
      this.renderRoot.innerHTML = '<div style="padding:40px;color:var(--ctp-red);">Error: data.js failed to load. Run <code>node analyze.mjs</code> first.</div>';
    }
    this._bindKeyboard();
    this._bindNavigationEvents();
  }

  // ─── Keyboard shortcuts ──────────────────────────────────────────
  _bindKeyboard() {
    document.addEventListener('keydown', (e) => {
      // Ctrl+/ → toggle chat
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault();
        store.set('chatOpen', !store.state.chatOpen);
      }
      // Ctrl+B → toggle sidebar
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        store.set('sidebarCollapsed', !store.state.sidebarCollapsed);
      }
      // Ctrl+K → global search
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this._globalSearch?.open();
      }
      // Escape → layered dismissal / navigation back
      if (e.key === 'Escape') {
        this._handleEscape();
      }
    });
  }

  _handleEscape() {
    // Layer 1: close global search if open
    const gs = this._globalSearch;
    if (gs?.classList.contains('open')) {
      gs.close();
      return;
    }
    // Layer 2: close code popup if open
    const cp = this._codePopup;
    if (cp?.classList.contains('open')) {
      cp.close();
      return;
    }
    // Layer 3: close chat if open
    if (store.state.chatOpen) {
      store.set('chatOpen', false);
      return;
    }
    // Layer 4: navigate back one level in the graph
    this._goBack();
  }

  _goBack() {
    const s = store.state;
    if (s.currentLevel === 'symbols') {
      store.setBatch({ currentLevel: 'files', currentFile: null });
    } else if (s.currentLevel === 'files') {
      if (s.currentSubdir) {
        const parentPath = s.currentSubdir.includes('/')
          ? s.currentSubdir.substring(0, s.currentSubdir.lastIndexOf('/'))
          : null;
        store.setBatch({
          currentLevel: parentPath ? 'subdirs' : 'modules',
          currentSubdir: parentPath,
          currentModule: parentPath ? s.currentModule : null,
        });
      } else {
        store.setBatch({ currentLevel: 'modules', currentModule: null, currentSubdir: null });
      }
    } else if (s.currentLevel === 'subdirs') {
      if (s.currentSubdir) {
        const parentPath = s.currentSubdir.includes('/')
          ? s.currentSubdir.substring(0, s.currentSubdir.lastIndexOf('/'))
          : null;
        store.setBatch({
          currentLevel: parentPath ? 'subdirs' : 'modules',
          currentSubdir: parentPath,
          currentModule: parentPath ? s.currentModule : null,
        });
      } else {
        store.setBatch({ currentLevel: 'modules', currentModule: null, currentSubdir: null });
      }
    }
    // At modules level → do nothing
  }

  // ─── Event wiring ────────────────────────────────────────────────
  _bindNavigationEvents() {
    // Breadcrumb navigation
    document.addEventListener('navigate', (e) => {
      const { action, module, subdir } = e.detail;
      if (action === 'modules') {
        store.setBatch({ currentLevel: 'modules', currentModule: null, currentSubdir: null, currentFile: null });
      } else if (action === 'module') {
        store.setBatch({ currentLevel: 'files', currentModule: module, currentSubdir: null, currentFile: null });
      } else if (action === 'subdir') {
        store.setBatch({ currentLevel: 'subdirs', currentModule: module, currentSubdir: subdir, currentFile: null });
      }
    });

    // Navigate to module (from explorer, global search)
    document.addEventListener('navigate-to-module', (e) => {
      const name = e.detail.module || e.detail.name;
      store.setBatch({ currentLevel: 'files', currentModule: name, currentSubdir: null, currentFile: null });
    });

    // Navigate to file (from explorer, global search)
    document.addEventListener('navigate-to-file', (e) => {
      const filePath = e.detail.filePath || e.detail.path;
      if (filePath) {
        this._graph?.navigateToFile(filePath);
      }
    });

    // Navigate to subdir (from explorer)
    document.addEventListener('navigate-to-subdir', (e) => {
      const { module, subdir } = e.detail;
      store.setBatch({ currentLevel: 'subdirs', currentModule: module, currentSubdir: subdir, currentFile: null });
    });

    // Start tour (from explorer, tour panel)
    document.addEventListener('start-tour', (e) => {
      const { tourId } = e.detail;
      const DATA = store.state.DATA;
      const tour = DATA?.tours?.find(t => t.id === tourId);
      if (tour && tour.steps?.length > 0) {
        store.setBatch({ activeTour: tour, activeTourStep: 0 });
        // Navigate to the first step's file
        const firstStep = tour.steps[0];
        if (firstStep.file) {
          this._graph?.navigateToFile(firstStep.file);
        }
      }
    });

    // Navigate tour step (from tour panel)
    document.addEventListener('navigate-tour-step', (e) => {
      const { stepIndex } = e.detail;
      const tour = store.state.activeTour;
      if (tour && tour.steps?.[stepIndex]) {
        store.set('activeTourStep', stepIndex);
        const step = tour.steps[stepIndex];
        if (step.file) {
          this._graph?.navigateToFile(step.file);
        }
      }
    });

    // Exit tour (from tour panel)
    document.addEventListener('exit-tour', () => {
      store.setBatch({
        activeTour: null,
        activeTourStep: 0,
        currentLevel: 'modules',
        currentModule: null,
        currentSubdir: null,
        currentFile: null,
      });
    });

    // Show code popup (from explorer)
    document.addEventListener('show-code', (e) => {
      const { symbol, file } = e.detail;
      this._codePopup?.open(symbol, file);
    });

    // Filter graph nodes (from search panel)
    document.addEventListener('filter-graph', (e) => {
      const { query } = e.detail;
      const cy = this._graph?.cyCode;
      if (!cy) return;
      if (!query) {
        cy.elements().removeClass('dimmed').removeClass('search-match');
        return;
      }
      cy.elements().addClass('dimmed').removeClass('search-match');
      cy.elements().filter(ele => {
        const label = (ele.data('label') || '').toLowerCase();
        return label.includes(query);
      }).removeClass('dimmed').addClass('search-match');
    });

    // open-global-search (from Ctrl+K in other contexts)
    document.addEventListener('open-global-search', () => {
      this._globalSearch?.open();
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
