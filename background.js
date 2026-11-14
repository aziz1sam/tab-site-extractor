'use strict';

/**
 * Background Service Worker
 * Handles extracting tabs to a new window, moving tabs to an existing window,
 * and merging all open normal windows into a single target window.
 */

async function fetchValidTabs(tabIds) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) return [];
  const uniqueIds = [...new Set(tabIds.filter((id) => typeof id === 'number'))];
  const settled = await Promise.allSettled(
    uniqueIds.map((id) => chrome.tabs.get(id))
  );

  const validTabs = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value && typeof res.value.id === 'number') {
      validTabs.push({
        id: res.value.id,
        windowId: res.value.windowId,
        pinned: Boolean(res.value.pinned),
        incognito: Boolean(res.value.incognito)
      });
    }
  }
  return validTabs;
}

async function moveTabsToExistingWindow(validTabs, targetWindowId) {
  let targetWin;
  try {
    targetWin = await chrome.windows.get(targetWindowId);
  } catch {
    return { ok: false, error: 'النافذة المستهدفة لم تعد متاحة.' };
  }

  const compatibleTabs = validTabs.filter(
    (t) => t.incognito === Boolean(targetWin.incognito)
  );
  if (compatibleTabs.length === 0) {
    return { ok: false, error: 'لا يمكن نقل التبويبات بين التصفح العادي والخفي.' };
  }

  let movedCount = 0;
  const pinnedTabs = compatibleTabs.filter((t) => t.pinned);
  const unpinnedTabs = compatibleTabs.filter((t) => !t.pinned);

  for (const tab of pinnedTabs) {
    try {
      if (tab.windowId !== targetWindowId) {
        await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
      }
      await chrome.tabs.update(tab.id, { pinned: true });
      movedCount += 1;
    } catch {
      // Skip closed/unmovable tab
    }
  }

  for (const tab of unpinnedTabs) {
    try {
      if (tab.windowId !== targetWindowId) {
        await chrome.tabs.move(tab.id, { windowId: targetWindowId, index: -1 });
      }
      movedCount += 1;
    } catch {
      // Skip closed/unmovable tab
    }
  }

  try {
    await chrome.windows.update(targetWindowId, { focused: true });
  } catch {
    // Ignore focus error
  }

  return {
    ok: true,
    windowId: targetWindowId,
    moved: movedCount
  };
}

async function extractTabsToWindow(tabIds, targetWindowId) {
  const validTabs = await fetchValidTabs(tabIds);
  if (validTabs.length === 0) {
    return { ok: false, error: 'لم تعد التبويبات المحددة متاحة.' };
  }

  if (typeof targetWindowId === 'number') {
    return moveTabsToExistingWindow(validTabs, targetWindowId);
  }

  let newWin = null;
  let firstTab = null;
  let startIndex = 0;

  for (let i = 0; i < validTabs.length; i += 1) {
    const candidate = validTabs[i];
    try {
      const created = await chrome.windows.create({
        tabId: candidate.id,
        incognito: candidate.incognito,
        focused: false
      });
      if (created && typeof created.id === 'number') {
        newWin = created;
        firstTab = candidate;
        startIndex = i + 1;
        break;
      }
    } catch {
      // Try next tab if candidate failed
    }
  }

  if (!newWin || !firstTab) {
    return { ok: false, error: 'تعذر إنشاء النافذة الجديدة.' };
  }

  let movedCount = 1;

  if (firstTab.pinned) {
    try {
      await chrome.tabs.update(firstTab.id, { pinned: true });
    } catch {
      // Ignore
    }
  }

  const restTabs = validTabs
    .slice(startIndex)
    .filter((t) => t.incognito === firstTab.incognito);

  const restPinned = restTabs.filter((t) => t.pinned);
  const restUnpinned = restTabs.filter((t) => !t.pinned);

  for (const tab of restPinned) {
    try {
      await chrome.tabs.move(tab.id, { windowId: newWin.id, index: -1 });
      await chrome.tabs.update(tab.id, { pinned: true });
      movedCount += 1;
    } catch {
      // Skip
    }
  }

  if (restUnpinned.length > 0) {
    const restUnpinnedIds = restUnpinned.map((t) => t.id);
    try {
      await chrome.tabs.move(restUnpinnedIds, { windowId: newWin.id, index: -1 });
      movedCount += restUnpinnedIds.length;
    } catch {
      for (const id of restUnpinnedIds) {
        try {
          const currentTab = await chrome.tabs.get(id);
          if (currentTab && currentTab.windowId === newWin.id) {
            movedCount += 1;
            continue;
          }
          await chrome.tabs.move(id, { windowId: newWin.id, index: -1 });
          movedCount += 1;
        } catch {
          // Skip
        }
      }
    }
  }

  try {
    await chrome.windows.update(newWin.id, { focused: true });
  } catch {
    // Ignore
  }

  return {
    ok: true,
    windowId: newWin.id,
    moved: movedCount
  };
}

async function mergeAllWindowsIntoTarget(targetWindowId) {
  if (typeof targetWindowId !== 'number') {
    return { ok: false, error: 'لم يتم تحديد النافذة المستهدفة للدمج.' };
  }

  let targetWin;
  try {
    targetWin = await chrome.windows.get(targetWindowId);
  } catch {
    return { ok: false, error: 'النافذة الحالية غير متاحة.' };
  }

  const allTabs = await chrome.tabs.query({ windowType: 'normal' });
  const tabsToMove = allTabs.filter(
    (t) =>
      t.windowId !== targetWindowId &&
      Boolean(t.incognito) === Boolean(targetWin.incognito)
  );

  if (tabsToMove.length === 0) {
    return { ok: false, error: 'لا توجد نوافذ أخرى لدمجها.' };
  }

  return moveTabsToExistingWindow(tabsToMove, targetWindowId);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message.type !== 'string') {
    return false;
  }

  if (message.type === 'EXTRACT_TABS') {
    extractTabsToWindow(message.tabIds, message.targetWindowId)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : 'حدث خطأ أثناء نقل التبويبات.'
        });
      });
    return true;
  }

  if (message.type === 'MERGE_WINDOWS') {
    mergeAllWindowsIntoTarget(message.targetWindowId)
      .then(sendResponse)
      .catch((err) => {
        sendResponse({
          ok: false,
          error: err && err.message ? err.message : 'حدث خطأ أثناء دمج النوافذ.'
        });
      });
    return true;
  }

  return false;
});
