import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('C++ symbol extraction', () => {
  it('extracts class with methods and tracks access specifiers', () => {
    const code = `class Widget {
public:
    void draw() {}
    int getWidth() { return 0; }
private:
    void internal() {}
};`;
    const result = parseFile(code, 'cpp');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('Widget');
    expect(names).toContain('draw');
    expect(names).toContain('getWidth');
    expect(names).toContain('internal');

    const widget = result.symbols.find(s => s.name === 'Widget');
    expect(widget.kind).toBe('class');

    const draw = result.symbols.find(s => s.name === 'draw');
    expect(draw.kind).toBe('method');
    expect(draw.exported).toBe(true);
    expect(draw.className).toBe('Widget');

    const getWidth = result.symbols.find(s => s.name === 'getWidth');
    expect(getWidth.kind).toBe('method');
    expect(getWidth.exported).toBe(true);

    const internal = result.symbols.find(s => s.name === 'internal');
    expect(internal.kind).toBe('method');
    expect(internal.exported).toBe(false);
  });

  it('extracts namespace-prefixed symbols', () => {
    const code = `namespace MyApp {
    void init() {}
    class Config {};
}`;
    const result = parseFile(code, 'cpp');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('MyApp::init');
    expect(names).toContain('MyApp::Config');

    const init = result.symbols.find(s => s.name === 'MyApp::init');
    expect(init.kind).toBe('function');

    const config = result.symbols.find(s => s.name === 'MyApp::Config');
    expect(config.kind).toBe('class');
  });

  it('extracts using declarations as imports', () => {
    const code = `#include <iostream>\nusing std::cout;`;
    const result = parseFile(code, 'cpp');
    expect(result.imports.length).toBeGreaterThanOrEqual(2);

    const includeImport = result.imports.find(i => i.source === 'iostream');
    expect(includeImport).toBeDefined();
    expect(includeImport.isSystem).toBe(true);

    const usingImport = result.imports.find(i => i.source === 'std::cout');
    expect(usingImport).toBeDefined();
    expect(usingImport.symbols).toContain('cout');
  });

  it('extracts template functions and classes', () => {
    const code = `template <typename T>
T maximum(T a, T b) { return a > b ? a : b; }

template <typename T>
class Container {
public:
    void add(T item) {}
};`;
    const result = parseFile(code, 'cpp');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('maximum');
    expect(names).toContain('Container');

    const maximum = result.symbols.find(s => s.name === 'maximum');
    expect(maximum.kind).toBe('function');

    const container = result.symbols.find(s => s.name === 'Container');
    expect(container.kind).toBe('class');
  });
});
