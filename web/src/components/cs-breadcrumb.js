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
      min-height: 36px;
      background: var(--bg-primary, #181825);
      border-bottom: 1px solid var(--border, #313244);
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      color: var(--text-muted, #a6adc8);
      font-size: 14px;
      transition: all 0.15s;
      flex-shrink: 0;
    }
    .back-btn:hover { color: var(--text-primary, #cdd6f4); background: rgba(255,255,255,0.08); }
    .back-btn.hidden { visibility: hidden; }
    span {
      color: var(--text-muted, #a6adc8);
      cursor: pointer;
      padding: 2px 6px;
      border-radius: var(--radius-sm);
      transition: all 0.15s;
    }
    span:hover { color: var(--text-primary, #cdd6f4); background: rgba(255,255,255,0.05); }
    span.active { color: var(--accent, #89b4fa); cursor: default; }
    span.active:hover { background: none; }
    .sep { color: var(--ctp-surface2, #585b70); cursor: default; padding: 0; }
    .sep:hover { background: none; }
  `];

  static properties = {
    _level: { state: true },
    _module: { state: true },
    _subdir: { state: true },
    _file: { state: true },
    _activeGroup: { state: true },
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

  _goBack() {
    if (this._level === 'symbols') {
      this._nav('module', this._module);
    } else if (this._level === 'files' || this._level === 'subdirs') {
      if (this._subdir) {
        const parentPath = this._subdir.includes('/')
          ? this._subdir.substring(0, this._subdir.lastIndexOf('/'))
          : null;
        if (parentPath) {
          this._nav('subdir', this._module, parentPath);
        } else {
          this._nav('module', this._module);
        }
      } else {
        this._nav('modules');
      }
    } else if (this._level === 'modules' && this._activeGroup) {
      this._nav('modules');
    }
  }

  render() {
    const projName = store.state.DATA?.projectName || 'Project';
    const parts = [];
    const canGoBack = this._level !== 'modules' || this._activeGroup;

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

    return html`
      <div class="back-btn ${canGoBack ? '' : 'hidden'}" @click=${() => this._goBack()} title="Go back">\u2190</div>
      ${parts}
    `;
  }
}
customElements.define('cs-breadcrumb', CsBreadcrumb);
