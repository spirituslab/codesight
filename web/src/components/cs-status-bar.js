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
    this._boundStoreHandler = this._onStoreChanged.bind(this);
  }

  _onStoreChanged() {
    if (store.state.DATA !== this._data) this._data = store.state.DATA;
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
    this._data = store.state.DATA;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
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
