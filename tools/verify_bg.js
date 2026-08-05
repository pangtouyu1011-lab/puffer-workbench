// 验证背景像素漂浮物 + 视差
const puppeteer = require('puppeteer-core');
const path = require('path');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\tools';
const URL = 'file:///C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html';

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500)); // 等动画进入中段

  const info = await page.evaluate(() => {
    const motes = Array.from(document.querySelectorAll('.bg-motes .mote'));
    const heart = document.querySelector('.mote-heart');
    const star = document.querySelector('.mote-star');
    const puff = document.querySelector('.mote-puff');
    const cs = (el) => el ? getComputedStyle(el) : null;
    const visible = motes.filter(m => parseFloat(getComputedStyle(m).opacity) > .15).length;
    return {
      moteCount: motes.length,
      visibleNow: visible,
      heartShadows: heart ? getComputedStyle(heart, '::before').boxShadow.split('),').length : 0,
      starShadows: star ? getComputedStyle(star, '::before').boxShadow.split('),').length : 0,
      puffBg: puff ? getComputedStyle(puff, '::before').backgroundImage.slice(0, 50) : '',
      heartOpacity: cs(heart) ? parseFloat(cs(heart).opacity).toFixed(2) : -1,
      heartTransform: cs(heart) ? cs(heart).transform.slice(0, 80) : '',
      layerCount: document.querySelectorAll('.bg-bubbles, .bg-motes').length,
      layerZ: getComputedStyle(document.querySelector('.bg-motes')).zIndex,
      appZ: getComputedStyle(document.querySelector('.app')).zIndex,
    };
  });
  console.log('INFO:', JSON.stringify(info, null, 2));
  console.log('ERRORS:', errors.length ? errors : 'none');

  await page.screenshot({ path: path.join(OUT, 'verify_bg_motes.png') });

  // 触发视差：dispatch mousemove 到 window（headless 中 page.mouse.move 不一定派发）
  await page.evaluate(() => {
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1440, clientY: 900, bubbles: true }));
  });
  await new Promise(r => setTimeout(r, 500));
  const parallax = await page.evaluate(() => ({
    bubbles: getComputedStyle(document.querySelector('.bg-bubbles')).transform,
    motes: getComputedStyle(document.querySelector('.bg-motes')).transform,
  }));
  console.log('PARALLAX:', JSON.stringify(parallax));
  await page.screenshot({ path: path.join(OUT, 'verify_bg_parallax.png') });
  await browser.close();
})();
