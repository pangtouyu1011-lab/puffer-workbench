// 验证通知优化：打开页面立即检测新留言 + title 角标 + 进留言页清零
const puppeteer = require('puppeteer-core');
const SEED = JSON.stringify({
  messages: [{ id: 'old1', text: '昨天的留言', author: 'b', createdAt: Date.now() - 86400000, updatedAt: Date.now() - 86400000 }],
  settings: {
    partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 },
    me: 'a', city: '杭州', syncCode: '', cloudUrl: '',
    room: { backend: 'supabase', url: 'https://fake.example.com', anon: 'k', id: 'demo', pass: 'p', joined: true, lastSync: 0, lastRev: 0 },
    notifySystem: true,
  }
});
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e.message)));
  await p.evaluateOnNewDocument(seed => {
    localStorage.setItem('pufferwork:v1', seed);
    const orig = window.fetch;
    window.fetch = async function (url, opts) {
      const u = String(url);
      if (u.includes('/functions/v1/room-')) {
        if (u.endsWith('room-get')) {
          // 远端有一条本地没有的新留言（author=b，来自对方）
          return new Response(JSON.stringify({ ok: true, data: { messages: [{ id: 'new1', text: '今天去哪玩？', author: 'b', createdAt: Date.now(), updatedAt: Date.now() }] }, rev: 100 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(JSON.stringify({ ok: true, rev: 101 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return orig.apply(this, arguments);
    };
  }, SEED);
  await p.goto('file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000)); // 等初始化 push（含新留言检测）完成

  const afterLoad = await p.evaluate(() => ({
    title: document.title,
    badge: (() => { const el = document.querySelector('.nav-item[data-page="messages"] .msg-badge'); return el ? el.textContent : null; })(),
    badgeHidden: (() => { const el = document.querySelector('.nav-item[data-page="messages"] .msg-badge'); return el ? el.hidden : true; })(),
  }));
  console.log('AFTER_LOAD:', JSON.stringify(afterLoad, null, 2));

  // 进入留言页 → 未读清零、title 恢复
  await p.evaluate(() => document.querySelector('.nav-item[data-page="messages"]').click());
  await new Promise(r => setTimeout(r, 400));
  const afterEnter = await p.evaluate(() => ({
    title: document.title,
    badgeHidden: (() => { const el = document.querySelector('.nav-item[data-page="messages"] .msg-badge'); return el ? el.hidden : true; })(),
    hasNewMsg: document.getElementById('msgList').textContent.includes('今天去哪玩'),
  }));
  console.log('AFTER_ENTER:', JSON.stringify(afterEnter, null, 2));
  console.log('ERRORS:', errors.length ? errors : 'none');
  await b.close();
})();
