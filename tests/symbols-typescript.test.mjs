import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('TypeScript symbol extraction', () => {
  it('extracts exported function with params and return type', () => {
    const result = parseFile(
      'export function greet(name: string, age?: number): string { return name; }',
      'typescript'
    );
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('greet');
    expect(sym.kind).toBe('function');
    expect(sym.exported).toBe(true);
    expect(sym.parameters).toHaveLength(2);
    expect(sym.parameters[0]).toMatchObject({ name: 'name', type: 'string' });
    expect(sym.parameters[1]).toMatchObject({ name: 'age' });
    expect(sym.returnType).toBe('string');
  });

  it('extracts non-exported function', () => {
    const result = parseFile('function helper() {}', 'typescript');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].exported).toBe(false);
  });

  it('extracts class with export', () => {
    const result = parseFile(
      'export class UserService {\n  getUser(id: string) { return id; }\n}',
      'typescript'
    );
    expect(result.symbols).toHaveLength(2);
    const cls = result.symbols[0];
    expect(cls.name).toBe('UserService');
    expect(cls.kind).toBe('class');
    expect(cls.exported).toBe(true);
    const method = result.symbols[1];
    expect(method.name).toBe('getUser');
    expect(method.kind).toBe('method');
    expect(method.className).toBe('UserService');
  });

  it('extracts interface', () => {
    const result = parseFile(
      'export interface User {\n  name: string;\n  age: number;\n}',
      'typescript'
    );
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('User');
    expect(result.symbols[0].kind).toBe('interface');
  });

  it('extracts type alias', () => {
    const result = parseFile('export type ID = string | number;', 'typescript');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('ID');
    expect(result.symbols[0].kind).toBe('type');
  });

  it('extracts const', () => {
    const result = parseFile('export const MAX_SIZE = 100;', 'typescript');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('MAX_SIZE');
    expect(result.symbols[0].kind).toBe('const');
  });

  it('extracts enum', () => {
    const result = parseFile('export enum Color { Red, Green, Blue }', 'typescript');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('Color');
    expect(result.symbols[0].kind).toBe('enum');
  });

  it('extracts multiple symbols from a file', () => {
    const code = `
export function foo() {}
export function bar() {}
export class Baz {}
const LIMIT = 10;
`;
    const result = parseFile(code, 'typescript');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('foo');
    expect(names).toContain('bar');
    expect(names).toContain('Baz');
  });

  it('extracts arrow function assigned to const', () => {
    const result = parseFile('export const add = (a: number, b: number) => a + b;', 'typescript');
    expect(result.symbols.length).toBeGreaterThanOrEqual(1);
    const sym = result.symbols.find(s => s.name === 'add');
    expect(sym).toBeDefined();
  });
});
