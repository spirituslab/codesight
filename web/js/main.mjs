// Main entry point — state init, navigation, view rendering, keyboard, global wiring

import { state } from './state.mjs';
import { escHtml, escJs, getColor, getSymbolColor, shadeColor, fadeColor, updateLevelBadge, updateMinimap, explanationHtml } from './utils.mjs';
import { initCyCode, highlightConnected, unhighlightAll } from './cytoscape-setup.mjs';
import { initCyIdea, renderIdeaLayer, showIdeaDetail, backToOverview, highlightCodeRefs } from './idea-layer.mjs';
import { drawMappingLines, scheduleDrawMappingLines } from './mapping-canvas.mjs';
import { startTour, renderTourSidebar, navigateToTourStep as tourNavigate, exitTour } from './tour.mjs';
import { initSearch, getAllFilesFlat, openGlobalSearch, closeGlobalSearch } from './search.mjs';
import { initChat, updateChatContext } from './chat.mjs';

// --- Init data ---
state.DATA = window.CODEBASE_DATA;
if (!state.DATA) {
  document.body.innerHTML = '<div style="padding:40px;color:#f66;font-size:18px">Error: data.js failed to load. Run <code>node analyze.mjs</code> first.</div>';
  throw new Error('No data');
}
document.title = `codesight — ${state.DATA.projectName}`;
console.log('Loaded:', state.DATA.modules.length, 'modules,', state.DATA.edges.length, 'edges');
if (state.DATA.warnings?.length > 0) {
  console.warn(`Analysis warnings (${state.DATA.warnings.length}):`, state.DATA.warnings);
}

// --- Node tap handler ---
function handleNodeTap(e) {
  const node = e.target;
  const id = node.data('id');
  const nodeType = node.data('nodeType');
  if (state.currentLevel === 'modules') {
    drillToModule(id);
  } else if (state.currentLevel === 'subdirs') {
    const info = node.data('info');
    if (info && info.name) {
      if (info.name === '(root)') {
        drillToSubdir(state.currentModule, state.currentSubdir);
      } else {
        const deeper = state.currentSubdir ? state.currentSubdir + '/' + info.name : info.name;
        drillToNestedDir(state.currentModule, deeper);
      }
    }
  } else if (state.currentLevel === 'files') {
    drillToSymbols(id);
  } else if (state.currentLevel === 'symbols') {
    if (nodeType === 'export') {
      showExportDetail(node.data('info'), state.currentFile);
      if (node.data('info')?.source) showCodePopup(node.data('info'), state.currentFile);
    }
    else if (nodeType === 'import') showImportDetail(node.data('info'), state.currentFile);
    else if (nodeType === 'file') renderSymbolSidebar(state.currentFile);
  }
}

// --- Breadcrumb ---
function renderBreadcrumb() {
  const bc = document.getElementById('breadcrumb');
  let html = '';
  const projName = state.DATA.projectName || 'Project';
  if (state.currentLevel === 'modules') {
    html = `<span class="active">${escHtml(projName)}</span>`;
  } else {
    html = `<span onclick="renderModuleView()">${escHtml(projName)}</span>`;
    html += `<span class="sep">/</span>`;
    if (state.currentLevel === 'subdirs' && !state.currentSubdir) {
      html += `<span class="active">${escHtml(state.currentModule)}</span>`;
    } else {
      html += `<span onclick="drillToModule('${escJs(state.currentModule)}')">${escHtml(state.currentModule)}</span>`;
    }
    if (state.currentSubdir) {
      const parts = state.currentSubdir.split('/');
      for (let i = 0; i < parts.length; i++) {
        html += `<span class="sep">/</span>`;
        const partialPath = parts.slice(0, i + 1).join('/');
        const isLast = i === parts.length - 1;
        if (isLast && (state.currentLevel === 'subdirs' || state.currentLevel === 'files')) {
          html += `<span class="active">${escHtml(parts[i])}</span>`;
        } else {
          html += `<span onclick="drillToNestedDir('${escJs(state.currentModule)}','${escJs(partialPath)}')">${escHtml(parts[i])}</span>`;
        }
      }
    }
    if (state.currentLevel === 'symbols' && state.currentFile) {
      html += `<span class="sep">/</span><span class="active">${escHtml(state.currentFile.name)}</span>`;
    }
  }
  bc.innerHTML = html;
  updateChatContext();
}

// --- Helpers ---
function getModuleData(moduleName) {
  if (moduleName === 'root') {
    return { name: 'root', description: `${state.DATA.rootFiles.length} files in project root`, fileCount: state.DATA.rootFiles.length, lineCount: state.DATA.rootFiles.reduce((s,f)=>s+f.lineCount,0), files: state.DATA.rootFiles };
  }
  return state.DATA.modules.find(m => m.name === moduleName);
}

function getFileInnerPath(filePath, moduleName) {
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

function getSubdirMap(files, moduleName, nestedPath) {
  const subdirMap = new Map();
  for (const f of files) {
    let inner = getFileInnerPath(f.path, moduleName);
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

function getModuleConnections(moduleName) {
  const connections = [];
  for (const e of state.DATA.edges) {
    if (e.source === moduleName) connections.push({ module: e.target, weight: e.weight, direction: 'out' });
    else if (e.target === moduleName) connections.push({ module: e.source, weight: e.weight, direction: 'in' });
  }
  return connections.sort((a,b) => b.weight - a.weight);
}

function resolveImportPath(importSource, fromPath) {
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

// --- Level 1: Module Overview ---
function renderModuleView() {
  state.currentLevel = 'modules';
  state.currentModule = null;
  state.currentFile = null;
  renderBreadcrumb();

  const elements = [];
  const allModules = [...state.DATA.modules];
  if (state.DATA.rootFiles.length > 0) {
    allModules.push({
      name: 'root', path: '', description: `${state.DATA.rootFiles.length} files in project root`,
      fileCount: state.DATA.rootFiles.length, lineCount: state.DATA.rootFiles.reduce((s, f) => s + f.lineCount, 0),
      files: state.DATA.rootFiles,
    });
  }

  for (const mod of allModules) {
    const w = Math.max(40, Math.min(110, 15 * Math.log2(mod.lineCount + 1)));
    const color = getColor(mod.name);
    elements.push({ data: { id: mod.name, label: mod.name, color, borderColor: shadeColor(color, -40), size: w, sizeH: w * 0.65, info: mod } });
  }

  for (const edge of state.DATA.edges) {
    const srcExists = allModules.some(m => m.name === edge.source);
    const tgtExists = allModules.some(m => m.name === edge.target);
    if (!srcExists || !tgtExists) continue;
    elements.push({
      data: {
        id: `${edge.source}->${edge.target}`, source: edge.source, target: edge.target,
        width: Math.max(0.5, Math.min(6, Math.log2(edge.weight + 1))), rawWeight: edge.weight,
        edgeColor: getColor(edge.source),
      }
    });
  }

  state.cyCode.elements().remove();
  state.cyCode.add(elements);
  state.cyCode.layout({
    name: 'cose', animate: true, animationDuration: 400, nodeDimensionsIncludeLabels: true,
    idealEdgeLength: () => 180, nodeRepulsion: () => 14000, edgeElasticity: () => 100,
    gravity: 0.25, numIter: 1000, padding: 50, randomize: true, componentSpacing: 100, nodeOverlap: 20,
  }).run();
  state.cyCode.fit(undefined, 50);

  renderModuleSidebar(allModules);
  renderLegend(allModules);
  updateLevelBadge();
  setTimeout(() => { updateMinimap(); drawMappingLines(); }, 500);
}

function renderModuleSidebar(allModules) {
  const allFilesFlat = getAllFilesFlat();
  const total = allModules.reduce((s, m) => s + m.lineCount, 0);
  const totalFiles = allModules.reduce((s, m) => s + m.fileCount, 0);

  let html = `
    <h2>${escHtml(state.DATA.projectName)}</h2>
    <div class="subtitle">Generated ${state.DATA.generatedAt.split('T')[0]}${state.DATA.languages.length ? ' — ' + state.DATA.languages.join(', ') : ''}</div>
    <div class="desc">${state.DATA.ideaStructure?.projectSummary ? '<span class="ai-badge">AI</span> ' + escHtml(state.DATA.ideaStructure.projectSummary) : 'Interactive code structure visualization. Click any module to explore its files and symbols.'}</div>
    <div class="stats">
      <div class="stat"><div class="val">${allModules.length}</div><div class="label">Modules</div></div>
      <div class="stat"><div class="val">${totalFiles.toLocaleString()}</div><div class="label">Files</div></div>
      <div class="stat"><div class="val">${(total/1000).toFixed(0)}k</div><div class="label">Lines</div></div>
    </div>
    <div class="section-title">Modules by size</div>
    <ul class="file-list">
  `;
  for (const mod of allModules.sort((a,b) => b.lineCount - a.lineCount)) {
    html += `<li onclick="drillToModule('${escJs(mod.name)}')">
      <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${getColor(mod.name)};margin-right:6px"></span>${escHtml(mod.name)}</span>
      <span class="lines">${mod.fileCount} files, ${(mod.lineCount/1000).toFixed(1)}k lines</span>
    </li>`;
  }
  html += '</ul>';

  const entryFiles = allFilesFlat.filter(f => f.isEntryPoint);
  if (entryFiles.length > 0) {
    html += '<div class="section-title">Entry Points</div>';
    for (const f of entryFiles) {
      html += `<div class="key-file-item" onclick="navigateToFile('${escJs(f.path)}')">
        <span><span class="badge badge-entry">entry</span> ${escHtml(f.name)}</span>
        <span style="color:#666;font-size:11px">${escHtml(f.path)}</span>
      </div>`;
    }
  }

  if (state.DATA.keyFiles && state.DATA.keyFiles.length > 0) {
    html += '<div class="section-title">Key Files (most imported)</div>';
    for (const kf of state.DATA.keyFiles.slice(0, 10)) {
      const badges = [];
      if (kf.isEntryPoint) badges.push('<span class="badge badge-entry">entry</span>');
      badges.push('<span class="badge badge-imports">' + kf.importedByCount + 'x</span>');
      html += `<div class="key-file-item" onclick="navigateToFile('${escJs(kf.path)}')">
        <span>${badges.join(' ')} ${escHtml(kf.name)}</span>
      </div>`;
    }
  }

  if (state.DATA.tours && state.DATA.tours.length > 0) {
    html += '<div class="section-title">Guided Tours</div>';
    for (const tour of state.DATA.tours) {
      html += `<div class="tour-card" onclick="startTour('${escJs(tour.id)}')">
        <div class="tour-title">${escHtml(tour.title)}</div>
        <div class="tour-meta">${tour.steps.length} steps &middot; ${escHtml(tour.description || '').substring(0, 80)}</div>
      </div>`;
    }
  }

  document.getElementById('sidebar-content').innerHTML = html;
}

function renderLegend(allModules) {
  const top = allModules.sort((a,b) => b.lineCount - a.lineCount).slice(0, 12);
  let html = '<div class="title">Modules</div>';
  for (const m of top) {
    html += `<div class="item"><div class="dot" style="background:${getColor(m.name)}"></div>${escHtml(m.name)}</div>`;
  }
  document.getElementById('legend').innerHTML = html;
}

// --- Level 2: Module -> Subdirs or Files ---
function drillToModule(moduleName) {
  const mod = getModuleData(moduleName);
  if (!mod) return;
  state.currentModule = moduleName;
  state.currentSubdir = null;
  state.currentFile = null;
  drillToNestedDir(moduleName, null);
}

function drillToNestedDir(moduleName, nestedPath) {
  const mod = getModuleData(moduleName);
  if (!mod) return;
  state.currentModule = moduleName;
  state.currentSubdir = nestedPath;
  state.currentFile = null;

  const subdirMap = getSubdirMap(mod.files, moduleName, nestedPath);
  const subdirCount = [...subdirMap.keys()].filter(k => k !== '(root)').length;

  if (subdirCount >= 1 && subdirMap.has('(root)') && subdirMap.get('(root)').length > 0) {
    state.currentLevel = 'subdirs';
    renderBreadcrumb();
    renderSubdirView(mod, subdirMap);
  } else if (subdirCount === 1) {
    const onlyDir = [...subdirMap.keys()].find(k => k !== '(root)');
    const deeper = nestedPath ? nestedPath + '/' + onlyDir : onlyDir;
    drillToNestedDir(moduleName, deeper);
  } else if (subdirCount >= 2) {
    state.currentLevel = 'subdirs';
    renderBreadcrumb();
    renderSubdirView(mod, subdirMap);
  } else {
    drillToSubdir(moduleName, nestedPath);
  }
}

function renderSubdirView(mod, subdirMap) {
  const elements = [];
  const subdirs = [...subdirMap.entries()]
    .map(([name, files]) => ({ name, files, fileCount: files.length, lineCount: files.reduce((s, f) => s + f.lineCount, 0) }))
    .sort((a, b) => b.lineCount - a.lineCount);

  for (let si = 0; si < subdirs.length; si++) {
    const sub = subdirs[si];
    const w = Math.max(30, Math.min(80, 12 * Math.log2(sub.lineCount + 1)));
    const label = sub.name === '(root)' ? `${mod.name}/ files` : sub.name;
    const color = shadeColor(getColor(mod.name), si * 8 - 15);
    elements.push({
      data: {
        id: `subdir:${sub.name}`, label, color, borderColor: shadeColor(color, -30),
        size: w, sizeH: w * 0.65, nodeType: 'subdir', info: sub,
      }
    });
  }

  const edgeMap = new Map();
  for (const [subdirName, files] of subdirMap) {
    for (const f of files) {
      for (const imp of f.imports) {
        if (imp.resolvedModule !== mod.name && imp.resolvedModule !== 'root') continue;
        const targetPath = resolveImportPath(imp.source, f.path);
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
    elements.push({ data: { id: key, source: src, target: tgt, width: Math.max(0.5, Math.min(4, Math.log2(weight + 1))), rawWeight: weight, edgeColor: getColor(mod.name) } });
  }

  state.cyCode.elements().remove();
  state.cyCode.add(elements);
  state.cyCode.layout({ name: 'cose', animate: true, animationDuration: 400, nodeDimensionsIncludeLabels: true, idealEdgeLength: () => 150, nodeRepulsion: () => 10000, gravity: 0.3, numIter: 1000, padding: 50, randomize: true, nodeOverlap: 20 }).run();
  state.cyCode.fit(undefined, 40);

  renderSubdirSidebar(mod, subdirs);
  document.getElementById('legend').innerHTML = '';
  updateLevelBadge();
  setTimeout(() => { updateMinimap(); drawMappingLines(); }, 500);
}

function renderSubdirSidebar(mod, subdirs) {
  const connections = getModuleConnections(mod.name);
  let html = `
    <h2>${escHtml(mod.name)}</h2>
    <div class="subtitle">${escHtml(mod.path || mod.name)}/</div>
    <div class="desc">${mod.explanation ? '<span class="ai-badge">AI</span> ' + escHtml(mod.explanation) : escHtml(mod.description || '')}</div>
    <div class="stats">
      <div class="stat"><div class="val">${subdirs.length}</div><div class="label">Folders</div></div>
      <div class="stat"><div class="val">${mod.files.length}</div><div class="label">Files</div></div>
      <div class="stat"><div class="val">${(mod.lineCount/1000).toFixed(1)}k</div><div class="label">Lines</div></div>
    </div>
  `;
  if (connections.length > 0) {
    html += '<div class="section-title">Dependencies</div><div>';
    for (const c of connections.slice(0, 10)) {
      html += `<div class="connection-item"><span>${c.direction === 'out' ? '→' : '←'} ${escHtml(c.module)}</span><span class="weight">${c.weight} imports</span></div>`;
    }
    html += '</div>';
  }
  html += '<div class="section-title">Subdirectories</div><ul class="file-list">';
  for (const sub of subdirs) {
    const label = sub.name === '(root)' ? '(files in root)' : sub.name + '/';
    if (sub.name === '(root)') {
      html += `<li onclick="drillToSubdir('${escJs(mod.name)}', ${state.currentSubdir ? "'" + escJs(state.currentSubdir) + "'" : 'null'})">
        <span>${escHtml(label)}</span>
        <span class="lines">${sub.fileCount} files, ${(sub.lineCount/1000).toFixed(1)}k lines</span>
      </li>`;
    } else {
      const deeper = state.currentSubdir ? state.currentSubdir + '/' + sub.name : sub.name;
      html += `<li onclick="drillToNestedDir('${escJs(mod.name)}', '${escJs(deeper)}')">
        <span>${escHtml(label)}</span>
        <span class="lines">${sub.fileCount} files, ${(sub.lineCount/1000).toFixed(1)}k lines</span>
      </li>`;
    }
  }
  html += '</ul>';
  document.getElementById('sidebar-content').innerHTML = html;
}

// --- Level 2b: Files ---
function drillToSubdir(moduleName, nestedPath) {
  state.currentLevel = 'files';
  state.currentModule = moduleName;
  state.currentSubdir = nestedPath;
  state.currentFile = null;
  renderBreadcrumb();

  const mod = getModuleData(moduleName);
  if (!mod) return;

  const subdirMap = getSubdirMap(mod.files, moduleName, nestedPath);
  let files;
  if (nestedPath === null) {
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
    elements.push({ data: { id: f.path, label, color: modColor, borderColor: shadeColor(modColor, -30), size: w, sizeH: w * 0.6, info: f }, classes: classes.join(' ') });
  }

  const filePaths = new Set(files.map(f => f.path));
  for (const f of files) {
    for (const imp of f.imports) {
      if (imp.resolvedModule === 'external') continue;
      const targetPath = resolveImportPath(imp.source, f.path);
      if (!targetPath) continue;
      for (const fp of filePaths) {
        if (fp === f.path) continue;
        if (fp.replace(/\.[^.]+$/, '').endsWith(targetPath) || fp === targetPath) {
          const edgeId = `${f.path}->${fp}`;
          if (!elements.some(e => e.data?.id === edgeId)) {
            elements.push({ data: { id: edgeId, source: f.path, target: fp, width: 1, rawWeight: 1, edgeColor: modColor } });
          }
          break;
        }
      }
    }
  }

  state.cyCode.elements().remove();
  state.cyCode.add(elements);
  const layoutName = files.length > 150 ? 'concentric' : 'cose';
  state.cyCode.layout({
    name: layoutName, animate: true, animationDuration: 400, nodeDimensionsIncludeLabels: true, randomize: true, padding: 40,
    ...(layoutName === 'cose' ? { idealEdgeLength: () => files.length > 80 ? 90 : 130, nodeRepulsion: () => 9000, gravity: 0.35, numIter: 1000, nodeOverlap: 20 }
      : { concentric: (node) => node.degree(), levelWidth: () => 3, minNodeSpacing: 25 }),
  }).run();
  state.cyCode.fit(undefined, 40);

  const subdirName = nestedPath;
  renderFileListSidebar(mod, files, subdirName);
  document.getElementById('legend').innerHTML = '';
  updateLevelBadge();
  setTimeout(() => { updateMinimap(); drawMappingLines(); }, 500);
}

function renderFileListSidebar(mod, files, subdirName) {
  const lineCount = files.reduce((s,f) => s + f.lineCount, 0);
  const totalSymbols = files.reduce((s,f) => s + f.symbols.length, 0);
  const title = subdirName ? `${mod.name}/${subdirName}` : mod.name;

  let html = `
    <h2>${escHtml(title)}</h2>
    <div class="subtitle">${escHtml(subdirName ? mod.name + '/' + subdirName + '/' : (mod.path || mod.name) + '/')}</div>
    <div class="desc">${mod.explanation ? '<span class="ai-badge">AI</span> ' + escHtml(mod.explanation) : escHtml(mod.description || '')}</div>
    <div class="stats">
      <div class="stat"><div class="val">${files.length}</div><div class="label">Files</div></div>
      <div class="stat"><div class="val">${(lineCount/1000).toFixed(1)}k</div><div class="label">Lines</div></div>
      <div class="stat"><div class="val">${totalSymbols}</div><div class="label">Symbols</div></div>
    </div>
    <div class="section-title">Files</div>
    <ul class="file-list">
  `;
  for (const f of files) {
    const langBadge = f.language ? `<span class="lang-badge">${f.language}</span>` : '';
    html += `<li onclick="drillToSymbols('${escJs(f.path)}')">
      <span>${escHtml(f.name)}${langBadge}</span>
      <span class="lines">${f.lineCount} lines, ${f.symbols.length} symbols</span>
    </li>`;
  }
  html += '</ul>';
  document.getElementById('sidebar-content').innerHTML = html;
}

// --- Level 3: Symbols ---
function drillToSymbols(filePath) {
  const mod = state.currentModule === 'root'
    ? { name: 'root', files: state.DATA.rootFiles }
    : state.DATA.modules.find(m => m.name === state.currentModule);
  if (!mod) return;
  const file = mod.files.find(f => f.path === filePath);
  if (!file) return;

  state.currentLevel = 'symbols';
  state.currentFile = file;
  renderBreadcrumb();
  buildSymbolGraph(file);
  renderSymbolSidebar(file);
}

function buildSymbolGraph(file) {
  const elements = [];
  const centerX = 0, centerY = 0;

  const centerColor = getColor(state.currentModule);
  elements.push({
    data: { id: 'center', label: file.name.replace(/\.[^.]+$/, ''), color: centerColor, borderColor: shadeColor(centerColor, -30), size: 70, sizeH: 50, nodeType: 'file', info: file },
    position: { x: centerX, y: centerY },
  });

  const exported = file.symbols.filter(s => s.exported);
  for (let i = 0; i < exported.length; i++) {
    const angle = ((i / Math.max(exported.length, 1)) * Math.PI) - Math.PI / 2;
    const radius = 180 + (exported.length > 10 ? 50 : 0);
    const symColor = getSymbolColor(exported[i].kind);
    elements.push({
      data: {
        id: `export:${exported[i].name}`, label: exported[i].name, color: symColor, borderColor: shadeColor(symColor, -30),
        size: 36, sizeH: 26, nodeType: 'export', info: exported[i],
      },
      position: { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) },
    });
    elements.push({ data: { id: `center->export:${exported[i].name}`, source: 'center', target: `export:${exported[i].name}`, width: 1.5, rawWeight: 1, edgeColor: symColor } });
  }

  const imports = file.imports;
  for (let i = 0; i < imports.length; i++) {
    const imp = imports[i];
    const angle = ((i / Math.max(imports.length, 1)) * Math.PI) + Math.PI / 2;
    const radius = 220 + (imports.length > 10 ? 50 : 0);
    const nodeId = `import:${i}:${imp.source}`;
    const srcParts = imp.source.replace(/\.[^.]+$/, '').split('/');
    const shortLabel = srcParts[srcParts.length - 1];
    const impColor = imp.resolvedModule === 'external' ? '#555' : getColor(imp.resolvedModule);

    elements.push({
      data: { id: nodeId, label: shortLabel, color: impColor, borderColor: shadeColor(impColor, -20), size: 32, sizeH: 22, nodeType: 'import', info: imp },
      position: { x: centerX + radius * Math.cos(angle), y: centerY + radius * Math.sin(angle) },
    });
    elements.push({ data: { id: `${nodeId}->center`, source: nodeId, target: 'center', width: 1, rawWeight: imp.symbols.length || 1, edgeColor: impColor } });
  }

  state.cyCode.elements().remove();
  state.cyCode.add(elements);
  state.cyCode.layout({ name: 'preset' }).run();
  state.cyCode.fit(undefined, 50);

  updateLevelBadge();
  setTimeout(() => { updateMinimap(); drawMappingLines(); }, 100);
  document.getElementById('legend').innerHTML = `
    <div class="title">Symbol types</div>
    <div class="item"><div class="dot" style="background:#3b82f6"></div>function</div>
    <div class="item"><div class="dot" style="background:#a855f7"></div>class</div>
    <div class="item"><div class="dot" style="background:#10b981"></div>type</div>
    <div class="item"><div class="dot" style="background:#14b8a6"></div>interface</div>
    <div class="item"><div class="dot" style="background:#f59e0b"></div>const</div>
    <div class="item"><div class="dot" style="background:#ec4899"></div>enum</div>
    <div class="item"><div class="dot" style="background:#666"></div>external import</div>
  `;
}

function renderSymbolSidebar(file) {
  const exported = file.symbols.filter(s => s.exported);
  let html = `
    <h2>${escHtml(file.name)}</h2>
    <div class="subtitle">${escHtml(file.path)}${file.language ? ' <span class="lang-badge">' + file.language + '</span>' : ''}</div>
    <div class="stats">
      <div class="stat"><div class="val">${file.lineCount}</div><div class="label">Lines</div></div>
      <div class="stat"><div class="val">${exported.length}</div><div class="label">Exports</div></div>
      <div class="stat"><div class="val">${file.imports.length}</div><div class="label">Imports</div></div>
    </div>
    ${file.explanation ? '<div class="ai-explanation"><span class="ai-badge">AI</span> ' + escHtml(file.explanation) + '</div>' : '<div class="desc" style="font-size:12px;color:#888;margin-bottom:8px">Click any node in the graph to see details</div>'}
  `;

  if (exported.length > 0) {
    html += '<div class="section-title">Exported Symbols</div><ul class="export-list">';
    for (const sym of exported) {
      const sigPreview = sym.signature ? sym.signature.split('\n')[0].substring(0, 80) : '';
      const riskBadge = sym.impact ? `<span class="risk-badge risk-${sym.impact.riskLevel}" style="margin-left:6px;font-size:8px">${sym.impact.riskLevel}</span>` : '';
      const callsBadge = sym.calls?.length ? `<span style="font-size:9px;color:#555;margin-left:4px">→${sym.calls.length}</span>` : '';
      html += `<li class="export-item" onclick="showExportDetail(currentFile.symbols.find(x=>x.name==='${escJs(sym.name)}' && x.exported), currentFile)">
        <div><span class="kind kind-${sym.kind}">${sym.kind}</span><strong>${escHtml(sym.name)}</strong>${riskBadge}${callsBadge}</div>
        ${sigPreview ? `<div class="sig-preview">${escHtml(sigPreview)}</div>` : ''}
        ${sym.comment ? `<div class="comment-preview">${escHtml(sym.comment.split('\n')[0].substring(0, 100))}</div>` : ''}
      </li>`;
    }
    html += '</ul>';
  }

  if (file.imports.length > 0) {
    html += '<div class="section-title">Imports</div><ul class="import-list">';
    for (let i = 0; i < file.imports.length; i++) {
      const imp = file.imports[i];
      const symbols = imp.symbols.length > 0 ? imp.symbols.join(', ') : '(side-effect)';
      const typeTag = imp.typeOnly ? '<span class="type-tag">type</span>' : '';
      const srcShort = imp.source.replace(/\.[^.]+$/, '').split('/').pop();
      html += `<li class="import-item" onclick="showImportDetail(currentFile.imports[${i}], currentFile)">
        <div>
          <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${imp.resolvedModule === 'external' ? '#666' : getColor(imp.resolvedModule)};margin-right:4px"></span>
          <strong>${escHtml(srcShort)}</strong> ${typeTag}
          <span style="color:#555;font-size:10px;margin-left:4px">${escHtml(imp.resolvedModule)}</span>
        </div>
        <div style="font-size:11px;color:#888;padding-left:14px;font-family:monospace">${escHtml(symbols)}</div>
      </li>`;
    }
    html += '</ul>';
  }

  document.getElementById('sidebar-content').innerHTML = html;
}

function showExportDetail(sym, file) {
  if (!sym) return;
  let html = `
    <h2>${escHtml(sym.name)}</h2>
    <div class="subtitle"><span class="kind kind-${sym.kind}" style="font-size:12px">${sym.kind}</span> ${sym.exported ? 'exported from' : 'in'} ${escHtml(file.name)} <span style="color:#666;font-size:11px">line ${sym.line}</span></div>
  `;
  if (sym.signature) html += `<div class="section-title">Signature</div><pre class="code-block">${escHtml(sym.signature)}</pre>`;
  if (sym.parameters && sym.parameters.length > 0) {
    html += '<div class="section-title">Parameters</div><ul class="param-list">';
    for (const p of sym.parameters) html += `<li><span class="param-name">${escHtml(p.name)}</span>${p.type ? `<span class="param-type">${escHtml(p.type)}</span>` : ''}</li>`;
    html += '</ul>';
  }
  if (sym.returnType) html += `<div class="section-title">Returns</div><div class="desc" style="font-family:monospace;color:#6ee7b7">${escHtml(sym.returnType)}</div>`;
  if (sym.explanation) html += `<div class="section-title">Explanation</div><div class="ai-explanation"><span class="ai-badge">AI</span> ${escHtml(sym.explanation)}</div>`;
  if (sym.comment) html += `<div class="section-title">Description</div><div class="desc">${escHtml(sym.comment)}</div>`;

  if (sym.impact) {
    const imp = sym.impact;
    html += `<div class="section-title">Impact</div>
      <div style="margin-bottom:12px">
        <span class="risk-badge risk-${imp.riskLevel}">${imp.riskLevel} risk</span>
        <span style="font-size:11px;color:#888;margin-left:8px">${imp.directCallers} direct callers, ${imp.impactedFiles} files affected</span>
      </div>`;
  }
  if (sym.calls && sym.calls.length > 0) {
    html += `<div class="section-title">Calls (${sym.calls.length})</div><ul class="call-list">`;
    for (const c of sym.calls) html += `<li onclick="navigateToFile('${escJs(c.resolvedFile || file.path)}')"><span><span class="call-dir">→</span>${escHtml(c.name)}</span><span style="font-size:10px;color:#555">line ${c.line}</span></li>`;
    html += '</ul>';
  }
  if (sym.calledBy && sym.calledBy.length > 0) {
    html += `<div class="section-title">Called by (${sym.calledBy.length})</div><ul class="call-list">`;
    for (const c of sym.calledBy) html += `<li onclick="navigateToFile('${escJs(c.file)}')"><span><span class="call-dir">←</span>${escHtml(c.symbol)}</span><span style="font-size:10px;color:#555">${escHtml(c.file.split('/').pop())}</span></li>`;
    html += '</ul>';
  }
  if (sym.usedBy && sym.usedBy.length > 0) {
    html += `<div class="section-title">Imported by (${sym.usedBy.length} files)</div><ul class="used-by-list">`;
    for (const path of sym.usedBy) html += `<li onclick="navigateToFile('${escJs(path)}')">${escHtml(path)}</li>`;
    html += '</ul>';
  }
  html += `<div class="section-title" style="margin-top:20px">File context</div><div class="desc" style="font-size:12px;color:#888">Part of <strong>${escHtml(file.path)}</strong> (${file.lineCount} lines)<br>Module: <strong>${escHtml(state.currentModule)}</strong></div>`;
  if (sym.source) html += `<div style="margin-top:12px"><a href="#" onclick="showCodePopup(currentFile.symbols.find(x=>x.name==='${escJs(sym.name)}' && x.exported), currentFile);return false" style="color:#7dd3fc;font-size:12px;display:inline-flex;align-items:center;gap:4px"><kbd style="font-size:10px">&lt;/&gt;</kbd> View source code</a></div>`;

  const others = file.symbols.filter(e => e.name !== sym.name && e.exported);
  if (others.length > 0) {
    html += '<div class="section-title">Other exports in this file</div><ul class="export-list">';
    for (const e of others) html += `<li style="cursor:pointer" onclick="showExportDetail(currentFile.symbols.find(x=>x.name==='${escJs(e.name)}' && x.exported), currentFile)"><span class="kind kind-${e.kind}">${e.kind}</span>${escHtml(e.name)}</li>`;
    html += '</ul>';
  }
  html += `<div style="margin-top:16px"><a href="#" onclick="renderSymbolSidebar(currentFile);return false" style="color:#7dd3fc;font-size:12px">\u2190 Back to file overview</a></div>`;
  document.getElementById('sidebar-content').innerHTML = html;
}

function showImportDetail(imp, file) {
  let html = `
    <h2>${escHtml(imp.source.replace(/\.[^.]+$/, '').split('/').pop())}</h2>
    <div class="subtitle">Imported into ${escHtml(file.name)}</div>
    <div class="section-title">Source</div><pre class="code-block">${escHtml(imp.source)}</pre>
    <div class="section-title">Module</div>
    <div class="desc">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${imp.resolvedModule === 'external' ? '#666' : getColor(imp.resolvedModule)};margin-right:6px"></span>
      <strong>${escHtml(imp.resolvedModule)}</strong>
      ${imp.typeOnly ? '<span style="color:#888;font-size:11px;margin-left:6px">(type-only import)</span>' : ''}
    </div>
  `;
  if (imp.symbols.length > 0) {
    html += '<div class="section-title">Imported symbols</div><ul class="export-list">';
    for (const sym of imp.symbols) html += `<li style="font-family:monospace;font-size:12px">${escHtml(sym)}</li>`;
    html += '</ul>';
  } else {
    html += '<div class="section-title">Import type</div><div class="desc">Side-effect import (no named symbols)</div>';
  }
  html += `<div style="margin-top:16px"><a href="#" onclick="renderSymbolSidebar(currentFile);return false" style="color:#7dd3fc;font-size:12px">\u2190 Back to file overview</a></div>`;
  document.getElementById('sidebar-content').innerHTML = html;
}

// --- Code popup ---
function showCodePopup(sym, file) {
  if (!sym || !sym.source) return;
  document.getElementById('code-popup-title').innerHTML =
    `<span class="kind kind-${sym.kind}" style="font-size:11px;margin-right:6px">${sym.kind}</span>${escHtml(sym.name)}`;
  document.getElementById('code-popup-meta').textContent =
    `${file.path} : line ${sym.line}` + (sym.returnType ? ` → ${sym.returnType}` : '');
  const srcLines = sym.source.split('\n');
  const startLine = sym.line;
  let html = '';
  for (let i = 0; i < srcLines.length; i++) {
    const lineNo = startLine + i;
    html += `<span class="line-num">${lineNo}</span>${escHtml(srcLines[i])}\n`;
  }
  document.getElementById('code-popup-code').innerHTML = html;
  document.getElementById('code-popup-overlay').style.display = 'block';
}

function closeCodePopup() {
  document.getElementById('code-popup-overlay').style.display = 'none';
}

function navigateToFile(filePath) {
  for (const mod of state.DATA.modules) {
    const file = mod.files.find(f => f.path === filePath);
    if (file) {
      state.currentModule = mod.name;
      state.currentSubdir = null;
      drillToSymbols(filePath);
      closeGlobalSearch();
      return;
    }
  }
  const rootFile = state.DATA.rootFiles.find(f => f.path === filePath);
  if (rootFile) {
    state.currentModule = 'root';
    state.currentSubdir = null;
    drillToSymbols(filePath);
    closeGlobalSearch();
  }
}

// --- Keyboard ---
const searchBox = document.getElementById('search-box');
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.activeElement === searchBox) {
      searchBox.value = ''; searchBox.blur();
      state.cyCode.elements().removeClass('dimmed').removeClass('search-match');
      return;
    }
    if (state.activeIdeaNode) {
      state.activeIdeaNode = null;
      if (state.cyIdea) state.cyIdea.elements().removeClass('dimmed').removeClass('highlighted');
      state.cyCode.elements().removeClass('dimmed').removeClass('highlighted');
      drawMappingLines();
      renderModuleView();
      return;
    }
    if (state.currentLevel === 'symbols') {
      if (state.currentSubdir !== null) drillToSubdir(state.currentModule, state.currentSubdir);
      else drillToModule(state.currentModule);
    } else if (state.currentLevel === 'files') {
      if (state.currentSubdir) {
        const parentPath = state.currentSubdir.includes('/') ? state.currentSubdir.substring(0, state.currentSubdir.lastIndexOf('/')) : null;
        if (parentPath) drillToNestedDir(state.currentModule, parentPath);
        else renderModuleView();
      } else {
        renderModuleView();
      }
    } else if (state.currentLevel === 'subdirs') {
      if (state.currentSubdir) {
        const parentPath = state.currentSubdir.includes('/') ? state.currentSubdir.substring(0, state.currentSubdir.lastIndexOf('/')) : null;
        if (parentPath) drillToNestedDir(state.currentModule, parentPath);
        else renderModuleView();
      } else {
        renderModuleView();
      }
    } else if (state.currentLevel === 'modules') {
      // Already at top level, nothing to do
    }
  }
  if (e.key === '/' && document.activeElement !== searchBox && document.activeElement !== document.getElementById('global-search-input')) { e.preventDefault(); searchBox.focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); openGlobalSearch(); }
  if (e.key === 'Escape' && document.getElementById('code-popup-overlay').style.display === 'block') { closeCodePopup(); return; }
  if (e.key === 'Escape' && document.getElementById('global-search-overlay').style.display === 'block') { closeGlobalSearch(); return; }
});

// --- Expose globals for onclick handlers in HTML strings ---
window.renderModuleView = renderModuleView;
window.drillToModule = drillToModule;
window.drillToNestedDir = drillToNestedDir;
window.drillToSubdir = drillToSubdir;
window.drillToSymbols = drillToSymbols;
window.drillToFiles = drillToModule;
window.navigateToFile = navigateToFile;
window.showExportDetail = showExportDetail;
window.showImportDetail = showImportDetail;
window.renderSymbolSidebar = renderSymbolSidebar;
window.showCodePopup = showCodePopup;
window.closeCodePopup = closeCodePopup;
window.openGlobalSearch = openGlobalSearch;
window.closeGlobalSearch = closeGlobalSearch;
window.showIdeaDetail = showIdeaDetail;
window.backToOverview = () => backToOverview(renderModuleView);
window.drawMappingLines = drawMappingLines;
window.startTour = (id) => startTour(id, buildSymbolGraph, renderBreadcrumb, renderModuleView);
window.navigateToTourStep = (i) => tourNavigate(i, buildSymbolGraph, renderBreadcrumb);
window.exitTour = () => exitTour(renderModuleView);
// Expose state refs needed by onclick handlers
Object.defineProperty(window, 'currentFile', { get: () => state.currentFile });
Object.defineProperty(window, 'activeIdeaNode', { get: () => state.activeIdeaNode, set: (v) => { state.activeIdeaNode = v; } });

// --- Init ---
initSearch(navigateToFile, drillToModule);
const hasIdeas = !!state.DATA.ideaStructure;

if (!hasIdeas) {
  document.getElementById('idea-layer').classList.add('hidden');
  document.getElementById('code-layer').classList.add('full');
}

initCyCode(handleNodeTap);
if (hasIdeas) {
  initCyIdea();
  renderIdeaLayer();
}
initChat();
renderModuleView();
