import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('Rust symbol extraction', () => {
  it('extracts pub function', () => {
    const { symbols } = parseFile(`
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
`, 'rust');
    expect(symbols.length).toBeGreaterThanOrEqual(1);
    const sym = symbols.find(s => s.name === 'add');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('function');
    expect(sym.exported).toBe(true);
  });

  it('extracts non-pub function', () => {
    const { symbols } = parseFile(`
fn helper() {
}
`, 'rust');
    const sym = symbols.find(s => s.name === 'helper');
    expect(sym).toBeDefined();
    expect(sym.exported).toBe(false);
  });

  it('extracts struct', () => {
    const { symbols } = parseFile(`
pub struct Config {
    host: String,
    port: u16,
}
`, 'rust');
    const sym = symbols.find(s => s.name === 'Config');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('class');
    expect(sym.exported).toBe(true);
  });

  it('extracts enum', () => {
    const { symbols } = parseFile(`
pub enum Status {
    Active,
    Inactive,
}
`, 'rust');
    const sym = symbols.find(s => s.name === 'Status');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('enum');
  });

  it('extracts trait', () => {
    const { symbols } = parseFile(`
pub trait Drawable {
    fn draw(&self);
}
`, 'rust');
    const sym = symbols.find(s => s.name === 'Drawable');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('interface');
  });

  it('extracts impl methods', () => {
    const { symbols } = parseFile(`
struct Config {}

impl Config {
    pub fn new() -> Config {
        Config {}
    }
}
`, 'rust');
    const method = symbols.find(s => s.name === 'new' && s.kind === 'method');
    expect(method).toBeDefined();
    expect(method.className).toBe('Config');
  });

  it('extracts use declarations', () => {
    const { imports } = parseFile(`
use std::io;
use std::collections::{HashMap, HashSet};
`, 'rust');
    expect(imports.length).toBeGreaterThanOrEqual(2);
    const ioImport = imports.find(i => i.source.includes('io'));
    expect(ioImport).toBeDefined();
  });
});
