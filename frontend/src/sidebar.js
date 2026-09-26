// Sidebar module: renders the report list panel.
// Contract: createSidebar(el, { onClearSelection }) → { render({ title, subtitle, reports, categoryLabels, loading, error, canClear }) }

const PALETTE = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#9085e9', '#e66767', '#008300'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function humanize(id) {
  if (!id) return 'Uncategorized';
  return String(id)
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Small deterministic string hash so the same category id always maps to the same palette colour.
function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function catColor(catId) {
  const hex = PALETTE[hashStr(String(catId || '')) % PALETTE.length];
  return { bg: `color-mix(in srgb, ${hex} 28%, var(--card-2))`, border: hex };
}

function formatDate(iso, withTime) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const opts = { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric' };
  if (withTime) {
    opts.hour = 'numeric';
    opts.minute = '2-digit';
  }
  return new Intl.DateTimeFormat('en-IN', opts).format(d);
}

function incidentString(r) {
  if (!r.incident_datetime || r.incident_datetime_precision === 'unknown') return '';
  if (r.incident_datetime_precision === 'exact') return formatDate(r.incident_datetime, true);
  if (r.incident_datetime_precision === 'date') return formatDate(r.incident_datetime, false);
  if (r.incident_datetime_precision === 'date_range') return `${formatDate(r.incident_datetime, false)} (night of)`;
  return '';
}

function sortKey(r) {
  const t = new Date(r.incident_datetime ?? r.published_datetime).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

function reportCard(r, categoryLabels) {
  const catLabel = esc(categoryLabels?.[r.category] ?? humanize(r.category ?? r.category_raw));
  const { bg, border } = catColor(r.category);
  const isNews = r.source_type === 'news';
  const badgeLabel = isNews ? 'News' : 'Police';
  const badgeClass = isNews ? 'sb-badge-news' : 'sb-badge-police';

  const topDateSrc = r.incident_datetime ?? r.published_datetime;
  const topDate = esc(formatDate(topDateSrc, false));

  const hasLink = typeof r.source_link === 'string' && /^https?:\/\//i.test(r.source_link);
  const titleText = esc(r.title || '(untitled report)');
  const titleInner = hasLink
    ? `<a class="sb-card-title-link" href="${esc(r.source_link)}" target="_blank" rel="noopener">${titleText}</a>`
    : `<span class="sb-card-title-link sb-card-title-plain">${titleText}</span>`;

  const stationDiffers = r.police_station && r.police_station !== r.location_text;
  const metaText = `${esc(r.location_text || 'Unknown location')}${stationDiffers ? ` · ${esc(r.police_station)}` : ''}`;

  const descHtml = r.description ? `<p class="sb-desc">${esc(r.description)}</p>` : '';

  const publishedStr = formatDate(r.published_datetime, false);
  const incidentStr = incidentString(r);
  const footerParts = [
    r.source_name,
    publishedStr ? `Published ${publishedStr}` : '',
    incidentStr ? `Incident ${incidentStr}` : '',
  ].filter(Boolean).map(esc);

  const cityNote = r.geo_precision === 'city'
    ? '<div class="sb-citynote">Location known only at city level</div>'
    : '';

  return `
    <article class="sb-card">
      <div class="sb-row-top">
        <span class="sb-chip" style="background:${bg};border-color:${border}">${catLabel}</span>
        <span class="sb-badge ${badgeClass}">${badgeLabel}</span>
        <span class="sb-top-date">${topDate}</span>
      </div>
      <h3 class="sb-card-title">${titleInner}</h3>
      <div class="sb-meta">📍 ${metaText}</div>
      ${descHtml}
      ${cityNote}
      <div class="sb-footer">${footerParts.join(' · ')}</div>
    </article>`;
}

function skeletonHtml() {
  return Array.from({ length: 3 }, () => `
    <article class="sb-card sb-skeleton">
      <div class="sb-row-top">
        <span class="sb-sk sb-sk-chip"></span>
        <span class="sb-sk sb-sk-badge"></span>
        <span class="sb-sk sb-sk-date"></span>
      </div>
      <div class="sb-sk sb-sk-title"></div>
      <div class="sb-sk sb-sk-meta"></div>
      <div class="sb-sk sb-sk-desc"></div>
      <div class="sb-sk sb-sk-desc sb-sk-desc-short"></div>
    </article>`).join('');
}

export function createSidebar(el, { onClearSelection } = {}) {
  function render({ title, subtitle, reports, categoryLabels, loading, error, canClear } = {}) {
    const safeReports = Array.isArray(reports) ? reports : [];
    const sorted = [...safeReports].sort((a, b) => sortKey(b) - sortKey(a));

    let summary;
    if (loading) summary = 'Loading reports…';
    else if (error) summary = 'Could not load reports';
    else summary = `${sorted.length} report${sorted.length === 1 ? '' : 's'} · sorted newest first`;

    let bodyHtml;
    if (loading) bodyHtml = skeletonHtml();
    else if (error) bodyHtml = `<div class="sb-card sb-error">${esc(error)}</div>`;
    else if (sorted.length === 0) bodyHtml = '<div class="sb-card sb-empty">No reports here for the selected filters.</div>';
    else bodyHtml = sorted.map((r) => reportCard(r, categoryLabels || {})).join('');

    el.innerHTML = `
      <div class="sb-header">
        <div class="sb-header-top">
          <div class="sb-titles">
            <div class="sb-title-main">${esc(title || 'Reports')}</div>
            ${subtitle ? `<div class="sb-subtitle">${esc(subtitle)}</div>` : ''}
          </div>
          ${canClear ? '<button type="button" class="sb-clear-btn">✕ Clear selection</button>' : ''}
        </div>
        <div class="sb-summary">${esc(summary)}</div>
      </div>
      <div class="sb-list">${bodyHtml}</div>
    `;

    if (canClear) {
      const btn = el.querySelector('.sb-clear-btn');
      if (btn) btn.addEventListener('click', () => onClearSelection?.());
    }
  }

  return { render };
}
