// Color utilities, escape helpers, minimap

import { state } from './state.mjs';

export function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export const COLOR_PALETTE = [
  '#3b82f6', '#a855f7', '#10b981', '#f59e0b', '#ef4444',
  '#06b6d4', '#84cc16', '#ec4899', '#f97316', '#14b8a6',
  '#6366f1', '#e879f9', '#0ea5e9', '#8b5cf6', '#22c55e',
  '#fb923c', '#38bdf8', '#d946ef', '#facc15', '#2dd4bf',
];

export function getColor(name) {
  return COLOR_PALETTE[hashStr(name) % COLOR_PALETTE.length];
}

export function getSymbolColor(kind) {
  const map = {
    function: '#3b82f6', method: '#3b82f6',
    class: '#a855f7', struct: '#a855f7',
    type: '#10b981',
    interface: '#14b8a6', trait: '#14b8a6',
    const: '#f59e0b',
    enum: '#ec4899',
    default: '#9ca3af',
  };
  return map[kind] || '#9ca3af';
}

export function shadeColor(hex, amount) {
  let r = parseInt(hex.slice(1,3), 16) + amount;
  let g = parseInt(hex.slice(3,5), 16) + amount;
  let b = parseInt(hex.slice(5,7), 16) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r,g,b].map(v => v.toString(16).padStart(2,'0')).join('');
}

export function fadeColor(hex, opacity) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}

export function escHtml(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
export function escJs(s) { return (s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); }

export function explanationHtml(text) {
  if (!text) return '';
  return `<div class="ai-explanation"><span class="ai-badge">AI</span> ${escHtml(text)}</div>`;
}

const LEVEL_LABELS = { modules: 'L1 Modules', subdirs: 'L2 Folders', files: 'L3 Files', symbols: 'L4 Symbols' };
export function updateLevelBadge() {
  document.getElementById('level-badge').textContent = LEVEL_LABELS[state.currentLevel] || '';
}

export function updateMinimap() {
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!state.cyCode || state.cyCode.nodes().length === 0) return;

  const bb = state.cyCode.extent();
  const nodes = state.cyCode.nodes();
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

  const vp = state.cyCode.extent();
  const vpBB = { x1: (vp.x1 - bb.x1) * scale + offX, y1: (vp.y1 - bb.y1) * scale + offY,
    x2: (vp.x2 - bb.x1) * scale + offX, y2: (vp.y2 - bb.y1) * scale + offY };
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(125,211,252,0.6)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(vpBB.x1, vpBB.y1, vpBB.x2 - vpBB.x1, vpBB.y2 - vpBB.y1);
}

export function showTooltipHtml(event, html) {
  const tt = document.getElementById('tooltip');
  tt.innerHTML = html;
  tt.style.display = 'block';
  tt.style.left = (event.offsetX + 14) + 'px';
  tt.style.top = (event.offsetY + 14) + 'px';
}

export function hideTooltip() { document.getElementById('tooltip').style.display = 'none'; }
