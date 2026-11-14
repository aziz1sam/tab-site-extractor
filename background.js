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

  const uniqueIds = [...new Set(tabIds.filter((id) => typeof id === 'number'))];
  if (uniqueIds.length === 0) {
    return { ok: false, error: 'لم يتم تحديد أي تبويبات صالحة للنقل.' };
  }

  // Fetch all tab states in parallel instead of sequential IPC calls
  const settled = await Promise.allSettled(
    uniqueIds.map((id) => chrome.tabs.get(id))
  );

  const validTabs = [];
  for (const res of settled) {
    if (res.status === 'fulfilled' && res.value && typeof res.value.id === 'number') {
      validTabs.push({
        id: res.value.id,
        pinned: Boolean(res.value.pinned),
        incognito: Boolean(res.value.incognito)
      });
    }
  }

  if (validTabs.length === 0) {
    return { ok: false, error: 'لم تعد التبويبات المحددة متاحة.' };
  }

  // Try creating the new window with the first available tab (fallback to next if closed concurrently)
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
      // Candidate tab closed or unmovable; try the next one
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
      // Ignore if tab closed concurrently
    }
  }

  // Filter remaining tabs to match the target window's incognito mode
  const restTabs = validTabs
    .slice(startIndex)
    .filter((t) => t.incognito === firstTab.incognito);

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
      // Fallback: check which tabs weren't moved yet and move individually
      for (const id of restUnpinnedIds) {
        try {
          const currentTab = await chrome.tabs.get(id);
          if (currentTab && currentTab.windowId === newWin.id) {
            movedCount += 1;
            continue;
          }
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
