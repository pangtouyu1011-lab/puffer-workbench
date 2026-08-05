// 生成设计评审截图（高清 2x，注入演示数据让页面内容更丰富）
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\tools\\design-shots';
const URL = 'file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html';
const now = Date.now();

// 演示数据：让截图展示真实内容形态
const SEED = JSON.stringify({
  water: {},
  todos: [
    { id: 't1', text: '写周报', done: false, priority: 'high', date: '', createdAt: now, updatedAt: now },
    { id: 't2', text: '去超市买牛奶和鸡蛋', done: false, priority: 'mid', date: '', createdAt: now, updatedAt: now },
    { id: 't3', text: '晚上一起看那部电影', done: true, priority: '', date: '', createdAt: now, updatedAt: now },
  ],
  messages: [
    { id: 'm1', text: '今天天气不错，要不要出去走走？☀️', author: 'b', createdAt: now - 3600000, updatedAt: now - 3600000 },
    { id: 'm2', text: '好呀！顺便去那家新开的咖啡店～', author: 'a', createdAt: now - 1800000, updatedAt: now - 1800000 },
    { id: 'm3', text: '哈哈哈那就说定了，下午三点见！💛', author: 'b', createdAt: now - 600000, updatedAt: now - 600000 },
  ],
  wishes: [
    { id: 'w1', text: '想一起去海边看一次日出 🌅', icon: '🛎️', anonymous: false, author: 'a', color: 'coral', tilt: -2, createdAt: now, updatedAt: now },
    { id: 'w2', text: '攒钱换一台新相机，拍更多我们的照片', icon: '🛎️', anonymous: true, author: 'b', color: 'mint', tilt: 1.5, createdAt: now, updatedAt: now },
    { id: 'w3', text: '养一只橘猫 🐱', icon: '🛎️', anonymous: false, author: 'a', color: 'peach', tilt: -1, createdAt: now, updatedAt: now },
  ],
  settings: {
    partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 },
    me: 'a', city: '杭州', syncCode: '', cloudUrl: '',
  }
});

const SHOTS = [
  { name: '01-dashboard-desktop', page: 'dashboard', w: 1440, h: 900 },
  { name: '02-wishes-desktop', page: 'wishes', w: 1440, h: 900 },
  { name: '03-messages-desktop', page: 'messages', w: 1440, h: 900 },
  { name: '04-dashboard-mobile', page: 'dashboard', w: 390, h: 844 },
  { name: '05-wishes-mobile', page: 'wishes', w: 390, h: 844 },
];

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await b.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.evaluateOnNewDocument(seed => {
    localStorage.setItem('pufferwork:v1', seed);
    // 喝水打卡演示数据（当天 3 杯）
    const d = new Date(); const k = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    try { const s = JSON.parse(seed); s.water = { [k]: 3 }; localStorage.setItem('pufferwork:v1', JSON.stringify(s)); } catch(e) {}
  }, SEED);
  for (const s of SHOTS) {
    await page.setViewport({ width: s.w, height: s.h, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1400));
    await page.evaluate(p => {
      const el = document.querySelector('.nav-item[data-page="' + p + '"]') || document.querySelector('.bn-item[data-page="' + p + '"]');
      if (el) el.click();
    }, s.page);
    await new Promise(r => setTimeout(r, 500));
    await page.screenshot({ path: path.join(OUT, s.name + '.png') });
    console.log('saved', s.name);
  }
  console.log('ERRORS:', errors.length ? errors : 'none');
  await b.close();
})();
