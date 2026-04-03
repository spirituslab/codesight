// web/src/utils/helpers.js
export function escHtml(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function escJs(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
