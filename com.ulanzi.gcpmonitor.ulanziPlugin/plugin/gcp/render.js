const W = 144;
const H = 144;
const FONT = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

const esc = (s) =>
  String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));

const clip = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}\u2026` : str;
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const colorFor = (pct) => (pct >= 85 ? '#ff4d4f' : pct >= 60 ? '#ffb020' : '#3ddc84');

const dataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

const frame = (inner, bg = '#1e1f22') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">` +
  `<rect x="0" y="0" width="${W}" height="${H}" rx="18" fill="${bg}"/>${inner}</svg>`;

const bar = (x, y, w, h, pct, color) => {
  const fill = Math.round((clamp(pct, 0, 100) / 100) * w);
  const r = h / 2;
  const track = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="#2b2d31"/>`;
  const value = fill >= h ? `<rect x="${x}" y="${y}" width="${fill}" height="${h}" rx="${r}" fill="${color}"/>` : '';
  return track + value;
};

const text = (x, y, str, { size = 12, fill = '#ffffff', weight = 400, anchor = 'start', spacing } = {}) =>
  `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" fill="${fill}" font-weight="${weight}"` +
  `${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${spacing ? ` letter-spacing="${spacing}"` : ''}>${esc(str)}</text>`;

const fmtCount = (n) => {
  const v = Math.round(n);
  if (v >= 100000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  return String(v);
};

const metricRow = (m, labelY, barY) => {
  const label = text(12, labelY, clip(m.label, 5), { size: 12, fill: '#9a9da1' });
  if (m.stale || !Number.isFinite(m.value)) {
    return (
      label +
      text(132, labelY, 'N/A', { size: 16, weight: 700, anchor: 'end', fill: '#7c7f84' }) +
      bar(12, barY, 120, 10, 0, '#5a5d63')
    );
  }
  if (m.kind === 'count') {
    return label + text(132, labelY, fmtCount(m.value), { size: 18, weight: 700, anchor: 'end' });
  }
  const pct = Math.round(clamp(m.value, 0, 100));
  return (
    label +
    text(132, labelY, `${pct}%`, { size: 16, weight: 700, anchor: 'end' }) +
    bar(12, barY, 120, 10, pct, colorFor(pct))
  );
};

export const renderMetrics = ({ name, showName = true, rows = [] }) => {
  const items = rows.slice(0, showName ? 2 : 3);
  const count = Math.max(1, items.length);
  const areaTop = showName ? 40 : 16;
  const slotH = (136 - areaTop) / count;

  const parts = ['<circle cx="133" cy="13" r="4" fill="#3ddc84"/>'];
  if (showName) parts.push(text(12, 22, clip(name, 16), { size: 13, fill: '#c7c9cc', weight: 600 }));

  items.forEach((m, i) => {
    const pairTop = areaTop + i * slotH + (slotH - 26) / 2;
    parts.push(metricRow(m, Math.round(pairTop + 12), Math.round(pairTop + 18)));
  });

  return dataUri(frame(parts.join('')));
};

export const renderDown = ({ name, ageText, showName = true }) => {
  const inner =
    (showName ? text(72, 20, clip(name, 18), { size: 12, fill: '#c7c9cc', weight: 600, anchor: 'middle' }) : '') +
    '<g transform="translate(72,74)">' +
    '<path d="M0,-30 L34,28 L-34,28 Z" fill="#3a1b1b" stroke="#ff4d4f" stroke-width="3" stroke-linejoin="round"/>' +
    '<rect x="-3" y="-14" width="6" height="24" rx="3" fill="#ff4d4f"/>' +
    '<circle cx="0" cy="20" r="3.5" fill="#ff4d4f"/>' +
    '</g>' +
    text(72, 122, 'DOWN', { size: 18, fill: '#ff6b6b', weight: 800, anchor: 'middle', spacing: 1 }) +
    text(72, 138, ageText || 'no data', { size: 9, fill: '#8a5a5a', anchor: 'middle' });
  return dataUri(frame(inner, '#241111'));
};

export const renderError = ({ title, message, showName = true }) => {
  const inner =
    (showName ? text(72, 22, clip(title, 16), { size: 12, fill: '#c7c9cc', weight: 600, anchor: 'middle' }) : '') +
    '<g transform="translate(72,66)">' +
    '<circle r="26" fill="#3a2a12" stroke="#ffb020" stroke-width="3"/>' +
    '<rect x="-3" y="-15" width="6" height="20" rx="3" fill="#ffb020"/>' +
    '<circle cx="0" cy="12" r="3.5" fill="#ffb020"/>' +
    '</g>' +
    text(72, 112, 'ERROR', { size: 14, fill: '#ffb020', weight: 800, anchor: 'middle' }) +
    text(72, 130, clip(message, 26), { size: 8, fill: '#9a8a6a', anchor: 'middle' });
  return dataUri(frame(inner, '#221a0e'));
};

export const renderSetup = () => {
  const inner =
    '<g transform="translate(72,58)">' +
    '<circle r="26" fill="#14263a" stroke="#4aa3ff" stroke-width="3"/>' +
    '<path d="M-9,0 h18 M0,-9 v18" stroke="#4aa3ff" stroke-width="4" stroke-linecap="round"/>' +
    '</g>' +
    text(72, 108, 'Configure', { size: 13, fill: '#cdd6df', weight: 700, anchor: 'middle' }) +
    text(72, 126, 'pick project & VM', { size: 9, fill: '#7c8794', anchor: 'middle' });
  return dataUri(frame(inner, '#0f1720'));
};

export const renderLoading = (name) => {
  const inner =
    text(72, 24, clip(name || 'GCP', 18), { size: 12, fill: '#c7c9cc', weight: 600, anchor: 'middle' }) +
    '<g transform="translate(72,78)">' +
    '<circle r="20" fill="none" stroke="#2b2d31" stroke-width="5"/>' +
    '<path d="M20,0 A20,20 0 0 1 0,20" fill="none" stroke="#4aa3ff" stroke-width="5" stroke-linecap="round"/>' +
    '</g>' +
    text(72, 126, 'loading', { size: 10, fill: '#7c7f84', anchor: 'middle' });
  return dataUri(frame(inner, '#101216'));
};
