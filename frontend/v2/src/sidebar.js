// v2 "Beware" left detail panel.
// Contract (frontend/v2/CONTRACT.md):
//   createSidebar(el, { onSelect(ids: string[] | null), onPickGroup(groupId | null) })
//     → { render({ mode, city, reports, selected, groups, categoryLabels, counts, loading, error, cityLevelCount }) }
// Full re-render on every render() call; listeners are bound once on `el` via event delegation.

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

// Precision-aware incident date/time string, same rules as v1's sidebar.
function incidentString(r) {
  if (!r.incident_datetime || r.incident_datetime_precision === 'unknown') return '';
  if (r.incident_datetime_precision === 'exact') return formatDate(r.incident_datetime, true);
  if (r.incident_datetime_precision === 'date') return formatDate(r.incident_datetime, false);
  if (r.incident_datetime_precision === 'date_range') return `${formatDate(r.incident_datetime, false)} (night of)`;
  return '';
}

function precisionNote(geoPrecision) {
  switch (geoPrecision) {
    case 'address': return 'exact address';
    case 'police_station': return 'police station area';
    case 'locality': return 'approximate: locality centre';
    default: return '';
  }
}

function sortKey(r) {
  const t = new Date(r.incident_datetime ?? r.published_datetime).getTime();
  return Number.isNaN(t) ? -Infinity : t;
}

const mappable = (r) => r.geo_precision !== 'city';

function groupInfo(groups, groupId) {
  const g = (groups || []).find((x) => x.id === groupId);
  if (g) return g;
  return { id: groupId ?? null, label: humanize(groupId), color: 'var(--muted)' };
}

function chipHtml(group) {
  const bg = `color-mix(in srgb, ${group.color} 28%, var(--card-2))`;
  return `<span class="sb-chip" style="background:${bg};border-color:${group.color}">${esc(group.label)}</span>`;
}

function sourceBadge(r) {
  const isNews = r.source_type === 'news';
  const badgeLabel = isNews ? 'News' : 'Police';
  const badgeClass = isNews ? 'sb-badge-news' : 'sb-badge-police';
  return `<span class="sb-badge ${badgeClass}">${badgeLabel}</span>`;
}

// Compact row used for "Latest reports" (summary) and list mode. Click -> onSelect([id]).
function compactRow(r, groups, categoryLabels) {
  const group = groupInfo(groups, r.group);
  const dateSrc = r.incident_datetime ?? r.published_datetime;
  const dateStr = esc(formatDate(dateSrc, false));
  const catLabel = esc(categoryLabels?.[r.category] ?? humanize(r.category ?? r.category_raw));
  return `
    <button type="button" class="sb-row" data-action="select-one" data-id="${esc(r.id)}">
      <span class="sb-row-bar" style="background:${group.color}"></span>
      <span class="sb-row-main">
        <span class="sb-row-title">${esc(r.title || '(untitled report)')}</span>
        <span class="sb-row-sub">${esc(r.location_text || 'Unknown location')} · ${catLabel} · ${dateStr}</span>
      </span>
    </button>`;
}

function skeletonRows(n) {
  return Array.from({ length: n }, () => `
    <div class="sb-row sb-skeleton">
      <span class="sb-sk sb-sk-bar"></span>
      <span class="sb-row-main">
        <span class="sb-sk sb-sk-title"></span>
        <span class="sb-sk sb-sk-sub"></span>
      </span>
    </div>`).join('');
}

function skeletonTiles() {
  return Array.from({ length: 6 }, () => `
    <div class="sb-tile sb-skeleton">
      <span class="sb-sk sb-sk-dot"></span>
      <span class="sb-sk sb-sk-tile-label"></span>
      <span class="sb-sk sb-sk-tile-count"></span>
    </div>`).join('');
}

function errorCard(message) {
  return `<div class="sb-card sb-error">${esc(message)}</div>`;
}

function renderSummary({ city, reports, groups, categoryLabels, counts, loading, error, cityLevelCount }) {
  const cityName = esc(city?.name || 'City');

  if (loading) {
    return `
      <div class="sb-header">
        <div class="sb-title-main">${cityName}</div>
        <div class="sb-subtitle">Loading…</div>
      </div>
      <div class="sb-section">
        <div class="sb-tiles">${skeletonTiles()}</div>
      </div>
      <div class="sb-section">
        <div class="sb-section-title">Latest reports</div>
        <div class="sb-rows">${skeletonRows(6)}</div>
      </div>`;
  }

  if (error) {
    return `
      <div class="sb-header">
        <div class="sb-title-main">${cityName}</div>
      </div>
      <div class="sb-section">${errorCard(error)}</div>`;
  }

  const safeReports = Array.isArray(reports) ? reports : [];
  const safeGroups = Array.isArray(groups) ? groups : [];
  const safeCounts = counts || {};
  const mappableReports = safeReports.filter(mappable);
  const mapCount = mappableReports.length;
  const allCount = safeGroups.reduce((sum, g) => sum + (safeCounts[g.id] || 0), 0);

  const allTile = `
    <button type="button" class="sb-tile" data-action="pick-group" data-group="">
      <span class="sb-dot sb-dot-all"></span>
      <span class="sb-tile-label">All</span>
      <span class="sb-tile-count">${allCount}</span>
    </button>`;

  const groupTiles = safeGroups.map((g) => {
    const disabled = !!g.disabled;
    const countLabel = disabled ? 'coming soon' : String(safeCounts[g.id] || 0);
    return `
      <button type="button" class="sb-tile${disabled ? ' sb-tile-disabled' : ''}" data-action="pick-group" data-group="${esc(g.id)}"${disabled ? ' aria-disabled="true"' : ''}>
        <span class="sb-dot" style="background:${esc(g.color)}"></span>
        <span class="sb-tile-label">${esc(g.label)}</span>
        <span class="sb-tile-count">${esc(countLabel)}</span>
      </button>`;
  }).join('');

  const latest = [...mappableReports].sort((a, b) => sortKey(b) - sortKey(a)).slice(0, 12);
  const latestHtml = latest.length
    ? latest.map((r) => compactRow(r, safeGroups, categoryLabels)).join('')
    : '<div class="sb-empty">No reports here for the selected filters.</div>';

  const footnote = cityLevelCount > 0
    ? `<div class="sb-footnote">${esc(cityLevelCount)} report${cityLevelCount === 1 ? '' : 's'} known only at city level aren't on the map</div>`
    : '';

  return `
    <div class="sb-header">
      <div class="sb-title-main">${cityName}</div>
      <div class="sb-subtitle">Where to be careful: ${mapCount} report${mapCount === 1 ? '' : 's'} on the map</div>
      <div class="sb-caption">Last 6 months · news &amp; police sources</div>
    </div>
    <div class="sb-section">
      <div class="sb-tiles">${allTile}${groupTiles}</div>
    </div>
    <div class="sb-section">
      <div class="sb-section-title">Latest reports</div>
      <div class="sb-rows">${latestHtml}</div>
      ${footnote}
    </div>`;
}

function renderDetail({ selected, groups, categoryLabels, loading, error }) {
  if (loading) {
    return `
      <div class="sb-detail">
        <button type="button" class="sb-back" data-action="back">← Back</button>
        <div class="sb-sk sb-sk-chip"></div>
        <div class="sb-sk sb-sk-title-lg"></div>
        <div class="sb-sk sb-sk-sub"></div>
        <div class="sb-sk sb-sk-sub"></div>
        <div class="sb-sk sb-sk-desc"></div>
        <div class="sb-sk sb-sk-desc"></div>
      </div>`;
  }

  if (error) {
    return `
      <div class="sb-detail">
        <button type="button" class="sb-back" data-action="back">← Back</button>
        ${errorCard(error)}
      </div>`;
  }

  const r = Array.isArray(selected) ? selected[0] : selected;
  if (!r) {
    return `
      <div class="sb-detail">
        <button type="button" class="sb-back" data-action="back">← Back</button>
        <div class="sb-empty">Report not found.</div>
      </div>`;
  }

  const group = groupInfo(groups, r.group);
  const catLabel = esc(categoryLabels?.[r.category] ?? humanize(r.category ?? r.category_raw));

  const incidentStr = incidentString(r);
  const publishedStr = formatDate(r.published_datetime, false);

  const stationDiffers = r.police_station && r.police_station !== r.location_text;
  const locationMain = `${esc(r.location_text || 'Unknown location')}${stationDiffers ? ` · ${esc(r.police_station)}` : ''}`;
  const note = precisionNote(r.geo_precision);

  const descHtml = r.description
    ? `<p class="sb-detail-desc">${esc(r.description)}</p>`
    : '<p class="sb-detail-desc sb-muted-italic">No description available.</p>';

  const hasLink = typeof r.source_link === 'string' && /^https?:\/\//i.test(r.source_link);
  const readBtn = hasLink
    ? `<a class="sb-source-btn" href="${esc(r.source_link)}" target="_blank" rel="noopener">Read source ↗</a>`
    : '';

  return `
    <div class="sb-detail">
      <button type="button" class="sb-back" data-action="back">← Back</button>
      <div class="sb-chiprow">
        ${chipHtml(group)}
        <span class="sb-chip-sub">${catLabel}</span>
      </div>
      <h2 class="sb-detail-title">${esc(r.title || '(untitled report)')}</h2>
      <div class="sb-meta-row">
        <span class="sb-meta-icon">🕒</span>
        <div class="sb-meta-body">
          <div class="sb-meta-main">${incidentStr ? esc(incidentStr) : 'Incident time unknown'}</div>
          ${publishedStr ? `<div class="sb-meta-sub">Published ${esc(publishedStr)}</div>` : ''}
        </div>
      </div>
      <div class="sb-meta-row">
        <span class="sb-meta-icon">📍</span>
        <div class="sb-meta-body">
          <div class="sb-meta-main">${locationMain}</div>
          ${note ? `<div class="sb-meta-sub">${esc(note)}</div>` : ''}
        </div>
      </div>
      ${descHtml}
      <div class="sb-source-row">
        <span class="sb-source-name">${esc(r.source_name || '')}</span>
        ${sourceBadge(r)}
      </div>
      ${readBtn}
    </div>`;
}

function renderList({ selected, groups, categoryLabels, loading, error }) {
  if (loading) {
    return `
      <div class="sb-header">
        <button type="button" class="sb-back" data-action="back">← Back</button>
        <div class="sb-subtitle">Loading…</div>
      </div>
      <div class="sb-rows">${skeletonRows(4)}</div>`;
  }

  if (error) {
    return `
      <div class="sb-header">
        <button type="button" class="sb-back" data-action="back">← Back</button>
      </div>
      <div class="sb-section">${errorCard(error)}</div>`;
  }

  const items = Array.isArray(selected) ? selected : [];
  const first = items[0];
  const loc = esc(first?.location_text || 'Unknown location');

  const sorted = [...items].sort((a, b) => sortKey(b) - sortKey(a));
  const rowsHtml = sorted.length
    ? sorted.map((r) => compactRow(r, groups, categoryLabels)).join('')
    : '<div class="sb-empty">No reports here.</div>';

  return `
    <div class="sb-header">
      <button type="button" class="sb-back" data-action="back">← Back</button>
      <div class="sb-title-main">${items.length} report${items.length === 1 ? '' : 's'} here</div>
      <div class="sb-subtitle">${loc}</div>
    </div>
    <div class="sb-rows">${rowsHtml}</div>`;
}

export function createSidebar(el, { onSelect, onPickGroup } = {}) {
  el.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target || !el.contains(target)) return;

    const action = target.dataset.action;
    if (action === 'pick-group') {
      if (target.classList.contains('sb-tile-disabled') || target.getAttribute('aria-disabled') === 'true') return;
      const groupId = target.dataset.group;
      onPickGroup?.(groupId === '' ? null : groupId);
    } else if (action === 'select-one') {
      const id = target.dataset.id;
      if (id) onSelect?.([id]);
    } else if (action === 'back') {
      onSelect?.(null);
    }
  });

  function render(state = {}) {
    const { mode } = state;
    let html;
    if (mode === 'detail') html = renderDetail(state);
    else if (mode === 'list') html = renderList(state);
    else html = renderSummary(state);

    el.innerHTML = html;
  }

  return { render };
}
