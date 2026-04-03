// Cytoscape code-layer initialization, highlight, tooltip wiring

import { state } from './state.mjs';
import { escHtml, getColor, shadeColor, showTooltipHtml, hideTooltip, updateMinimap } from './utils.mjs';
import { scheduleDrawMappingLines } from './mapping-canvas.mjs';

export function highlightConnected(node) {
  const connected = node.connectedEdges();
  const neighbors = node.neighborhood('node');
  const parent = node.cy();
  parent.elements().addClass('dimmed');
  node.removeClass('dimmed').addClass('highlighted');
  connected.removeClass('dimmed').addClass('highlighted');
  neighbors.removeClass('dimmed');
}

export function unhighlightAll() {
  state.cyCode.elements().removeClass('dimmed').removeClass('highlighted');
  if (state.cyIdea) state.cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
}

export function initCyCode(handleNodeTap) {
  state.cyCode = cytoscape({
    container: document.getElementById('cy-code'),
    style: [
      {
        selector: 'node',
        style: {
          'label': 'data(label)',
          'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 6,
          'font-size': '11px', 'color': '#e0e0e0',
          'text-outline-color': '#0f0f1a', 'text-outline-width': 2,
          'text-background-color': '#0f0f1a', 'text-background-opacity': 0.6,
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
          'line-color': '#7dd3fc', 'line-opacity': 0.8,
          'target-arrow-color': '#7dd3fc', 'z-index': 10, 'width': 'mapData(width, 0.5, 6, 1.5, 6)',
        }
      },
      { selector: 'edge.dimmed', style: { 'line-opacity': 0.04 } },
      { selector: 'node.search-match', style: { 'border-width': 3, 'border-color': '#fbbf24', 'border-opacity': 1, 'z-index': 999 } },
      { selector: 'node.entry-point', style: { 'border-width': 2.5, 'border-color': '#22d3ee', 'border-opacity': 1, 'border-style': 'double', 'shape': 'diamond' } },
      { selector: 'node.key-file', style: { 'shadow-blur': 12, 'shadow-color': '#f59e0b', 'shadow-opacity': 0.5 } },
    ],
    layout: { name: 'preset' },
    minZoom: 0.1, maxZoom: 5, wheelSensitivity: 0.3,
  });

  state.cyCode.on('tap', 'node', handleNodeTap);

  state.cyCode.on('mouseover', 'node', (e) => {
    highlightConnected(e.target);
    const info = e.target.data('info');
    if (info) {
      let html = `<div class="tooltip-title">${escHtml(info.name || e.target.data('label'))}</div>`;
      if (info.explanation) html += `<div class="tooltip-meta" style="color:#a0aec0;margin-top:2px">${escHtml(info.explanation.substring(0, 120))}${info.explanation.length > 120 ? '...' : ''}</div>`;
      if (info.fileCount !== undefined) html += `<div class="tooltip-meta">${info.fileCount} files, ${(info.lineCount/1000).toFixed(1)}k lines</div>`;
      else if (info.lineCount !== undefined) {
        let meta = `${info.lineCount} lines, ${(info.symbols || []).length} symbols`;
        if (info.importedByCount > 0) meta += ` &middot; imported by ${info.importedByCount} files`;
        if (info.isEntryPoint) meta += ' &middot; <span style="color:#22d3ee">entry point</span>';
        html += `<div class="tooltip-meta">${meta}</div>`;
        const topExports = (info.symbols || []).filter(s => s.exported).slice(0, 3);
        if (topExports.length > 0) {
          html += `<div class="tooltip-meta" style="margin-top:3px;color:#aaa">${topExports.map(s => '<span class="kind kind-' + s.kind + '" style="font-size:8px;padding:0 3px">' + s.kind[0] + '</span>' + escHtml(s.name)).join(', ')}</div>`;
        }
      }
      else if (info.kind) html += `<div class="tooltip-meta">${info.kind}${info.parameters?.length ? ' (' + info.parameters.length + ' params)' : ''}</div>`;
      else if (info.source) html += `<div class="tooltip-meta">${info.symbols?.length || 0} symbols from ${escHtml(info.resolvedModule || '')}</div>`;
      showTooltipHtml(e.originalEvent, html);
    }
  });
  state.cyCode.on('mouseout', 'node', () => { unhighlightAll(); hideTooltip(); });
  state.cyCode.on('mouseover', 'edge', (e) => {
    const edge = e.target;
    showTooltipHtml(e.originalEvent, `<div class="tooltip-title">${escHtml(edge.data('source'))} → ${escHtml(edge.data('target'))}</div><div class="tooltip-meta">${edge.data('rawWeight')} imports</div>`);
  });
  state.cyCode.on('mouseout', 'edge', () => hideTooltip());
  state.cyCode.on('pan zoom', () => { updateMinimap(); scheduleDrawMappingLines(); });
  state.cyCode.on('render', () => updateMinimap());
}
