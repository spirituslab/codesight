// web/src/utils/colors.js
// Module/symbol color palette — ported from web/js/utils.mjs

const COLOR_PALETTE = [
  '#89b4fa', '#cba6f7', '#a6e3a1', '#f9e2af', '#f38ba8',
  '#89dceb', '#a6e3a1', '#f5c2e7', '#fab387', '#94e2d5',
  '#b4befe', '#f5c2e7', '#74c7ec', '#b4befe', '#a6e3a1',
  '#fab387', '#89dceb', '#cba6f7', '#f9e2af', '#94e2d5',
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function getColor(name) {
  return COLOR_PALETTE[hashStr(name) % COLOR_PALETTE.length];
}

export function getSymbolColor(kind) {
  const map = {
    function: '#89b4fa', method: '#89b4fa',
    class: '#cba6f7', struct: '#cba6f7',
    type: '#a6e3a1',
    interface: '#94e2d5', trait: '#94e2d5',
    const: '#f9e2af',
    enum: '#f38ba8',
    default: '#a6adc8',
  };
  return map[kind] || '#a6adc8';
}

export function shadeColor(hex, amount) {
  let r = parseInt(hex.slice(1, 3), 16) + amount;
  let g = parseInt(hex.slice(3, 5), 16) + amount;
  let b = parseInt(hex.slice(5, 7), 16) + amount;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

export function fadeColor(hex, opacity) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${opacity})`;
}
