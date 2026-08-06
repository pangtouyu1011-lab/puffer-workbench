// 验证：改名 / 待办日历合并 / 星座页 / 祈福抽签 / 导航
const puppeteer = require('puppeteer-core');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html';
const now = Date.now();
const SEED = JSON.stringify({
  todos: [
    { id: 't1', text: '今天的事', done: false, priority: 'high', date: (() => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); })(), createdAt: now, updatedAt: now },
    { id: 't2', text: '无日期的事', done: false, priority: '', date: '', createdAt: now, updatedAt: now },
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
  await new Promise(r => setTimeout(r, 1200));

  // 1) 改名
  const brand = await p.evaluate(() => ({
    title: document.title,
    brandTitle: document.querySelector('.brand-title').textContent,
    brandSub: document.getElementById('brandSub').textContent,
  }));
  console.log('BRAND:', JSON.stringify(brand));

  // 2) 导航（无 calendar、有 horoscope）
  const nav = await p.evaluate(() => Array.from(document.querySelectorAll('.nav-item')).map(n => n.dataset.page));
  console.log('NAV:', JSON.stringify(nav));

  // 3) 待办日历页
  await p.evaluate(() => document.querySelector('.nav-item[data-page="todo"]').click());
  await new Promise(r => setTimeout(r, 500));
  const todoPage = await p.evaluate(() => ({
    calCells: document.querySelectorAll('#calGrid .cal-cell:not(.empty)').length,
    dayBarHidden: document.getElementById('todoDayBar').hidden,
    listCount: document.querySelectorAll('#todoList .todo-item').length,
  }));
  console.log('TODO_PAGE:', JSON.stringify(todoPage));
  // 点击今天的日期 → 只显示今天的事 + daybar 出现
  await p.evaluate(() => {
    const d = new Date();
    const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    document.querySelector('#calGrid .cal-cell[data-date="' + key + '"]').click();
  });
  await new Promise(r => setTimeout(r, 400));
  const afterClick = await p.evaluate(() => ({
    dayBarShown: !document.getElementById('todoDayBar').hidden,
    barText: document.getElementById('todoDayBar').textContent.slice(0, 40),
    items: Array.from(document.querySelectorAll('#todoList .todo-item .ti-text')).map(x => x.textContent),
  }));
  console.log('AFTER_DAY_CLICK:', JSON.stringify(afterClick));

  // 4) 星座页
  await p.evaluate(() => document.querySelector('.nav-item[data-page="horoscope"]').click());
  await new Promise(r => setTimeout(r, 500));
  const horo = await p.evaluate(() => ({
    cards: document.querySelectorAll('.horo-card').length,
    names: Array.from(document.querySelectorAll('.horo-name')).map(x => x.textContent.slice(0, 6)),
    rows: document.querySelectorAll('.horo-row').length,
    note: !!document.querySelector('.horo-note'),
    fortuneHasPick: !!document.getElementById('fortunePick'),
  }));
  console.log('HORO:', JSON.stringify(horo));

  // 5) 抽签
  await p.evaluate(() => document.getElementById('fortunePick').click());
  await new Promise(r => setTimeout(r, 1300));
  const fortune = await p.evaluate(() => ({
    sign: (document.querySelector('.ft-sign') || {}).textContent || '',
    text: (document.querySelector('.ft-text') || {}).textContent || '',
    tip: (document.querySelector('.ft-tip') || {}).textContent || '',
    dateNote: (document.querySelector('.ft-date') || {}).textContent || '',
    pickGone: !document.getElementById('fortunePick'),
  }));
  console.log('FORTUNE:', JSON.stringify(fortune));

  // 6) 再进一次星座页 → 应显示已抽（每日一次生效）
  await p.evaluate(() => document.querySelector('.nav-item[data-page="dashboard"]').click());
  await new Promise(r => setTimeout(r, 300));
  await p.evaluate(() => document.querySelector('.nav-item[data-page="horoscope"]').click());
  await new Promise(r => setTimeout(r, 400));
  const again = await p.evaluate(() => ({ pickGone: !document.getElementById('fortunePick'), signShown: !!document.querySelector('.ft-sign') }));
  console.log('FORTUNE_AGAIN:', JSON.stringify(again));

  console.log('ERRORS:', errors.length ? errors : 'none');
  await b.close();
})();
