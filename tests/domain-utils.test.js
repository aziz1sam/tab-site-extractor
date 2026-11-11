'use strict';

const assert = require('node:assert/strict');
const DomainUtils = require('../domain-utils.js');

const {
  INTERNAL_GROUP_KEY,
  INTERNAL_GROUP_LABEL,
  classifyTab,
  groupTabsBySite
} = DomainUtils;

function runTests() {
  // 1. Subdomain vs Main domain for standard domains
  assert.equal(classifyTab('https://mail.google.com/x', 'main').displayName, 'google.com');
  assert.equal(classifyTab('https://mail.google.com/x', 'subdomain').displayName, 'mail.google.com');
  assert.equal(classifyTab('https://drive.google.com/drive/u/0', 'subdomain').displayName, 'drive.google.com');

  // 2. Strip www. in both modes & handle 2-letter country SLDs
  assert.equal(classifyTab('https://www.bbc.co.uk', 'main').displayName, 'bbc.co.uk');
  assert.equal(classifyTab('https://www.bbc.co.uk', 'subdomain').displayName, 'bbc.co.uk');

  assert.equal(classifyTab('https://news.bbc.co.uk', 'main').displayName, 'bbc.co.uk');
  assert.equal(classifyTab('https://news.bbc.co.uk', 'subdomain').displayName, 'news.bbc.co.uk');

  assert.equal(classifyTab('https://example.com.sa', 'main').displayName, 'example.com.sa');
  assert.equal(classifyTab('https://portal.example.com.sa/path', 'main').displayName, 'example.com.sa');
  assert.equal(classifyTab('https://site.co.jp', 'main').displayName, 'site.co.jp');
  assert.equal(classifyTab('https://shop.com.au', 'main').displayName, 'shop.com.au');

  // 3. Hosting platform exceptions keep 3 parts in main mode
  assert.equal(classifyTab('https://user.github.io', 'main').displayName, 'user.github.io');
  assert.equal(classifyTab('https://docs.user.github.io/guide', 'main').displayName, 'user.github.io');
  assert.equal(classifyTab('https://myblog.blogspot.com', 'main').displayName, 'myblog.blogspot.com');
  assert.equal(classifyTab('https://demo.vercel.app', 'main').displayName, 'demo.vercel.app');
  assert.equal(classifyTab('https://app.netlify.app', 'main').displayName, 'app.netlify.app');
  assert.equal(classifyTab('https://site.pages.dev', 'main').displayName, 'site.pages.dev');
  assert.equal(classifyTab('https://api.workers.dev', 'main').displayName, 'api.workers.dev');
  assert.equal(classifyTab('https://svc.herokuapp.com', 'main').displayName, 'svc.herokuapp.com');
  assert.equal(classifyTab('https://proj.web.app', 'main').displayName, 'proj.web.app');
  assert.equal(classifyTab('https://proj.firebaseapp.com', 'main').displayName, 'proj.firebaseapp.com');
  assert.equal(classifyTab('https://proj.appspot.com', 'main').displayName, 'proj.appspot.com');
  assert.equal(classifyTab('https://svc.onrender.com', 'main').displayName, 'svc.onrender.com');
  assert.equal(classifyTab('https://portal.azurewebsites.net', 'main').displayName, 'portal.azurewebsites.net');
  assert.equal(classifyTab('https://writer.wordpress.com', 'main').displayName, 'writer.wordpress.com');

  // 4. Localhost & IPv4 / IPv6
  assert.equal(classifyTab('http://localhost:3000', 'main').displayName, 'localhost');
  assert.equal(classifyTab('http://localhost:3000', 'subdomain').displayName, 'localhost');
  assert.equal(classifyTab('http://192.168.1.5:8080', 'main').displayName, '192.168.1.5');
  assert.equal(classifyTab('http://192.168.1.5:8080', 'subdomain').displayName, '192.168.1.5');
  assert.equal(classifyTab('http://[::1]:5173/app', 'main').displayName, '::1');

  // 5. System pages and empty URLs -> single system group
  const systemUrls = [
    'chrome://extensions',
    'edge://settings',
    'brave://settings',
    'opera://extensions',
    'vivaldi://about',
    'chrome-extension://abcdefghijklmnop/p.html',
    'chrome-untrusted://media-app/',
    'chrome-search://local-ntp/',
    'file:///a.pdf',
    'about:blank',
    'devtools://devtools/bundled/inspector.html',
    'view-source:https://example.com',
    'data:text/html,<h1>Hi</h1>',
    'blob:https://example.com/1234',
    ''
  ];

  for (const url of systemUrls) {
    const resMain = classifyTab(url, 'main');
    const resSub = classifyTab(url, 'subdomain');
    assert.equal(resMain.key, INTERNAL_GROUP_KEY, `Expected system key for ${url}`);
    assert.equal(resMain.displayName, INTERNAL_GROUP_LABEL);
    assert.equal(resMain.isInternal, true);
    assert.equal(resSub.key, INTERNAL_GROUP_KEY);
  }

  // 6. pendingUrl takes precedence when url is empty
  const pendingClassified = classifyTab({ url: '', pendingUrl: 'https://mail.google.com/x' }, 'main');
  assert.equal(pendingClassified.displayName, 'google.com');

  const pendingSub = classifyTab({ url: '', pendingUrl: 'https://mail.google.com/x' }, 'subdomain');
  assert.equal(pendingSub.displayName, 'mail.google.com');

  // 7. Grouping & sorting: descending tab count, Arabic localeCompare tiebreaker, system last,
  //    and windowId -> index sorting within each group
  const grouped = groupTabsBySite(
    [
      { id: 1, url: 'chrome://extensions', title: 'Extensions', windowId: 1, index: 0 },
      { id: 2, url: 'https://www.google.com', title: 'Google', windowId: 1, index: 1 },
      { id: 3, url: '', pendingUrl: 'https://mail.google.com/inbox', title: 'Mail', windowId: 1, index: 3 },
      { id: 4, url: 'https://drive.google.com', title: 'Drive', windowId: 1, index: 2 },
      { id: 5, url: 'https://youtube.com/watch?v=1', title: 'Video 1', windowId: 2, index: 0 },
      { id: 6, url: 'https://youtube.com/watch?v=2', title: 'Video 2', windowId: 1, index: 4 },
      { id: 7, url: 'about:blank', title: 'Blank', windowId: 1, index: 5 }
    ],
    'main'
  );

  assert.equal(grouped.length, 3);
  assert.equal(grouped[0].displayName, 'google.com');
  assert.equal(grouped[0].tabs.length, 3);
  assert.deepEqual(
    grouped[0].tabs.map((t) => t.id),
    [2, 4, 3]
  );

  assert.equal(grouped[1].displayName, 'youtube.com');
  assert.equal(grouped[1].tabs.length, 2);
  assert.deepEqual(
    grouped[1].tabs.map((t) => t.id),
    [6, 5] // windowId 1 before windowId 2
  );

  assert.equal(grouped[2].key, INTERNAL_GROUP_KEY);
  assert.equal(grouped[2].tabs.length, 2);

  console.log('All domain-utils tests passed successfully!');
}

runTests();
