// Idea layer (concept graph) — Cytoscape setup and rendering

import { state } from './state.mjs';
import { escHtml, escJs, getColor, shadeColor, showTooltipHtml, hideTooltip } from './utils.mjs';
import { highlightConnected } from './cytoscape-setup.mjs';
import { drawMappingLines, scheduleDrawMappingLines } from './mapping-canvas.mjs';

export function initCyIdea() {
  state.cyIdea = cytoscape({
    container: document.getElementById('cy-idea'),
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
        }
      },
      {
        selector: 'edge',
        style: {
          'width': 1.5, 'line-color': '#3a3a5a', 'line-opacity': 0.5,
          'line-style': 'dashed',
          'target-arrow-shape': 'vee', 'target-arrow-color': '#3a3a5a',
          'arrow-scale': 0.6, 'curve-style': 'bezier',
          'label': 'data(label)', 'font-size': '8px', 'color': '#555',
          'text-rotation': 'autorotate',
          'text-background-color': '#0a0a18', 'text-background-opacity': 0.8,
          'text-background-padding': '2px',
        }
      },
      { selector: 'node.highlighted', style: { 'background-opacity': 0.45, 'border-width': 3, 'border-opacity': 1, 'shadow-blur': 25, 'shadow-color': 'data(color)', 'shadow-opacity': 0.5 } },
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

  state.cyIdea.on('tap', 'node', (e) => {
    const nodeId = e.target.data('id');
    state.activeIdeaNode = nodeId;
    showIdeaDetail(nodeId);
    drawMappingLines();
  });
  state.cyIdea.on('tap', (e) => {
    if (e.target === state.cyIdea) {
      state.activeIdeaNode = null;
      state.cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
      state.cyCode.elements().removeClass('dimmed').removeClass('highlighted');
      drawMappingLines();
    }
  });
  state.cyIdea.on('mouseover', 'node', (e) => {
    const info = e.target.data('info');
    if (info) {
      let html = `<div class="tooltip-title">${escHtml(info.label)}</div>`;
      html += `<div class="tooltip-meta" style="color:#a0aec0">${escHtml(info.description || '')}</div>`;
      const refs = info.codeRefs?.length || 0;
      if (refs) html += `<div class="tooltip-meta">${refs} code references</div>`;
      showTooltipHtml(e.originalEvent, html);
    }
  });
  state.cyIdea.on('mouseout', 'node', () => hideTooltip());
  state.cyIdea.on('pan zoom', () => scheduleDrawMappingLines());
}

export function renderIdeaLayer() {
  const idea = state.DATA.ideaStructure;
  if (!idea) return;

  const elements = [];
  for (const node of idea.nodes) {
    const refCount = node.codeRefs?.length || 0;
    const size = Math.min(85, 45 + refCount * 5);
    const color = getColor(node.id);
    elements.push({
      data: {
        id: node.id, label: node.label, color, size,
        nodeType: 'idea', info: node,
      }
    });
  }

  if (idea.edges) {
    for (const edge of idea.edges) {
      elements.push({
        data: {
          id: `ie:${edge.source}->${edge.target}`,
          source: edge.source, target: edge.target,
          label: edge.label || '',
        }
      });
    }
  }

  state.cyIdea.elements().remove();
  state.cyIdea.add(elements);
  state.cyIdea.layout({
    name: 'cose', animate: false, nodeDimensionsIncludeLabels: true,
    idealEdgeLength: () => 120, nodeRepulsion: () => 8000,
    gravity: 0.5, numIter: 500, padding: 20,
  }).run();
  state.cyIdea.fit(undefined, 15);
}

export function showIdeaDetail(nodeId) {
  const idea = state.DATA.ideaStructure;
  const node = idea.nodes.find(n => n.id === nodeId);
  if (!node) return;

  state.cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
  const cyNode = state.cyIdea.getElementById(nodeId);
  if (cyNode.length) highlightConnected(cyNode);

  highlightCodeRefs(node.codeRefs);

  let html = `
    <h2>${escHtml(node.label)}</h2>
    <div class="subtitle">Concept <span class="ai-badge">AI</span></div>
    <div class="ai-explanation">${escHtml(node.description)}</div>
  `;

  if (node.codeRefs?.length > 0) {
    html += '<div class="section-title">Mapped to code</div><ul class="idea-refs">';
    for (const ref of node.codeRefs) {
      if (ref.type === 'module') {
        html += `<li onclick="drillToModule('${escJs(ref.name)}')">
          <span class="ref-type">module</span>${escHtml(ref.name)}
        </li>`;
      } else if (ref.type === 'file') {
        html += `<li onclick="navigateToFile('${escJs(ref.path)}')">
          <span class="ref-type">file</span>${escHtml(ref.path)}
        </li>`;
      } else if (ref.type === 'symbol') {
        html += `<li onclick="navigateToFile('${escJs(ref.path)}')">
          <span class="ref-type">symbol</span>${escHtml(ref.name)} <span style="color:#555;font-size:10px">in ${escHtml(ref.path)}</span>
        </li>`;
      }
    }
    html += '</ul>';
  }

  const related = (idea.edges || []).filter(e => e.source === nodeId || e.target === nodeId);
  if (related.length > 0) {
    html += '<div class="section-title">Related concepts</div>';
    for (const edge of related) {
      const otherId = edge.source === nodeId ? edge.target : edge.source;
      const other = idea.nodes.find(n => n.id === otherId);
      if (!other) continue;
      const dir = edge.source === nodeId ? '→' : '←';
      html += `<div class="connection-item" onclick="activeIdeaNode='${escJs(otherId)}';showIdeaDetail('${escJs(otherId)}');drawMappingLines()">
        <span>${dir} ${escHtml(other.label)}</span>
        <span class="idea-edge-label">${escHtml(edge.label || '')}</span>
      </div>`;
    }
  }

  html += `<div style="margin-top:16px"><a href="#" onclick="backToOverview();return false" style="color:#7dd3fc;font-size:12px">\u2190 Back to overview</a></div>`;
  document.getElementById('sidebar-content').innerHTML = html;
}

export function backToOverview(renderModuleView) {
  state.activeIdeaNode = null;
  if (state.cyIdea) state.cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
  state.cyCode.elements().removeClass('dimmed').removeClass('highlighted');
  drawMappingLines();
  renderModuleView();
}

export function highlightCodeRefs(codeRefs) {
  if (!codeRefs || codeRefs.length === 0) return;
  state.cyCode.elements().addClass('dimmed');
  for (const ref of codeRefs) {
    const nodeId = resolveCodeRefToNodeId(ref);
    if (!nodeId) continue;
    const node = state.cyCode.getElementById(nodeId);
    if (node.length) {
      node.removeClass('dimmed').addClass('highlighted');
      node.connectedEdges().removeClass('dimmed');
    }
  }
}

function resolveCodeRefToNodeId(ref) {
  function moduleForFile(filePath) {
    for (const mod of state.DATA.modules) {
      if (mod.files.some(f => f.path === filePath)) return mod.name;
    }
    if (state.DATA.rootFiles?.some(f => f.path === filePath)) return 'root';
    return null;
  }

  const filePath = ref.type === 'file' ? ref.path : ref.type === 'symbol' ? ref.path : null;
  const moduleName = ref.type === 'module' ? ref.name : (filePath ? moduleForFile(filePath) : null);

  if (state.currentLevel === 'modules') {
    if (moduleName) return moduleName;
    return null;
  }

  if (state.currentLevel === 'subdirs' || state.currentLevel === 'files') {
    if (filePath) {
      const node = state.cyCode.getElementById(filePath);
      if (node.length) return filePath;
    }
    if (filePath) {
      const nodes = state.cyCode.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const info = n.data('info');
        if (info?.files && info.files.some(f => f.path === filePath)) {
          return n.data('id');
        }
      }
    }
    return null;
  }

  if (state.currentLevel === 'symbols') {
    if (ref.type === 'symbol') {
      const node = state.cyCode.getElementById(`export:${ref.name}`);
      if (node.length) return `export:${ref.name}`;
    }
    if (filePath === state.currentFile?.path) return 'center';
    return null;
  }

  return null;
}
