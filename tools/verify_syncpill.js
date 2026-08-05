const puppeteer = require('puppeteer-core');
const path = require('path');

const OUT = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\tools';
const HTML = 'C:\\Users\\woqutech\\WorkBuddy\\2026-08-04-10-01-24\\personal-workbench\\index.html';
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const SEED = JSON.stringify({
  settings: {
    partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 },
    me: 'a', city: '杭州', syncCode: '', cloudUrl: '',
    room: { backend: 'supabase', url: 'https://fake.example.com', anon: 'k', id: 'demo', pass: 'p', joined: true, lastSync: 0, lastRev: 0 }
  }
});

(async () => {
  let T0 = Date.now(); // 供 request handler 记录相对时间
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));

  // 注入已加入房间的本地数据
  await page.evaluateOnNewDocument(seed => localStorage.setItem('pufferwork:v1', seed), SEED);

  // 拦截 Edge Function 请求：phase=fail 全部 500；phase=ok 返回成功（延迟 400ms 以便观察「同步中…」）
  // 必须响应 OPTIONS 预检并带 CORS 头，否则 file:// 页面的跨域 fetch 会报 Failed to fetch
  let phase = 'fail';
  global.__reqs = [];
  await page.setRequestInterception(true);
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'apikey,authorization,content-type,prefer',
  };
  page.on('request', req => {
    const u = req.url();
    if (u.includes('/functions/v1/room-')) {
      const isGet = u.includes('room-get');
      const method = req.method();
      global.__reqs.push({ method: isGet ? 'GET' : 'PUT', phase, t: Date.now() - T0 });
      if (method === 'OPTIONS') {
        req.respond({ status: 204, headers: cors });
        return;
      }
      if (phase === 'fail') {
        req.respond({ status: 500, headers: cors, contentType: 'application/json', body: '{"error":"boom"}' });
        return;
      }
      const body = isGet
        ? JSON.stringify({ ok: true, data: {}, rev: 123 })
        : JSON.stringify({ ok: true, rev: 456 });
      setTimeout(() => req.respond({ status: 200, headers: cors, contentType: 'application/json', body }), 400);
      return;
    }
    req.continue();
  });

  await page.goto('file://' + HTML, { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 800));

  const read = () => page.evaluate(() => ({
    text: document.getElementById('syncText').textContent,
    cls: document.getElementById('syncDot').className,
  }));

  const result = {};

  // 页面加载后：初始化自动同步被 mock 500 挡住 → pill 应变「同步失败·点重试」
  result.initial = await read();

  // 切换到成功模式，点击右上角 pill（失败态 → 直接重试）→ 先「同步中…」再恢复
  phase = 'ok';
  T0 = Date.now();
  // 记录 pill 文本变化序列
  await page.evaluate(() => {
    window.__pillLog = [];
    const st = document.getElementById('syncText');
    new MutationObserver(() => window.__pillLog.push({ dt: Date.now() - (window.__T0 || Date.now()), v: st.textContent }))
      .observe(st, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(() => { window.__T0 = Date.now(); document.getElementById('syncPill').click(); });
  await new Promise(r => setTimeout(r, 2500));
  result.pillLog = await page.evaluate(() => window.__pillLog);
  result.reqs = global.__reqs;
  result.toast = await page.evaluate(() => (document.getElementById('toast') || {}).textContent || '');
  result.final = await read();

  await page.screenshot({ path: path.join(OUT, 'verify_syncpill_after.png') });
  await browser.close();

  console.log(JSON.stringify({ result, errors }, null, 2));
})();
