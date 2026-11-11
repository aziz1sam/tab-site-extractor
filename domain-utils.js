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
    'co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'mil', 'sch', 'ne', 'or', 'go'
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
    'wordpress.com'
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
    if (hostname.includes(':')) return true; // IPv6 (e.g. [::1] or ::1)
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
      return hostname.slice(4);
    }
    return hostname;
  }

  function extractMainDomain(cleanHost) {
    if (isIpOrLocalhost(cleanHost)) {
      return normalizeIpv6Host(cleanHost);
    }

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
    if (parsed.hostname) {
      return `${parsed.protocol}//${parsed.hostname}`;
    }
    return parsed.protocol || 'صفحة نظام';
  }

  /**
   * Classify a tab object or URL string into a site group descriptor.
   * @param {object|string} tabOrUrl
   * @param {'main'|'subdomain'} groupingMode
   */
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

  /**
   * Group tabs into sorted site entries.
   * @param {Array<object>} rawTabs
   * @param {'main'|'subdomain'} groupingMode
   */
  function groupTabsBySite(rawTabs, groupingMode) {
    const mode = groupingMode === 'subdomain' ? 'subdomain' : 'main';
    const groupMap = new Map();

    for (const tab of rawTabs) {
      if (!tab || typeof tab.id !== 'number') continue;
      const effectiveUrl = tab.pendingUrl || tab.url || '';
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

      group.tabs.push({
        id: tab.id,
        title,
        url: effectiveUrl,
        subLabel: info.subLabel,
        favIconUrl: safeIcon,
        pinned: Boolean(tab.pinned),
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
    classifyTab,
    groupTabsBySite
  };

  root.DomainUtils = DomainUtils;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = DomainUtils;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
