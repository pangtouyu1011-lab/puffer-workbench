// 全面冒烟：双视口遍历所有页面 + 关键交互 + 收集 pageerror / console error
const puppeteer = require('puppeteer-core');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\tools';
const URL = 'file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html';
const PAGES = ['dashboard', 'todo', 'fitness', 'horoscope', 'messages', 'wishes'];
const KEY_ELEMENTS = {
  dashboard: ['#waterPlus', '#mascotBubble', '#statTodo', '#todayDateText', '.dw-mascot .mascot-img'],
  todo: ['#addTodoBtn', '#todoList', '#calGrid'],
  fitness: ['#addTrainBtn', '#weekStrip'],
  horoscope: ['#horoGrid', '#fortuneBody'],
  messages: ['#msgInput', '#msgSend', '#msgList'],
  wishes: ['#addWishBtn', '#wishWall'],
};

async function testViewport(browser, viewport, name) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const pageErrors = [];
  const consoleErrors = [];
  const failedReqs = [];
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('requestfailed', r => failedReqs.push(r.url().slice(0, 100)));
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1200));

  const report = { viewport: name, pageErrors, consoleErrors, failedReqs: [...new Set(failedReqs)], pages: {} };
  for (const pg of PAGES) {
    await page.evaluate(p => { const el = document.querySelector('.nav-item[data-page="' + p + '"]') || document.querySelector('.bn-item[data-page="' + p + '"]'); if (el) el.click(); }, pg);
    await new Promise(r => setTimeout(r, 350));
    const info = await page.evaluate((pg, keys) => {
      const missing = keys.filter(k => !document.querySelector(k));
      const bodyLen = document.body.innerText.length;
      return { missing, bodyLen };
    }, pg, KEY_ELEMENTS[pg]);
    report.pages[pg] = info;
  }
  // 交互：喝水打卡
  await page.evaluate(() => document.querySelector('.nav-item[data-page="dashboard"]').click());
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => document.getElementById('waterPlus').click());
  await new Promise(r => setTimeout(r, 200));
  const water = await page.evaluate(() => document.getElementById('waterCount').textContent);
  report.waterAfterClick = water;
  // 交互：戳河豚
  const puff = await page.evaluate(() => {
    const img = document.querySelector('.dw-mascot .mascot-img');
    img.click();
    return new Promise(res => setTimeout(() => res(img.classList.contains('puff')), 100));
  });
  report.mascotPuff = puff;
  await page.screenshot({ path: path.join(OUT, 'full_' + name + '.png') });
  await page.close();
  return report;
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const desktop = await testViewport(browser, { width: 1440, height: 900 }, 'desktop');
  const mobile = await testViewport(browser, { width: 390, height: 844 }, 'mobile');
  console.log('=== DESKTOP ===');
  console.log(JSON.stringify(desktop, null, 1));
  console.log('=== MOBILE ===');
  console.log(JSON.stringify(mobile, null, 1));
  await browser.close();
})();
