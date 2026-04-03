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
    ::slotted(*) { display: none; }
  `];

  static properties = { _tab: { state: true } };

  constructor() {
    super();
    this._tab = 'explorer';
    store.addEventListener('state-changed', (e) => {
      if (e.detail.key === 'sidebarTab') {
        this._tab = store.state.sidebarTab;
        this._showActiveSlot();
      }
    });
  }

  firstUpdated() { this._showActiveSlot(); }

  _showActiveSlot() {
    const slots = this.querySelectorAll('[slot]');
    slots.forEach(el => {
      el.style.display = el.slot === this._tab ? '' : 'none';
    });
  }

  _tabLabel() {
    return { explorer: 'Explorer', search: 'Search', tours: 'Tours' }[this._tab] || '';
  }

  render() {
    return html`
      <div class="header">${this._tabLabel()}</div>
      <div class="content"><slot name=${this._tab}></slot></div>
    `;
  }
}
customElements.define('cs-sidebar', CsSidebar);
