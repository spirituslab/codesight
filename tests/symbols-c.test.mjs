import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('C symbol extraction', () => {
  it('extracts function with params and return type', () => {
    const result = parseFile(
      'int add(int a, int b) { return a+b; }',
      'c'
    );
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('add');
    expect(sym.kind).toBe('function');
    expect(sym.exported).toBe(true);
    expect(sym.returnType).toBe('int');
    expect(sym.parameters).toHaveLength(2);
    expect(sym.parameters[0]).toMatchObject({ name: 'a', type: 'int' });
    expect(sym.parameters[1]).toMatchObject({ name: 'b', type: 'int' });
  });

  it('extracts struct', () => {
    const result = parseFile(
      'struct Point { int x; int y; };',
      'c'
    );
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('Point');
    expect(sym.kind).toBe('class');
    expect(sym.exported).toBe(true);
  });

  it('extracts enum', () => {
    const result = parseFile(
      'enum Color { RED, GREEN, BLUE };',
      'c'
    );
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('Color');
    expect(sym.kind).toBe('class');
    expect(sym.exported).toBe(true);
  });

  it('extracts typedef', () => {
    const result = parseFile(
      'typedef struct Point Point;',
      'c'
    );
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('Point');
    expect(sym.kind).toBe('type');
    expect(sym.exported).toBe(true);
  });

  it('marks static functions as non-exported', () => {
    const result = parseFile(
      'static void helper() {}',
      'c'
    );
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('helper');
    expect(sym.kind).toBe('function');
    expect(sym.exported).toBe(false);
  });

  it('extracts includes with isSystem flag', () => {
    const code = `#include <stdio.h>\n#include "utils.h"`;
    const result = parseFile(code, 'c');
    expect(result.imports).toHaveLength(2);

    const systemInclude = result.imports.find(i => i.source === 'stdio.h');
    expect(systemInclude).toBeDefined();
    expect(systemInclude.isSystem).toBe(true);

    const localInclude = result.imports.find(i => i.source === 'utils.h');
    expect(localInclude).toBeDefined();
    expect(localInclude.isSystem).toBeUndefined();
  });
});
