// Tour walkthrough UI

import { state } from './state.mjs';
import { escHtml, escJs } from './utils.mjs';

export function startTour(tourId, buildSymbolGraph, renderBreadcrumb, renderModuleView) {
  const tour = state.DATA.tours?.find(t => t.id === tourId);
  if (!tour) return;
  state.activeTour = tour;
  state.activeTourStep = 0;
  renderTourSidebar();
  navigateToTourStep(0, buildSymbolGraph, renderBreadcrumb);
}

export function renderTourSidebar() {
  if (!state.activeTour) return;
  let html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <h2 style="font-size:16px">${escHtml(state.activeTour.title)}</h2>
      <a href="#" onclick="exitTour();return false" style="color:#888;font-size:11px">Exit tour</a>
    </div>
    <div class="desc">${escHtml(state.activeTour.description || '')}</div>
    <div class="section-title">Steps (${state.activeTourStep + 1} of ${state.activeTour.steps.length})</div>
  `;

  for (let i = 0; i < state.activeTour.steps.length; i++) {
    const step = state.activeTour.steps[i];
    const isActive = i === state.activeTourStep;
    html += `<div class="tour-step ${isActive ? 'active' : ''}" onclick="navigateToTourStep(${i})">
      <div class="tour-step-num">Step ${i + 1}</div>
      <div class="tour-step-sym"><span class="kind kind-${step.kind || 'function'}" style="font-size:9px;margin-right:4px">${step.kind || 'fn'}</span>${escHtml(step.symbol)}</div>
      <div class="tour-step-file">${escHtml(step.file)} : ${step.line}</div>
      ${isActive ? `<div class="tour-step-explain">${escHtml(step.explanation || '')}</div>` : ''}
    </div>`;
  }

  html += `<div class="tour-nav">
    <button onclick="navigateToTourStep(${state.activeTourStep - 1})" ${state.activeTourStep <= 0 ? 'disabled' : ''}>← Previous</button>
    <button onclick="navigateToTourStep(${state.activeTourStep + 1})" ${state.activeTourStep >= state.activeTour.steps.length - 1 ? 'disabled' : ''}>Next →</button>
  </div>`;

  document.getElementById('sidebar-content').innerHTML = html;
}

export function navigateToTourStep(stepIndex, buildSymbolGraph, renderBreadcrumb) {
  if (!state.activeTour || stepIndex < 0 || stepIndex >= state.activeTour.steps.length) return;
  state.activeTourStep = stepIndex;
  const step = state.activeTour.steps[stepIndex];

  for (const mod of state.DATA.modules) {
    const file = mod.files.find(f => f.path === step.file);
    if (file) {
      state.currentModule = mod.name;
      state.currentSubdir = null;
      state.currentFile = file;
      state.currentLevel = 'symbols';
      renderBreadcrumb();
      buildSymbolGraph(file);
      break;
    }
  }
  if (!state.currentFile || state.currentFile.path !== step.file) {
    const rootFile = state.DATA.rootFiles?.find(f => f.path === step.file);
    if (rootFile) {
      state.currentModule = 'root';
      state.currentSubdir = null;
      state.currentFile = rootFile;
      state.currentLevel = 'symbols';
      renderBreadcrumb();
      buildSymbolGraph(rootFile);
    }
  }

  renderTourSidebar();
}

export function exitTour(renderModuleView) {
  state.activeTour = null;
  state.activeTourStep = 0;
  renderModuleView();
}
