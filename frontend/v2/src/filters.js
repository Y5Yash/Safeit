// v2 filters bar: city segmented control, single-select group chips with counts, dates under "More".
// Contract: createFilters(el, { onChange(patch) }) → { render({ meta, state, counts, loading }) }
import { GROUPS } from './groups.js';

export function createFilters(el, { onChange }) {
  let built = false;
  let cityIds = null;
  let latestState = null;
  const dom = {};

  function build() {
    el.classList.add('filters-bar', 'v2-filters');
    el.innerHTML = `
      <div class="f-group f-cities" role="group" aria-label="City"></div>
      <div class="f-group f-chips" role="group" aria-label="Category"></div>
      <details class="f-more">
        <summary>More <span aria-hidden="true">▾</span></summary>
        <div class="f-more-panel">
          <label class="f-date-label">From <input type="date" class="f-date-from" aria-label="From date" /></label>
          <label class="f-date-label">To <input type="date" class="f-date-to" aria-label="To date" /></label>
          <a href="#" class="f-dates-reset">Last 6 months</a>
        </div>
      </details>
      <span class="f-loading" hidden aria-hidden="true" title="Loading"></span>
    `;
    dom.cities = el.querySelector('.f-cities');
    dom.chips = el.querySelector('.f-chips');
    dom.more = el.querySelector('.f-more');
    dom.dateFrom = el.querySelector('.f-date-from');
    dom.dateTo = el.querySelector('.f-date-to');
    dom.datesReset = el.querySelector('.f-dates-reset');
    dom.loading = el.querySelector('.f-loading');

    const chipDefs = [{ id: '', label: 'All' }, ...GROUPS];
    for (const g of chipDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'f-chip';
      b.dataset.id = g.id;
      if (g.color) b.style.setProperty('--chip-color', g.color);
      b.innerHTML = `${g.color ? '<span class="f-chip-dot" aria-hidden="true"></span>' : ''}<span class="f-chip-label"></span><span class="f-chip-count"></span>`;
      b.querySelector('.f-chip-label').textContent = g.label;
      if (g.disabled) {
        b.disabled = true;
        b.dataset.disabled = 'true';
        b.title = 'Coming soon';
        b.querySelector('.f-chip-count').textContent = 'soon';
      }
      dom.chips.appendChild(b);
    }

    dom.cities.addEventListener('click', (e) => {
      const btn = e.target.closest('.f-city-btn');
      if (!btn || btn.disabled || btn.dataset.id === latestState?.city) return;
      onChange({ city: btn.dataset.id });
    });
    dom.chips.addEventListener('click', (e) => {
      const btn = e.target.closest('.f-chip');
      if (!btn || btn.disabled) return;
      const group = btn.dataset.id || null;
      if (group === (latestState?.group ?? null)) return;
      onChange({ group });
    });
    dom.dateFrom.addEventListener('change', () => onChange({ from: dom.dateFrom.value }));
    dom.dateTo.addEventListener('change', () => onChange({ to: dom.dateTo.value }));
    dom.datesReset.addEventListener('click', (e) => {
      e.preventDefault();
      dom.dateFrom.value = '';
      dom.dateTo.value = '';
      onChange({ from: '', to: '' });
    });
    document.addEventListener('click', (e) => {
      if (dom.more.open && !e.target.closest('.f-more')) dom.more.open = false;
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.more.open) dom.more.open = false;
    });
    built = true;
  }

  function renderCities(meta, state) {
    const ids = meta ? meta.cities.map((c) => c.id).join('|') : '';
    if (ids !== cityIds) {
      cityIds = ids;
      dom.cities.innerHTML = '';
      for (const c of meta?.cities || []) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'f-city-btn';
        btn.textContent = c.name;
        btn.dataset.id = c.id;
        dom.cities.appendChild(btn);
      }
    }
    for (const btn of dom.cities.children) {
      const active = state.city === btn.dataset.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = !meta;
    }
  }

  function renderChips(meta, state, counts, loading) {
    const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
    for (const btn of dom.chips.children) {
      if (btn.dataset.disabled) continue;
      const id = btn.dataset.id;
      const active = (state.group || '') === id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = !meta;
      const n = id ? counts?.[id] || 0 : total;
      btn.querySelector('.f-chip-count').textContent = loading && !counts ? '' : String(n);
    }
  }

  function renderDates(meta, state) {
    dom.dateFrom.disabled = !meta;
    dom.dateTo.disabled = !meta;
    if (document.activeElement !== dom.dateFrom) dom.dateFrom.value = state.from || '';
    if (document.activeElement !== dom.dateTo) dom.dateTo.value = state.to || '';
    const range = meta?.date_range;
    const min = range?.min ? range.min.slice(0, 10) : '';
    const max = range?.max ? range.max.slice(0, 10) : '';
    for (const input of [dom.dateFrom, dom.dateTo]) {
      input.min = min;
      input.max = max;
    }
    dom.more.classList.toggle('has-value', Boolean(state.from || state.to));
  }

  function render({ meta, state, counts, loading }) {
    if (!built) build();
    latestState = state;
    dom.loading.hidden = !loading;
    renderCities(meta, state);
    renderChips(meta, state, counts, loading);
    renderDates(meta, state);
  }

  return { render };
}
