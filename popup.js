(function () {
  'use strict';

  const DomainUtils = globalThis.DomainUtils;
  if (!DomainUtils) {
    throw new Error('DomainUtils module is not loaded.');
  }

  const STORAGE_KEYS = {
    scope: 'preferredScope',
    grouping: 'preferredGrouping',
    view: 'preferredView',
    features: 'enabledFeatures'
  };

  const DEFAULT_FEATURES = {
    quickFilters: true,
    windowTargetAndMerge: true,
    tabGroups: true,
    hibernateTabs: true,
    copyTools: true,
    livePreview: true
  };

  const TAB_GROUP_COLORS = [
    'blue',
    'cyan',
    'green',
    'purple',
    'orange',
    'red',
    'yellow',
    'pink'
  ];

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
    scope: 'current',
    grouping: 'main',
    view: 'list',
    features: { ...DEFAULT_FEATURES },
    settingsOpen: false,
    searchQuery: '',
    activeFilters: new Set(),
    targetWindow: 'new', // 'new' or stringified windowId
    rawTabs: [],
    allWindowsTabs: [],
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
    settingsBtn: document.getElementById('settingsBtn'),
    settingsPanel: document.getElementById('settingsPanel'),
    featureCheckboxes: Array.from(document.querySelectorAll('[data-feature]')),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    selectAllBtn: document.getElementById('selectAllBtn'),
    filterPillsRow: document.getElementById('filterPillsRow'),
    countPinned: document.getElementById('countPinned'),
    countAudible: document.getElementById('countAudible'),
    countDuplicated: document.getElementById('countDuplicated'),
    cleanDuplicatesBtn: document.getElementById('cleanDuplicatesBtn'),
    countDuplicateCopies: document.getElementById('countDuplicateCopies'),
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
    windowTargetRow: document.getElementById('windowTargetRow'),
    targetWindowSelect: document.getElementById('targetWindowSelect'),
    mergeWindowsBtn: document.getElementById('mergeWindowsBtn'),
    extractBtn: document.getElementById('extractBtn'),
    closeTabsBtn: document.getElementById('closeTabsBtn'),
    groupTabsBtn: document.getElementById('groupTabsBtn'),
    hibernateTabsBtn: document.getElementById('hibernateTabsBtn'),
    copyUrlsBtn: document.getElementById('copyUrlsBtn'),
    copyMarkdownBtn: document.getElementById('copyMarkdownBtn'),
    viewButtons: Array.from(document.querySelectorAll('[data-view]')),
    scopeButtons: Array.from(document.querySelectorAll('[data-scope]')),
    groupingButtons: Array.from(document.querySelectorAll('[data-grouping]')),
    filterButtons: Array.from(document.querySelectorAll('[data-filter]'))
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

  function parseSearchAndFilters() {
    const requiredFilters = new Set(
      state.features.quickFilters ? state.activeFilters : []
    );
    const rawTokens = state.searchQuery.trim().split(/\s+/).filter(Boolean);
    const textTokens = [];

    for (const token of rawTokens) {
      const lower = token.toLowerCase();
      if (lower === 'is:pinned') {
        requiredFilters.add('pinned');
      } else if (lower === 'is:audible' || lower === 'is:audio' || lower === 'is:muted') {
        requiredFilters.add('audible');
      } else if (lower === 'is:duplicated' || lower === 'is:duplicate') {
        requiredFilters.add('duplicated');
      } else {
        textTokens.push(lower);
      }
    }

    return {
      textQuery: textTokens.join(' '),
      requiredFilters
    };
  }

  function matchesSmartFilters(tab, requiredFilters) {
    if (requiredFilters.has('pinned') && !tab.pinned) return false;
    if (requiredFilters.has('audible') && !(tab.audible || tab.muted)) return false;
    if (requiredFilters.has('duplicated') && !tab.isDuplicate) return false;
    return true;
  }

  function getVisibleEntries() {
    const { textQuery, requiredFilters } = parseSearchAndFilters();
    const hasFilters = requiredFilters.size > 0;

    if (!textQuery && !hasFilters) {
      return state.groups.map((group) => ({
        group,
        visibleTabs: group.tabs
      }));
    }

    const entries = [];
    for (const group of state.groups) {
      const groupNameMatches = textQuery
        ? group.displayName.toLowerCase().includes(textQuery)
        : true;

      const matchingTabs = group.tabs.filter((tab) => {
        if (!matchesSmartFilters(tab, requiredFilters)) return false;
        if (!textQuery || groupNameMatches) return true;
        return (
          tab.title.toLowerCase().includes(textQuery) ||
          tab.url.toLowerCase().includes(textQuery) ||
          tab.subLabel.toLowerCase().includes(textQuery)
        );
      });

      if (matchingTabs.length > 0) {
        entries.push({ group, visibleTabs: matchingTabs });
      }
    }
    return entries;
  }

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

  function updateFilterPillCounts() {
    let pinned = 0;
    let audible = 0;
    let duplicated = 0;
    let duplicateCopies = 0;

    for (const group of state.groups) {
      for (const tab of group.tabs) {
        if (tab.pinned) pinned += 1;
        if (tab.audible || tab.muted) audible += 1;
        if (tab.isDuplicate) duplicated += 1;
        if (tab.isDuplicateCopy) duplicateCopies += 1;
      }
    }

    if (els.countPinned) els.countPinned.textContent = String(pinned);
    if (els.countAudible) els.countAudible.textContent = String(audible);
    if (els.countDuplicated) els.countDuplicated.textContent = String(duplicated);
    if (els.countDuplicateCopies) {
      els.countDuplicateCopies.textContent = String(duplicateCopies);
    }
    if (els.cleanDuplicatesBtn) {
      els.cleanDuplicatesBtn.hidden =
        !state.features.quickFilters || duplicateCopies === 0;
    }
  }

  function syncTargetWindowSelect() {
    if (!els.targetWindowSelect) return;
    const prevValue = state.targetWindow;
    els.targetWindowSelect.textContent = '';

    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = 'نافذة جديدة مستقلة';
    els.targetWindowSelect.appendChild(newOpt);

    for (const [wid, winNum] of state.windowNumberMap.entries()) {
      const count = state.windowTotalCounts.get(wid) || 0;
      const isCurrent = wid === state.currentWindowId;
      const opt = document.createElement('option');
      opt.value = String(wid);
      opt.textContent = isCurrent
        ? `النافذة الحالية (نافذة ${winNum} — ${count} تبويب)`
        : `نافذة ${winNum} (${count} تبويب)`;
      els.targetWindowSelect.appendChild(opt);
    }

    const exists = Array.from(els.targetWindowSelect.options).some(
      (o) => o.value === prevValue
    );
    state.targetWindow = exists ? prevValue : 'new';
    els.targetWindowSelect.value = state.targetWindow;

    if (els.mergeWindowsBtn) {
      els.mergeWindowsBtn.hidden =
        !state.features.windowTargetAndMerge || state.windowCount <= 1;
    }
  }

  function syncFeatureVisibility() {
    els.settingsBtn.setAttribute('aria-expanded', String(state.settingsOpen));
    els.settingsPanel.hidden = !state.settingsOpen;

    for (const chk of els.featureCheckboxes) {
      const fKey = chk.dataset.feature;
      chk.checked = Boolean(state.features[fKey]);
    }

    els.filterPillsRow.hidden = !state.features.quickFilters;
    els.windowTargetRow.hidden = !state.features.windowTargetAndMerge;
    els.groupTabsBtn.hidden = !state.features.tabGroups;
    els.hibernateTabsBtn.hidden = !state.features.hibernateTabs;
    els.copyUrlsBtn.hidden = !state.features.copyTools;
    els.copyMarkdownBtn.hidden = !state.features.copyTools;
  }

  function syncHeaderControls() {
    syncFeatureVisibility();

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
    for (const btn of els.filterButtons) {
      const fKey = btn.dataset.filter;
      const active = state.activeFilters.has(fKey);
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-pressed', String(active));
    }
    els.clearSearchBtn.hidden = state.searchQuery.length === 0;
    updateFilterPillCounts();
    syncTargetWindowSelect();
  }

  function renderPreviewStrip(effectiveTabs) {
    if (!state.features.livePreview || effectiveTabs.length === 0) {
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

  function getExtractButtonLabel(effectiveCount) {
    if (
      state.features.windowTargetAndMerge &&
      state.targetWindow !== 'new'
    ) {
      const wid = Number(state.targetWindow);
      const winNum = state.windowNumberMap.get(wid) || '';
      return `نقل إلى نافذة ${winNum} (${effectiveCount})`;
    }
    return `استخراج في نافذة جديدة (${effectiveCount})`;
  }

  function updateSummaryPreviewAndFooter(visibleEntries) {
    const totalSites = state.groups.length;
    const totalTabs = state.groups.reduce((sum, g) => sum + g.tabs.length, 0);

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
      els.extractBtn.textContent = getExtractButtonLabel(0);
      els.closeTabsBtn.disabled = true;
      els.closeTabsBtn.classList.remove('is-confirming');
      els.closeTabsBtn.textContent = 'إغلاق المحدد (0)';
      els.groupTabsBtn.disabled = true;
      els.hibernateTabsBtn.disabled = true;
      els.copyUrlsBtn.disabled = true;
      els.copyMarkdownBtn.disabled = true;
      els.windowWarning.hidden = true;
      els.windowWarning.textContent = '';
      return;
    }

    els.extractBtn.disabled = state.busy;
    els.extractBtn.textContent = getExtractButtonLabel(effectiveCount);
    els.closeTabsBtn.disabled = state.busy;
    els.groupTabsBtn.disabled = state.busy;
    els.hibernateTabsBtn.disabled = state.busy;
    els.copyUrlsBtn.disabled = state.busy;
    els.copyMarkdownBtn.disabled = state.busy;

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
          'تنبيه: التحديد يشمل كل تبويبات النافذة الحالية؛ نقلها أو إغلاقها سيؤدي إلى إغلاق النافذة الحالية.';
        els.windowWarning.hidden = false;
      } else if (closure.closesAnyWindow) {
        els.windowWarning.textContent =
          'تنبيه: التحديد يشمل كل تبويبات إحدى النوافذ المفتوحة؛ تنفيذ الإجراء سيغلق تلك النافذة.';
        els.windowWarning.hidden = false;
      } else {
        els.windowWarning.hidden = true;
        els.windowWarning.textContent = '';
      }
    }
  }

  /**
   * Feature 5 (Smart One-Click Clean Duplicates):
   * Selects ONLY excess duplicate copies (isDuplicateCopy === true) and leaves original intact.
   */
  function selectOnlyDuplicateCopies() {
    cancelCloseConfirmation();
    state.selectedTabIds.clear();

    let count = 0;
    for (const group of state.groups) {
      for (const tab of group.tabs) {
        if (tab.isDuplicateCopy) {
          state.selectedTabIds.add(tab.id);
          state.expandedGroupKeys.add(group.key);
          count += 1;
        }
      }
    }

    if (count === 0) {
      showStatus('لا توجد نسخ مكررة زائدة لتحديدها.', false);
      renderList();
      return;
    }

    state.activeFilters.add('duplicated');
    renderList();
    showStatus(
      `تم تحديد ${formatTabCount(count, 'accusative')} من النسخ المكررة الزائدة فقط (تُركت النسخة الأصلية سليمة). اضغط Del للإغلاق.`,
      false
    );
  }

  /**
   * Feature 3 (Chrome Native Tab Groups):
   * Groups selected tabs by site domain inside their respective window with a distinct color.
   */
  async function groupSelectedTabsInPlace() {
    if (state.busy) return;
    const visibleEntries = getVisibleEntries();
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    if (effectiveTabs.length === 0) return;

    cancelCloseConfirmation();
    state.busy = true;
    updateSummaryPreviewAndFooter(visibleEntries);

    try {
      // Group by (windowId + groupKey) so tabs from each site become a neat colored Chrome Tab Group
      const buckets = new Map();
      for (const tab of effectiveTabs) {
        if (tab.pinned) continue; // Chrome does not allow pinned tabs inside Tab Groups
        const bKey = `${tab.windowId}::${tab.groupKey}`;
        if (!buckets.has(bKey)) {
          buckets.set(bKey, {
            windowId: tab.windowId,
            title: tab.groupDisplayName,
            tabIds: []
          });
        }
        buckets.get(bKey).tabIds.push(tab.id);
      }

      if (buckets.size === 0) {
        showStatus('التبويبات المثبتة لا يمكن وضعها داخل مجموعات كروم.', true);
        return;
      }

      let colorIdx = 0;
      let groupedTabsCount = 0;

      for (const bucket of buckets.values()) {
        try {
          const groupId = await chrome.tabs.group({
            tabIds: bucket.tabIds,
            createProperties: { windowId: bucket.windowId }
          });
          if (chrome.tabGroups && typeof chrome.tabGroups.update === 'function') {
            const color = TAB_GROUP_COLORS[colorIdx % TAB_GROUP_COLORS.length];
            colorIdx += 1;
            await chrome.tabGroups.update(groupId, {
              title: bucket.title,
              color
            });
          }
          groupedTabsCount += bucket.tabIds.length;
        } catch {
          // Continue with remaining buckets
        }
      }

      await scanTabs();
      showStatus(
        `تم تجميع ${formatTabCount(groupedTabsCount, 'accusative')} في مجموعات ملونة داخل النافذة.`,
        false
      );
    } catch {
      showStatus('تعذر إنشاء مجموعات التبويبات.', true);
    } finally {
      state.busy = false;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    }
  }

  /**
   * Feature 2 (Hibernate / Discard Selected Tabs):
   * Frees memory of selected tabs using chrome.tabs.discard(tabId)
   */
  async function hibernateSelectedTabs() {
    if (state.busy) return;
    const visibleEntries = getVisibleEntries();
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    if (effectiveTabs.length === 0) return;

    cancelCloseConfirmation();
    state.busy = true;
    updateSummaryPreviewAndFooter(visibleEntries);

    let discardedCount = 0;
    let skippedActiveOrDiscarded = 0;

    try {
      for (const tab of effectiveTabs) {
        if (tab.discarded || tab.active) {
          skippedActiveOrDiscarded += 1;
          continue;
        }
        try {
          const res = await chrome.tabs.discard(tab.id);
          if (res) discardedCount += 1;
        } catch {
          skippedActiveOrDiscarded += 1;
        }
      }

      await scanTabs();
      if (discardedCount > 0) {
        showStatus(
          `تم تجميد وتحرير ذاكرة ${formatTabCount(discardedCount, 'accusative')} بنجاح ❄️.`,
          false
        );
      } else {
        showStatus(
          skippedActiveOrDiscarded > 0
            ? 'التبويبات المحددة إما مجمّدة مسبقاً أو نشطة حالياً في المتصفح.'
            : 'تعذر تجميد التبويبات المحددة.',
          false
        );
      }
    } finally {
      state.busy = false;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    }
  }

  /**
   * Feature 1B (Merge All Open Windows into Current Window)
   */
  async function mergeOpenWindows() {
    if (state.busy || typeof state.currentWindowId !== 'number') return;
    cancelCloseConfirmation();
    state.busy = true;
    showStatus('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'MERGE_WINDOWS',
        targetWindowId: state.currentWindowId
      });

      if (response && response.ok) {
        await scanTabs();
        showStatus(
          `تم دمج ونقل ${formatTabCount(response.moved, 'accusative')} إلى النافذة الحالية.`,
          false
        );
      } else if (response && response.error) {
        showStatus(response.error, true);
      }
    } catch {
      showStatus('حدث خطأ أثناء دمج النوافذ.', true);
    } finally {
      state.busy = false;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    }
  }

  async function jumpToTab(tab) {
    try {
      await chrome.tabs.update(tab.id, { active: true });
      if (typeof tab.windowId === 'number') {
        await chrome.windows.update(tab.windowId, { focused: true });
      }
      window.close();
    } catch {
      showStatus('تعذر الانتقال إلى التبويب المحدد.', true);
    }
  }

  async function toggleMuteTab(tab) {
    try {
      const nextMuted = !tab.muted;
      await chrome.tabs.update(tab.id, { muted: nextMuted });
      await scanTabs();
      showStatus(nextMuted ? 'تم كتم صوت التبويب.' : 'تم إلغاء كتم صوت التبويب.', false);
    } catch {
      showStatus('تعذر تغيير حالة الصوت للتبويب.', true);
    }
  }

  async function copySelectedTabs(format) {
    const visibleEntries = getVisibleEntries();
    const effectiveTabs = getEffectiveSelectedTabs(visibleEntries);
    if (effectiveTabs.length === 0) return;

    const ordered = getOrderedExtractionTabs(effectiveTabs);
    const lines = ordered.map((tab) => {
      const url = tab.url || '';
      if (format === 'markdown') {
        const safeTitle = (tab.title || url).replace(/[\[\]]/g, '\\$&');
        return `- [${safeTitle}](${url})`;
      }
      return url;
    });

    const textToCopy = lines.join('\n');
    try {
      await navigator.clipboard.writeText(textToCopy);
      showStatus(
        format === 'markdown'
          ? `تم نسخ ${formatTabCount(ordered.length, 'accusative')} بصيغة Markdown.`
          : `تم نسخ روابط ${formatTabCount(ordered.length, 'accusative')} إلى الحافظة.`,
        false
      );
    } catch {
      showStatus('تعذر النسخ إلى الحافظة.', true);
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
      const hasAudibleInGroup = visibleTabs.some((t) => t.audible);

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

      const badgesWrap = document.createElement('span');
      badgesWrap.className = 'site-badges';

      if (hasAudibleInGroup) {
        const audioInd = document.createElement('span');
        audioInd.className = 'site-audio-indicator';
        audioInd.textContent = '🔊';
        audioInd.title = 'يحتوي على تبويب يصدر صوتاً';
        badgesWrap.appendChild(audioInd);
      }

      const countSpan = document.createElement('span');
      countSpan.className = 'tab-count-badge';
      if (visibleTabs.length !== group.tabs.length) {
        countSpan.textContent = `${visibleTabs.length} / ${group.tabs.length}`;
      } else if (partialSelected) {
        countSpan.textContent = `${selectedInVisible} / ${visibleTabs.length}`;
      } else {
        countSpan.textContent = String(group.tabs.length);
      }

      badgesWrap.appendChild(countSpan);
      meta.append(nameSpan, badgesWrap);
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
          subLi.className = 'tab-item-row';

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

          if (tab.pinned || tab.discarded || tab.isDuplicate || state.scope === 'all') {
            const tags = document.createElement('span');
            tags.className = 'tab-tags';

            if (tab.pinned) {
              const pinTag = document.createElement('span');
              pinTag.className = 'tab-tag is-accent';
              pinTag.textContent = 'مثبّت';
              tags.appendChild(pinTag);
            }

            if (tab.discarded) {
              const discTag = document.createElement('span');
              discTag.className = 'tab-tag';
              discTag.textContent = '❄️ خامل';
              tags.appendChild(discTag);
            }

            if (tab.isDuplicate) {
              const dupTag = document.createElement('span');
              dupTag.className = tab.isDuplicateCopy ? 'tab-tag is-accent' : 'tab-tag';
              dupTag.textContent = tab.isDuplicateCopy ? 'نسخة زائدة' : 'أصلي';
              tags.appendChild(dupTag);
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

          const actionsWrap = document.createElement('div');
          actionsWrap.className = 'tab-quick-actions';

          if (tab.audible || tab.muted) {
            const audioBtn = document.createElement('button');
            audioBtn.type = 'button';
            audioBtn.className = tab.muted
              ? 'tab-action-btn is-audio is-muted'
              : 'tab-action-btn is-audio';
            audioBtn.textContent = tab.muted ? '🔇' : '🔊';
            audioBtn.title = tab.muted ? 'إلغاء كتم الصوت' : 'كتم صوت هذا التبويب';
            audioBtn.setAttribute('aria-label', audioBtn.title);
            audioBtn.addEventListener('click', (e) => {
              e.stopPropagation();
              toggleMuteTab(tab);
            });
            actionsWrap.appendChild(audioBtn);
          }

          const jumpBtn = document.createElement('button');
          jumpBtn.type = 'button';
          jumpBtn.className = 'tab-action-btn is-jump';
          jumpBtn.textContent = '↗';
          jumpBtn.title = 'الانتقال الفوري إلى هذا التبويب';
          jumpBtn.setAttribute('aria-label', 'الانتقال الفوري إلى هذا التبويب');
          jumpBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            jumpToTab(tab);
          });
          actionsWrap.appendChild(jumpBtn);

          subLi.append(tabLabel, actionsWrap);
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
      if (state.searchQuery.trim() || state.activeFilters.size > 0) {
        els.emptyMessage.textContent = 'لا توجد تبويبات تطابق البحث أو الفلتر';
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

      // Always query all normal windows to populate the target window selector & merge button
      const allNormalTabs = await chrome.tabs.query({ windowType: 'normal' });
      state.allWindowsTabs = Array.isArray(allNormalTabs) ? allNormalTabs : [];

      const countsByWindow = new Map();
      const orderedWindowIds = [];
      for (const tab of state.allWindowsTabs) {
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

      state.rawTabs =
        state.scope === 'current' && typeof currentWinId === 'number'
          ? state.allWindowsTabs.filter((t) => t.windowId === currentWinId)
          : state.allWindowsTabs;

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
      const targetWindowId =
        state.features.windowTargetAndMerge && state.targetWindow !== 'new'
          ? Number(state.targetWindow)
          : null;

      const response = await chrome.runtime.sendMessage({
        type: 'EXTRACT_TABS',
        tabIds: orderedTabIds,
        targetWindowId
      });

      if (response && response.ok) {
        showStatus(
          targetWindowId
            ? `تم نقل ${formatTabCount(response.moved, 'accusative')} إلى النافذة المحددة.`
            : `تم استخراج ${formatTabCount(response.moved, 'accusative')} إلى نافذة جديدة.`,
          false
        );
        window.close();
      } else if (response && response.error) {
        showStatus(response.error, true);
        await scanTabs();
      }
    } catch {
      // Popup may close naturally as the target window receives focus
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
    // Settings Panel toggle
    els.settingsBtn.addEventListener('click', () => {
      state.settingsOpen = !state.settingsOpen;
      syncFeatureVisibility();
    });

    // Feature checkboxes inside Settings Panel
    for (const chk of els.featureCheckboxes) {
      chk.addEventListener('change', async () => {
        const fKey = chk.dataset.feature;
        if (!fKey) return;
        state.features[fKey] = chk.checked;
        if (!state.features.quickFilters) {
          state.activeFilters.clear();
        }
        if (!state.features.windowTargetAndMerge) {
          state.targetWindow = 'new';
        }
        try {
          await chrome.storage.local.set({
            [STORAGE_KEYS.features]: state.features
          });
        } catch {
          // Ignore storage error
        }
        renderList();
      });
    }

    for (const btn of els.viewButtons) {
      btn.addEventListener('click', async () => {
        const nextView = btn.dataset.view;
        if (!nextView || nextView === state.view) return;
        cancelCloseConfirmation();
        state.view = nextView;
        try {
          await chrome.storage.local.set({ [STORAGE_KEYS.view]: nextView });
        } catch {
          // Ignore
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
          // Ignore
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
          // Ignore
        }
        rebuildGroupsFromRawTabs();
      });
    }

    for (const btn of els.filterButtons) {
      btn.addEventListener('click', () => {
        const filterKey = btn.dataset.filter;
        if (!filterKey) return;
        cancelCloseConfirmation();
        showStatus('');
        if (state.activeFilters.has(filterKey)) {
          state.activeFilters.delete(filterKey);
        } else {
          state.activeFilters.add(filterKey);
        }
        renderList();
      });

      // Double-click on "📑 مكرر" selects only excess duplicate copies
      if (btn.dataset.filter === 'duplicated') {
        btn.addEventListener('dblclick', (e) => {
          e.preventDefault();
          selectOnlyDuplicateCopies();
        });
      }
    }

    els.cleanDuplicatesBtn.addEventListener('click', selectOnlyDuplicateCopies);

    els.targetWindowSelect.addEventListener('change', () => {
      state.targetWindow = els.targetWindowSelect.value;
      updateSummaryPreviewAndFooter(getVisibleEntries());
    });

    els.mergeWindowsBtn.addEventListener('click', mergeOpenWindows);
    els.groupTabsBtn.addEventListener('click', groupSelectedTabsInPlace);
    els.hibernateTabsBtn.addEventListener('click', hibernateSelectedTabs);

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
      state.activeFilters.clear();
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
    els.copyUrlsBtn.addEventListener('click', () => copySelectedTabs('urls'));
    els.copyMarkdownBtn.addEventListener('click', () => copySelectedTabs('markdown'));

    document.addEventListener('keydown', (event) => {
      if (state.busy) return;

      const activeEl = document.activeElement;
      const inSearchInput = activeEl === els.searchInput;

      if (
        state.features.copyTools &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === 'c'
      ) {
        const hasTextSelection =
          (window.getSelection && String(window.getSelection()).length > 0) ||
          (inSearchInput && els.searchInput.selectionStart !== els.searchInput.selectionEnd);

        if (!hasTextSelection) {
          const effectiveTabs = getEffectiveSelectedTabs(getVisibleEntries());
          if (effectiveTabs.length > 0) {
            event.preventDefault();
            copySelectedTabs(event.shiftKey ? 'markdown' : 'urls');
          }
        }
        return;
      }

      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (event.key === 'Enter') {
        const isOnButtonOrLink =
          activeEl &&
          (activeEl.tagName === 'BUTTON' ||
            activeEl.tagName === 'A' ||
            activeEl.tagName === 'SELECT');
        if (isOnButtonOrLink) return;

        const effectiveTabs = getEffectiveSelectedTabs(getVisibleEntries());
        if (effectiveTabs.length > 0) {
          event.preventDefault();
          extractSelectedTabs();
        }
      } else if (event.key === 'Delete') {
        if (inSearchInput && els.searchInput.value.length > 0) return;

        const effectiveTabs = getEffectiveSelectedTabs(getVisibleEntries());
        if (effectiveTabs.length > 0) {
          event.preventDefault();
          handleCloseButtonClick();
        }
      } else if (event.key === 'Escape') {
        if (state.confirmingClose) {
          event.preventDefault();
          cancelCloseConfirmation();
          updateSummaryPreviewAndFooter(getVisibleEntries());
        } else if (state.settingsOpen) {
          event.preventDefault();
          state.settingsOpen = false;
          syncFeatureVisibility();
        }
      }
    });
  }

  async function init() {
    try {
      const saved = await chrome.storage.local.get([
        STORAGE_KEYS.scope,
        STORAGE_KEYS.grouping,
        STORAGE_KEYS.view,
        STORAGE_KEYS.features
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
      if (saved[STORAGE_KEYS.features] && typeof saved[STORAGE_KEYS.features] === 'object') {
        state.features = {
          ...DEFAULT_FEATURES,
          ...saved[STORAGE_KEYS.features]
        };
      }
    } catch {
      // Keep defaults on storage error
    }

    bindEvents();
    await scanTabs();
    els.searchInput.focus();
  }

  init();
})();
