// Filters bar: city segmented control, searchable area combobox, categories popover, date range.
// See main.js for the exact contract this module must satisfy.
export function createFilters(el, { onChange }) {
  let built = false;
  const dom = {};

  let latestMeta = null;
  let latestState = null;
  let latestAreas = [];

  let cityIds = null;
  let categoryIds = null;

  let areaFocused = false;
  let areaOpen = false;
  let highlightedIndex = -1;

  let categoriesOpen = false;

  function build() {
    el.classList.add('filters-bar');
    el.innerHTML = `
      <div class="f-group f-cities" role="group" aria-label="City"></div>
      <div class="f-group f-area">
        <div class="f-combobox">
          <input type="text" class="f-area-input" placeholder="All areas" aria-label="Area"
                 role="combobox" aria-expanded="false" aria-autocomplete="list" aria-controls="f-area-listbox"
                 autocomplete="off" />
          <button type="button" class="f-area-clear" aria-label="Clear area" tabindex="-1" hidden>&times;</button>
          <ul class="f-area-list" id="f-area-listbox" role="listbox" hidden></ul>
        </div>
      </div>
      <div class="f-group f-categories">
        <button type="button" class="f-cat-toggle" aria-haspopup="true" aria-expanded="false">Categories: All</button>
        <div class="f-cat-popover" hidden>
          <div class="f-cat-actions">
            <a href="#" class="f-cat-all">All</a>
            <a href="#" class="f-cat-none">None</a>
          </div>
          <div class="f-cat-list"></div>
        </div>
      </div>
      <div class="f-group f-dates">
        <label class="f-date-label">From
          <input type="date" class="f-date-from" aria-label="From date" />
        </label>
        <label class="f-date-label">To
          <input type="date" class="f-date-to" aria-label="To date" />
        </label>
        <a href="#" class="f-dates-reset">Last 6 months</a>
      </div>
      <span class="f-loading" hidden aria-hidden="true" title="Loading"></span>
    `;

    dom.cities = el.querySelector('.f-cities');
    dom.areaInput = el.querySelector('.f-area-input');
    dom.areaClear = el.querySelector('.f-area-clear');
    dom.areaList = el.querySelector('.f-area-list');
    dom.catToggle = el.querySelector('.f-cat-toggle');
    dom.catPopover = el.querySelector('.f-cat-popover');
    dom.catAll = el.querySelector('.f-cat-all');
    dom.catNone = el.querySelector('.f-cat-none');
    dom.catList = el.querySelector('.f-cat-list');
    dom.dateFrom = el.querySelector('.f-date-from');
    dom.dateTo = el.querySelector('.f-date-to');
    dom.datesReset = el.querySelector('.f-dates-reset');
    dom.loading = el.querySelector('.f-loading');

    wireEvents();
    built = true;
  }

  // --- area combobox helpers ---------------------------------------------

  function openAreaList() {
    areaOpen = true;
    dom.areaInput.setAttribute('aria-expanded', 'true');
    renderAreaList(dom.areaInput.value);
  }

  function closeAreaList(revert) {
    areaOpen = false;
    highlightedIndex = -1;
    dom.areaInput.setAttribute('aria-expanded', 'false');
    dom.areaList.hidden = true;
    dom.areaList.innerHTML = '';
    if (revert) dom.areaInput.value = latestState?.area || '';
    dom.areaClear.hidden = !dom.areaInput.value;
  }

  function renderAreaList(query) {
    const q = query.trim().toLowerCase();
    const filtered = q ? latestAreas.filter((a) => a.name.toLowerCase().includes(q)) : latestAreas;
    dom.areaList.innerHTML = '';
    if (!filtered.length) {
      dom.areaList.hidden = true;
      return;
    }
    dom.areaList.hidden = false;
    for (const a of filtered.slice(0, 300)) {
      const li = document.createElement('li');
      li.setAttribute('role', 'option');
      li.dataset.name = a.name;
      li.textContent = `${a.name}  (${a.count})`;
      dom.areaList.appendChild(li);
    }
    highlightedIndex = -1;
  }

  function updateHighlight() {
    const items = [...dom.areaList.children];
    items.forEach((it, i) => it.classList.toggle('is-active', i === highlightedIndex));
    const active = items[highlightedIndex];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function selectArea(name) {
    dom.areaInput.value = name;
    dom.areaClear.hidden = false;
    closeAreaList(false);
    onChange({ area: name });
  }

  // --- categories popover helpers -----------------------------------------

  function closeCategories() {
    categoriesOpen = false;
    dom.catPopover.hidden = true;
    dom.catToggle.setAttribute('aria-expanded', 'false');
  }

  function emitCategories() {
    const boxes = [...dom.catList.querySelectorAll('input[type=checkbox]')];
    const checkedIds = boxes.filter((cb) => cb.checked).map((cb) => cb.dataset.id);
    // Empty selection is treated the same as "everything selected" per the state contract.
    const categories = checkedIds.length === 0 || checkedIds.length === boxes.length ? [] : checkedIds;
    onChange({ categories });
  }

  function wireEvents() {
    // City segmented control
    dom.cities.addEventListener('click', (e) => {
      const btn = e.target.closest('.f-city-btn');
      if (!btn || btn.disabled) return;
      if (btn.dataset.id === latestState?.city) return;
      onChange({ city: btn.dataset.id });
    });

    // Area combobox
    dom.areaInput.addEventListener('focus', () => {
      areaFocused = true;
      openAreaList();
    });
    dom.areaInput.addEventListener('input', () => {
      dom.areaClear.hidden = !dom.areaInput.value;
      openAreaList();
    });
    dom.areaInput.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!areaOpen) return openAreaList();
        highlightedIndex = Math.min(dom.areaList.children.length - 1, highlightedIndex + 1);
        updateHighlight();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!areaOpen) return openAreaList();
        highlightedIndex = Math.max(0, highlightedIndex - 1);
        updateHighlight();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const items = [...dom.areaList.children];
        const item = items[highlightedIndex] || items[0];
        if (item) selectArea(item.dataset.name);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        closeAreaList(true);
        dom.areaInput.blur();
      }
    });
    dom.areaInput.addEventListener('blur', () => {
      areaFocused = false;
      closeAreaList(true);
    });
    // Prevent mousedown on the list/clear button from blurring the input before click fires.
    dom.areaList.addEventListener('mousedown', (e) => e.preventDefault());
    dom.areaList.addEventListener('click', (e) => {
      const li = e.target.closest('li');
      if (!li) return;
      selectArea(li.dataset.name);
    });
    dom.areaClear.addEventListener('mousedown', (e) => e.preventDefault());
    dom.areaClear.addEventListener('click', () => {
      dom.areaInput.value = '';
      dom.areaClear.hidden = true;
      closeAreaList(false);
      onChange({ area: null });
    });

    // Categories popover
    dom.catToggle.addEventListener('click', () => {
      if (dom.catToggle.disabled) return;
      categoriesOpen = !categoriesOpen;
      dom.catPopover.hidden = !categoriesOpen;
      dom.catToggle.setAttribute('aria-expanded', String(categoriesOpen));
    });
    dom.catList.addEventListener('change', (e) => {
      if (e.target.closest('input[type=checkbox]')) emitCategories();
    });
    dom.catAll.addEventListener('click', (e) => {
      e.preventDefault();
      for (const cb of dom.catList.querySelectorAll('input')) cb.checked = true;
      emitCategories();
    });
    dom.catNone.addEventListener('click', (e) => {
      e.preventDefault();
      for (const cb of dom.catList.querySelectorAll('input')) cb.checked = false;
      emitCategories();
    });

    // Dates
    dom.dateFrom.addEventListener('change', () => onChange({ from: dom.dateFrom.value }));
    dom.dateTo.addEventListener('change', () => onChange({ to: dom.dateTo.value }));
    dom.datesReset.addEventListener('click', (e) => {
      e.preventDefault();
      dom.dateFrom.value = '';
      dom.dateTo.value = '';
      onChange({ from: '', to: '' });
    });

    // Outside click / Esc closes open popovers
    document.addEventListener('click', (e) => {
      if (areaOpen && !e.target.closest('.f-area')) closeAreaList(true);
      if (categoriesOpen && !e.target.closest('.f-categories')) closeCategories();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && categoriesOpen) closeCategories();
    });
  }

  function renderCities(meta, state) {
    const ids = meta ? meta.cities.map((c) => c.id).join('|') : '';
    if (ids !== cityIds) {
      cityIds = ids;
      dom.cities.innerHTML = '';
      if (meta) {
        for (const c of meta.cities) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'f-city-btn';
          btn.textContent = c.name;
          btn.dataset.id = c.id;
          dom.cities.appendChild(btn);
        }
      }
    }
    for (const btn of dom.cities.children) {
      const active = state.city === btn.dataset.id;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
      btn.disabled = !meta;
    }
  }

  function renderArea(state, areas) {
    latestAreas = areas || [];
    if (!areaFocused) dom.areaInput.value = state.area || '';
    dom.areaInput.disabled = !latestMeta;
    dom.areaClear.hidden = !dom.areaInput.value;
    dom.areaClear.disabled = !latestMeta;
    if (areaOpen) renderAreaList(dom.areaInput.value);
  }

  function renderCategories(meta, state) {
    const ids = meta ? meta.categories.map((c) => c.id).join('|') : '';
    if (ids !== categoryIds) {
      categoryIds = ids;
      dom.catList.innerHTML = '';
      if (meta) {
        for (const cat of meta.categories) {
          const row = document.createElement('label');
          row.className = 'f-cat-item';
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.id = cat.id;
          const span = document.createElement('span');
          span.textContent = cat.label;
          row.appendChild(cb);
          row.appendChild(span);
          dom.catList.appendChild(row);
        }
      }
    }
    const allIds = meta ? meta.categories.map((c) => c.id) : [];
    const selected = state.categories.length ? state.categories : allIds;
    for (const row of dom.catList.children) {
      const cb = row.querySelector('input');
      cb.checked = selected.includes(cb.dataset.id);
      cb.disabled = !meta;
    }
    dom.catToggle.disabled = !meta;
    dom.catToggle.textContent = state.categories.length === 0 ? 'Categories: All' : `Categories: ${state.categories.length}`;
  }

  function renderDates(meta, state) {
    dom.dateFrom.disabled = !meta;
    dom.dateTo.disabled = !meta;
    if (document.activeElement !== dom.dateFrom) dom.dateFrom.value = state.from || '';
    if (document.activeElement !== dom.dateTo) dom.dateTo.value = state.to || '';
    const range = meta?.date_range;
    const min = range ? range.min.slice(0, 10) : '';
    const max = range ? range.max.slice(0, 10) : '';
    dom.dateFrom.min = min;
    dom.dateFrom.max = max;
    dom.dateTo.min = min;
    dom.dateTo.max = max;
  }

  function render({ meta, state, areas, loading }) {
    if (!built) build();
    latestMeta = meta;
    latestState = state;

    dom.loading.hidden = !loading;

    renderCities(meta, state);
    renderArea(state, areas);
    renderCategories(meta, state);
    renderDates(meta, state);
  }

  return { render };
}
