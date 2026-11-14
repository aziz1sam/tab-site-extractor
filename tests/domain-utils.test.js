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

  // 2. Strip www. in both modes & handle 2-letter country SLDs safely (including www.co.uk edge case)
  assert.equal(classifyTab('https://www.bbc.co.uk', 'main').displayName, 'bbc.co.uk');
  assert.equal(classifyTab('https://www.bbc.co.uk', 'subdomain').displayName, 'bbc.co.uk');
  assert.equal(classifyTab('https://www.co.uk', 'main').displayName, 'www.co.uk');

  assert.equal(classifyTab('https://news.bbc.co.uk', 'main').displayName, 'bbc.co.uk');
  assert.equal(classifyTab('https://news.bbc.co.uk', 'subdomain').displayName, 'news.bbc.co.uk');

  assert.equal(classifyTab('https://example.com.sa', 'main').displayName, 'example.com.sa');
  assert.equal(classifyTab('https://portal.example.com.sa/path', 'main').displayName, 'example.com.sa');
  assert.equal(classifyTab('https://hospital.med.sa', 'main').displayName, 'hospital.med.sa');

  // 3. Hosting platform exceptions keep 3 parts in main mode
  assert.equal(classifyTab('https://user.github.io', 'main').displayName, 'user.github.io');
  assert.equal(classifyTab('https://docs.user.github.io/guide', 'main').displayName, 'user.github.io');
  assert.equal(classifyTab('https://demo.vercel.app', 'main').displayName, 'demo.vercel.app');
  assert.equal(classifyTab('https://app.fly.dev', 'main').displayName, 'app.fly.dev');
  assert.equal(classifyTab('https://bot.railway.app', 'main').displayName, 'bot.railway.app');

  // 4. Localhost & IPv4 / IPv6
  assert.equal(classifyTab('http://localhost:3000', 'main').displayName, 'localhost');
  assert.equal(classifyTab('http://192.168.1.5:8080', 'main').displayName, '192.168.1.5');
  assert.equal(classifyTab('http://[::1]:5173/app', 'main').displayName, '::1');

  // 5. System pages and view-source / blob subLabels
  const viewSourceClassified = classifyTab('view-source:https://example.com/page', 'main');
  assert.equal(viewSourceClassified.key, INTERNAL_GROUP_KEY);
  assert.equal(viewSourceClassified.subLabel, 'view-source:example.com');

  const blobClassified = classifyTab('blob:https://example.com/550e8400-e29b', 'main');
  assert.equal(blobClassified.key, INTERNAL_GROUP_KEY);
  assert.equal(blobClassified.subLabel, 'blob:example.com');

  // 6. Grouping, duplicate detection (ignoring #hash & trailing slash), and audio flags
  const grouped = groupTabsBySite(
    [
      { id: 1, url: 'https://github.com/aziz1sam/tab-site-extractor/', title: 'Repo 1', windowId: 1, index: 0 },
      { id: 2, url: 'https://github.com/aziz1sam/tab-site-extractor#readme', title: 'Repo 2', windowId: 1, index: 1 },
      { id: 3, url: 'https://youtube.com/watch?v=1', title: 'Video', windowId: 1, index: 2, audible: true, mutedInfo: { muted: false } }
    ],
    'main'
  );

  assert.equal(grouped.length, 2);
  const githubGroup = grouped.find((g) => g.key === 'github.com');
  assert.equal(githubGroup.tabs.length, 2);
  assert.equal(githubGroup.tabs[0].isDuplicate, true);
  assert.equal(githubGroup.tabs[0].isDuplicateCopy, false);
  assert.equal(githubGroup.tabs[1].isDuplicate, true);
  assert.equal(githubGroup.tabs[1].isDuplicateCopy, true);

  const ytGroup = grouped.find((g) => g.key === 'youtube.com');
  assert.equal(ytGroup.tabs[0].audible, true);
  assert.equal(ytGroup.tabs[0].muted, false);

  console.log('All domain-utils tests passed successfully!');
}

runTests();
