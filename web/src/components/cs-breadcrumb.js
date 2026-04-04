// Breadcrumb navigation — shows current drill-down path
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
    this._boundStoreHandler = this._update.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
    this._update();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
  }

  _update() {
    this._level = store.state.currentLevel;
    this._module = store.state.currentModule;
    this._subdir = store.state.currentSubdir;
    this._file = store.state.currentFile;
    this._activeGroup = store.state.activeGroup;
  }

  _nav(action, module, subdir) {
    this.dispatchEvent(new CustomEvent('navigate', {
      detail: { action, module, subdir },
      bubbles: true, composed: true,
    }));
  }

  render() {
    const projName = store.state.DATA?.projectName || 'Project';
    const parts = [];

    if (this._level === 'modules' && this._activeGroup) {
      // Inside a module group drill-down
      parts.push(html`<span @click=${() => this._nav('modules')}>${projName}</span>`);
      parts.push(html`<span class="sep">/</span>`);
      parts.push(html`<span class="active">${this._activeGroup.name}/</span>`);
    } else if (this._level === 'modules') {
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
