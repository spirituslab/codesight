// Mapping canvas — draws lines connecting idea layer nodes to code layer nodes

import { state } from './state.mjs';
import { getColor, fadeColor } from './utils.mjs';

let mappingRAF = null;

export function scheduleDrawMappingLines() {
  if (mappingRAF) return;
  mappingRAF = requestAnimationFrame(() => {
    mappingRAF = null;
    drawMappingLines();
  });
}

export function drawMappingLines() {
  const canvas = document.getElementById('mapping-canvas');
  if (!canvas || !state.cyIdea || !state.DATA.ideaStructure) return;

  const container = document.getElementById('graph-container');
  canvas.width = container.offsetWidth;
  canvas.height = container.offsetHeight;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const idea = state.DATA.ideaStructure;
  const ideaEl = document.getElementById('cy-idea');
  const codeEl = document.getElementById('cy-code');
  if (!ideaEl || !codeEl) return;

  const containerRect = container.getBoundingClientRect();

  for (const node of idea.nodes) {
    if (!node.codeRefs || node.codeRefs.length === 0) continue;

    const fromPos = getScreenPos(state.cyIdea, node.id, ideaEl, containerRect);
    if (!fromPos) continue;

    const isActive = state.activeIdeaNode === node.id;
    const color = getColor(node.id);

    for (const ref of node.codeRefs) {
      const targetId = resolveCodeRefToNodeId(ref);
      if (!targetId) continue;

      const toPos = getScreenPos(state.cyCode, targetId, codeEl, containerRect);
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

function getScreenPos(cyInstance, nodeId, containerEl, parentRect) {
  const node = cyInstance.getElementById(nodeId);
  if (!node || node.length === 0) return null;
  const pos = node.renderedPosition();
  const rect = containerEl.getBoundingClientRect();
  return {
    x: rect.left - parentRect.left + pos.x,
    y: rect.top - parentRect.top + pos.y,
  };
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
    return moduleName || null;
  }
  if (state.currentLevel === 'subdirs' || state.currentLevel === 'files') {
    if (filePath) {
      const node = state.cyCode.getElementById(filePath);
      if (node.length) return filePath;
      const nodes = state.cyCode.nodes();
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        const info = n.data('info');
        if (info?.files && info.files.some(f => f.path === filePath)) return n.data('id');
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
