// cs-graph.js — Cytoscape graph component with 4-level drill-down navigation
// Ports rendering from: main.mjs, cytoscape-setup.mjs, idea-layer.mjs, mapping-canvas.mjs, utils.mjs

import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import { getColor, getSymbolColor, shadeColor, fadeColor } from '../utils/colors.js';
import { escHtml } from '../utils/helpers.js';

const LEVEL_LABELS = {
  modules: 'L1 Modules',
  subdirs: 'L2 Folders',
  files: 'L3 Files',
  symbols: 'L4 Symbols',
};

export class CsGraph extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      min-height: 0;
      position: relative;
      background: var(--bg-graph);
    }

    #scene-wrapper {
      display: flex;
      flex: 1;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }

    #idea-layer {
      width: 30%;
      min-width: 200px;
      position: relative;
      border-right: 1px solid var(--border);
      flex-shrink: 0;
    }
    #idea-layer.hidden { display: none; }

    #code-layer {
      flex: 1;
      min-width: 0;
      min-height: 0;
      position: relative;
    }
    #code-layer.full { width: 100%; }

    #cy-idea, #cy-code {
      width: 100%;
      height: 100%;
      position: absolute;
      top: 0; left: 0;
    }

    #idea-badge, #level-badge {
      position: absolute;
      top: 8px;
      left: 10px;
      font-size: var(--font-size-xs);
      color: var(--ctp-overlay0);
      background: var(--ctp-mantle);
      padding: 2px 8px;
      border-radius: var(--radius-sm);
      pointer-events: none;
      z-index: 2;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }

    #minimap {
      position: absolute;
      bottom: 10px;
      right: 10px;
      width: 140px;
      height: 90px;
      background: rgba(17,17,27,0.7);
      border: 1px solid var(--ctp-surface0);
      border-radius: var(--radius-sm);
      z-index: 2;
    }

    #legend {
      position: absolute;
      bottom: 10px;
      left: 10px;
      max-height: 200px;
      overflow-y: auto;
      z-index: 2;
      font-size: var(--font-size-xs);
      color: var(--ctp-subtext0);
    }
    #legend .title {
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--ctp-overlay0);
      margin-bottom: 4px;
    }
    #legend .item {
      display: flex;
      align-items: center;
      gap: 5px;
      padding: 1px 0;
    }
    #legend .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    #mapping-canvas {
      position: absolute;
      top: 0; left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1;
    }

    #tooltip {
      display: none;
      position: absolute;
      background: var(--ctp-mantle);
      border: 1px solid var(--ctp-surface0);
      border-radius: var(--radius-md);
      padding: 8px 12px;
      font-size: var(--font-size-sm);
      color: var(--ctp-text);
      pointer-events: none;
      z-index: 100;
      max-width: 300px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }

    #help-hint {
      position: absolute;
      bottom: 8px;
      left: 50%;
      transform: translateX(-50%);
      font-size: var(--font-size-xs);
      color: var(--ctp-overlay0);
      background: rgba(17,17,27,0.8);
      padding: 4px 12px;
      border-radius: var(--radius-sm);
      z-index: 2;
      pointer-events: none;
      white-space: nowrap;
    }
  `];

  static properties = {
    _hasIdeas: { state: true },
  };

  constructor() {
    super();
    this._cyCode = null;
    this._cyIdea = null;
    this._hasIdeas = false;
    this._mappingRAF = null;
    this._updatingStore = false;
    this._activeGroup = null; // { name, modules: [] } when drilled into a module group
    this._boundStoreHandler = this._onStoreChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
    if (this._cyCode) this._cyCode.destroy();
    if (this._cyIdea) this._cyIdea.destroy();
  }

  render() {
    const levelLabel = LEVEL_LABELS[store.state.currentLevel] || '';
    return html`
      <cs-breadcrumb @navigate=${this._onNavigate}></cs-breadcrumb>
      <div id="scene-wrapper">
        <div id="idea-layer" class="${this._hasIdeas ? '' : 'hidden'}">
          <div id="cy-idea"></div>
          <div id="idea-badge">Idea Map</div>
        </div>
        <div id="code-layer" class="${this._hasIdeas ? '' : 'full'}">
          <div id="cy-code"></div>
          <div id="level-badge">${levelLabel}</div>
          <canvas id="minimap" width="140" height="90"></canvas>
          <div id="legend"></div>
        </div>
      </div>
      <canvas id="mapping-canvas"></canvas>
      <div id="tooltip"></div>
      <div id="help-hint">Click node to drill in · Esc go back · / filter · Ctrl+K search</div>
    `;
  }

  firstUpdated() {
    this._initCytoscape();
    this._hasIdeas = !!store.state.DATA?.ideaStructure;
    if (this._hasIdeas) {
      // Need to wait a tick for the idea container to be visible after _hasIdeas update
      this.updateComplete.then(() => {
        this._initIdeaLayer();
        this._renderIdeaLayer();
        this._renderModuleView();
      });
    } else {
      this._renderModuleView();
    }
  }

  // ─── Store Watcher ────────────────────────────────────────────────

  /** Set store state without triggering re-entrant _syncViewToState */
  _setStoreState(updates) {
    this._updatingStore = true;
    if (typeof updates === 'object' && !Array.isArray(updates)) {
      store.setBatch(updates);
    }
    this._updatingStore = false;
  }

  _setStoreSingle(key, value) {
    this._updatingStore = true;
    store.set(key, value);
    this._updatingStore = false;
  }

  _onStoreChanged(e) {
    const { key, keys } = e.detail;
    const changed = keys || [key];
    if (changed.includes('DATA')) {
      this._hasIdeas = !!store.state.DATA?.ideaStructure;
    }
    // Skip re-render if we caused this state change
    if (this._updatingStore) return;
    if (changed.includes('currentLevel') || changed.includes('currentModule') || changed.includes('currentFile')) {
      this._syncViewToState();
    }
  }

  _syncViewToState() {
    const { currentLevel, currentModule, currentFile, currentSubdir } = store.state;
    if (currentLevel === 'modules') {
      this._renderModuleView();
    } else if (currentLevel === 'symbols' && currentFile) {
      this._buildSymbolGraph(currentFile);
    } else if (currentLevel === 'files' && currentModule) {
      this._renderFileView(currentModule, currentSubdir);
    } else if (currentLevel === 'subdirs' && currentModule) {
      this._drillToModule(currentModule);
    }
  }

  // ─── Navigation Handler ───────────────────────────────────────────

  _onNavigate(e) {
    const { action, module, subdir } = e.detail;
    if (action === 'modules') this._renderModuleView();
    else if (action === 'module') this._drillToModule(module);
    else if (action === 'subdir') this._drillToNestedDir(module, subdir);
  }

  // ─── Node Tap Handler ────────────────────────────────────────────

  _handleNodeTap(e) {
    const node = e.target;
    const id = node.data('id');
    const nodeType = node.data('nodeType');
    const level = store.state.currentLevel;

    if (level === 'modules') {
      if (nodeType === 'group') {
        this._activeGroup = node.data('info');
        store.set('activeGroup', this._activeGroup);
        this._renderGroupDrillDown();
      } else {
        this._drillToModule(id);
      }
    } else if (level === 'subdirs') {
      const info = node.data('info');
      if (info && info.name) {
        if (info.name === '(root)') {
          this._renderFileView(store.state.currentModule, store.state.currentSubdir);
        } else {
          const deeper = store.state.currentSubdir
            ? store.state.currentSubdir + '/' + info.name
            : info.name;
          this._drillToNestedDir(store.state.currentModule, deeper);
        }
      }
    } else if (level === 'files') {
      this._drillToSymbols(id);
    } else if (level === 'symbols') {
      const info = node.data('info');
      if (nodeType === 'import') {
        // Navigate to the imported file's symbol view (cross-file drill-down)
        if (info && info.resolvedPath && info.resolvedModule !== 'external') {
          this.navigateToFile(info.resolvedPath);
        }
      } else if (nodeType === 'export') {
        // Select the symbol — explorer sidebar shows its details
        store.set('selectedSymbol', info || null);
      } else if (nodeType === 'file') {
        // Center file node — clear symbol selection to show file overview
        store.set('selectedSymbol', null);
      }
    }
  }

  // ─── Cytoscape Init ──────────────────────────────────────────────

  _initCytoscape() {
    const container = this.renderRoot.querySelector('#cy-code');
    this._cyCode = cytoscape({
      container,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 6,
            'font-size': '11px', 'color': '#cdd6f4',
            'text-outline-color': '#11111b', 'text-outline-width': 2,
            'text-background-color': '#11111b', 'text-background-opacity': 0.6,
            'text-background-padding': '2px', 'text-background-shape': 'roundrectangle',
            'background-color': 'data(color)', 'background-opacity': 0.85,
            'shape': 'round-rectangle',
            'width': 'data(size)', 'height': 'data(sizeH)',
            'border-width': 1, 'border-color': 'data(borderColor)', 'border-opacity': 0.4,
            'text-max-width': '90px', 'text-wrap': 'ellipsis',
          }
        },
        { selector: 'node.dimmed', style: { 'opacity': 0.15 } },
        {
          selector: 'node.highlighted',
          style: {
            'border-width': 2, 'border-color': '#fff', 'border-opacity': 1,
            'shadow-blur': 20, 'shadow-color': 'data(color)', 'shadow-opacity': 0.6,
            'shadow-offset-x': 0, 'shadow-offset-y': 0,
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 'data(width)',
            'line-color': 'data(edgeColor)', 'line-opacity': 0.35,
            'target-arrow-color': 'data(edgeColor)', 'target-arrow-shape': 'triangle',
            'arrow-scale': 0.7, 'curve-style': 'bezier',
          }
        },
        {
          selector: 'edge.highlighted',
          style: {
            'line-color': '#89b4fa', 'line-opacity': 0.8,
            'target-arrow-color': '#89b4fa', 'z-index': 10,
            'width': 'mapData(width, 0.5, 6, 1.5, 6)',
          }
        },
        { selector: 'edge.dimmed', style: { 'line-opacity': 0.04 } },
        {
          selector: 'node.search-match',
          style: {
            'border-width': 3, 'border-color': '#f9e2af', 'border-opacity': 1, 'z-index': 999,
          }
        },
        {
          selector: 'node.entry-point',
          style: {
            'border-width': 2.5, 'border-color': '#89dceb', 'border-opacity': 1,
            'border-style': 'double', 'shape': 'diamond',
          }
        },
        {
          selector: 'node.key-file',
          style: {
            'shadow-blur': 12, 'shadow-color': '#f9e2af', 'shadow-opacity': 0.5,
          }
        },
      ],
      layout: { name: 'preset' },
      minZoom: 0.1, maxZoom: 5, wheelSensitivity: 0.3,
    });

    this._cyCode.on('tap', 'node', (e) => this._handleNodeTap(e));

    this._cyCode.on('mouseover', 'node', (e) => {
      this._highlightConnected(e.target);
      const info = e.target.data('info');
      if (info) {
        let tipHtml = `<div style="font-weight:600;margin-bottom:2px">${escHtml(info.name || e.target.data('label'))}</div>`;
        if (info.explanation) {
          tipHtml += `<div style="color:#a6adc8;margin-top:2px;font-size:10px">${escHtml(info.explanation.substring(0, 120))}${info.explanation.length > 120 ? '...' : ''}</div>`;
        }
        if (info.fileCount !== undefined) {
          tipHtml += `<div style="color:#6c7086;font-size:10px">${info.fileCount} files, ${(info.lineCount / 1000).toFixed(1)}k lines</div>`;
        } else if (info.lineCount !== undefined) {
          let meta = `${info.lineCount} lines, ${(info.symbols || []).length} symbols`;
          if (info.importedByCount > 0) meta += ` &middot; imported by ${info.importedByCount} files`;
          if (info.isEntryPoint) meta += ' &middot; <span style="color:#89dceb">entry point</span>';
          tipHtml += `<div style="color:#6c7086;font-size:10px">${meta}</div>`;
          const topExports = (info.symbols || []).filter(s => s.exported).slice(0, 3);
          if (topExports.length > 0) {
            tipHtml += `<div style="margin-top:3px;color:#a6adc8;font-size:10px">${topExports.map(s => '<span style="font-size:8px;padding:0 3px;background:#313244;border-radius:2px">' + s.kind[0] + '</span>' + escHtml(s.name)).join(', ')}</div>`;
          }
        } else if (info.kind) {
          tipHtml += `<div style="color:#6c7086;font-size:10px">${info.kind}${info.parameters?.length ? ' (' + info.parameters.length + ' params)' : ''}</div>`;
        } else if (info.source) {
          tipHtml += `<div style="color:#6c7086;font-size:10px">${info.symbols?.length || 0} symbols from ${escHtml(info.resolvedModule || '')}</div>`;
        }
        this._showTooltip(e.originalEvent, tipHtml);
      }
    });

    this._cyCode.on('mouseout', 'node', () => {
      this._unhighlightAll();
      this._hideTooltip();
    });

    this._cyCode.on('mouseover', 'edge', (e) => {
      const edge = e.target;
      this._showTooltip(e.originalEvent, `<div style="font-weight:600">${escHtml(edge.data('source'))} → ${escHtml(edge.data('target'))}</div><div style="color:#6c7086;font-size:10px">${edge.data('rawWeight')} imports</div>`);
    });

    this._cyCode.on('mouseout', 'edge', () => this._hideTooltip());

    this._cyCode.on('pan zoom', () => {
      this._updateMinimap();
      this._scheduleDrawMappingLines();
    });

    this._cyCode.on('render', () => this._updateMinimap());
  }

  // ─── Highlight / Unhighlight ──────────────────────────────────────

  _highlightConnected(node) {
    const connected = node.connectedEdges();
    const neighbors = node.neighborhood('node');
    const parent = node.cy();
    parent.elements().addClass('dimmed');
    node.removeClass('dimmed').addClass('highlighted');
    connected.removeClass('dimmed').addClass('highlighted');
    neighbors.removeClass('dimmed');
  }

  _unhighlightAll() {
    if (this._cyCode) this._cyCode.elements().removeClass('dimmed').removeClass('highlighted');
    if (this._cyIdea) this._cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
  }

  // ─── Tooltip ──────────────────────────────────────────────────────

  _showTooltip(event, tipHtml) {
    const tt = this.renderRoot.querySelector('#tooltip');
    if (!tt) return;
    tt.innerHTML = tipHtml;
    tt.style.display = 'block';
    // Position relative to the code layer
    const codeLayer = this.renderRoot.querySelector('#code-layer');
    if (codeLayer && event) {
      const rect = codeLayer.getBoundingClientRect();
      tt.style.left = (event.clientX - rect.left + 14) + 'px';
      tt.style.top = (event.clientY - rect.top + 14) + 'px';
    }
  }

  _hideTooltip() {
    const tt = this.renderRoot.querySelector('#tooltip');
    if (tt) tt.style.display = 'none';
  }

  // ─── Minimap ──────────────────────────────────────────────────────

  _updateMinimap() {
    const canvas = this.renderRoot.querySelector('#minimap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!this._cyCode || this._cyCode.nodes().length === 0) return;

    const bb = this._cyCode.elements().boundingBox();
    const nodes = this._cyCode.nodes();
    const scaleX = canvas.width / (bb.w || 1);
    const scaleY = canvas.height / (bb.h || 1);
    const scale = Math.min(scaleX, scaleY) * 0.85;
    const offX = (canvas.width - bb.w * scale) / 2;
    const offY = (canvas.height - bb.h * scale) / 2;

    nodes.forEach(n => {
      const pos = n.position();
      const x = (pos.x - bb.x1) * scale + offX;
      const y = (pos.y - bb.y1) * scale + offY;
      const r = Math.max(2, parseFloat(n.data('size') || 30) * scale * 0.15);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.data('color') || '#666';
      ctx.globalAlpha = 0.8;
      ctx.fill();
    });

    const vp = this._cyCode.extent();
    const vpBB = {
      x1: (vp.x1 - bb.x1) * scale + offX,
      y1: (vp.y1 - bb.y1) * scale + offY,
      x2: (vp.x2 - bb.x1) * scale + offX,
      y2: (vp.y2 - bb.y1) * scale + offY,
    };
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(137,180,250,0.6)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(vpBB.x1, vpBB.y1, vpBB.x2 - vpBB.x1, vpBB.y2 - vpBB.y1);
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  _getModuleData(moduleName) {
    const DATA = store.state.DATA;
    if (moduleName === 'root') {
      return {
        name: 'root',
        description: `${DATA.rootFiles.length} files in project root`,
        fileCount: DATA.rootFiles.length,
        lineCount: DATA.rootFiles.reduce((s, f) => s + f.lineCount, 0),
        files: DATA.rootFiles,
      };
    }
    return DATA.modules.find(m => m.name === moduleName);
  }

  _getFileInnerPath(filePath, moduleName) {
    let inner = filePath;
    const srcPrefixes = ['src/', 'lib/', 'app/', 'source/', 'packages/'];
    for (const prefix of srcPrefixes) {
      if (inner.startsWith(prefix)) { inner = inner.substring(prefix.length); break; }
    }
    const modulePath = moduleName === 'root' ? '' : moduleName;
    if (modulePath && inner.startsWith(modulePath + '/')) {
      inner = inner.substring(modulePath.length + 1);
    }
    return inner;
  }

  _getSubdirMap(files, moduleName, nestedPath) {
    const subdirMap = new Map();
    for (const f of files) {
      let inner = this._getFileInnerPath(f.path, moduleName);
      if (nestedPath) {
        if (!inner.startsWith(nestedPath + '/')) continue;
        inner = inner.substring(nestedPath.length + 1);
      }
      const slashIdx = inner.indexOf('/');
      const subdir = slashIdx !== -1 ? inner.substring(0, slashIdx) : '(root)';
      if (!subdirMap.has(subdir)) subdirMap.set(subdir, []);
      subdirMap.get(subdir).push(f);
    }
    return subdirMap;
  }

  _getModuleConnections(moduleName) {
    const connections = [];
    for (const e of store.state.DATA.edges) {
      if (e.source === moduleName) connections.push({ module: e.target, weight: e.weight, direction: 'out' });
      else if (e.target === moduleName) connections.push({ module: e.source, weight: e.weight, direction: 'in' });
    }
    return connections.sort((a, b) => b.weight - a.weight);
  }

  _resolveImportPath(importSource, fromPath) {
    if (!importSource.startsWith('.')) return null;
    const fromDir = fromPath.split('/').slice(0, -1).join('/');
    const parts = importSource.replace(/\.(js|ts|tsx|jsx|mjs|cjs|py)$/, '').split('/');
    const baseParts = fromDir ? fromDir.split('/') : [];
    for (const part of parts) {
      if (part === '.') continue;
      else if (part === '..') baseParts.pop();
      else baseParts.push(part);
    }
    return baseParts.join('/');
  }

  // ─── Level 1: Module Overview ─────────────────────────────────────

  _getAllModules() {
    const DATA = store.state.DATA;
    const allModules = [...DATA.modules];
    if (DATA.rootFiles && DATA.rootFiles.length > 0) {
      allModules.push({
        name: 'root', path: '',
        description: `${DATA.rootFiles.length} files in project root`,
        fileCount: DATA.rootFiles.length,
        lineCount: DATA.rootFiles.reduce((s, f) => s + f.lineCount, 0),
        files: DATA.rootFiles,
      });
    }
    return allModules;
  }

  _groupModules(allModules) {
    const groups = new Map();
    for (const mod of allModules) {
      const slash = mod.name.indexOf('/');
      const parent = slash !== -1 ? mod.name.substring(0, slash) : null;
      if (parent) {
        if (!groups.has(parent)) groups.set(parent, { name: parent, standalone: null, modules: [], fileCount: 0, lineCount: 0 });
        const g = groups.get(parent);
        g.modules.push(mod);
        g.fileCount += mod.fileCount;
        g.lineCount += mod.lineCount;
      } else {
        if (!groups.has(mod.name)) groups.set(mod.name, { name: mod.name, standalone: null, modules: [], fileCount: 0, lineCount: 0 });
        const g = groups.get(mod.name);
        g.standalone = mod;
        g.fileCount += mod.fileCount;
        g.lineCount += mod.lineCount;
      }
    }
    return groups;
  }

  _renderModuleView() {
    this._activeGroup = null;
    this._setStoreState({
      currentLevel: 'modules',
      currentModule: null,
      currentSubdir: null,
      currentFile: null,
      activeGroup: null,
    });

    const allModules = this._getAllModules();
    const groups = this._groupModules(allModules);
    const elements = [];

    // Map module names to their group name (for edge aggregation)
    const modToGroup = new Map();
    for (const [groupName, g] of groups) {
      if (g.standalone) modToGroup.set(g.standalone.name, groupName);
      for (const sub of g.modules) modToGroup.set(sub.name, groupName);
    }

    // Build nodes from groups
    for (const [groupName, g] of groups) {
      const isGroup = g.modules.length > 0;
      const w = Math.max(40, Math.min(110, 15 * Math.log2(g.lineCount + 1)));
      const color = getColor(groupName);
      elements.push({
        data: {
          id: groupName,
          label: isGroup ? groupName + '/' : groupName,
          color,
          borderColor: shadeColor(color, -40),
          size: w, sizeH: w * 0.65,
          nodeType: isGroup ? 'group' : 'module',
          info: g,
        },
      });
    }

    // Aggregate edges between groups
    const edgeMap = new Map();
    for (const edge of store.state.DATA.edges) {
      const srcGroup = modToGroup.get(edge.source);
      const tgtGroup = modToGroup.get(edge.target);
      if (!srcGroup || !tgtGroup || srcGroup === tgtGroup) continue;
      const key = `${srcGroup}->${tgtGroup}`;
      edgeMap.set(key, (edgeMap.get(key) || 0) + edge.weight);
    }
    for (const [key, weight] of edgeMap) {
      const [src, tgt] = key.split('->');
      elements.push({
        data: {
          id: key, source: src, target: tgt,
          width: Math.max(0.5, Math.min(6, Math.log2(weight + 1))),
          rawWeight: weight,
          edgeColor: getColor(src),
        },
      });
    }

    this._cyCode.elements().remove();
    this._cyCode.add(elements);
    this._cyCode.layout({
      name: 'cose', animate: true, animationDuration: 400,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: () => 180, nodeRepulsion: () => 14000,
      edgeElasticity: () => 100, gravity: 0.25, numIter: 1000,
      padding: 50, randomize: true, componentSpacing: 100, nodeOverlap: 20,
    }).run();
    this._cyCode.fit(undefined, 50);

    this._renderLegend([...groups.values()].map(g => ({ name: g.name, lineCount: g.lineCount })));
    this._updateLevelBadge();
    setTimeout(() => { this._updateMinimap(); this._drawMappingLines(); }, 500);
  }

  _renderGroupDrillDown() {
    const group = this._activeGroup;
    if (!group) return;

    const subModules = [...group.modules];
    if (group.standalone) subModules.push(group.standalone);

    const elements = [];
    for (const mod of subModules) {
      const w = Math.max(35, Math.min(90, 14 * Math.log2(mod.lineCount + 1)));
      const color = getColor(mod.name);
      const label = mod.name.includes('/') ? mod.name.split('/').slice(1).join('/') : mod.name;
      elements.push({
        data: {
          id: mod.name, label, color,
          borderColor: shadeColor(color, -40),
          size: w, sizeH: w * 0.65,
          nodeType: 'module', info: mod,
        },
      });
    }

    // Edges between sub-modules only
    const subSet = new Set(subModules.map(m => m.name));
    for (const edge of store.state.DATA.edges) {
      if (!subSet.has(edge.source) || !subSet.has(edge.target)) continue;
      elements.push({
        data: {
          id: `${edge.source}->${edge.target}`,
          source: edge.source, target: edge.target,
          width: Math.max(0.5, Math.min(6, Math.log2(edge.weight + 1))),
          rawWeight: edge.weight,
          edgeColor: getColor(edge.source),
        },
      });
    }

    this._cyCode.elements().remove();
    this._cyCode.add(elements);
    this._cyCode.layout({
      name: 'cose', animate: true, animationDuration: 400,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: () => 150, nodeRepulsion: () => 10000,
      edgeElasticity: () => 80, gravity: 0.3, numIter: 800,
      padding: 40, randomize: true, componentSpacing: 80, nodeOverlap: 15,
    }).run();
    this._cyCode.fit(undefined, 40);

    this._renderLegend(subModules);
    this._updateLevelBadge();
    setTimeout(() => { this._updateMinimap(); this._drawMappingLines(); }, 500);
  }

  _renderLegend(allModules) {
    const legend = this.renderRoot.querySelector('#legend');
    if (!legend) return;
    const top = [...allModules].sort((a, b) => b.lineCount - a.lineCount).slice(0, 12);
    let legendHtml = '<div class="title">Modules</div>';
    for (const m of top) {
      legendHtml += `<div class="item"><div class="dot" style="background:${getColor(m.name)}"></div>${escHtml(m.name)}</div>`;
    }
    legend.innerHTML = legendHtml;
  }

  _updateLevelBadge() {
    const badge = this.renderRoot.querySelector('#level-badge');
    if (badge) badge.textContent = LEVEL_LABELS[store.state.currentLevel] || '';
  }

  // ─── Level 2: Module -> Subdirs or Files ──────────────────────────

  _drillToModule(moduleName) {
    const mod = this._getModuleData(moduleName);
    if (!mod) return;
    this._setStoreState({
      currentModule: moduleName,
      currentSubdir: null,
      currentFile: null,
    });
    this._drillToNestedDir(moduleName, null);
  }

  _drillToNestedDir(moduleName, nestedPath) {
    const mod = this._getModuleData(moduleName);
    if (!mod) return;
    this._setStoreState({
      currentModule: moduleName,
      currentSubdir: nestedPath,
      currentFile: null,
    });

    const subdirMap = this._getSubdirMap(mod.files, moduleName, nestedPath);
    const subdirCount = [...subdirMap.keys()].filter(k => k !== '(root)').length;

    if (subdirCount >= 1 && subdirMap.has('(root)') && subdirMap.get('(root)').length > 0) {
      this._setStoreSingle('currentLevel', 'subdirs');
      this._renderSubdirView(mod, subdirMap);
    } else if (subdirCount === 1) {
      const onlyDir = [...subdirMap.keys()].find(k => k !== '(root)');
      const deeper = nestedPath ? nestedPath + '/' + onlyDir : onlyDir;
      this._drillToNestedDir(moduleName, deeper);
    } else if (subdirCount >= 2) {
      this._setStoreSingle('currentLevel', 'subdirs');
      this._renderSubdirView(mod, subdirMap);
    } else {
      this._renderFileView(moduleName, nestedPath);
    }
  }

  _renderSubdirView(mod, subdirMap) {
    const elements = [];
    const subdirs = [...subdirMap.entries()]
      .map(([name, files]) => ({
        name, files,
        fileCount: files.length,
        lineCount: files.reduce((s, f) => s + f.lineCount, 0),
      }))
      .sort((a, b) => b.lineCount - a.lineCount);

    for (let si = 0; si < subdirs.length; si++) {
      const sub = subdirs[si];
      const w = Math.max(30, Math.min(80, 12 * Math.log2(sub.lineCount + 1)));
      const label = sub.name === '(root)' ? `${mod.name}/ files` : sub.name;
      const color = shadeColor(getColor(mod.name), si * 8 - 15);
      elements.push({
        data: {
          id: `subdir:${sub.name}`, label, color,
          borderColor: shadeColor(color, -30),
          size: w, sizeH: w * 0.65,
          nodeType: 'subdir', info: sub,
        },
      });
    }

    // Build edges between subdirs
    const edgeMap = new Map();
    for (const [subdirName, files] of subdirMap) {
      for (const f of files) {
        for (const imp of f.imports) {
          if (imp.resolvedModule !== mod.name && imp.resolvedModule !== 'root') continue;
          const targetPath = this._resolveImportPath(imp.source, f.path);
          if (!targetPath) continue;
          for (const [targetSub, targetFiles] of subdirMap) {
            if (targetSub === subdirName) continue;
            if (targetFiles.some(tf => tf.path.replace(/\.[^.]+$/, '').endsWith(targetPath) || tf.path === targetPath)) {
              const key = `subdir:${subdirName}->subdir:${targetSub}`;
              edgeMap.set(key, (edgeMap.get(key) || 0) + 1);
              break;
            }
          }
        }
      }
    }
    for (const [key, weight] of edgeMap) {
      const [src, tgt] = key.split('->');
      elements.push({
        data: {
          id: key, source: src, target: tgt,
          width: Math.max(0.5, Math.min(4, Math.log2(weight + 1))),
          rawWeight: weight, edgeColor: getColor(mod.name),
        },
      });
    }

    this._cyCode.elements().remove();
    this._cyCode.add(elements);
    this._cyCode.layout({
      name: 'cose', animate: true, animationDuration: 400,
      nodeDimensionsIncludeLabels: true,
      idealEdgeLength: () => 150, nodeRepulsion: () => 10000,
      gravity: 0.3, numIter: 1000, padding: 50,
      randomize: true, nodeOverlap: 20,
    }).run();
    this._cyCode.fit(undefined, 40);

    this.renderRoot.querySelector('#legend').innerHTML = '';
    this._updateLevelBadge();
    setTimeout(() => { this._updateMinimap(); this._drawMappingLines(); }, 500);
  }

  // ─── Level 2b: Files ──────────────────────────────────────────────

  _renderFileView(moduleName, nestedPath) {
    this._setStoreState({
      currentLevel: 'files',
      currentModule: moduleName,
      currentSubdir: nestedPath,
      currentFile: null,
    });

    const mod = this._getModuleData(moduleName);
    if (!mod) return;

    const subdirMap = this._getSubdirMap(mod.files, moduleName, nestedPath);
    let files;
    if (nestedPath === null || nestedPath === undefined) {
      const hasSubdirs = [...subdirMap.keys()].some(k => k !== '(root)');
      files = hasSubdirs ? (subdirMap.get('(root)') || []) : mod.files;
    } else {
      files = subdirMap.get('(root)') || [];
      for (const [key, dirFiles] of subdirMap) {
        if (key !== '(root)') files = files.concat(dirFiles);
      }
    }

    const elements = [];
    const modColor = getColor(moduleName);
    for (const f of files) {
      const w = Math.max(28, Math.min(65, 8 * Math.log2(f.lineCount + 1)));
      const label = f.name.replace(/\.[^.]+$/, '');
      const classes = [];
      if (f.isEntryPoint) classes.push('entry-point');
      if (f.importedByCount > 20) classes.push('key-file');
      elements.push({
        data: {
          id: f.path, label, color: modColor,
          borderColor: shadeColor(modColor, -30),
          size: w, sizeH: w * 0.6, info: f,
        },
        classes: classes.join(' '),
      });
    }

    // Build edges between files
    const filePaths = new Set(files.map(f => f.path));
    for (const f of files) {
      for (const imp of f.imports) {
        if (imp.resolvedModule === 'external') continue;
        const targetPath = this._resolveImportPath(imp.source, f.path);
        if (!targetPath) continue;
        for (const fp of filePaths) {
          if (fp === f.path) continue;
          if (fp.replace(/\.[^.]+$/, '').endsWith(targetPath) || fp === targetPath) {
            const edgeId = `${f.path}->${fp}`;
            if (!elements.some(e => e.data?.id === edgeId)) {
              elements.push({
                data: {
                  id: edgeId, source: f.path, target: fp,
                  width: 1, rawWeight: 1, edgeColor: modColor,
                },
              });
            }
            break;
          }
        }
      }
    }

    this._cyCode.elements().remove();
    this._cyCode.add(elements);
    const layoutName = files.length > 150 ? 'concentric' : 'cose';
    this._cyCode.layout({
      name: layoutName, animate: true, animationDuration: 400,
      nodeDimensionsIncludeLabels: true, randomize: true, padding: 40,
      ...(layoutName === 'cose'
        ? {
            idealEdgeLength: () => files.length > 80 ? 90 : 130,
            nodeRepulsion: () => 9000, gravity: 0.35, numIter: 1000, nodeOverlap: 20,
          }
        : {
            concentric: (node) => node.degree(),
            levelWidth: () => 3, minNodeSpacing: 25,
          }),
    }).run();
    this._cyCode.fit(undefined, 40);

    this.renderRoot.querySelector('#legend').innerHTML = '';
    this._updateLevelBadge();
    setTimeout(() => { this._updateMinimap(); this._drawMappingLines(); }, 500);
  }

  // ─── Level 3: Symbols ─────────────────────────────────────────────

  _drillToSymbols(filePath) {
    const mod = store.state.currentModule === 'root'
      ? { name: 'root', files: store.state.DATA.rootFiles }
      : store.state.DATA.modules.find(m => m.name === store.state.currentModule);
    if (!mod) return;
    const file = mod.files.find(f => f.path === filePath);
    if (!file) return;

    this._setStoreState({
      currentLevel: 'symbols',
      currentFile: file,
    });
    this._buildSymbolGraph(file);
  }

  _buildSymbolGraph(file) {
    const elements = [];
    const centerX = 0, centerY = 0;

    const centerColor = getColor(store.state.currentModule);
    elements.push({
      data: {
        id: 'center',
        label: file.name.replace(/\.[^.]+$/, ''),
        color: centerColor,
        borderColor: shadeColor(centerColor, -30),
        size: 70, sizeH: 50,
        nodeType: 'file', info: file,
      },
      position: { x: centerX, y: centerY },
    });

    // Exports — top semicircle
    const exported = file.symbols.filter(s => s.exported);
    for (let i = 0; i < exported.length; i++) {
      const angle = ((i / Math.max(exported.length, 1)) * Math.PI) - Math.PI / 2;
      const radius = 180 + (exported.length > 10 ? 50 : 0);
      const symColor = getSymbolColor(exported[i].kind);
      elements.push({
        data: {
          id: `export:${exported[i].name}`,
          label: exported[i].name, color: symColor,
          borderColor: shadeColor(symColor, -30),
          size: 36, sizeH: 26,
          nodeType: 'export', info: exported[i],
        },
        position: {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
      });
      elements.push({
        data: {
          id: `center->export:${exported[i].name}`,
          source: 'center', target: `export:${exported[i].name}`,
          width: 1.5, rawWeight: 1, edgeColor: symColor,
        },
      });
    }

    // Imports — bottom semicircle
    const imports = file.imports;
    for (let i = 0; i < imports.length; i++) {
      const imp = imports[i];
      const angle = ((i / Math.max(imports.length, 1)) * Math.PI) + Math.PI / 2;
      const radius = 220 + (imports.length > 10 ? 50 : 0);
      const nodeId = `import:${i}:${imp.source}`;
      const srcParts = imp.source.replace(/\.[^.]+$/, '').split('/');
      const shortLabel = srcParts[srcParts.length - 1];
      const impColor = imp.resolvedModule === 'external' ? '#585b70' : getColor(imp.resolvedModule);

      elements.push({
        data: {
          id: nodeId, label: shortLabel, color: impColor,
          borderColor: shadeColor(impColor, -20),
          size: 32, sizeH: 22,
          nodeType: 'import', info: imp,
        },
        position: {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
      });
      elements.push({
        data: {
          id: `${nodeId}->center`,
          source: nodeId, target: 'center',
          width: 1, rawWeight: imp.symbols.length || 1,
          edgeColor: impColor,
        },
      });
    }

    this._cyCode.elements().remove();
    this._cyCode.add(elements);
    this._cyCode.layout({ name: 'preset' }).run();
    this._cyCode.fit(undefined, 50);

    this._updateLevelBadge();
    setTimeout(() => { this._updateMinimap(); this._drawMappingLines(); }, 100);

    // Symbol type legend
    const legend = this.renderRoot.querySelector('#legend');
    if (legend) {
      legend.innerHTML = `
        <div class="title">Symbol types</div>
        <div class="item"><div class="dot" style="background:#89b4fa"></div>function</div>
        <div class="item"><div class="dot" style="background:#cba6f7"></div>class</div>
        <div class="item"><div class="dot" style="background:#a6e3a1"></div>type</div>
        <div class="item"><div class="dot" style="background:#94e2d5"></div>interface</div>
        <div class="item"><div class="dot" style="background:#f9e2af"></div>const</div>
        <div class="item"><div class="dot" style="background:#f38ba8"></div>enum</div>
        <div class="item"><div class="dot" style="background:#585b70"></div>external import</div>
      `;
    }
  }

  // ─── Idea Layer ───────────────────────────────────────────────────

  _initIdeaLayer() {
    const container = this.renderRoot.querySelector('#cy-idea');
    if (!container) return;

    this._cyIdea = cytoscape({
      container,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'text-valign': 'center', 'text-halign': 'center',
            'font-size': '11px', 'color': '#fff',
            'text-outline-color': 'data(color)', 'text-outline-width': 1.5,
            'background-color': 'data(color)', 'background-opacity': 0.2,
            'shape': 'ellipse',
            'width': 'data(size)', 'height': 'data(size)',
            'border-width': 2, 'border-color': 'data(color)', 'border-opacity': 0.5,
            'text-max-width': '80px', 'text-wrap': 'wrap',
          },
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5, 'line-color': '#45475a', 'line-opacity': 0.5,
            'line-style': 'dashed',
            'target-arrow-shape': 'vee', 'target-arrow-color': '#45475a',
            'arrow-scale': 0.6, 'curve-style': 'bezier',
            'label': 'data(label)', 'font-size': '8px', 'color': '#585b70',
            'text-rotation': 'autorotate',
            'text-background-color': '#11111b', 'text-background-opacity': 0.8,
            'text-background-padding': '2px',
          },
        },
        {
          selector: 'node.highlighted',
          style: {
            'background-opacity': 0.45, 'border-width': 3, 'border-opacity': 1,
            'shadow-blur': 25, 'shadow-color': 'data(color)', 'shadow-opacity': 0.5,
          },
        },
        { selector: 'node.dimmed', style: { 'opacity': 0.15 } },
        { selector: 'edge.dimmed', style: { 'line-opacity': 0.05 } },
      ],
      layout: { name: 'preset' },
      minZoom: 0.3, maxZoom: 3,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      boxSelectionEnabled: false,
      wheelSensitivity: 0.3,
    });

    this._cyIdea.on('tap', 'node', (e) => {
      const nodeId = e.target.data('id');
      store.set('activeIdeaNode', nodeId);
      this._showIdeaDetail(nodeId);
      this._drawMappingLines();
    });

    this._cyIdea.on('tap', (e) => {
      if (e.target === this._cyIdea) {
        store.set('activeIdeaNode', null);
        this._cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
        this._cyCode.elements().removeClass('dimmed').removeClass('highlighted');
        this._drawMappingLines();
      }
    });

    this._cyIdea.on('mouseover', 'node', (e) => {
      const info = e.target.data('info');
      if (info) {
        let tipHtml = `<div style="font-weight:600;margin-bottom:2px">${escHtml(info.label)}</div>`;
        tipHtml += `<div style="color:#a6adc8;font-size:10px">${escHtml(info.description || '')}</div>`;
        const refs = info.codeRefs?.length || 0;
        if (refs) tipHtml += `<div style="color:#6c7086;font-size:10px">${refs} code references</div>`;
        this._showTooltip(e.originalEvent, tipHtml);
      }
    });

    this._cyIdea.on('mouseout', 'node', () => this._hideTooltip());
    this._cyIdea.on('pan zoom', () => this._scheduleDrawMappingLines());
  }

  _renderIdeaLayer() {
    const idea = store.state.DATA?.ideaStructure;
    if (!idea || !this._cyIdea) return;

    const elements = [];
    for (const node of idea.nodes) {
      const refCount = node.codeRefs?.length || 0;
      const size = Math.min(85, 45 + refCount * 5);
      const color = getColor(node.id);
      elements.push({
        data: {
          id: node.id, label: node.label, color, size,
          nodeType: 'idea', info: node,
        },
      });
    }

    if (idea.edges) {
      for (const edge of idea.edges) {
        elements.push({
          data: {
            id: `ie:${edge.source}->${edge.target}`,
            source: edge.source, target: edge.target,
            label: edge.label || '',
          },
        });
      }
    }

    this._cyIdea.elements().remove();
    this._cyIdea.add(elements);
    this._cyIdea.layout({
      name: 'cose', animate: false, nodeDimensionsIncludeLabels: true,
      idealEdgeLength: () => 120, nodeRepulsion: () => 8000,
      gravity: 0.5, numIter: 500, padding: 20,
    }).run();
    this._cyIdea.fit(undefined, 15);
  }

  _showIdeaDetail(nodeId) {
    const idea = store.state.DATA?.ideaStructure;
    if (!idea) return;
    const node = idea.nodes.find(n => n.id === nodeId);
    if (!node) return;

    this._cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
    const cyNode = this._cyIdea.getElementById(nodeId);
    if (cyNode.length) this._highlightConnected(cyNode);

    this._highlightCodeRefs(node.codeRefs);

    // Dispatch event for sidebar to show idea detail
    this.dispatchEvent(new CustomEvent('idea-selected', {
      detail: { nodeId, node, idea },
      bubbles: true, composed: true,
    }));
  }

  _highlightCodeRefs(codeRefs) {
    if (!codeRefs || codeRefs.length === 0) return;
    this._cyCode.elements().addClass('dimmed');
    for (const ref of codeRefs) {
      const nodeId = this._resolveCodeRefToNodeId(ref);
      if (!nodeId) continue;
      const node = this._cyCode.getElementById(nodeId);
      if (node.length) {
        node.removeClass('dimmed').addClass('highlighted');
        node.connectedEdges().removeClass('dimmed');
      }
    }
  }

  _resolveCodeRefToNodeId(ref) {
    const DATA = store.state.DATA;
    const moduleForFile = (filePath) => {
      for (const mod of DATA.modules) {
        if (mod.files.some(f => f.path === filePath)) return mod.name;
      }
      if (DATA.rootFiles?.some(f => f.path === filePath)) return 'root';
      return null;
    };

    const filePath = ref.type === 'file' ? ref.path : ref.type === 'symbol' ? ref.path : null;
    const moduleName = ref.type === 'module' ? ref.name : (filePath ? moduleForFile(filePath) : null);
    const level = store.state.currentLevel;

    if (level === 'modules') {
      return moduleName || null;
    }
    if (level === 'subdirs' || level === 'files') {
      if (filePath) {
        const node = this._cyCode.getElementById(filePath);
        if (node.length) return filePath;
        const nodes = this._cyCode.nodes();
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const info = n.data('info');
          if (info?.files && info.files.some(f => f.path === filePath)) return n.data('id');
        }
      }
      return null;
    }
    if (level === 'symbols') {
      if (ref.type === 'symbol') {
        const node = this._cyCode.getElementById(`export:${ref.name}`);
        if (node.length) return `export:${ref.name}`;
      }
      if (filePath === store.state.currentFile?.path) return 'center';
      return null;
    }
    return null;
  }

  // ─── Mapping Lines ────────────────────────────────────────────────

  _scheduleDrawMappingLines() {
    if (this._mappingRAF) return;
    this._mappingRAF = requestAnimationFrame(() => {
      this._mappingRAF = null;
      this._drawMappingLines();
    });
  }

  _drawMappingLines() {
    const canvas = this.renderRoot.querySelector('#mapping-canvas');
    if (!canvas || !this._cyIdea || !store.state.DATA?.ideaStructure) return;

    const sceneWrapper = this.renderRoot.querySelector('#scene-wrapper');
    if (!sceneWrapper) return;
    canvas.width = sceneWrapper.offsetWidth;
    canvas.height = sceneWrapper.offsetHeight;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const idea = store.state.DATA.ideaStructure;
    const ideaEl = this.renderRoot.querySelector('#cy-idea');
    const codeEl = this.renderRoot.querySelector('#cy-code');
    if (!ideaEl || !codeEl) return;

    const containerRect = sceneWrapper.getBoundingClientRect();

    for (const node of idea.nodes) {
      if (!node.codeRefs || node.codeRefs.length === 0) continue;

      const fromPos = this._getScreenPos(this._cyIdea, node.id, ideaEl, containerRect);
      if (!fromPos) continue;

      const isActive = store.state.activeIdeaNode === node.id;
      const color = getColor(node.id);

      for (const ref of node.codeRefs) {
        const targetId = this._resolveCodeRefToNodeId(ref);
        if (!targetId) continue;

        const toPos = this._getScreenPos(this._cyCode, targetId, codeEl, containerRect);
        if (!toPos) continue;

        ctx.beginPath();
        ctx.setLineDash([4, 8]);
        ctx.strokeStyle = fadeColor(color, isActive ? 0.55 : 0.1);
        ctx.lineWidth = isActive ? 2 : 0.8;

        const midX = (fromPos.x + toPos.x) / 2;
        const midY = (fromPos.y + toPos.y) / 2;
        ctx.moveTo(fromPos.x, fromPos.y);
        ctx.quadraticCurveTo(midX, midY - 15, toPos.x, toPos.y);
        ctx.stroke();

        if (isActive) {
          ctx.beginPath();
          ctx.arc(toPos.x, toPos.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = fadeColor(color, 0.6);
          ctx.fill();
        }
      }
    }
  }

  _getScreenPos(cyInstance, nodeId, containerEl, parentRect) {
    const node = cyInstance.getElementById(nodeId);
    if (!node || node.length === 0) return null;
    const pos = node.renderedPosition();
    const rect = containerEl.getBoundingClientRect();
    return {
      x: rect.left - parentRect.left + pos.x,
      y: rect.top - parentRect.top + pos.y,
    };
  }

  // ─── Public API ───────────────────────────────────────────────────

  /** Navigate to a specific file by path — used by search, tours, etc. */
  navigateToFile(filePath) {
    const DATA = store.state.DATA;
    let targetMod = null;
    let targetFile = null;

    for (const mod of DATA.modules) {
      const file = mod.files.find(f => f.path === filePath);
      if (file) {
        targetMod = mod.name;
        targetFile = file;
        break;
      }
    }
    if (!targetFile) {
      const rootFile = DATA.rootFiles?.find(f => f.path === filePath);
      if (rootFile) {
        targetMod = 'root';
        targetFile = rootFile;
      }
    }
    if (!targetMod || !targetFile) {
      console.warn(`[codesight] navigateToFile: file not found in data — ${filePath}`);
      return false;
    }

    this._setStoreState({
      currentModule: targetMod,
      currentSubdir: null,
      currentLevel: 'symbols',
      currentFile: targetFile,
    });
    this._buildSymbolGraph(targetFile);
    return true;
  }

  /** Navigate to a module group's drill-down view by group name. */
  navigateToGroup(groupName) {
    const allModules = this._getAllModules();
    const groups = this._groupModules(allModules);
    const group = groups.get(groupName);
    if (!group || group.modules.length === 0) return;
    // Ensure we're at modules level
    this._setStoreState({
      currentLevel: 'modules',
      currentModule: null,
      currentSubdir: null,
      currentFile: null,
    });
    this._activeGroup = group;
    this._setStoreSingle('activeGroup', group);
    this._renderGroupDrillDown();
  }

  /** Go back from group drill-down to grouped overview. Returns true if handled. */
  goBack() {
    if (this._activeGroup) {
      this._renderModuleView(); // clears _activeGroup and re-renders grouped view
      return true;
    }
    return false;
  }

  /** Get the Cytoscape code instance (for search highlighting, etc.) */
  get cyCode() { return this._cyCode; }

  /** Get the Cytoscape idea instance */
  get cyIdea() { return this._cyIdea; }
}

customElements.define('cs-graph', CsGraph);
