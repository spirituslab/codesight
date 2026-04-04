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
    this._boundStoreHandler = this._onStoreChanged.bind(this);
  }

  _onStoreChanged() {
    this.activeTab = store.state.sidebarTab;
    this.chatOpen = store.state.chatOpen;
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
    this._onStoreChanged();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
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
