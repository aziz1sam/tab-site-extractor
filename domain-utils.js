(function (root) {
  'use strict';

  const INTERNAL_GROUP_KEY = '__browser_system__';
  const INTERNAL_GROUP_LABEL = 'صفحات المتصفح والنظام';

  const SYSTEM_PROTOCOLS = new Set([
    'chrome:',
    'chrome-extension:',
    'chrome-untrusted:',
    'chrome-search:',
    'edge:',
    'brave:',
    'opera:',
    'vivaldi:',
    'about:',
    'file:',
    'devtools:',
    'view-source:',
    'data:',
    'blob:'
  ]);

  const COUNTRY_SECOND_LEVEL_LABELS = new Set([
    'co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'mil', 'sch', 'ne', 'or', 'go',
    'med', 'nom', 'ind', 'id', 'lg'
  ]);

  const HOSTING_PLATFORM_SUFFIXES = new Set([
    'github.io',
    'gitlab.io',
    'blogspot.com',
    'vercel.app',
    'netlify.app',
    'pages.dev',
    'workers.dev',
    'herokuapp.com',
    'web.app',
    'firebaseapp.com',
    'appspot.com',
    'onrender.com',
    'azurewebsites.net',
    'wordpress.com',
    'fly.dev',
    'railway.app',
    'deno.dev',
    'surge.sh',
    'glitch.me',
    'ngrok-free.app',
    'ngrok.io',
    'trycloudflare.com',
    'myshopify.com',
    'wixsite.com'
  ]);

  function isSafeImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    return (
      url.startsWith('https://') ||
      url.startsWith('http://') ||
      url.startsWith('data:image/')
    );
  }

  function isIpOrLocalhost(hostname) {
    if (!hostname) return true;
    if (hostname === 'localhost') return true;
    if (hostname.includes(':')) return true;
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
  }

  function normalizeIpv6Host(hostname) {
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      return hostname.slice(1, -1);
    }
    return hostname;
  }

  function stripLeadingWww(hostname) {
    const parts = hostname.split('.');
    if (hostname.startsWith('www.') && parts.length > 2) {
      if (
        parts.length === 3 &&
        parts[2].length === 2 &&
        COUNTRY_SECOND_LEVEL_LABELS.has(parts[1])
      ) {
        return hostname;
      }
      return hostname.slice(4);
    }
    return hostname;
  }

  function extractMainDomain(rawCleanHost) {
    if (isIpOrLocalhost(rawCleanHost)) {
      return normalizeIpv6Host(rawCleanHost);
    }

    const cleanHost = stripLeadingWww(rawCleanHost.toLowerCase().replace(/\.$/, ''));
    const parts = cleanHost.split('.').filter(Boolean);
    if (parts.length <= 2) {
      return cleanHost;
    }

    const lastTwo = parts.slice(-2).join('.');
    if (HOSTING_PLATFORM_SUFFIXES.has(lastTwo)) {
      return parts.slice(-3).join('.');
    }

    const tld = parts[parts.length - 1];
    const sld = parts[parts.length - 2];

    if (tld.length === 2 && COUNTRY_SECOND_LEVEL_LABELS.has(sld) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }

    return lastTwo;
  }

  function formatSystemHint(parsed) {
    if (!parsed) return 'صفحة نظام';
    if (parsed.protocol === 'file:') {
      try {
        const segs = decodeURIComponent(parsed.pathname).split('/').filter(Boolean);
        return segs.length > 0 ? segs[segs.length - 1] : 'ملف محلي';
      } catch {
        return 'ملف محلي';
      }
    }
    if (parsed.protocol === 'about:') {
      return `about:${parsed.pathname || 'blank'}`;
    }
    if (parsed.protocol === 'view-source:' || parsed.protocol === 'blob:') {
      try {
        const inner = new URL(parsed.pathname);
        if (inner.hostname) return `${parsed.protocol}${inner.hostname}`;
      } catch {
        // Fallback below
      }
    }
    if (parsed.hostname) {
      return `${parsed.protocol}//${parsed.hostname}`;
    }
    return parsed.protocol || 'صفحة نظام';
  }

  function normalizeUrlForDedupe(rawUrl) {
    const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!trimmed) return '';
    try {
      const parsed = new URL(trimmed);
      parsed.hash = '';
      if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
        parsed.pathname = parsed.pathname.slice(0, -1);
      }
      return parsed.toString();
    } catch {
      return trimmed;
    }
  }

  function classifyTab(tabOrUrl, groupingMode) {
    const mode = groupingMode === 'subdomain' ? 'subdomain' : 'main';
    const rawUrl =
      typeof tabOrUrl === 'string'
        ? tabOrUrl
        : (tabOrUrl && (tabOrUrl.pendingUrl || tabOrUrl.url)) || '';

    const trimmed = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!trimmed) {
      return {
        key: INTERNAL_GROUP_KEY,
        displayName: INTERNAL_GROUP_LABEL,
        isInternal: true,
        subLabel: 'صفحة فارغة'
      };
    }

    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return {
        key: INTERNAL_GROUP_KEY,
        displayName: INTERNAL_GROUP_LABEL,
        isInternal: true,
        subLabel: 'صفحة نظام'
      };
    }

    if (SYSTEM_PROTOCOLS.has(parsed.protocol) || !parsed.hostname) {
      return {
        key: INTERNAL_GROUP_KEY,
        displayName: INTERNAL_GROUP_LABEL,
        isInternal: true,
        subLabel: formatSystemHint(parsed)
      };
    }

    const rawHost = parsed.hostname.toLowerCase().replace(/\.$/, '');
    const cleanHost = isIpOrLocalhost(rawHost)
      ? normalizeIpv6Host(rawHost)
      : stripLeadingWww(rawHost);

    if (mode === 'subdomain') {
      return {
        key: cleanHost,
        displayName: cleanHost,
        isInternal: false,
        subLabel: cleanHost
      };
    }

    const mainDomain = extractMainDomain(cleanHost);
    return {
      key: mainDomain,
      displayName: mainDomain,
      isInternal: false,
      subLabel: cleanHost
    };
  }

  function groupTabsBySite(rawTabs, groupingMode) {
    const mode = groupingMode === 'subdomain' ? 'subdomain' : 'main';
    const groupMap = new Map();
    const urlCounts = new Map();

    for (const tab of rawTabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      const effectiveUrl = tab.pendingUrl || tab.url || '';
      const normUrl = normalizeUrlForDedupe(effectiveUrl);
      if (normUrl) {
        urlCounts.set(normUrl, (urlCounts.get(normUrl) || 0) + 1);
      }
    }

    const seenFirstInstance = new Set();

    for (const tab of rawTabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      const effectiveUrl = tab.pendingUrl || tab.url || '';
      const normUrl = normalizeUrlForDedupe(effectiveUrl);
      const hasDuplicates = Boolean(normUrl && (urlCounts.get(normUrl) || 0) > 1);
      let isDuplicateCopy = false;

      if (hasDuplicates) {
        if (seenFirstInstance.has(normUrl)) {
          isDuplicateCopy = true;
        } else {
          seenFirstInstance.add(normUrl);
        }
      }

      const info = classifyTab(effectiveUrl, mode);
      const safeIcon = !info.isInternal && isSafeImageUrl(tab.favIconUrl)
        ? tab.favIconUrl
        : null;

      if (!groupMap.has(info.key)) {
        groupMap.set(info.key, {
          key: info.key,
          displayName: info.displayName,
          isInternal: info.isInternal,
          favicon: safeIcon,
          tabs: []
        });
      }

      const group = groupMap.get(info.key);
      if (!group.favicon && safeIcon) {
        group.favicon = safeIcon;
      }

      const title = (tab.title || '').trim() || info.subLabel || 'تبويب بدون عنوان';
      const muted = Boolean(tab.mutedInfo && tab.mutedInfo.muted);
      const audible = Boolean(tab.audible);
      const discarded = Boolean(tab.discarded);

      group.tabs.push({
        id: tab.id,
        title,
        url: effectiveUrl,
        subLabel: info.subLabel,
        favIconUrl: safeIcon,
        pinned: Boolean(tab.pinned),
        audible,
        muted,
        discarded,
        isDuplicate: hasDuplicates,
        isDuplicateCopy,
        windowId: tab.windowId,
        index: tab.index,
        active: Boolean(tab.active),
        groupKey: info.key,
        groupDisplayName: info.displayName,
        isInternal: info.isInternal
      });
    }

    const groups = Array.from(groupMap.values());

    for (const group of groups) {
      group.tabs.sort((a, b) => {
        if (a.windowId !== b.windowId) return a.windowId - b.windowId;
        return a.index - b.index;
      });
    }

    groups.sort((a, b) => {
      if (a.isInternal !== b.isInternal) return a.isInternal ? 1 : -1;
      if (b.tabs.length !== a.tabs.length) return b.tabs.length - a.tabs.length;
      return a.displayName.localeCompare(b.displayName, 'ar');
    });

    return groups;
  }

  const DomainUtils = {
    INTERNAL_GROUP_KEY,
    INTERNAL_GROUP_LABEL,
    isSafeImageUrl,
    extractMainDomain,
    normalizeUrlForDedupe,
    classifyTab,
    groupTabsBySite
  };

  root.DomainUtils = DomainUtils;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DomainUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
