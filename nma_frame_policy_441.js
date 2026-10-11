'use strict';

const EXACT = new Set([
  '/', '/master', '/master/',
  '/spatial-twin', '/field-x1', '/digital-memory', '/master43',
  '/supervisore', '/audit', '/workflow', '/quality', '/enterprise-control',
  '/asset-memory', '/network-memory', '/command-center',
  '/sal', '/sal-v2', '/direzione', '/cantiere', '/ufficio', '/correzioni'
]);

const PREFIX = [
  /^\/master-final\/module\/[a-z0-9_-]+$/i,
  /^\/passaporto\/[^/]+$/i,
  /^\/confronto\/[^/]+$/i
];

function normalizePath(raw) {
  let p = String(raw || '').trim();
  if (!p) return '';
  const q = p.indexOf('?'); if (q >= 0) p = p.slice(0, q);
  const h = p.indexOf('#'); if (h >= 0) p = p.slice(0, h);
  try { p = decodeURIComponent(p); } catch (_) { return ''; }
  if (!p.startsWith('/') || p.includes('\\') || p.includes('..')) return '';
  return p.replace(/\/{2,}/g, '/');
}

function isInternalFramePath(raw) {
  const p = normalizePath(raw);
  if (!p) return false;
  if (EXACT.has(p)) return true;
  return PREFIX.some((re) => re.test(p));
}

function headersForPath(raw) {
  const allow = isInternalFramePath(raw);
  return {
    xFrameOptions: allow ? 'SAMEORIGIN' : 'DENY',
    csp: allow ? "frame-ancestors 'self'" : "frame-ancestors 'none'"
  };
}

module.exports = { EXACT, PREFIX, normalizePath, isInternalFramePath, headersForPath };
