import { describe, it, expect } from 'vitest';
import { detectDeadCode } from '../src/analyzer/dead-code.mjs';

function makeFile(path, symbols, opts = {}) {
  return {
    path,
    name: path.split('/').pop(),
    importedByCount: opts.importedByCount || 0,
    isEntryPoint: opts.isEntryPoint || false,
    symbols: symbols.map(s => ({
      name: s.name,
      kind: s.kind || 'function',
      exported: s.exported !== false,
      usedBy: s.usedBy || [],
    })),
  };
}

describe('detectDeadCode', () => {
  it('flags exported symbol with no importers or callers as dead', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/utils.ts', [{ name: 'helper' }])],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadSymbols).toHaveLength(1);
    expect(result.deadSymbols[0].name).toBe('helper');
    expect(result.deadSymbols[0].reason).toContain('never imported');
  });

  it('does not flag symbol with usedBy', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/utils.ts', [{ name: 'helper', usedBy: ['src/app.ts'] }])],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadSymbols).toHaveLength(0);
  });

  it('does not flag symbol with callers in call graph', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/utils.ts', [{ name: 'helper' }])],
    }];
    const callGraph = { edges: [{ source: 'src/app.ts::main', target: 'src/utils.ts::helper' }] };
    const result = detectDeadCode(modules, [], callGraph, []);
    expect(result.deadSymbols).toHaveLength(0);
  });

  it('never flags entry point file symbols as dead', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/index.ts', [{ name: 'main' }], { isEntryPoint: true })],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadSymbols).toHaveLength(0);
  });

  it('flags file as dead when all exported symbols are dead and no importers', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/dead.ts', [{ name: 'foo' }, { name: 'bar' }])],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadFiles).toHaveLength(1);
    expect(result.deadFiles[0].path).toBe('src/dead.ts');
  });

  it('does not flag file as dead if it has importers', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/used.ts', [{ name: 'foo' }], { importedByCount: 3 })],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadFiles).toHaveLength(0);
  });

  it('flags module as dead when no incoming edges and no entry points', () => {
    const modules = [
      { name: 'src', files: [makeFile('src/a.ts', [{ name: 'x' }])] },
      { name: 'orphan', files: [makeFile('orphan/b.ts', [{ name: 'y' }])] },
    ];
    const edges = [{ source: 'other', target: 'src', weight: 1 }];
    const result = detectDeadCode(modules, [], { edges: [] }, edges);
    expect(result.deadModules).toHaveLength(1);
    expect(result.deadModules[0].name).toBe('orphan');
  });

  it('does not flag module with entry points as dead', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/main.ts', [{ name: 'run' }], { isEntryPoint: true })],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadModules).toHaveLength(0);
  });

  it('returns correct stats', () => {
    const modules = [{
      name: 'src',
      files: [
        makeFile('src/alive.ts', [{ name: 'used', usedBy: ['x'] }]),
        makeFile('src/dead.ts', [{ name: 'unused' }]),
      ],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.stats.totalSymbols).toBe(2);
    expect(result.stats.deadSymbolCount).toBe(1);
    expect(result.stats.totalFiles).toBe(2);
    expect(result.stats.deadFileCount).toBe(1);
  });

  it('does not flag non-exported symbols as dead', () => {
    const modules = [{
      name: 'src',
      files: [makeFile('src/internal.ts', [{ name: 'private', exported: false }])],
    }];
    const result = detectDeadCode(modules, [], { edges: [] }, []);
    expect(result.deadSymbols).toHaveLength(0);
  });
});
