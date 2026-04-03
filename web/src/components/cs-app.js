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
    store.set('DATA', window.CODEBASE_DATA);
    if (!window.CODEBASE_DATA) {
      this.renderRoot.innerHTML = '<div style="padding:40px;color:var(--ctp-red);">Error: data.js failed to load. Run <code>node analyze.mjs</code> first.</div>';
    }
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
