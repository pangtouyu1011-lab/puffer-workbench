// 验证本轮设计改动：心愿点亮 / 空相册 is-empty / 留言时间分隔 / 河豚页面文案 / muted
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html';
const now = Date.now();
const SEED = JSON.stringify({
  messages: [
    { id: 'm-old', text: '昨天的消息', author: 'b', createdAt: now - 90000000, updatedAt: now - 90000000 },
    { id: 'm-new', text: '今天的新消息', author: 'b', createdAt: now, updatedAt: now },
  ],
  wishes: [
    { id: 'w-mine', text: '我自己写的', icon: '🛎️', anonymous: false, author: 'a', color: 'coral', tilt: 0, createdAt: now, updatedAt: now },
    { id: 'w-theirs', text: 'TA 写的', icon: '🛎️', anonymous: false, author: 'b', color: 'mint', tilt: 0, createdAt: now, updatedAt: now },
  ],
  settings: { partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a', city: '杭州' }
});

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e.message)));
  await p.evaluateOnNewDocument(s => localStorage.setItem('pufferwork:v1', s), SEED);
  await p.setViewport({ width: 1440, height: 900 });
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // 1) 空相册：is-empty class + 压缩高度 + CTA
  const gallery = await p.evaluate(() => {
    const hero = document.getElementById('galleryHero');
    const stage = document.querySelector('.gallery-stage');
    return {
      isEmptyClass: hero.classList.contains('is-empty'),
      stageH: stage ? stage.offsetHeight : -1,
      hasCta: !!document.getElementById('galleryEmptyCta'),
    };
  });
  console.log('GALLERY:', JSON.stringify(gallery));

  // 2) 留言时间分隔
  await p.evaluate(() => document.querySelector('.nav-item[data-page="messages"]').click());
  await new Promise(r => setTimeout(r, 300));
  const msgs = await p.evaluate(() => ({
    dayChips: document.querySelectorAll('.msg-day').length,
    texts: document.getElementById('msgList').textContent,
  }));
  console.log('MESSAGES:', JSON.stringify(msgs));

  // 3) 心愿点亮：TA 的心愿有点亮按钮，自己的没有；点亮后变「已被 TA 看到」
  await p.evaluate(() => document.querySelector('.nav-item[data-page="wishes"]').click());
  await new Promise(r => setTimeout(r, 300));
  const before = await p.evaluate(() => ({
    litBtns: document.querySelectorAll('.wish-lit-btn').length,
    litLabels: document.querySelectorAll('.wish-lit').length,
  }));
  console.log('WISH_BEFORE:', JSON.stringify(before));
  // 点第一个点亮按钮（TA 的心愿）
  await p.evaluate(() => document.querySelector('.wish-lit-btn').click());
  await new Promise(r => setTimeout(r, 300));
  const after = await p.evaluate(() => ({
    litBtns: document.querySelectorAll('.wish-lit-btn').length,
    litLabels: document.querySelectorAll('.wish-lit').length,
    litText: (document.querySelector('.wish-lit') || {}).textContent || '',
  }));
  console.log('WISH_AFTER:', JSON.stringify(after));

  // 4) 河豚页面文案：留言页 → 文案变化
  await p.evaluate(() => document.querySelector('.nav-item[data-page="wishes"]').click());
  await new Promise(r => setTimeout(r, 200));
  const wishQuote = await p.evaluate(() => document.getElementById('mascotQuote').textContent);
  await p.evaluate(() => document.querySelector('.nav-item[data-page="todo"]').click());
  await new Promise(r => setTimeout(r, 200));
  const todoQuote = await p.evaluate(() => document.getElementById('mascotQuote').textContent);
  console.log('QUOTES:', JSON.stringify({ wishQuote, todoQuote }));

  // 5) muted 颜色值
  const muted = await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--muted').trim());
  console.log('MUTED:', muted);

  console.log('ERRORS:', errors.length ? errors : 'none');
  await b.close();
})();
