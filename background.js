'use strict';

/**
 * Background Service Worker
 * Executes tab extraction into a new window reliably even if the popup closes
 * when focus changes.
 */

async function extractTabsToNewWindow(tabIds) {
  if (!Array.isArray(tabIds) || tabIds.length === 0) {
    return { ok: false, error: 'لم يتم تحديد أي تبويبات للنقل.' };
  }

  const validTabs = [];
  for (const rawId of tabIds) {
    if (typeof rawId !== 'number') continue;
    try {
      const tab = await chrome.tabs.get(rawId);
      if (tab && typeof tab.id === 'number') {
        validTabs.push({
          id: tab.id,
          pinned: Boolean(tab.pinned)
        });
      }
    } catch {
      // Ignore tabs closed or unavailable before extraction
    }
  }

  if (validTabs.length === 0) {
    return { ok: false, error: 'لم تعد التبويبات المحددة متاحة.' };
  }

  const firstTab = validTabs[0];
  const restTabs = validTabs.slice(1);

  // Create the new window unfocused first so the popup stays alive while moving
  const newWin = await chrome.windows.create({
    tabId: firstTab.id,
    focused: false
  });

  if (!newWin || typeof newWin.id !== 'number') {
    return { ok: false, error: 'تعذر إنشاء النافذة الجديدة.' };
  }

  let movedCount = 1;

  if (firstTab.pinned) {
    try {
      await chrome.tabs.update(firstTab.id, { pinned: true });
    } catch {
      // Ignore if tab closed concurrently
    }
  }

  // Move remaining pinned tabs first, re-pinning sequentially to preserve order
  const restPinned = restTabs.filter((t) => t.pinned);
  const restUnpinned = restTabs.filter((t) => !t.pinned);

  for (const tab of restPinned) {
    try {
      await chrome.tabs.move(tab.id, {
        windowId: newWin.id,
        index: -1
      });
      await chrome.tabs.update(tab.id, { pinned: true });
      movedCount += 1;
    } catch {
      // Skip tab if unmovable or closed
    }
  }

  if (restUnpinned.length > 0) {
    const restUnpinnedIds = restUnpinned.map((t) => t.id);
    try {
      await chrome.tabs.move(restUnpinnedIds, {
        windowId: newWin.id,
        index: -1
      });
      movedCount += restUnpinnedIds.length;
    } catch {
      // Fallback: move individually if any single tab fails
      for (const id of restUnpinnedIds) {
        try {
          await chrome.tabs.move(id, {
            windowId: newWin.id,
            index: -1
          });
          movedCount += 1;
        } catch {
          // Skip unmovable tab
        }
      }
    }
  }

  try {
    await chrome.windows.update(newWin.id, { focused: true });
  } catch {
    // Ignore focus error
  }

  return {
    ok: true,
    windowId: newWin.id,
    moved: movedCount
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== 'EXTRACT_TABS') {
    return false;
  }

  extractTabsToNewWindow(message.tabIds)
    .then((result) => {
      sendResponse(result);
    })
    .catch((err) => {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : 'حدث خطأ أثناء نقل التبويبات.'
      });
    });

  return true;
});
