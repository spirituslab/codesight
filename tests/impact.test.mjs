import { describe, it, expect } from 'vitest';
import { computeImpact } from '../src/analyzer/impact.mjs';

function makeFile(path, imports = [], symbols = []) {
  return {
    name: path.split('/').pop(),
    path,
    language: 'typescript',
    lineCount: 10,
    symbols: symbols.map(s => ({ name: s, kind: 'function', exported: true, usedBy: [] })),
    imports: imports.map(i => ({
      source: i,
      resolvedPath: i,
      resolvedModule: i.split('/')[0] || 'root',
      symbols: [],
      typeOnly: false,
    })),
  };
}

describe('computeImpact', () => {
  it('computes direct dependents', () => {
    const utils = makeFile('utils.ts', [], ['helper']);
    const app = makeFile('app.ts', ['utils'], ['main']);
    const result = computeImpact([], [utils, app], { edges: [] });
    expect(result['utils.ts']).toBeDefined();
    expect(result['utils.ts'].directDependents).toContain('app.ts');
  });

  it('computes transitive dependents', () => {
    const core = makeFile('core.ts', [], ['coreFunc']);
    const utils = makeFile('utils.ts', ['core'], ['utilFunc']);
    const app = makeFile('app.ts', ['utils'], ['main']);
    const result = computeImpact([], [core, utils, app], { edges: [] });
    // core is imported by utils, which is imported by app
    expect(result['core.ts']).toBeDefined();
    expect(result['core.ts'].transitiveDependents).toContain('app.ts');
    expect(result['core.ts'].transitiveDependents).toContain('utils.ts');
  });

  it('assigns risk levels based on dependent count', () => {
    const core = makeFile('core.ts', [], ['coreFunc']);
    // Create many dependents
    const dependents = [];
    for (let i = 0; i < 12; i++) {
      dependents.push(makeFile(`dep${i}.ts`, ['core'], [`func${i}`]));
    }
    const result = computeImpact([], [core, ...dependents], { edges: [] });
    expect(result['core.ts'].riskLevel).toBe('high');
  });

  it('assigns low risk for few dependents', () => {
    const utils = makeFile('utils.ts', [], ['helper']);
    const app = makeFile('app.ts', ['utils'], ['main']);
    const result = computeImpact([], [utils, app], { edges: [] });
    expect(result['utils.ts'].riskLevel).toBe('low');
  });

  it('returns empty impact map for files with no dependents', () => {
    const lonely = makeFile('lonely.ts', [], ['func']);
    const result = computeImpact([], [lonely], { edges: [] });
    expect(result['lonely.ts']).toBeUndefined();
  });
});
