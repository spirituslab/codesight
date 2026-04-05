// web/src/panels/cs-explorer.js
import { LitElement, html, css, nothing } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import { getColor, getSymbolColor } from '../utils/colors.js';
import { escHtml } from '../utils/helpers.js';
import { icons } from '../icons.js';

export class CsExplorer extends LitElement {
  static styles = [theme, css`
    :host {
      display: block;
      font-family: var(--font-sans);
      color: var(--text-primary);
      font-size: var(--font-size-base);
    }

    h2 {
      margin: 0 0 4px;
      font-size: var(--font-size-lg);
      font-weight: 600;
      color: var(--text-primary);
    }
    .subtitle {
      font-size: var(--font-size-sm);
      color: var(--text-muted);
      margin-bottom: 8px;
      word-break: break-all;
    }
    .desc {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin-bottom: 12px;
      line-height: 1.5;
    }

    /* Stats row */
    .stats {
      display: flex;
      gap: 12px;
      margin-bottom: 14px;
      padding: 8px 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .stat { text-align: center; flex: 1; }
    .stat .val {
      font-size: var(--font-size-lg);
      font-weight: 700;
      color: var(--accent);
    }
    .stat .label {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    /* Section headings */
    .section-title {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      margin: 14px 0 6px;
      font-weight: 600;
    }

    /* List items */
    .file-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .file-list li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: var(--font-size-sm);
      transition: background 0.15s;
    }
    .file-list li:hover { background: var(--ctp-surface0); }
    .lines {
      font-size: 10px;
      color: var(--text-muted);
      white-space: nowrap;
      margin-left: 8px;
    }

    /* File/folder icons */
    .icon-folder, .icon-file {
      display: inline-flex;
      align-items: center;
      margin-right: 5px;
      vertical-align: middle;
      color: var(--text-muted);
    }
    .icon-folder { color: var(--ctp-peach, #fab387); }
    .icon-file { color: var(--ctp-blue, #89b4fa); }

    /* Color dot */
    .dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      margin-right: 6px;
      vertical-align: middle;
    }

    /* Badges */
    .badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      text-transform: uppercase;
      vertical-align: middle;
    }
    .badge-entry { background: var(--ctp-green); color: var(--ctp-crust); }
    .badge-imports { background: var(--ctp-surface1); color: var(--ctp-text); }
    .lang-badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 4px;
      border-radius: 3px;
      background: var(--ctp-surface1);
      color: var(--text-secondary);
      margin-left: 6px;
      vertical-align: middle;
    }
    .ai-badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      background: var(--ctp-mauve);
      color: var(--ctp-crust);
      font-weight: 600;
      vertical-align: middle;
    }

    /* Key file items */
    .key-file-item {
      padding: 6px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: var(--font-size-sm);
      transition: background 0.15s;
    }
    .key-file-item:hover { background: var(--ctp-surface0); }
    .key-file-item span:last-child {
      display: block;
      color: var(--text-muted);
      font-size: 11px;
    }

    /* Tour cards */
    .tour-card {
      padding: 10px 12px;
      background: var(--ctp-surface0);
      border-radius: var(--radius-md);
      cursor: pointer;
      margin-bottom: 6px;
      transition: background 0.15s;
    }
    .tour-card:hover { background: var(--ctp-surface1); }
    .tour-title { font-weight: 600; font-size: var(--font-size-sm); }
    .tour-meta { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    /* Connection items */
    .connection-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      font-size: var(--font-size-sm);
    }
    .weight {
      font-size: 10px;
      color: var(--text-muted);
    }

    /* AI explanation */
    .ai-explanation {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin-bottom: 12px;
      line-height: 1.5;
      padding: 8px;
      background: var(--ctp-surface0);
      border-radius: var(--radius-sm);
    }

    /* Symbol kind badges */
    .kind {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      margin-right: 4px;
      vertical-align: middle;
      color: var(--ctp-crust);
    }
    .kind-function, .kind-method { background: var(--ctp-blue); }
    .kind-class, .kind-struct { background: var(--ctp-mauve); }
    .kind-type { background: var(--ctp-green); }
    .kind-interface, .kind-trait { background: var(--ctp-teal); }
    .kind-const { background: var(--ctp-yellow); }
    .kind-enum { background: var(--ctp-red); }

    /* Export / import lists */
    .export-list, .import-list, .call-list, .param-list, .used-by-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .export-item, .import-item {
      padding: 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      transition: background 0.15s;
      margin-bottom: 2px;
    }
    .export-item:hover, .import-item:hover { background: var(--ctp-surface0); }
    .sig-preview {
      font-size: 10px;
      font-family: var(--font-mono);
      color: var(--text-muted);
      margin-top: 2px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .comment-preview {
      font-size: 10px;
      color: var(--ctp-overlay1);
      margin-top: 2px;
    }

    /* Risk badges */
    .risk-badge {
      display: inline-block;
      font-size: 8px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 700;
      text-transform: uppercase;
      vertical-align: middle;
    }
    .risk-low { background: var(--ctp-green); color: var(--ctp-crust); }
    .risk-medium { background: var(--ctp-yellow); color: var(--ctp-crust); }
    .risk-high { background: var(--ctp-red); color: var(--ctp-crust); }

    .type-tag {
      font-size: 9px;
      color: var(--ctp-teal);
      margin-left: 4px;
      font-style: italic;
    }

    /* Code block */
    .code-block {
      font-family: var(--font-mono);
      font-size: 11px;
      background: var(--ctp-crust);
      padding: 10px;
      border-radius: var(--radius-sm);
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--text-primary);
      margin: 4px 0 12px;
    }

    /* Call list */
    .call-list li {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 8px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      font-size: var(--font-size-sm);
      transition: background 0.15s;
    }
    .call-list li:hover { background: var(--ctp-surface0); }
    .call-dir {
      font-size: 11px;
      margin-right: 4px;
      color: var(--text-muted);
    }

    /* Param list */
    .param-list li {
      padding: 4px 8px;
      font-size: var(--font-size-sm);
    }
    .param-name {
      font-family: var(--font-mono);
      color: var(--ctp-peach);
      margin-right: 6px;
    }
    .param-type {
      font-family: var(--font-mono);
      color: var(--ctp-teal);
      font-size: 11px;
    }

    /* Used-by list */
    .used-by-list li {
      padding: 4px 8px;
      font-size: var(--font-size-sm);
      cursor: pointer;
      border-radius: var(--radius-sm);
      transition: background 0.15s;
      word-break: break-all;
    }
    .used-by-list li:hover { background: var(--ctp-surface0); }

    /* Back link */
    .back-link {
      color: var(--ctp-sapphire);
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
      margin-top: 16px;
    }
    .back-link:hover { text-decoration: underline; }

    .source-link {
      color: var(--ctp-sapphire);
      font-size: 12px;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-top: 12px;
    }
    .source-link:hover { text-decoration: underline; }
    .source-link kbd {
      font-size: 10px;
      font-family: var(--font-mono);
    }
  `];

  static properties = {
    _level: { state: true },
    _data: { state: true },
    _module: { state: true },
    _subdir: { state: true },
    _file: { state: true },
    _selectedSymbol: { state: true },
    _selectedImport: { state: true },
  };

  constructor() {
    super();
    this._level = 'modules';
    this._data = null;
    this._module = null;
    this._subdir = null;
    this._file = null;
    this._selectedSymbol = null;
    this._selectedImport = null;

    this._boundStoreHandler = this._onStoreChanged.bind(this);
  }

  _onStoreChanged() {
    const s = store.state;
    this._data = s.DATA;
    this._level = s.currentLevel;
    this._module = s.currentModule;
    this._subdir = s.currentSubdir;
    if (s.currentFile !== this._file) {
      this._file = s.currentFile;
      this._selectedSymbol = null;
      this._selectedImport = null;
    }
    // Sync symbol selection from graph clicks
    if (s.selectedSymbol !== undefined && s.selectedSymbol !== null && s.selectedSymbol !== this._selectedSymbol) {
      this._selectedSymbol = s.selectedSymbol;
      this._selectedImport = null;
    }
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
    const s = store.state;
    this._data = s.DATA;
    this._level = s.currentLevel;
    this._module = s.currentModule;
    this._subdir = s.currentSubdir;
    this._file = s.currentFile;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
  }

  // ---- Helpers ----

  _getAllModules() {
    if (!this._data) return [];
    const mods = [...this._data.modules];
    if (this._data.rootFiles?.length > 0) {
      mods.push({
        name: 'root',
        path: '',
        description: `${this._data.rootFiles.length} files in project root`,
        fileCount: this._data.rootFiles.length,
        lineCount: this._data.rootFiles.reduce((s, f) => s + f.lineCount, 0),
        files: this._data.rootFiles,
      });
    }
    return mods;
  }

  _getAllFilesFlat() {
    const mods = this._getAllModules();
    const files = [];
    for (const m of mods) {
      for (const f of m.files) files.push(f);
    }
    return files;
  }

  _getModuleData(name) {
    if (!this._data) return null;
    if (name === 'root') {
      return {
        name: 'root',
        path: '',
        files: this._data.rootFiles || [],
        fileCount: this._data.rootFiles?.length || 0,
        lineCount: (this._data.rootFiles || []).reduce((s, f) => s + f.lineCount, 0),
      };
    }
    return this._data.modules.find(m => m.name === name) || null;
  }

  _getModuleConnections(moduleName) {
    if (!this._data?.edges) return [];
    const connections = [];
    for (const e of this._data.edges) {
      if (e.source === moduleName) connections.push({ module: e.target, weight: e.weight, direction: 'imports' });
      else if (e.target === moduleName) connections.push({ module: e.source, weight: e.weight, direction: 'imported by' });
    }
    return connections.sort((a, b) => b.weight - a.weight);
  }

  _getSubdirFiles() {
    const mod = this._getModuleData(this._module);
    if (!mod) return [];
    // Simplified: return all files in the module filtered by subdir
    if (!this._subdir) return mod.files;
    const prefix = this._subdir + '/';
    return mod.files.filter(f => {
      const rel = f.path.startsWith(mod.path + '/') ? f.path.slice(mod.path.length + 1) : f.path;
      return rel.startsWith(prefix);
    });
  }

  // ---- Event dispatchers ----

  _dispatchNav(eventName, detail) {
    this.dispatchEvent(new CustomEvent(eventName, { detail, bubbles: true, composed: true }));
  }

  _onModuleClick(modName) {
    this._selectedSymbol = null;
    this._selectedImport = null;
    this._dispatchNav('navigate-to-module', { module: modName });
  }

  _onSubdirClick(modName, subdir) {
    this._selectedSymbol = null;
    this._selectedImport = null;
    this._dispatchNav('navigate-to-subdir', { module: modName, subdir });
  }

  _onFileClick(filePath) {
    this._selectedSymbol = null;
    this._selectedImport = null;
    this._dispatchNav('navigate-to-file', { filePath });
  }

  _onTourClick(tourId) {
    this._dispatchNav('start-tour', { tourId });
  }

  _onExportClick(sym) {
    this._selectedImport = null;
    this._selectedSymbol = sym;
    store.set('selectedSymbol', sym);
  }

  _onImportClick(imp) {
    this._selectedSymbol = null;
    this._selectedImport = imp;
  }

  _backToFileOverview() {
    this._selectedSymbol = null;
    this._selectedImport = null;
    store.set('selectedSymbol', null);
  }

  _onShowCode(sym, file) {
    this._dispatchNav('show-code', { symbol: sym, file });
  }

  // ---- Render ----

  render() {
    if (!this._data) return html`<div class="desc">Loading...</div>`;

    // Detail views take priority when in symbol level
    if (this._level === 'symbols' && this._selectedSymbol) {
      return this._renderExportDetail();
    }
    if (this._level === 'symbols' && this._selectedImport) {
      return this._renderImportDetail();
    }

    switch (this._level) {
      case 'modules': return this._renderModuleOverview();
      case 'subdirs': return this._renderSubdirView();
      case 'files': return this._renderSubdirView();
      case 'symbols': return this._renderSymbolView();
      default: return html`<div class="desc">Unknown view</div>`;
    }
  }

  // ---- 1. Module overview ----

  _renderModuleOverview() {
    const allModules = this._getAllModules();
    const allFiles = this._getAllFilesFlat();
    const total = allModules.reduce((s, m) => s + m.lineCount, 0);
    const totalFiles = allModules.reduce((s, m) => s + m.fileCount, 0);
    const sortedModules = [...allModules].sort((a, b) => b.lineCount - a.lineCount);

    const entryFiles = allFiles.filter(f => f.isEntryPoint);
    const keyFiles = this._data.keyFiles?.slice(0, 10) || [];
    const tours = this._data.tours || [];

    return html`
      <h2>${this._data.projectName}</h2>
      <div class="subtitle">
        Generated ${this._data.generatedAt?.split('T')[0] || ''}${this._data.languages?.length ? ' \u2014 ' + this._data.languages.join(', ') : ''}
      </div>
      <div class="desc">
        ${this._data.ideaStructure?.projectSummary
          ? html`<span class="ai-badge">AI</span> ${this._data.ideaStructure.projectSummary}`
          : 'Interactive code structure visualization. Click any module to explore its files and symbols.'}
      </div>

      <div class="stats">
        <div class="stat"><div class="val">${allModules.length}</div><div class="label">Directories</div></div>
        <div class="stat"><div class="val">${totalFiles.toLocaleString()}</div><div class="label">Files</div></div>
        <div class="stat"><div class="val">${(total / 1000).toFixed(0)}k</div><div class="label">Lines</div></div>
      </div>

      <div class="section-title">Directories by size</div>
      <ul class="file-list">
        ${sortedModules.map(mod => html`
          <li @click=${() => this._onModuleClick(mod.name)}>
            <span><span class="dot" style="background:${getColor(mod.name)}"></span>${mod.name}</span>
            <span class="lines">${mod.fileCount} files, ${(mod.lineCount / 1000).toFixed(1)}k lines</span>
          </li>
        `)}
      </ul>

      ${entryFiles.length > 0 ? html`
        <div class="section-title">Entry Points</div>
        ${entryFiles.map(f => html`
          <div class="key-file-item" @click=${() => this._onFileClick(f.path)}>
            <span><span class="badge badge-entry">entry</span> ${f.name}</span>
            <span>${f.path}</span>
          </div>
        `)}
      ` : nothing}

      ${keyFiles.length > 0 ? html`
        <div class="section-title">Key Files (most imported)</div>
        ${keyFiles.map(kf => html`
          <div class="key-file-item" @click=${() => this._onFileClick(kf.path)}>
            <span>
              ${kf.isEntryPoint ? html`<span class="badge badge-entry">entry</span>` : nothing}
              <span class="badge badge-imports">${kf.importedByCount}x</span>
              ${kf.name}
            </span>
          </div>
        `)}
      ` : nothing}

      ${tours.length > 0 ? html`
        <div class="section-title">Guided Tours</div>
        ${tours.map(tour => html`
          <div class="tour-card" @click=${() => this._onTourClick(tour.id)}>
            <div class="tour-title">${tour.title}</div>
            <div class="tour-meta">${tour.steps.length} steps &middot; ${(tour.description || '').substring(0, 80)}</div>
          </div>
        `)}
      ` : nothing}
    `;
  }

  // ---- 2. Subdir view ----

  _renderSubdirView() {
    const mod = this._getModuleData(this._module);
    if (!mod) return html`<div class="desc">Module not found</div>`;

    const { folders, files } = this._computeContents(mod);
    const connections = this._getModuleConnections(mod.name);

    return html`
      <h2>${mod.name}</h2>
      <div class="subtitle">${(mod.path || mod.name)}/</div>
      <div class="desc">
        ${mod.explanation
          ? html`<span class="ai-badge">AI</span> ${mod.explanation}`
          : mod.description || ''}
      </div>

      <div class="stats">
        <div class="stat"><div class="val">${folders.length}</div><div class="label">Folders</div></div>
        <div class="stat"><div class="val">${files.length}</div><div class="label">Files</div></div>
        <div class="stat"><div class="val">${(mod.lineCount / 1000).toFixed(1)}k</div><div class="label">Lines</div></div>
      </div>

      ${connections.length > 0 ? html`
        <div class="section-title">Dependencies</div>
        <div>
          ${connections.slice(0, 10).map(c => html`
            <div class="connection-item">
              <span>${c.direction === 'imports' ? '\u2192 imports ' : '\u2190 imported by '}${c.module}</span>
              <span class="weight">${c.weight}</span>
            </div>
          `)}
        </div>
      ` : nothing}

      <div class="section-title">Contents</div>
      <ul class="file-list">
        ${folders.map(sub => html`
          <li @click=${() => this._onFolderClick(mod, sub)}>
            <span><span class="icon-folder">${icons.folder}</span> ${sub.name}/</span>
            <span class="lines">${sub.fileCount} files, ${(sub.lineCount / 1000).toFixed(1)}k lines</span>
          </li>
        `)}
        ${files.map(item => html`
          <li @click=${() => this._onFileClick(item.file.path)}>
            <span><span class="icon-file">${icons.file}</span> ${item.name}</span>
            <span class="lines">${item.file.lineCount} lines</span>
          </li>
        `)}
      </ul>
    `;
  }

  _computeContents(mod) {
    // Get folders and loose files at the current level
    const base = mod.name === 'root' ? '' : (mod.path || mod.name);
    const prefix = this._subdir
      ? base + '/' + this._subdir + '/'
      : base ? base + '/' : '';
    const folderMap = new Map();
    const looseFiles = [];

    for (const f of mod.files) {
      const rel = f.path.startsWith(prefix) ? f.path.slice(prefix.length) : null;
      if (rel === null) continue;
      const slashIdx = rel.indexOf('/');
      if (slashIdx === -1) {
        looseFiles.push(f);
      } else {
        const dir = rel.substring(0, slashIdx);
        if (!folderMap.has(dir)) folderMap.set(dir, []);
        folderMap.get(dir).push(f);
      }
    }

    const folders = [...folderMap.entries()]
      .map(([name, files]) => ({
        type: 'folder',
        name,
        files,
        fileCount: files.length,
        lineCount: files.reduce((s, f) => s + f.lineCount, 0),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const files = looseFiles
      .map(f => ({ type: 'file', name: f.name, file: f }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return { folders, files };
  }

  _onFolderClick(mod, sub) {
    const deeper = this._subdir ? this._subdir + '/' + sub.name : sub.name;
    this._dispatchNav('navigate-to-subdir', {
      module: mod.name,
      subdir: deeper,
    });
  }

  // ---- 3. File list ----

  _renderFileList() {
    const mod = this._getModuleData(this._module);
    if (!mod) return html`<div class="desc">Module not found</div>`;

    const files = this._getSubdirFiles();
    const lineCount = files.reduce((s, f) => s + f.lineCount, 0);
    const totalSymbols = files.reduce((s, f) => s + f.symbols.length, 0);
    const title = this._subdir ? `${mod.name}/${this._subdir}` : mod.name;
    const subtitle = this._subdir
      ? `${mod.name}/${this._subdir}/`
      : `${mod.path || mod.name}/`;

    return html`
      <h2>${title}</h2>
      <div class="subtitle">${subtitle}</div>
      <div class="desc">
        ${mod.explanation
          ? html`<span class="ai-badge">AI</span> ${mod.explanation}`
          : mod.description || ''}
      </div>

      <div class="stats">
        <div class="stat"><div class="val">${files.length}</div><div class="label">Files</div></div>
        <div class="stat"><div class="val">${(lineCount / 1000).toFixed(1)}k</div><div class="label">Lines</div></div>
        <div class="stat"><div class="val">${totalSymbols}</div><div class="label">Symbols</div></div>
      </div>

      <div class="section-title">Files</div>
      <ul class="file-list">
        ${files.map(f => html`
          <li @click=${() => this._onFileClick(f.path)}>
            <span>
              ${f.name}
              ${f.language ? html`<span class="lang-badge">${f.language}</span>` : nothing}
            </span>
            <span class="lines">${f.lineCount} lines, ${f.symbols.length} symbols</span>
          </li>
        `)}
      </ul>
    `;
  }

  // ---- 4. Symbol view ----

  _renderSymbolView() {
    const file = this._file;
    if (!file) return html`<div class="desc">No file selected</div>`;

    const exported = file.symbols.filter(s => s.exported);

    return html`
      <h2>${file.name}</h2>
      <div class="subtitle">
        ${file.path}
        ${file.language ? html`<span class="lang-badge">${file.language}</span>` : nothing}
      </div>

      <div class="stats">
        <div class="stat"><div class="val">${file.lineCount}</div><div class="label">Lines</div></div>
        <div class="stat"><div class="val">${exported.length}</div><div class="label">Exports</div></div>
        <div class="stat"><div class="val">${file.imports.length}</div><div class="label">Imports</div></div>
      </div>

      ${file.explanation
        ? html`<div class="ai-explanation"><span class="ai-badge">AI</span> ${file.explanation}</div>`
        : html`<div class="desc" style="font-size:12px;color:var(--text-muted);margin-bottom:8px">Click any node in the graph to see details</div>`}

      ${exported.length > 0 ? html`
        <div class="section-title">Exported Symbols</div>
        <ul class="export-list">
          ${exported.map(sym => this._renderExportItem(sym))}
        </ul>
      ` : nothing}

      ${file.imports.length > 0 ? html`
        <div class="section-title">Imports</div>
        <ul class="import-list">
          ${file.imports.map(imp => this._renderImportItem(imp))}
        </ul>
      ` : nothing}
    `;
  }

  _renderExportItem(sym) {
    const sigPreview = sym.signature ? sym.signature.split('\n')[0].substring(0, 80) : '';
    return html`
      <li class="export-item" @click=${() => this._onExportClick(sym)}>
        <div>
          <span class="kind kind-${sym.kind}">${sym.kind}</span>
          <strong>${sym.name}</strong>
          ${sym.impact ? html`<span class="risk-badge risk-${sym.impact.riskLevel}" style="margin-left:6px;font-size:8px">${sym.impact.riskLevel}</span>` : nothing}
          ${sym.calls?.length ? html`<span style="font-size:9px;color:var(--text-muted);margin-left:4px">\u2192${sym.calls.length}</span>` : nothing}
        </div>
        ${sigPreview ? html`<div class="sig-preview">${sigPreview}</div>` : nothing}
        ${sym.comment ? html`<div class="comment-preview">${sym.comment.split('\n')[0].substring(0, 100)}</div>` : nothing}
      </li>
    `;
  }

  _renderImportItem(imp) {
    const symbols = imp.symbols.length > 0 ? imp.symbols.join(', ') : '(side-effect)';
    const srcShort = imp.source.replace(/\.[^.]+$/, '').split('/').pop();
    const dotColor = imp.resolvedModule === 'external' ? 'var(--ctp-surface2)' : getColor(imp.resolvedModule);

    return html`
      <li class="import-item" @click=${() => this._onImportClick(imp)}>
        <div>
          <span class="dot" style="background:${dotColor}"></span>
          <strong>${srcShort}</strong>
          ${imp.typeOnly ? html`<span class="type-tag">type</span>` : nothing}
          <span style="color:var(--text-muted);font-size:10px;margin-left:4px">${imp.resolvedModule}</span>
        </div>
        <div style="font-size:11px;color:var(--ctp-overlay1);padding-left:14px;font-family:var(--font-mono)">${symbols}</div>
      </li>
    `;
  }

  // ---- 5. Export detail ----

  _renderExportDetail() {
    const sym = this._selectedSymbol;
    const file = this._file;
    if (!sym || !file) return nothing;

    const others = file.symbols.filter(e => e.name !== sym.name && e.exported);

    return html`
      <h2>${sym.name}</h2>
      <div class="subtitle">
        <span class="kind kind-${sym.kind}" style="font-size:12px">${sym.kind}</span>
        ${sym.exported ? 'exported from' : 'in'} ${file.name}
        <span style="color:var(--text-muted);font-size:11px">line ${sym.line}</span>
      </div>

      ${sym.signature ? html`
        <div class="section-title">Signature</div>
        <pre class="code-block">${sym.signature}</pre>
      ` : nothing}

      ${sym.parameters?.length > 0 ? html`
        <div class="section-title">Parameters</div>
        <ul class="param-list">
          ${sym.parameters.map(p => html`
            <li>
              <span class="param-name">${p.name}</span>
              ${p.type ? html`<span class="param-type">${p.type}</span>` : nothing}
            </li>
          `)}
        </ul>
      ` : nothing}

      ${sym.returnType ? html`
        <div class="section-title">Returns</div>
        <div class="desc" style="font-family:var(--font-mono);color:var(--ctp-green)">${sym.returnType}</div>
      ` : nothing}

      ${sym.explanation ? html`
        <div class="section-title">Explanation</div>
        <div class="ai-explanation"><span class="ai-badge">AI</span> ${sym.explanation}</div>
      ` : nothing}

      ${sym.comment ? html`
        <div class="section-title">Description</div>
        <div class="desc">${sym.comment}</div>
      ` : nothing}

      ${sym.impact ? html`
        <div class="section-title">Impact</div>
        <div style="margin-bottom:12px">
          <span class="risk-badge risk-${sym.impact.riskLevel}">${sym.impact.riskLevel} risk</span>
          <span style="font-size:11px;color:var(--text-muted);margin-left:8px">
            ${sym.impact.directCallers} direct callers, ${sym.impact.impactedFiles} files affected
          </span>
        </div>
      ` : nothing}

      ${sym.calls?.length > 0 ? html`
        <div class="section-title">Calls (${sym.calls.length})</div>
        <ul class="call-list">
          ${sym.calls.map(c => html`
            <li @click=${() => this._onFileClick(c.resolvedFile || file.path)}>
              <span><span class="call-dir">\u2192</span>${c.name}</span>
              <span style="font-size:10px;color:var(--text-muted)">line ${c.line}</span>
            </li>
          `)}
        </ul>
      ` : nothing}

      ${sym.calledBy?.length > 0 ? html`
        <div class="section-title">Called by (${sym.calledBy.length})</div>
        <ul class="call-list">
          ${sym.calledBy.map(c => html`
            <li @click=${() => this._onFileClick(c.file)}>
              <span><span class="call-dir">\u2190</span>${c.symbol}</span>
              <span style="font-size:10px;color:var(--text-muted)">${c.file.split('/').pop()}</span>
            </li>
          `)}
        </ul>
      ` : nothing}

      ${sym.usedBy?.length > 0 ? html`
        <div class="section-title">Imported by (${sym.usedBy.length} files)</div>
        <ul class="used-by-list">
          ${sym.usedBy.map(path => html`
            <li @click=${() => this._onFileClick(path)}>${path}</li>
          `)}
        </ul>
      ` : nothing}

      <div class="section-title" style="margin-top:20px">File context</div>
      <div class="desc" style="font-size:12px;color:var(--text-muted)">
        Part of <strong>${file.path}</strong> (${file.lineCount} lines)<br>
        Module: <strong>${this._module}</strong>
      </div>

      ${sym.source ? html`
        <a class="source-link" @click=${() => this._onShowCode(sym, file)}>
          <kbd>&lt;/&gt;</kbd> View source code
        </a>
      ` : nothing}

      ${others.length > 0 ? html`
        <div class="section-title">Other exports in this file</div>
        <ul class="export-list">
          ${others.map(e => html`
            <li style="cursor:pointer" @click=${() => this._onExportClick(e)}>
              <span class="kind kind-${e.kind}">${e.kind}</span>${e.name}
            </li>
          `)}
        </ul>
      ` : nothing}

      <a class="back-link" @click=${() => this._backToFileOverview()}>\u2190 Back to file overview</a>
    `;
  }

  // ---- 6. Import detail ----

  _renderImportDetail() {
    const imp = this._selectedImport;
    const file = this._file;
    if (!imp || !file) return nothing;

    const dotColor = imp.resolvedModule === 'external' ? 'var(--ctp-surface2)' : getColor(imp.resolvedModule);
    const srcShort = imp.source.replace(/\.[^.]+$/, '').split('/').pop();

    return html`
      <h2>${srcShort}</h2>
      <div class="subtitle">Imported into ${file.name}</div>

      <div class="section-title">Source</div>
      <pre class="code-block">${imp.source}</pre>

      <div class="section-title">Module</div>
      <div class="desc">
        <span class="dot" style="background:${dotColor};width:10px;height:10px"></span>
        <strong>${imp.resolvedModule}</strong>
        ${imp.typeOnly ? html`<span style="color:var(--text-muted);font-size:11px;margin-left:6px">(type-only import)</span>` : nothing}
      </div>

      ${imp.symbols.length > 0 ? html`
        <div class="section-title">Imported symbols</div>
        <ul class="export-list">
          ${imp.symbols.map(sym => html`
            <li style="font-family:var(--font-mono);font-size:12px">${sym}</li>
          `)}
        </ul>
      ` : html`
        <div class="section-title">Import type</div>
        <div class="desc">Side-effect import (no named symbols)</div>
      `}

      <a class="back-link" @click=${() => this._backToFileOverview()}>\u2190 Back to file overview</a>
    `;
  }
}
customElements.define('cs-explorer', CsExplorer);
