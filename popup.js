(function () {
  'use strict';

  const DomainUtils = globalThis.DomainUtils;
  if (!DomainUtils) {
    throw new Error('DomainUtils module is not loaded.');
  }

  const STORAGE_KEYS = {
    scope: 'preferredScope',
    grouping: 'preferredGrouping',
    view: 'preferredView'
  };

  const CLOSE_CONFIRM_TIMEOUT_MS = 4000;

  const MONOGRAM_COLORS = [
    '#0B6E99',
    '#2563EB',
    '#D93025',
    '#0D9488',
    '#6D28D9',
    '#B45309',
    '#1D4ED8',
    '#3B4A5A'
  ];

  const state = {
    scope: 'current',       // 'current' | 'all'
    grouping: 'main',       // 'main' | 'subdomain'
    view: 'list',           // 'list' | 'tiles'
    searchQuery: '',
    rawTabs: [],
    groups: [],
    currentWindowId: null,
    windowCount: 1,
    windowNumberMap: new Map(),
    windowTotalCounts: new Map(),
    selectedTabIds: new Set(),
    expandedGroupKeys: new Set(),
    confirmingClose: false,
    confirmTimerId: null,
    busy: false
  };

  const els = {
    summaryText: document.getElementById('summaryText'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    selectAllBtn: document.getElementById('selectAllBtn'),
    statusBanner: document.getElementById('statusBanner'),
    siteListContainer: document.getElementById('siteListContainer'),
    siteList: document.getElementById('siteList'),
    emptyState: document.getElementById('emptyState'),
    emptyMessage: document.getElementById('emptyMessage'),
    emptyActionBtn: document.getElementById('emptyActionBtn'),
    previewStrip: document.getElementById('previewStrip'),
    previewMeta: document.getElementById('previewMeta'),
    previewTabs: document.getElementById('previewTabs'),
    windowWarning: document.getElementById('windowWarning'),
    extractBtn: document.getElementById('extractBtn'),
    closeTabsBtn: document.getElementById('closeTabsBtn'),
    viewButtons: Array.from(document.querySelectorAll('[data-view]')),
    scopeButtons: Array.from(document.querySelectorAll('[data-scope]')),
    groupingButtons: Array.from(document.querySelectorAll('[data-grouping]'))
  };

  function formatTabCount(count, grammaticalCase) {
    if (count === 0) return '0 تبويبات';
    if (count === 1) return 'تبويب واحد';
    if (count === 2) {
      return grammaticalCase === 'accusative' ? 'تبويبين' : 'تبويبان';
    }
    if (count >= 3 && count <= 10) return `${count} تبويبات`;
    return `${count} تبويباً`;
  }

  function formatSiteCount(count) {
    if (count === 0) return '0 مواقع';
    if (count === 1) return 'موقع واحد';
    if (count === 2) return 'موقعان';
    if (count >= 3 && count <= 10) return `${count} مواقع`;
    return `${count} موقعاً`;
  }

  function showStatus(message, isError) {
    if (!message) {
      els.statusBanner.hidden = true;
      els.statusBanner.textContent = '';
      els.statusBanner.classList.remove('is-error');
      return;
    }
    els.statusBanner.textContent = message;
    els.statusBanner.classList.toggle('is-error', Boolean(isError));
    els.statusBanner.hidden = false;
  }

  function cancelCloseConfirmation() {
    if (state.confirmTimerId !== null) {
      clearTimeout(state.confirmTimerId);
      state.confirmTimerId = null;
    }
    state.confirmingClose = false;
  }

  function armCloseConfirmation(visibleEntries) {
    cancelCloseConfirmation();
    state.confirmingClose = true;
    state.confirmTimerId = setTimeout(() => {
      state.confirmTimerId = null;
      state.confirmingClose = false;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    }, CLOSE_CONFIRM_TIMEOUT_MS);
    updateSummaryPreviewAndFooter(visibleEntries);
  }

  function getMonogramMeta(displayName, isInternal) {
    if (isInternal) {
      return { letter: '⋯', color: '#5B6877' };
    }
    const clean = (displayName || '').trim();
    const match = clean.match(/[a-zA-Z0-9\u0600-\u06FF]/);
    const letter = match ? match[0].toUpperCase() : '?';
    let hash = 0;
    for (let i = 0; i < clean.length; i += 1) {
      hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
    }
    const color = MONOGRAM_COLORS[hash % MONOGRAM_COLORS.length];
    return { letter, color };
  }

  function createMonogramElement(displayName, isInternal, className) {
    const { letter, color } = getMonogramMeta(displayName, isInternal);
    const badge = document.createElement('span');
    badge.className = className;
    badge.style.backgroundColor = color;
    badge.textContent = letter;
    badge.setAttribute('aria-hidden', 'true');
    return badge;
  }

  function buildSiteIconElement(url, displayName, isInternal, imgClass, monoClass) {
    if (!url || isInternal) {
      return createMonogramElement(displayName, isInternal, monoClass);
    }
    const img = document.createElement('img');
    img.className = imgClass;
    img.src = url;
    img.alt = '';
    img.addEventListener(
      'error',
      () => {
        img.replaceWith(createMonogramElement(displayName, isInternal, monoClass));
      },
      { once: true }
    );
    return img;
  }

  function createChevronSvg() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('class', 'expand-chevron');
    svg.setAttribute('aria-hidden', 'true');

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', 'M4 6l4 4 4-4');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '1.6');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');

    svg.appendChild(path);
    return svg;
  }

  function getVisibleEntries() {
    const q = state.searchQuery.trim().toLowerCase();
    if (!q) {
      return state.groups.map((group) => ({
        group,
        visibleTabs: group.tabs
      }));
    }

    const entries = [];
    for (const group of state.groups) {
      const groupNameMatches = group.displayName.toLowerCase().includes(q);
      if (groupNameMatches) {
        entries.push({ group, visibleTabs: group.tabs });
        continue;
      }

      const matchingTabs = group.tabs.filter(
        (tab) =>
          tab.title.toLowerCase().includes(q) ||
          tab.url.toLowerCase().includes(q) ||
          tab.subLabel.toLowerCase().includes(q)
      );

      if (matchingTabs.length > 0) {
        entries.push({ group, visibleTabs: matchingTabs });
      }
    }
    return entries;
  }

  /**
   * Effective selection = selected ∩ visible.
   * Ensures preview, counts, and footer actions operate only on visible items.
   */
  function getEffectiveSelectedTabs(visibleEntries) {
    const selected = [];
    for (const entry of visibleEntries) {
      for (const tab of entry.visibleTabs) {
        if (state.selectedTabIds.has(tab.id)) {
          selected.push(tab);
        }
      }
    }
    return selected;
  }

  function getOrderedExtractionTabs(effectiveTabs) {
    const pinnedOrdered = effectiveTabs.filter((t) => t.pinned);
    const unpinnedOrdered = effectiveTabs.filter((t) => !t.pinned);
    return [...pinnedOrdered, ...unpinnedOrdered];
  }

  function detectFullWindowClosure(effectiveTabs) {
    if (effectiveTabs.length === 0) {
      return { closesCurrentWindow: false, closesAnyWindow: false };
    }

    const selectedPerWindow = new Map();
    for (const tab of effectiveTabs) {
      selectedPerWindow.set(
        tab.windowId,
        (selectedPerWindow.get(tab.windowId) || 0) + 1
      );
    }

    let closesCurrentWindow = false;
    let closesAnyWindow = false;

    for (const [windowId, selectedInWin] of selectedPerWindow.entries()) {
      const totalInWin = state.windowTotalCounts.get(windowId) || 0;
      if (totalInWin > 0 && selectedInWin >= totalInWin) {
        closesAnyWindow = true;
        if (windowId === state.currentWindowId) {
          closesCurrentWindow = true;
        }
      }
    }

    return { closesCurrentWindow, closesAnyWindow };
  }

  function syncHeaderControls() {
    for (const btn of els.viewButtons) {
      const active = btn.dataset.view === state.view;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    for (const btn of els.scopeButtons) {
      const active = btn.dataset.scope === state.scope;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    for (const btn of els.groupingButtons) {
      const active = btn.dataset.grouping === state.grouping;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    els.clearSearchBtn.hidden = state.searchQuery.length === 0;
  }

  function renderPreviewStrip(effectiveTabs) {
    if (effectiveTabs.length === 0) {
      els.previewStrip.hidden = true;
      els.previewTabs.textContent = '';
      els.previewMeta.textContent = '';
      return;
    }

    const orderedTabs = getOrderedExtractionTabs(effectiveTabs);
    const pinnedCount = orderedTabs.filter((t) => t.pinned).length;

    els.previewStrip.hidden = false;
    els.previewMeta.textContent =
      pinnedCount > 0
        ? `${formatTabCount(orderedTabs.length)} (${pinnedCount} مثبّت أولاً)`
        : formatTabCount(orderedTabs.length);

    els.previewTabs.textContent = '';
    const fragment = document.createDocumentFragment();

    for (const tab of orderedTabs) {
      const chip = document.createElement('div');
      chip.className = 'preview-tab-chip';
      if (tab.pinned) chip.classList.add('is-pinned');
      chip.setAttribute('role', 'listitem');
      chip.title = `${tab.groupDisplayName} — ${tab.title}`;

      if (tab.pinned) {
        const pinDot = document.createElement('span');
        pinDot.className = 'preview-pin-dot';
        pinDot.setAttribute('aria-hidden', 'true');
        chip.appendChild(pinDot);
      }

      const iconEl = buildSiteIconElement(
        tab.favIconUrl,
        tab.groupDisplayName,
        tab.isInternal,
        'preview-chip-icon',
        'preview-chip-mono'
      );

      const titleSpan = document.createElement('span');
      titleSpan.className = 'preview-chip-title';
      titleSpan.dir = 'auto';
      titleSpan.textContent = tab.title;

      chip.append(iconEl, titleSpan);
      fragment.appendChild(chip);
    }

    els.previewTabs.appendChild(fragment);
  }

  function updateSummaryPreviewAndFooter(visibleEntries) {
    const totalSites = state.groups.length;
    const totalTabs = state.groups.reduce((sum, g) => sum + g.tabs.length, 0);

    // Pre-filter total summary in the header
    els.summaryText.textContent =
      totalTabs === 0
        ? 'لا توجد تبويبات'
        : `${formatSiteCount(totalSites)}، ${formatTabCount(totalTabs, 'accusative')}`;

    const visibleTabs = visibleEntries.flatMap((entry) => entry.visibleTabs);
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    const effectiveCount = effectiveTabs.length;

    const allVisibleSelected =
      visibleTabs.length > 0 &&
      visibleTabs.every((tab) => state.selectedTabIds.has(tab.id));

    els.selectAllBtn.disabled = visibleTabs.length === 0;
    els.selectAllBtn.textContent = allVisibleSelected ? 'إلغاء' : 'تحديد الكل';

    renderPreviewStrip(effectiveTabs);

    if (effectiveCount === 0) {
      cancelCloseConfirmation();
      els.extractBtn.disabled = true;
      els.extractBtn.textContent = 'استخراج في نافذة جديدة (0)';
      els.closeTabsBtn.disabled = true;
      els.closeTabsBtn.classList.remove('is-confirming');
      els.closeTabsBtn.textContent = 'إغلاق المحدد (0)';
      els.windowWarning.hidden = true;
      els.windowWarning.textContent = '';
      return;
    }

    els.extractBtn.disabled = state.busy;
    els.extractBtn.textContent = `استخراج في نافذة جديدة (${effectiveCount})`;
    els.closeTabsBtn.disabled = state.busy;

    const closure = detectFullWindowClosure(effectiveTabs);

    if (state.confirmingClose) {
      els.closeTabsBtn.classList.add('is-confirming');
      els.closeTabsBtn.textContent = `تأكيد إغلاق ${effectiveCount}؟`;

      if (closure.closesCurrentWindow) {
        els.windowWarning.textContent =
          `تأكيد: إغلاق ${formatTabCount(effectiveCount, 'accusative')} سيشمل كل تبويبات النافذة الحالية، مما سيغلق النافذة وتختفي الإضافة. يمكن الاستعادة بـ Ctrl+Shift+T.`;
        els.windowWarning.hidden = false;
      } else if (closure.closesAnyWindow) {
        els.windowWarning.textContent =
          'تأكيد: هذا الإغلاق سيشمل كل تبويبات إحدى النوافذ وسيغلقها. يمكن الاستعادة بـ Ctrl+Shift+T.';
        els.windowWarning.hidden = false;
      } else {
        els.windowWarning.textContent =
          `اضغط مرة أخرى لإغلاق ${formatTabCount(effectiveCount, 'accusative')}. يمكن الاستعادة لاحقاً بـ Ctrl+Shift+T.`;
        els.windowWarning.hidden = false;
      }
    } else {
      els.closeTabsBtn.classList.remove('is-confirming');
      els.closeTabsBtn.textContent = `إغلاق المحدد (${effectiveCount})`;

      if (closure.closesCurrentWindow) {
        els.windowWarning.textContent =
          'تنبيه: التحديد يشمل كل تبويبات النافذة الحالية؛ تنفيذ الاستخراج أو الإغلاق سيغلق هذه النافذة وتختفي الإضافة (الاستعادة بـ Ctrl+Shift+T).';
        els.windowWarning.hidden = false;
      } else if (closure.closesAnyWindow) {
        els.windowWarning.textContent =
          'تنبيه: التحديد يشمل كل تبويبات إحدى النوافذ المفتوحة؛ تنفيذ الإجراء سيغلق تلك النافذة (الاستعادة بـ Ctrl+Shift+T).';
        els.windowWarning.hidden = false;
      } else {
        els.windowWarning.hidden = true;
        els.windowWarning.textContent = '';
      }
    }
  }

  function renderTileItems(visibleEntries) {
    els.siteList.classList.add('is-tiles');
    const fragment = document.createDocumentFragment();

    for (const { group, visibleTabs } of visibleEntries) {
      const li = document.createElement('li');
      li.className = 'site-tile-item';

      const selectedInVisible = visibleTabs.filter((t) =>
        state.selectedTabIds.has(t.id)
      ).length;
      const allSelected =
        selectedInVisible > 0 && selectedInVisible === visibleTabs.length;
      const partialSelected =
        selectedInVisible > 0 && selectedInVisible < visibleTabs.length;

      const tileBtn = document.createElement('button');
      tileBtn.type = 'button';
      tileBtn.className = 'site-tile-btn';
      tileBtn.dataset.focusKey = `tile:${group.key}`;
      tileBtn.setAttribute('aria-pressed', String(allSelected));
      if (allSelected) tileBtn.classList.add('is-selected');
      if (partialSelected) tileBtn.classList.add('is-partial');

      tileBtn.addEventListener('click', () => {
        cancelCloseConfirmation();
        showStatus('');
        if (allSelected) {
          for (const tab of visibleTabs) state.selectedTabIds.delete(tab.id);
        } else {
          for (const tab of visibleTabs) state.selectedTabIds.add(tab.id);
        }
        renderList();
      });

      const top = document.createElement('div');
      top.className = 'tile-top';

      const iconWrap = document.createElement('span');
      iconWrap.className = 'site-icon-wrap';
      iconWrap.appendChild(
        buildSiteIconElement(
          group.favicon,
          group.displayName,
          group.isInternal,
          'site-favicon',
          'site-monogram'
        )
      );

      const countSpan = document.createElement('span');
      countSpan.className = 'tile-count';
      countSpan.textContent = String(visibleTabs.length);

      top.append(iconWrap, countSpan);

      const bottom = document.createElement('div');
      bottom.className = 'tile-bottom';

      const nameSpan = document.createElement('span');
      nameSpan.className = group.isInternal ? 'tile-name' : 'tile-name is-domain';
      nameSpan.textContent = group.displayName;
      nameSpan.title = group.displayName;

      bottom.appendChild(nameSpan);

      if (partialSelected || visibleTabs.length !== group.tabs.length) {
        const subBadge = document.createElement('span');
        subBadge.className = 'tile-partial-badge';
        subBadge.textContent = partialSelected
          ? `${selectedInVisible}/${visibleTabs.length}`
          : `${visibleTabs.length}/${group.tabs.length}`;
        bottom.appendChild(subBadge);
      }

      tileBtn.append(top, bottom);
      li.appendChild(tileBtn);
      fragment.appendChild(li);
    }

    return fragment;
  }

  function renderListItems(visibleEntries) {
    els.siteList.classList.remove('is-tiles');
    const fragment = document.createDocumentFragment();

    for (const { group, visibleTabs } of visibleEntries) {
      const li = document.createElement('li');
      li.className = 'site-group';

      const selectedInVisible = visibleTabs.filter((t) =>
        state.selectedTabIds.has(t.id)
      ).length;
      const allSelected =
        selectedInVisible > 0 && selectedInVisible === visibleTabs.length;
      const partialSelected =
        selectedInVisible > 0 && selectedInVisible < visibleTabs.length;
      const isExpanded = state.expandedGroupKeys.has(group.key);

      const row = document.createElement('div');
      row.className = 'site-row';
      if (allSelected) row.classList.add('is-selected');

      const label = document.createElement('label');
      label.className = 'site-toggle';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'chk';
      checkbox.dataset.focusKey = `group:${group.key}`;
      checkbox.checked = allSelected;
      checkbox.indeterminate = partialSelected;
      checkbox.setAttribute('aria-label', `تحديد ${group.displayName}`);
      checkbox.addEventListener('change', () => {
        cancelCloseConfirmation();
        showStatus('');
        if (checkbox.checked) {
          for (const tab of visibleTabs) state.selectedTabIds.add(tab.id);
        } else {
          for (const tab of visibleTabs) state.selectedTabIds.delete(tab.id);
        }
        renderList();
      });

      const iconWrap = document.createElement('span');
      iconWrap.className = 'site-icon-wrap';
      iconWrap.appendChild(
        buildSiteIconElement(
          group.favicon,
          group.displayName,
          group.isInternal,
          'site-favicon',
          'site-monogram'
        )
      );

      const meta = document.createElement('span');
      meta.className = 'site-meta';

      const nameSpan = document.createElement('span');
      nameSpan.className = group.isInternal ? 'site-name' : 'site-name is-domain';
      nameSpan.textContent = group.displayName;
      nameSpan.title = group.displayName;

      const countSpan = document.createElement('span');
      countSpan.className = 'tab-count-badge';
      if (visibleTabs.length !== group.tabs.length) {
        countSpan.textContent = `${visibleTabs.length} / ${group.tabs.length}`;
      } else if (partialSelected) {
        countSpan.textContent = `${selectedInVisible} / ${visibleTabs.length}`;
      } else {
        countSpan.textContent = String(group.tabs.length);
      }

      meta.append(nameSpan, countSpan);
      label.append(checkbox, iconWrap, meta);

      const expandBtn = document.createElement('button');
      expandBtn.type = 'button';
      expandBtn.className = 'expand-btn';
      expandBtn.dataset.focusKey = `expand:${group.key}`;
      expandBtn.setAttribute('aria-expanded', String(isExpanded));
      expandBtn.setAttribute(
        'aria-label',
        isExpanded ? `إخفاء تبويبات ${group.displayName}` : `عرض تبويبات ${group.displayName}`
      );
      expandBtn.appendChild(createChevronSvg());

      const drawer = document.createElement('div');
      drawer.className = 'tab-drawer';
      drawer.hidden = !isExpanded;

      expandBtn.addEventListener('click', () => {
        if (state.expandedGroupKeys.has(group.key)) {
          state.expandedGroupKeys.delete(group.key);
        } else {
          state.expandedGroupKeys.add(group.key);
        }
        renderList();
      });

      if (isExpanded) {
        const subList = document.createElement('ul');
        subList.className = 'tab-sublist';

        for (const tab of visibleTabs) {
          const subLi = document.createElement('li');
          const tabLabel = document.createElement('label');
          tabLabel.className = 'tab-item-label';
          tabLabel.title = tab.url ? `${tab.title}\n${tab.url}` : tab.title;

          const tabChk = document.createElement('input');
          tabChk.type = 'checkbox';
          tabChk.className = 'chk';
          tabChk.dataset.focusKey = `tab:${tab.id}`;
          tabChk.checked = state.selectedTabIds.has(tab.id);
          tabChk.addEventListener('change', () => {
            cancelCloseConfirmation();
            showStatus('');
            if (tabChk.checked) {
              state.selectedTabIds.add(tab.id);
            } else {
              state.selectedTabIds.delete(tab.id);
            }
            renderList();
          });

          const titleSpan = document.createElement('span');
          titleSpan.className = 'tab-title';
          titleSpan.dir = 'auto';
          titleSpan.textContent = tab.title;

          tabLabel.append(tabChk, titleSpan);

          if (tab.pinned || state.scope === 'all') {
            const tags = document.createElement('span');
            tags.className = 'tab-tags';

            if (tab.pinned) {
              const pinTag = document.createElement('span');
              pinTag.className = 'tab-tag is-accent';
              pinTag.textContent = 'مثبّت';
              tags.appendChild(pinTag);
            }

            if (state.scope === 'all') {
              const winNum = state.windowNumberMap.get(tab.windowId);
              if (winNum) {
                const winTag = document.createElement('span');
                winTag.className = 'tab-tag';
                winTag.textContent = `نافذة ${winNum}`;
                tags.appendChild(winTag);
              }
              if (tab.windowId === state.currentWindowId) {
                const curTag = document.createElement('span');
                curTag.className = 'tab-tag is-accent';
                curTag.textContent = 'الحالية';
                tags.appendChild(curTag);
              }
            }

            if (tags.childElementCount > 0) {
              tabLabel.appendChild(tags);
            }
          }

          subLi.appendChild(tabLabel);
          subList.appendChild(subLi);
        }

        drawer.appendChild(subList);
      }

      row.append(label, expandBtn);
      li.append(row, drawer);
      fragment.appendChild(li);
    }

    return fragment;
  }

  function renderList() {
    const activeEl = document.activeElement;
    const activeFocusKey =
      activeEl && els.siteList.contains(activeEl) && activeEl.dataset
        ? activeEl.dataset.focusKey
        : null;
    const prevScrollTop = els.siteListContainer ? els.siteListContainer.scrollTop : 0;

    syncHeaderControls();
    const visibleEntries = getVisibleEntries();
    els.siteList.textContent = '';

    if (visibleEntries.length === 0) {
      els.siteList.classList.remove('is-tiles');
      els.emptyState.hidden = false;
      if (state.searchQuery.trim()) {
        els.emptyMessage.textContent = 'لا نتائج للبحث';
        els.emptyActionBtn.hidden = false;
      } else {
        els.emptyMessage.textContent = 'لا توجد تبويبات';
        els.emptyActionBtn.hidden = true;
      }
      updateSummaryPreviewAndFooter(visibleEntries);
      return;
    }

    els.emptyState.hidden = true;

    const fragment =
      state.view === 'tiles'
        ? renderTileItems(visibleEntries)
        : renderListItems(visibleEntries);

    els.siteList.appendChild(fragment);

    if (els.siteListContainer) {
      els.siteListContainer.scrollTop = prevScrollTop;
    }
    if (activeFocusKey) {
      const targetEl = els.siteList.querySelector(
        `[data-focus-key="${CSS.escape(activeFocusKey)}"]`
      );
      if (targetEl && typeof targetEl.focus === 'function') {
        targetEl.focus({ preventScroll: true });
      }
    }

    updateSummaryPreviewAndFooter(visibleEntries);
  }

  function rebuildGroupsFromRawTabs() {
    state.groups = DomainUtils.groupTabsBySite(state.rawTabs, state.grouping);

    const validTabIds = new Set(state.rawTabs.map((t) => t.id));
    for (const id of Array.from(state.selectedTabIds)) {
      if (!validTabIds.has(id)) {
        state.selectedTabIds.delete(id);
      }
    }

    const validGroupKeys = new Set(state.groups.map((g) => g.key));
    for (const key of Array.from(state.expandedGroupKeys)) {
      if (!validGroupKeys.has(key)) {
        state.expandedGroupKeys.delete(key);
      }
    }

    renderList();
  }

  async function scanTabs() {
    try {
      let currentWinId = null;
      try {
        const currentWin = await chrome.windows.getCurrent();
        if (currentWin && typeof currentWin.id === 'number') {
          currentWinId = currentWin.id;
        }
      } catch {
        currentWinId = null;
      }
      state.currentWindowId = currentWinId;

      const queryFilter =
        state.scope === 'current'
          ? { currentWindow: true }
          : { windowType: 'normal' };

      const tabs = await chrome.tabs.query(queryFilter);
      state.rawTabs = Array.isArray(tabs) ? tabs : [];

      const countsByWindow = new Map();
      const orderedWindowIds = [];
      for (const tab of state.rawTabs) {
        if (!countsByWindow.has(tab.windowId)) {
          countsByWindow.set(tab.windowId, 0);
          orderedWindowIds.push(tab.windowId);
        }
        countsByWindow.set(tab.windowId, countsByWindow.get(tab.windowId) + 1);
      }

      orderedWindowIds.sort((a, b) => {
        if (a === currentWinId) return -1;
        if (b === currentWinId) return 1;
        return a - b;
      });

      state.windowCount = orderedWindowIds.length;
      state.windowTotalCounts = countsByWindow;
      state.windowNumberMap = new Map(
        orderedWindowIds.map((wid, idx) => [wid, idx + 1])
      );

      rebuildGroupsFromRawTabs();
    } catch {
      showStatus('تعذر قراءة التبويبات من المتصفح.', true);
      state.rawTabs = [];
      rebuildGroupsFromRawTabs();
    }
  }

  async function extractSelectedTabs() {
    if (state.busy) return;
    const visibleEntries = getVisibleEntries();
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    if (effectiveTabs.length === 0) return;

    cancelCloseConfirmation();
    state.busy = true;
    showStatus('');
    updateSummaryPreviewAndFooter(visibleEntries);

    try {
      const orderedTabIds = getOrderedExtractionTabs(effectiveTabs).map((t) => t.id);

      const response = await chrome.runtime.sendMessage({
        type: 'EXTRACT_TABS',
        tabIds: orderedTabIds
      });

      if (response && response.ok) {
        showStatus(
          `تم استخراج ${formatTabCount(response.moved, 'accusative')} إلى نافذة جديدة.`,
          false
        );
        window.close();
      } else if (response && response.error) {
        showStatus(response.error, true);
        await scanTabs();
      }
    } catch {
      // Popup may close naturally as the new window receives focus
    } finally {
      state.busy = false;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    }
  }

  async function executeCloseTabs() {
    if (state.busy) return;
    const visibleEntries = getVisibleEntries();
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    if (effectiveTabs.length === 0) return;

    cancelCloseConfirmation();
    state.busy = true;
    updateSummaryPreviewAndFooter(visibleEntries);

    const idsToClose = effectiveTabs.map((t) => t.id);
    try {
      await chrome.tabs.remove(idsToClose);
      for (const id of idsToClose) {
        state.selectedTabIds.delete(id);
      }
      await scanTabs();
      showStatus(
        `تم إغلاق ${formatTabCount(idsToClose.length, 'accusative')}.`,
        false
      );
    } catch {
      showStatus('تعذر إغلاق بعض التبويبات المحددة.', true);
      await scanTabs();
    } finally {
      state.busy = false;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    }
  }

  function handleCloseButtonClick() {
    if (state.busy) return;
    const visibleEntries = getVisibleEntries();
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    if (effectiveTabs.length === 0) return;

    showStatus('');
    if (!state.confirmingClose) {
      armCloseConfirmation(visibleEntries);
    } else {
      executeCloseTabs();
    }
  }

  function bindEvents() {
    for (const btn of els.viewButtons) {
      btn.addEventListener('click', async () => {
        const nextView = btn.dataset.view;
        if (!nextView || nextView === state.view) return;
        cancelCloseConfirmation();
        state.view = nextView;
        try {
          await chrome.storage.local.set({ [STORAGE_KEYS.view]: nextView });
        } catch {
          // Handle storage failure silently
        }
        renderList();
      });
    }

    for (const btn of els.scopeButtons) {
      btn.addEventListener('click', async () => {
        const nextScope = btn.dataset.scope;
        if (!nextScope || nextScope === state.scope) return;
        cancelCloseConfirmation();
        showStatus('');
        state.scope = nextScope;
        try {
          await chrome.storage.local.set({ [STORAGE_KEYS.scope]: nextScope });
        } catch {
          // Handle storage failure silently
        }
        await scanTabs();
      });
    }

    for (const btn of els.groupingButtons) {
      btn.addEventListener('click', async () => {
        const nextGrouping = btn.dataset.grouping;
        if (!nextGrouping || nextGrouping === state.grouping) return;
        cancelCloseConfirmation();
        showStatus('');
        state.grouping = nextGrouping;
        try {
          await chrome.storage.local.set({ [STORAGE_KEYS.grouping]: nextGrouping });
        } catch {
          // Handle storage failure silently
        }
        rebuildGroupsFromRawTabs();
      });
    }

    els.searchInput.addEventListener('input', () => {
      cancelCloseConfirmation();
      showStatus('');
      state.searchQuery = els.searchInput.value;
      renderList();
    });

    els.clearSearchBtn.addEventListener('click', () => {
      cancelCloseConfirmation();
      state.searchQuery = '';
      els.searchInput.value = '';
      els.searchInput.focus();
      renderList();
    });

    els.emptyActionBtn.addEventListener('click', () => {
      cancelCloseConfirmation();
      state.searchQuery = '';
      els.searchInput.value = '';
      els.searchInput.focus();
      renderList();
    });

    els.selectAllBtn.addEventListener('click', () => {
      const visibleEntries = getVisibleEntries();
      const visibleTabs = visibleEntries.flatMap((e) => e.visibleTabs);
      if (visibleTabs.length === 0) return;

      cancelCloseConfirmation();
      showStatus('');

      const allSelected = visibleTabs.every((t) => state.selectedTabIds.has(t.id));
      if (allSelected) {
        for (const tab of visibleTabs) state.selectedTabIds.delete(tab.id);
      } else {
        for (const tab of visibleTabs) state.selectedTabIds.add(tab.id);
      }
      renderList();
    });

    els.extractBtn.addEventListener('click', extractSelectedTabs);
    els.closeTabsBtn.addEventListener('click', handleCloseButtonClick);

    // Keyboard shortcuts from Proposal D (safe around buttons and search editing)
    document.addEventListener('keydown', (event) => {
      if (state.busy || event.ctrlKey || event.metaKey || event.altKey) return;

      const activeEl = document.activeElement;
      const inSearchInput = activeEl === els.searchInput;

      if (event.key === 'Enter') {
        const isOnButtonOrLink =
          activeEl && (activeEl.tagName === 'BUTTON' || activeEl.tagName === 'A');
        if (isOnButtonOrLink) return;

        const effectiveTabs = getEffectiveSelectedTabs(getVisibleEntries());
        if (effectiveTabs.length > 0) {
          event.preventDefault();
          extractSelectedTabs();
        }
      } else if (event.key === 'Delete') {
        if (inSearchInput) return;

        const effectiveTabs = getEffectiveSelectedTabs(getVisibleEntries());
        if (effectiveTabs.length > 0) {
          event.preventDefault();
          handleCloseButtonClick();
        }
      } else if (event.key === 'Escape' && state.confirmingClose) {
        event.preventDefault();
        cancelCloseConfirmation();
        updateSummaryPreviewAndFooter(getVisibleEntries());
      }
    });
  }

  async function init() {
    try {
      const saved = await chrome.storage.local.get([
        STORAGE_KEYS.scope,
        STORAGE_KEYS.grouping,
        STORAGE_KEYS.view
      ]);
      if (saved[STORAGE_KEYS.scope] === 'all' || saved[STORAGE_KEYS.scope] === 'current') {
        state.scope = saved[STORAGE_KEYS.scope];
      }
      if (saved[STORAGE_KEYS.grouping] === 'subdomain' || saved[STORAGE_KEYS.grouping] === 'main') {
        state.grouping = saved[STORAGE_KEYS.grouping];
      }
      if (saved[STORAGE_KEYS.view] === 'tiles' || saved[STORAGE_KEYS.view] === 'list') {
        state.view = saved[STORAGE_KEYS.view];
      }
    } catch {
      // Handle storage failure silently and keep defaults
    }

    bindEvents();
    await scanTabs();
    els.searchInput.focus();
  }

  init();
})();
