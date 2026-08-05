const puppeteer = require('puppeteer-core');
const path = require('path');

const OUT = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\tools';
const HTML = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  await page.goto('file://' + HTML, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 600));

  // 找到首页大 mascot 图并点击
  const result = await page.evaluate(async () => {
    const img = document.querySelector('.dw-mascot .mascot-img');
    if (!img) return { found: false };
    const before = document.getElementById('mascotBubble').textContent;
    img.click();
    await new Promise(r => setTimeout(r, 100));
    const hasPuff = img.classList.contains('puff');
    const after = document.getElementById('mascotBubble').textContent;
    // 侧栏 mini 也点一下
    const mini = document.querySelector('.mascot-mini img');
    let miniPuff = false;
    if (mini) { mini.click(); await new Promise(r => setTimeout(r, 80)); miniPuff = mini.classList.contains('puff'); }
    return { found: true, before, after, hasPuff, miniPuff };
  });

  await page.screenshot({ path: path.join(OUT, 'verify_mascot.png') });
  await browser.close();

  console.log(JSON.stringify({ errors, result }, null, 2));
})();
