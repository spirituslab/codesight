// Local search + global search modal

import { state } from './state.mjs';
import { escHtml, escJs, getColor } from './utils.mjs';

let allFilesFlat = [];
let allSymbolsFlat = [];

export function initSearch(navigateToFileFn, drillToModuleFn) {
  allFilesFlat = [...(state.DATA.rootFiles || []), ...(state.DATA.modules || []).flatMap(m => m.files)];
  allSymbolsFlat = [];
  for (const f of allFilesFlat) {
    const modName = state.DATA.modules.find(m => m.files.includes(f))?.name || 'root';
    for (const s of (f.symbols || [])) {
      if (s.exported) allSymbolsFlat.push({ ...s, filePath: f.path, fileName: f.name, moduleName: modName });
    }
  }

  // Local search
  const searchBox = document.getElementById('search-box');
  searchBox.addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase().trim();
    if (!query) { state.cyCode.elements().removeClass('dimmed').removeClass('search-match'); return; }
    state.cyCode.nodes().forEach(node => {
      const label = (node.data('label') || '').toLowerCase();
      const id = (node.data('id') || '').toLowerCase();
      if (label.includes(query) || id.includes(query)) { node.removeClass('dimmed').addClass('search-match'); }
      else { node.addClass('dimmed').removeClass('search-match'); }
    });
    state.cyCode.edges().addClass('dimmed');
  });

  // Global search input
  document.getElementById('global-search-input').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const results = document.getElementById('global-search-results');
    if (!q) {
      results.innerHTML = '<div class="search-section-title">Type to search files and symbols across the project</div>';
      return;
    }

    let html = '';

    const matchedFiles = allFilesFlat.filter(f =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    ).slice(0, 10);

    if (matchedFiles.length > 0) {
      html += '<div class="search-section-title">Files</div>';
      for (const f of matchedFiles) {
        const badges = [];
        if (f.isEntryPoint) badges.push('<span class="badge badge-entry">entry</span>');
        if (f.importedByCount > 10) badges.push('<span class="badge badge-hot">' + f.importedByCount + 'x imported</span>');
        html += `<div class="search-result-item" onclick="navigateToFile('${escJs(f.path)}')">
          <div class="search-result-name">${escHtml(f.name)} ${badges.join(' ')}</div>
          <div class="search-result-path">${escHtml(f.path)} &middot; ${f.lineCount} lines, ${f.symbols.length} symbols</div>
        </div>`;
      }
    }

    const matchedSymbols = allSymbolsFlat.filter(s =>
      s.name.toLowerCase().includes(q)
    ).slice(0, 15);

    if (matchedSymbols.length > 0) {
      html += '<div class="search-section-title">Symbols</div>';
      for (const s of matchedSymbols) {
        html += `<div class="search-result-item" onclick="navigateToFile('${escJs(s.filePath)}')">
          <div><span class="search-result-kind kind-${s.kind}">${s.kind}</span><span class="search-result-name">${escHtml(s.name)}</span></div>
          <div class="search-result-path">${escHtml(s.filePath)} &middot; line ${s.line}</div>
        </div>`;
      }
    }

    const matchedModules = state.DATA.modules.filter(m =>
      m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
    ).slice(0, 5);

    if (matchedModules.length > 0) {
      html += '<div class="search-section-title">Modules</div>';
      for (const m of matchedModules) {
        html += `<div class="search-result-item" onclick="closeGlobalSearch();drillToModule('${escJs(m.name)}')">
          <div class="search-result-name"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getColor(m.name)};margin-right:6px"></span>${escHtml(m.name)}</div>
          <div class="search-result-path">${escHtml(m.description)}</div>
        </div>`;
      }
    }

    if (!html) html = '<div class="search-section-title">No results</div>';
    results.innerHTML = html;
  });
}

export function getAllFilesFlat() { return allFilesFlat; }

export function openGlobalSearch() {
  const overlay = document.getElementById('global-search-overlay');
  overlay.style.display = 'block';
  const input = document.getElementById('global-search-input');
  input.value = '';
  input.focus();
  document.getElementById('global-search-results').innerHTML = '<div class="search-section-title">Type to search files and symbols across the project</div>';
}

export function closeGlobalSearch() {
  document.getElementById('global-search-overlay').style.display = 'none';
}
