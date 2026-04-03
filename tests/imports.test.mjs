import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('TypeScript import extraction', () => {
  it('extracts named imports', () => {
    const result = parseFile('import { foo, bar } from "./utils";', 'typescript');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('./utils');
    expect(result.imports[0].symbols).toContain('foo');
    expect(result.imports[0].symbols).toContain('bar');
  });

  it('extracts default import', () => {
    const result = parseFile('import React from "react";', 'typescript');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('react');
    expect(result.imports[0].symbols).toContain('React');
  });

  it('detects type-only imports', () => {
    const result = parseFile('import type { User } from "./types";', 'typescript');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].typeOnly).toBe(true);
  });

  it('extracts re-exports', () => {
    const result = parseFile('export { helper } from "./helper";', 'typescript');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('./helper');
  });
});

describe('Python import extraction', () => {
  it('extracts simple import', () => {
    const result = parseFile('import os\n', 'python');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('os');
    expect(result.imports[0].symbols).toContain('os');
  });

  it('extracts from...import', () => {
    const result = parseFile('from pathlib import Path, PurePath\n', 'python');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('pathlib');
    expect(result.imports[0].symbols).toContain('Path');
    expect(result.imports[0].symbols).toContain('PurePath');
  });

  it('extracts relative imports', () => {
    const result = parseFile('from ..utils import helper\n', 'python');
    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].source).toBe('..utils');
    expect(result.imports[0].symbols).toContain('helper');
  });

  it('extracts aliased imports', () => {
    const result = parseFile('from collections import OrderedDict as OD\n', 'python');
    expect(result.imports).toHaveLength(1);
    // Should use alias name
    expect(result.imports[0].symbols).toContain('OD');
  });
});
