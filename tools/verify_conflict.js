// 页面内 patch fetch 验证 conflict 自动重试（无网络层/拦截器干扰）
const puppeteer = require('puppeteer-core');
const SEED = JSON.stringify({ settings: { partners:{a:'孙大炮',b:'童大侠',updatedAt:0}, me:'a', city:'杭州', syncCode:'', cloudUrl:'', room:{ backend:'supabase', url:'https://fake.example.com', anon:'k', id:'demo', pass:'p', joined:true, lastSync:0, lastRev:100 } } });
(async () => {
  const b = await puppeteer.launch({ executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', headless:'new', args:['--no-sandbox'] });
  const p = await b.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e.message)));
  await p.evaluateOnNewDocument(seed => {
    localStorage.setItem('pufferwork:v1', seed);
    window.__calls = [];
    const orig = window.fetch;
    window.fetch = async function (url, opts) {
      const u = String(url);
      if (u.includes('/functions/v1/room-')) {
        const slug = u.endsWith('room-get') ? 'GET' : 'PUT';
        window.__calls.push({ slug, t: performance.now() });
        if (slug === 'GET') {
          return new Response(JSON.stringify({ ok:true, data:{}, rev:100 }), { status:200, headers:{'Content-Type':'application/json'} });
        }
        const putN = window.__calls.filter(c => c.slug === 'PUT').length;
        if (putN === 1) {
          return new Response(JSON.stringify({ error:'conflict', rev:100 }), { status:409, headers:{'Content-Type':'application/json'} });
        }
        return new Response(JSON.stringify({ ok:true, rev:101 }), { status:200, headers:{'Content-Type':'application/json'} });
      }
      return orig.apply(this, arguments);
    };
  }, SEED);
  await p.goto('file://C:/Users/woqutech/WorkBuddy/2026-08-04-10-01-24/personal-workbench/index.html', { waitUntil:'domcontentloaded', timeout:30000 });
  await new Promise(r => setTimeout(r, 1500));
  // 触发一次修改 → 防抖 1s → push：PUT 第一次 conflict → 应自动重试成功
  await p.evaluate(() => document.getElementById('waterPlus').click());
  await new Promise(r => setTimeout(r, 6000));
  const out = await p.evaluate(() => {
    const calls = window.__calls.map((c,i) => c.slug + '#' + (i+1) + '@' + Math.round(c.t));
    return {
      calls,
      pill: document.getElementById('syncText').textContent,
      dot: document.getElementById('syncDot').className,
    };
  });
  console.log(JSON.stringify({ ...out, errors }, null, 2));
  await b.close();
})();
