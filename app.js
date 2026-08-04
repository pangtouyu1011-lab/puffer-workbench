/* ============================================
   PufferWork · 河豚工作台 业务逻辑
   ============================================ */

(function () {
  'use strict';

  // ==========================================
  // 0. 工具函数
  // ==========================================
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };
  const monthDay = (ts) => {
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()}`;
  };
  const fullDate = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  };
  const weekName = (idx) => ['周日','周一','周二','周三','周四','周五','周六'][idx];
  const escapeHtml = (s) => String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');

  // 图片压缩：缩放到最长边 maxDim 以内，转 JPEG 质量 quality，返回 dataUrl
  const compressImage = (file, maxDim, quality) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取失败'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('图片解析失败'));
      img.onload = () => {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        // 统一输出 JPEG 以显著减小体积（透明背景以白色填充）
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  const GALLERY_MAX = 5;

  // ==========================================
  // 1. 状态与数据
  // ==========================================
  const STORAGE_KEY = 'pufferwork:v1';

  const defaultPlan = {
    0: { name: '休息', muscle: 'rest', desc: '今天好好休息，恢复最重要 🌿' }, // 周日
    1: { name: '胸 + 肩 + 二头', muscle: 'push', desc: '推日训练日，记得热身肩袖！' },
    2: { name: '背 + 三头', muscle: 'pull', desc: '拉日训练日，注意挺胸沉肩' },
    3: { name: '腿 + 腹', muscle: 'legs', desc: '下肢日，深蹲硬拉注意护腰' },
    4: { name: '休息', muscle: 'rest', desc: '主动恢复日，可散步拉伸' },
    5: { name: '胸 + 肩 + 二头', muscle: 'push', desc: '第二次推日' },
    6: { name: '背 + 三头', muscle: 'pull', desc: '第二次拉日' },
  };

  const mascotQuotes = [
    '冲冲冲！', '今天也要元气满满！', '累了就休息一下 ☕',
    '你比你想象的更强！', '记得喝水哦～', '把待办清空，脑袋也清空～',
    '坚持就是胜利！', '专注当下，一步一步来'
  ];

  const state = {
    todos: [],
    fitnessPlan: { ...defaultPlan },
    trainings: [],
    messages: [],
    gallery: [],
    meals: defaultMeals(),
    settings: {
      partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 },
      me: 'a',
      city: '杭州',
      syncCode: '',
      cloudUrl: '',  // 可选：自建云同步 API
      room: { backend: 'supabase', url: 'https://chfczfrkgndgudcxoump.supabase.co', anon: 'sb_publishable_tOeCrvhq0WXTIRzUpaQAuQ_NrnmRwQq', id: '', pass: '', joined: false, lastSync: 0, lastRev: 0 },
    }
  };

  // 加载
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        Object.assign(state, data);
        // 兼容旧版本
        if (!state.settings) state.settings = { partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a', city: '杭州', syncCode: '', cloudUrl: '' };
        if (!state.fitnessPlan) state.fitnessPlan = { ...defaultPlan };
        if (!state.trainings) state.trainings = [];
        if (!state.todos) state.todos = [];
      if (!state.messages) state.messages = [];
      if (!state.gallery) state.gallery = [];
      if (!state.meals) state.meals = defaultMeals();
      if (state.settings.lastClean === undefined) state.settings.lastClean = 0;
        if (!state.settings.room) state.settings.room = { backend: 'supabase', url: 'https://chfczfrkgndgudcxoump.supabase.co', anon: 'sb_publishable_tOeCrvhq0WXTIRzUpaQAuQ_NrnmRwQq', id: '', pass: '', joined: false, lastSync: 0, lastRev: 0 };
        else {
          const rm = state.settings.room;
          // 从旧的 Cloudflare 默认地址迁移到 Supabase（workers.dev 在大陆被墙）
          if (rm.url === 'https://puffer-share.pangtouyu1011.workers.dev') { rm.url = ''; rm.backend = 'supabase'; }
          else if (!rm.backend) rm.backend = (rm.url && rm.url.includes('workers.dev')) ? 'worker' : 'supabase';
          if (rm.anon === undefined) rm.anon = 'sb_publishable_tOeCrvhq0WXTIRzUpaQAuQ_NrnmRwQq';
        }
      }
    } catch (e) {
      console.warn('Load failed', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      if (state.settings.room && state.settings.room.joined) scheduleRoomPush();
    } catch (e) {
      toast('保存失败：' + e.message, 'error');
    }
  }

  // 仅返回未软删除的条目（共享模式下删除通过 deleted 标记同步，避免被对方覆盖回来）
  function live(arr) { return (arr || []).filter(x => !x.deleted); }

  // ==========================================
  // 2. 路由 / 导航
  // ==========================================
  function goPage(name) {
    $$('.page').forEach(p => p.classList.remove('active'));
    const target = $(`#page-${name}`);
    if (target) target.classList.add('active');

    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
    $$('.bn-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));

    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 触发渲染
    onPageEnter(name);
  }

  function onPageEnter(name) {
    switch (name) {
      case 'dashboard': renderDashboard(); break;
      case 'todo': renderTodo(); break;
      case 'fitness': renderFitness(); break;
      case 'messages': renderMessages(); break;
      case 'meal': renderMeal(); break;
      case 'calendar': renderCalendar(); break;
    }
  }

  // ==========================================
  // 5.1 天气模块（Open-Meteo，免费无需 key）
  // ==========================================
  const CITY_COORDS = {
    '杭州': { lat: 30.27, lon: 120.15 }, '北京': { lat: 39.90, lon: 116.40 },
    '上海': { lat: 31.23, lon: 121.47 }, '广州': { lat: 23.13, lon: 113.26 },
    '深圳': { lat: 22.54, lon: 114.06 }, '成都': { lat: 30.57, lon: 104.07 },
    '武汉': { lat: 30.59, lon: 114.31 }, '南京': { lat: 32.06, lon: 118.80 },
    '西安': { lat: 34.34, lon: 108.94 }, '重庆': { lat: 29.56, lon: 106.55 }
  };
  const WMO = { 0:'晴',1:'大致晴朗',2:'局部多云',3:'阴',45:'雾',48:'雾凇',51:'小毛雨',53:'中毛雨',55:'大毛雨',61:'小雨',63:'中雨',65:'大雨',71:'小雪',73:'中雪',75:'大雪',80:'阵雨',81:'强阵雨',82:'暴雨',85:'阵雪',86:'强阵雪',95:'雷阵雨',96:'雷阵雨伴冰雹',99:'强雷暴' };
  const WMO_ICON = { 0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'🌨️',95:'⛈️',96:'⛈️',99:'⛈️' };

  async function fetchWeather(force) {
    const city = (state.settings.city && CITY_COORDS[state.settings.city]) ? state.settings.city : '杭州';
    const cached = state._weather;
    if (!force && cached && (Date.now() - (cached.ts || 0) < 3600 * 1000)) { renderWeather(); return; }
    try {
      const c = CITY_COORDS[city] || CITY_COORDS['杭州'];
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon + '&current=temperature_2m,weather_code&timezone=Asia%2FShanghai';
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const cur = j.current || {};
      state._weather = { ts: Date.now(), city: city, temp: Math.round(cur.temperature_2m), code: cur.weather_code, time: cur.time };
      save();
      renderWeather();
    } catch (e) {
      const el = $('#weatherBody');
      if (el) el.innerHTML = '<div class="muted">天气获取失败：' + escapeHtml(e.message) + '</div>';
    }
  }

  function renderWeather() {
    const el = $('#weatherBody');
    if (!el) return;
    const w = state._weather;
    if (!w) { el.innerHTML = '<div class="muted">加载中...</div>'; return; }
    const code = (w.code != null) ? w.code : 0;
    el.innerHTML =
      '<div class="weather-main">' +
        '<span class="weather-icon">' + (WMO_ICON[code] || '🌡️') + '</span>' +
        '<span class="weather-temp">' + w.temp + '°C</span>' +
      '</div>' +
      '<div class="weather-desc">' + (WMO[code] || '未知') + '</div>' +
      '<div class="weather-city">📍 ' + escapeHtml(w.city || '杭州') + '</div>';
    const cEl = $('#weatherCity');
    if (cEl) cEl.textContent = w.city || '杭州';
  }

  // ==========================================
  // 5.2 纪念日倒计时（从 2023-12-04 起）
  // ==========================================
  function renderAnniversary() {
    const el = $('#anniBody');
    if (!el) return;
    const start = new Date(2023, 11, 4);
    const now = new Date();
    const days = Math.floor((now - start) / 86400000);
    const years = Math.floor((now - start) / (365.25 * 86400000));
    const nextAnniv = new Date(start.getFullYear() + years + 1, 11, 4);
    const daysToNext = Math.ceil((nextAnniv - now) / 86400000);
    el.innerHTML =
      '<div class="anni-days">' + days + '<span class="anni-unit">天</span></div>' +
      '<div class="anni-label">我们已经在一起</div>' +
      '<div class="anni-next">💞 距离 ' + (years + 1) + ' 周年还有 <strong>' + daysToNext + '</strong> 天</div>';
  }

  // ==========================================
  // 5.3 首页精选照片轮播
  // ==========================================
  let galleryTimer = null;
  let galleryIdx = 0;
  function renderGallerySlider() {
    const el = $('#gallerySlider');
    if (!el) return;
    const dotsWrap = $('#galleryDots');
    const prev = $('#galleryPrev');
    const next = $('#galleryNext');
    const items = live(state.gallery);
    if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
    if (items.length === 0) {
      el.innerHTML = '<div class="gallery-empty">还没有照片，点「管理」添加你们的回忆 💕</div>';
      if (dotsWrap) dotsWrap.innerHTML = '';
      if (prev) prev.hidden = true;
      if (next) next.hidden = true;
      return;
    }
    el.innerHTML = items.map((g, k) =>
      '<div class="gallery-slide' + (k === 0 ? ' on' : '') + '" style="background-image:url(\'' + escapeHtml(g.dataUrl || g.url || '') + '\')"></div>'
    ).join('') + '<div class="gallery-cap"></div>';
    const capEl = el.querySelector('.gallery-cap');
    const slides = el.querySelectorAll('.gallery-slide');
    galleryIdx = 0;
    const show = (i) => {
      galleryIdx = (i + items.length) % items.length;
      slides.forEach((s, k) => s.classList.toggle('on', k === galleryIdx));
      capEl.textContent = items[galleryIdx].caption || '';
      if (dotsWrap) dotsWrap.querySelectorAll('span').forEach((d, k) => d.classList.toggle('on', k === galleryIdx));
    };
    const restart = () => {
      if (galleryTimer) clearInterval(galleryTimer);
      if (items.length > 1) galleryTimer = setInterval(() => show(galleryIdx + 1), 3500);
    };
    if (dotsWrap) {
      dotsWrap.innerHTML = items.map((_, k) => '<span class="' + (k === 0 ? 'on' : '') + '"></span>').join('');
      dotsWrap.querySelectorAll('span').forEach((d, k) => d.addEventListener('click', () => { show(k); restart(); }));
    }
    if (prev) { prev.hidden = items.length <= 1; prev.onclick = () => { show(galleryIdx - 1); restart(); }; }
    if (next) { next.hidden = items.length <= 1; next.onclick = () => { show(galleryIdx + 1); restart(); }; }
    show(0);
    restart();
  }

  function openGalleryManager() {
    openModal({
      title: '📸 精选照片管理',
      body:
        '<div class="form-row">' +
          '<label>添加照片（上传图片，或填图片链接）</label>' +
          '<input type="file" id="galFile" accept="image/*" class="pixel-input" />' +
          '<input class="pixel-input" id="galUrl" placeholder="或粘贴图片链接 https://..." style="margin-top:6px;" />' +
          '<input class="pixel-input" id="galCap" placeholder="照片说明（可选）" style="margin-top:6px;" />' +
          '<button class="pixel-btn primary" id="galAdd" style="margin-top:8px;">+ 添加这张</button>' +
          '<div class="file-hint" style="margin-top:4px;" id="galHint">上传图片会自动压缩（最长边 ≤ 1280px，JPEG 80%）</div>' +
        '</div>' +
        '<div class="gal-manage-list" id="galManageList"></div>',
      foot: '<button class="pixel-btn ghost" id="galClose">完成</button>'
    });
    const renderList = () => {
      const list = $('#galManageList');
      const its = live(state.gallery);
      const hint = $('#galHint');
      if (hint) hint.textContent = '上传图片会自动压缩（最长边 ≤ 1280px，JPEG 80%）· 已存 ' + its.length + '/' + GALLERY_MAX + ' 张';
      if (!its.length) { list.innerHTML = '<p class="muted">还没有照片</p>'; return; }
      list.innerHTML = its.map(g =>
        '<div class="gal-manage-item" data-id="' + g.id + '">' +
          '<img src="' + escapeHtml(g.dataUrl || g.url || '') + '" alt="" />' +
          '<div class="gm-meta"><div>' + escapeHtml(g.caption || '(无说明)') + '</div>' +
          '<button class="pixel-btn danger gm-del" data-id="' + g.id + '">删除</button></div>' +
        '</div>'
      ).join('');
      list.querySelectorAll('.gm-del').forEach(b => b.addEventListener('click', () => {
        const g = state.gallery.find(x => x.id === b.dataset.id);
        if (g) { g.deleted = true; g.updatedAt = Date.now(); }
        save(); renderList(); renderGallerySlider(); scheduleRoomPush(); toast('已删除');
      }));
    };
    renderList();
    $('#galClose').addEventListener('click', closeModal);
    $('#galAdd').addEventListener('click', () => {
      const url = $('#galUrl').value.trim();
      const cap = $('#galCap').value.trim();
      const file = $('#galFile').files[0];
      if (live(state.gallery).length >= GALLERY_MAX) {
        toast('最多只能保存 ' + GALLERY_MAX + ' 张照片，请先删除', 'error');
        return;
      }
      if (file) {
        toast('压缩中...');
        compressImage(file, 1280, 0.8).then(dataUrl => {
          state.gallery.push({ id: uid(), dataUrl, url: '', caption: cap, createdAt: Date.now(), updatedAt: Date.now() });
          save(); renderList(); renderGallerySlider(); scheduleRoomPush(); toast('已添加 ✨');
        }).catch(() => toast('图片处理失败', 'error'));
      } else if (url) {
        state.gallery.push({ id: uid(), dataUrl: '', url: url, caption: cap, createdAt: Date.now(), updatedAt: Date.now() });
        save(); renderList(); renderGallerySlider(); scheduleRoomPush(); toast('已添加 ✨');
      } else {
        toast('请选择图片或填链接', 'error');
      }
    });
  }

  // ==========================================
  // 5.4 留言板（两人共享）
  // ==========================================
  function fmtTime(ts) {
    const d = new Date(ts);
    const pad = n => (n < 10 ? '0' : '') + n;
    return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function renderMessages() {
    const list = $('#msgList');
    if (!list) return;
    const me = state.settings.me || 'a';
    const partners = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const items = live(state.messages).slice().sort((a, b) => a.createdAt - b.createdAt);
    if (items.length === 0) {
      list.innerHTML = '<div class="msg-empty">还没有留言，给 TA 写第一句吧 💌</div>';
    } else {
      list.innerHTML = items.map(m => {
        const who = m.author === 'a' ? partners.a : partners.b;
        const mine = m.author === me;
        return '<div class="msg-item ' + (mine ? 'mine' : '') + '">' +
          '<div class="msg-meta"><span class="msg-author">' + escapeHtml(who) + '</span><span class="msg-time">' + fmtTime(m.createdAt) + '</span></div>' +
          '<div class="msg-text">' + escapeHtml(m.text) + '</div>' +
          (mine ? '<button class="msg-del" data-id="' + m.id + '" title="删除">✕</button>' : '') +
        '</div>';
      }).join('');
      list.scrollTop = list.scrollHeight;
    }
    $$('#msgIdentitySeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.me === me));
  }
  function sendMessage() {
    const ta = $('#msgInput');
    const text = ta.value.trim();
    if (!text) { toast('写点什么吧', 'error'); return; }
    state.messages.push({ id: uid(), author: state.settings.me || 'a', text: text, createdAt: Date.now(), updatedAt: Date.now() });
    save(); ta.value = ''; renderMessages(); scheduleRoomPush(); toast('已发送 💌');
  }

  // 留言板 / 照片管理 事件绑定（脚本加载时只绑一次）
  const msgSendBtn = $('#msgSend');
  if (msgSendBtn) msgSendBtn.addEventListener('click', sendMessage);
  const galBtn = $('#galleryManageBtn');
  if (galBtn) galBtn.addEventListener('click', openGalleryManager);
  document.addEventListener('click', (e) => {
    const del = e.target.closest('.msg-del');
    if (del) {
      const m = state.messages.find(x => x.id === del.dataset.id);
      if (m) { m.deleted = true; m.updatedAt = Date.now(); }
      save(); renderMessages(); scheduleRoomPush(); toast('已删除');
      return;
    }
    const seg = e.target.closest('#msgIdentitySeg .seg-btn');
    if (seg) {
      state.settings.me = seg.dataset.me;
      save(); renderMessages();
    }
  });

  // ==========================================
  // 11c. 吃饭转盘（🎡 随机决定今天吃什么）
  // ==========================================
  const MEAL_COLORS = ['#FF8C42', '#FFB36B', '#F4A259', '#FFD8A8', '#E8833A', '#FFC078', '#FFE0B2', '#F6B26B'];
  let mealRotation = 0;   // 当前旋转角(弧度, 顺时针)
  let mealSpinning = false;

  function defaultMeals() {
    const names = ['火锅', '麻辣烫', '烧烤', '日料', '汉堡', '披萨', '盖浇饭', '面条', '沙拉', '饺子', '黄焖鸡', '螺蛳粉'];
    const now = Date.now();
    return names.map(n => ({ id: uid(), name: n, createdAt: now, updatedAt: now, deleted: false }));
  }
  function liveMeals() { return live(state.meals); }

  function drawMealWheel(rot) {
    const cv = $('#mealWheel');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, R = W / 2 - 6;
    ctx.clearRect(0, 0, W, H);
    const items = liveMeals();
    if (items.length === 0) {
      ctx.fillStyle = '#FFF4E0'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4A2C17'; ctx.font = '15px "ZCOOL KuaiLe", sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('先去添加菜单', cx, cy);
      return;
    }
    const n = items.length, step = (Math.PI * 2) / n;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2);   // 让本地 0 角度指向正上方
    ctx.rotate(rot);             // 转盘整体旋转
    for (let i = 0; i < n; i++) {
      const a0 = i * step, a1 = (i + 1) * step;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, a0, a1); ctx.closePath();
      ctx.fillStyle = MEAL_COLORS[i % MEAL_COLORS.length]; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = '#4A2C17'; ctx.stroke();
      ctx.save();
      const mid = a0 + step / 2;
      ctx.rotate(mid);
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      ctx.fillStyle = '#4A2C17'; ctx.font = '15px "ZCOOL KuaiLe", sans-serif';
      const label = items[i].name;
      ctx.fillText(label.length > 6 ? label.slice(0, 6) + '…' : label, R - 14, 0);
      ctx.restore();
    }
    ctx.restore();
    // 中心圆
    ctx.beginPath(); ctx.arc(cx, cy, 26, 0, Math.PI * 2);
    ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 3; ctx.strokeStyle = '#4A2C17'; ctx.stroke();
    ctx.fillStyle = '#FF8C42'; ctx.font = '20px "ZCOOL KuaiLe", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('吃', cx, cy);
  }

  function spinMeal() {
    if (mealSpinning) return;
    const items = liveMeals();
    if (items.length < 2) { toast('菜单至少要 2 项才能转哦', 'error'); return; }
    mealSpinning = true;
    const n = items.length, step = (Math.PI * 2) / n;
    const win = Math.floor(Math.random() * n);
    const winCenter = win * step + step / 2;             // 选中扇区中心(本地角度)
    const turns = 5 + Math.floor(Math.random() * 3);    // 转 5~7 圈
    const jitter = (Math.random() - 0.5) * step * 0.6;  // 落点在扇区内随机偏移
    let target = Math.PI * 2 * turns - winCenter + jitter;
    while (target <= mealRotation) target += Math.PI * 2; // 保证正向旋转
    const start = mealRotation, dist = target - start, dur = 3200, t0 = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);          // easeOutCubic
    function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      mealRotation = start + dist * ease(p);
      drawMealWheel(mealRotation);
      if (p < 1) { requestAnimationFrame(frame); }
      else {
        mealSpinning = false;
        const norm = ((mealRotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
        let idx = Math.round((-norm - step / 2) / step) % n;
        idx = (idx % n + n) % n;
        const pick = items[idx];
        $('#mealResult').innerHTML = '今天就吃 <b>' + escapeHtml(pick.name) + '</b> ！🎉';
        toast('命运之轮指向：' + pick.name);
      }
    }
    requestAnimationFrame(frame);
  }

  function addMeal() {
    const inp = $('#mealInput');
    const name = inp.value.trim();
    if (!name) { toast('先输入菜名', 'error'); return; }
    state.meals.push({ id: uid(), name: name, createdAt: Date.now(), updatedAt: Date.now(), deleted: false });
    save(); inp.value = ''; mealRotation = 0; renderMeal(); scheduleRoomPush(); toast('已添加 ✨');
  }
  function resetMeals() {
    state.meals = defaultMeals();
    save(); mealRotation = 0; renderMeal(); scheduleRoomPush(); toast('已恢复默认菜单');
  }
  function renderMeal() {
    drawMealWheel(mealRotation);
    const list = $('#mealList');
    if (!list) return;
    const items = liveMeals();
    if (items.length === 0) {
      list.innerHTML = '<li class="meal-empty">菜单空了，点「恢复默认」或上方添加～</li>';
      return;
    }
    list.innerHTML = items.map(m =>
      '<li data-id="' + m.id + '"><span class="meal-name">' + escapeHtml(m.name) + '</span>' +
      '<button class="meal-del" data-id="' + m.id + '" title="删除">✕</button></li>'
    ).join('');
    list.querySelectorAll('.meal-del').forEach(b => b.addEventListener('click', () => {
      const m = state.meals.find(x => x.id === b.dataset.id);
      if (m) { m.deleted = true; m.updatedAt = Date.now(); }
      save(); mealRotation = 0; renderMeal(); scheduleRoomPush(); toast('已移除');
    }));
  }

  // 吃饭转盘：事件绑定（首次加载只绑一次）
  const mealSpinBtn = $('#mealSpin');
  if (mealSpinBtn) mealSpinBtn.addEventListener('click', spinMeal);
  const mealAddBtn = $('#mealAdd');
  if (mealAddBtn) mealAddBtn.addEventListener('click', addMeal);
  const mealResetBtn = $('#mealReset');
  if (mealResetBtn) mealResetBtn.addEventListener('click', resetMeals);
  const mealInputEl = $('#mealInput');
  if (mealInputEl) mealInputEl.addEventListener('keydown', e => { if (e.key === 'Enter') addMeal(); });

  // ==========================================
  // 3. Toast
  // ==========================================
  let toastTimer = null;
  function toast(msg, type = 'success') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }

  // ==========================================
  // 4. 模态框
  // ==========================================
  function openModal({ title, body, foot, onClose }) {
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = foot || '';
    $('#modalMask').classList.add('show');
    if (onClose) $('#modalMask').dataset.closeHook = '1';
    else delete $('#modalMask').dataset.closeHook;
  }
  function closeModal() {
    $('#modalMask').classList.remove('show');
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
  }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modalMask').addEventListener('click', (e) => {
    if (e.target.id === 'modalMask') closeModal();
  });

  // ==========================================
  // 5. 仪表板
  // ==========================================
  function updateOwnerUI() {
    const p = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const sub = $('#brandSub');
    if (sub) sub.textContent = `${p.a} & ${p.b} 的河豚工作台`;
    const gt = $('#galleryHeroTitle');
    if (gt) gt.textContent = `📸 ${p.a} & ${p.b} 的精选回忆`;
    const dt = $('#dwTitle');
    if (dt) dt.textContent = `${p.a} & ${p.b}`;
  }
  function renderDashboard() {
    updateOwnerUI();
    const d = new Date();
    const wk = d.getDay();
    $('#todayDateText').textContent = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日 · ${weekName(wk)}`;
    const plan = state.fitnessPlan[wk];

    // 待办
    const activeTodos = live(state.todos).filter(t => !t.done);
    $('#statTodo').textContent = activeTodos.length;
    $('#statTodoSub').textContent = activeTodos.length === 0 ? '全部清空 🎉' : `待完成`;
    const dashTodo = $('#dashTodoList');
    if (live(state.todos).length === 0) {
      dashTodo.innerHTML = '<li class="empty">还没有待办，去添加一个吧～</li>';
    } else {
      dashTodo.innerHTML = live(state.todos).slice(0, 5).map(t => `
        <li>
          <span class="check ${t.done ? 'done' : ''}"></span>
          <span style="flex:1; ${t.done ? 'text-decoration:line-through;opacity:0.6' : ''}">${escapeHtml(t.text)}</span>
          ${t.priority && t.priority !== 'none' ? `<span class="ti-prio ${t.priority}">${t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低'}</span>` : ''}
        </li>
      `).join('');
    }

    // 今日训练
    const today = todayKey();
    const todayRecords = state.trainings.filter(t => t.date === today && !t.deleted);
    const trainText = plan.muscle === 'rest' ? '休息日' : plan.name;
    $('#statTrain').textContent = plan.muscle === 'rest' ? '休' : todayRecords.length > 0 ? '✓' : '·';
    $('#statTrainSub').textContent = todayRecords.length > 0 ? '已完成' : '今日计划';
    const dashTrain = $('#dashTrain');
    if (plan.muscle === 'rest') {
      dashTrain.innerHTML = `
        <div class="today-train is-rest">
          <div class="muscle">今日休息日 🌿</div>
          <div class="desc">${escapeHtml(plan.desc)}</div>
        </div>
      `;
    } else {
      dashTrain.innerHTML = `
        <div class="today-train">
          <div class="muscle">${escapeHtml(plan.name)}</div>
          <div class="desc">${escapeHtml(plan.desc)}</div>
          ${todayRecords.length > 0
            ? `<div style="margin-top:10px;padding:8px;background:var(--puffer-cream);border:2px solid var(--border);">
                 <div style="font-family:var(--font-pixel);font-size:10px;color:var(--border);margin-bottom:6px;">已记录 ${todayRecords.length} 条</div>
                 ${todayRecords.map(r => `<div style="font-size:13px;">• ${escapeHtml(r.muscle || '')} ${escapeHtml(r.content || '').slice(0, 40)}</div>`).join('')}
               </div>`
            : `<button class="pixel-btn primary" style="margin-top:10px;" onclick="goPage('fitness')">去记录 →</button>`
          }
        </div>
      `;
    }


    // 本周训练天数
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - wk);
    weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const weekCount = state.trainings.filter(t => {
      const td = new Date(t.date);
      return td >= weekStart && td < weekEnd && !t.deleted;
    }).length;
    $('#statWeek').textContent = weekCount;

    // 河豚气泡
    const hour = d.getHours();
    let greet = '今天也要元气满满哦～';
    if (hour < 6) greet = '这么早，要好好休息呀！';
    else if (hour < 12) greet = '早安！新的一天冲冲冲！';
    else if (hour < 14) greet = '中午好，记得吃饭！';
    else if (hour < 18) greet = '下午好，喝杯水继续！';
    else if (hour < 22) greet = '晚上好，今天辛苦啦～';
    else greet = '夜深了，别太晚睡哦';
    const p = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    $('#mascotBubble').textContent = `${p.a}、${p.b}，${greet}`;
    const greetEmoji = hour < 6 ? '🌙' : hour < 12 ? '🌞' : hour < 14 ? '🍱' : hour < 18 ? '☕' : hour < 22 ? '🌇' : '🌜';
    const tname = hour < 6 ? '夜深了' : hour < 12 ? '早安' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : hour < 22 ? '晚上好' : '夜深了';
    const dwg = $('#dwGreeting');
    if (dwg) dwg.textContent = `${tname} ${greetEmoji}`;
    $('#mascotQuote').textContent = mascotQuotes[Math.floor(Math.random() * mascotQuotes.length)];
    renderWeather();
    renderAnniversary();
    renderGallerySlider();
    fetchWeather();
  }

  // 仪表板快速入口
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-goto]');
    if (t) {
      const page = t.dataset.goto;
      const filter = t.dataset.filter;
      if (filter) state._materialFilter = filter;
      else delete state._materialFilter;
      goPage(page);
    }
  });

  // ==========================================
  // 6. 待办
  // ==========================================
  let todoFilter = 'all';

  // ---- 导出待办为 iOS 日历 (.ics) ----
  function icsEscape(s) {
    return String(s == null ? '' : s)
      .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
  function todoToICS(t) {
    if (!t.date) return '';
    const p = t.date.replace(/-/g, '');                 // 2026-08-04 -> 20260804
    const dtstart = p + 'T090000';                      // 默认当天 09:00（本地时间）
    const dtend = p + 'T100000';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    const prioText = (t.priority && t.priority !== 'none') ? '（优先级：' + ({ high: '高', mid: '中', low: '低' }[t.priority]) + '）' : '';
    return [
      'BEGIN:VEVENT',
      'UID:' + t.id + '@puffer-bench',
      'DTSTAMP:' + stamp,
      'DTSTART:' + dtstart,
      'DTEND:' + dtend,
      'SUMMARY:' + icsEscape(t.text),
      'DESCRIPTION:' + icsEscape('来自 河豚工作台' + prioText),
      'BEGIN:VALARM',
      'TRIGGER:-PT60M',                                  // 提前 1 小时提醒
      'ACTION:DISPLAY',
      'DESCRIPTION:' + icsEscape(t.text),
      'END:VALARM',
      'END:VEVENT'
    ].join('\r\n');
  }
  function buildICS(todos) {
    const events = (todos || []).filter(t => t.date && !t.deleted).map(todoToICS).filter(Boolean);
    if (!events.length) return '';
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PufferBench//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].join('\r\n');
  }
  function downloadICS(ics, filename) {
    const uri = 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
    const a = document.createElement('a');
    a.href = uri;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 2000);
  }
  function exportTodosToCalendar(todos, label) {
    const ics = buildICS(todos || live(state.todos));
    if (!ics) { toast('没有带日期的待办可导出', 'error'); return; }
    downloadICS(ics, (label || '待办') + '.ics');
    toast('已生成日历文件，iOS 上点开后选「添加至日历」即可');
  }

  // 日历视图状态
  const _now0 = new Date();
  let calYear = _now0.getFullYear();
  let calMonth = _now0.getMonth(); // 0-11
  let calSelected = null;          // 'YYYY-MM-DD'
  const dateKey = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

  function renderTodo() {
    const list = $('#todoList');
    let items = live(state.todos).slice().sort((a, b) => b.createdAt - a.createdAt);
    if (todoFilter === 'active') items = items.filter(t => !t.done);
    if (todoFilter === 'done') items = items.filter(t => t.done);

    if (items.length === 0) {
      list.innerHTML = `<li class="todo-empty">${live(state.todos).length === 0 ? '还没有待办，点 + 新建一个吧 ✨' : '当前筛选下没有待办'}</li>`;
      return;
    }
    list.innerHTML = items.map(t => `
      <li class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <span class="todo-check ${t.done ? 'done' : ''}" data-act="toggle"></span>
        <div class="ti-text">${escapeHtml(t.text)}</div>
        <div class="ti-meta">
          ${t.date ? `<span class="ti-date">📅${escapeHtml(t.date.slice(5))}</span>` : ''}
          ${t.priority && t.priority !== 'none' ? `<span class="ti-prio ${t.priority}">${t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低'}</span>` : ''}
        </div>
        <div class="ti-actions">
          <button data-act="edit" title="编辑">✎</button>
          <button data-act="cal" class="cal" title="添加到 iOS 日历">📱</button>
          <button data-act="del" class="del" title="删除">🗑</button>
        </div>
      </li>
    `).join('');
  }

  function openTodoModal(id, presetDate) {
    const editing = id ? state.todos.find(t => t.id === id) : null;
    const value = editing ? editing.text : '';
    const prio = editing ? (editing.priority || 'none') : 'none';
    const dateVal = editing ? (editing.date || '') : (presetDate || '');
    openModal({
      title: editing ? '✎ 编辑待办' : '+ 新建待办',
      body: `
        <div class="form-row">
          <label>待办内容</label>
          <textarea class="pixel-textarea" id="todoText" placeholder="要做点什么？">${escapeHtml(value)}</textarea>
        </div>
        <div class="form-row">
          <label>日期（显示在日历上，可选）</label>
          <input type="date" class="pixel-input" id="todoDate" value="${dateVal ? escapeHtml(dateVal) : ''}" />
        </div>
        <div class="form-row">
          <label>优先级</label>
          <div class="row-2">
            <label class="checkbox-row"><input type="radio" name="prio" value="high" ${prio==='high'?'checked':''}> 高</label>
            <label class="checkbox-row"><input type="radio" name="prio" value="mid"  ${prio==='mid'?'checked':''}> 中</label>
            <label class="checkbox-row"><input type="radio" name="prio" value="low"  ${prio==='low'?'checked':''}> 低</label>
            <label class="checkbox-row"><input type="radio" name="prio" value="none" ${prio==='none'?'checked':''}> 无</label>
          </div>
        </div>
      `,
      foot: `
        <button class="pixel-btn ghost" id="todoCancel">取消</button>
        <button class="pixel-btn primary" id="todoSave">${editing ? '保存' : '添加'}</button>
      `
    });
    $('#todoCancel').addEventListener('click', closeModal);
    $('#todoSave').addEventListener('click', () => {
      const text = $('#todoText').value.trim();
      const p = (document.querySelector('input[name="prio"]:checked') || {}).value || 'none';
      const date = $('#todoDate').value.trim();
      if (!text) { toast('内容不能为空', 'error'); return; }
      if (editing) {
        editing.text = text;
        editing.priority = p;
        editing.date = date || '';
        editing.updatedAt = Date.now();
      } else {
        state.todos.push({ id: uid(), text, priority: p, date: date || '', done: false, createdAt: Date.now(), updatedAt: Date.now() });
      }
      save();
      closeModal();
      renderTodo();
      renderCalendar();
      toast(editing ? '已更新' : '已添加');
    });
  }

  $('#addTodoBtn').addEventListener('click', () => openTodoModal());
  $('#exportCalBtn').addEventListener('click', () => {
    const dated = live(state.todos).filter(t => t.date);
    if (!dated.length) { toast('还没有带日期的待办，先在待办里选个日期', 'error'); return; }
    exportTodosToCalendar(dated, '河豚工作台待办');
  });

  // 列表交互
  $('#todoList').addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    const act = e.target.dataset.act;
    if (act === 'toggle') {
      const t = state.todos.find(x => x.id === id);
      t.done = !t.done;
      save(); renderTodo();
    } else if (act === 'edit') {
      openTodoModal(id);
    } else if (act === 'cal') {
      const t = state.todos.find(x => x.id === id);
      if (!t) return;
      if (!t.date) { toast('这条待办没有日期，先编辑加上日期', 'error'); openTodoModal(id); return; }
      exportTodosToCalendar([t], '待办-' + t.date);
    } else if (act === 'del') {
      if (confirm('确认删除这条待办？')) {
        const t = state.todos.find(x => x.id === id);
        if (t) { t.deleted = true; t.updatedAt = Date.now(); }
        save(); renderTodo();
        toast('已删除');
      }
    }
  });

  // 筛选
  $$('#page-todo .seg-btn').forEach(b => b.addEventListener('click', () => {
    $$('#page-todo .seg-btn').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    todoFilter = b.dataset.filter;
    renderTodo();
  }));

  // ==========================================
  // 6.1 共同日历
  // ==========================================
  function renderCalendar() {
    const grid = $('#calGrid');
    if (!grid) return;
    const y = calYear, m = calMonth;
    const titleEl = $('#calTitle');
    if (titleEl) titleEl.textContent = `${y}年${m + 1}月`;
    const first = new Date(y, m, 1);
    const startDay = first.getDay(); // 0=周日
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const todayStr = todayKey();
    grid.innerHTML = cells.map(c => {
      if (c === null) return '<div class="cal-cell empty"></div>';
      const key = dateKey(y, m, c);
      const todos = live(state.todos).filter(t => t.date === key);
      const isAnni = (m === 11 && c === 4); // 每年 12-04 纪念日
      const isToday = key === todayStr;
      const isSel = key === calSelected;
      const dots = todos.slice(0, 3).map(t =>
        `<span class="cal-dot ${t.done ? 'done' : ''} ${t.priority && t.priority !== 'none' ? t.priority : ''}"></span>`
      ).join('');
      const more = todos.length > 3 ? `<span class="cal-more">+${todos.length - 3}</span>` : '';
      return `<div class="cal-cell ${isToday ? 'today' : ''} ${isSel ? 'sel' : ''} ${isAnni ? 'anni' : ''}" data-date="${key}">
        <div class="cal-top">
          <span class="cal-day">${c}</span>
          ${isAnni ? '<span class="cal-heart">💞</span>' : ''}
        </div>
        <div class="cal-tags">${dots}${more}${isAnni ? '<span class="cal-anni-tag">纪念日</span>' : ''}</div>
      </div>`;
    }).join('');
  }

  function openCalDay(key) {
    const parts = key.split('-');
    const y = +parts[0], m = +parts[1], d = +parts[2];
    const dateLabel = `${y}年${m}月${d}日`;
    const isAnni = (m === 12 && d === 4);
    calSelected = key;
    const items = live(state.todos).filter(t => t.date === key).sort((a, b) => b.createdAt - a.createdAt);
    const listHtml = items.length ? items.map(t =>
      `<li class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <span class="todo-check ${t.done ? 'done' : ''}" data-act="toggle"></span>
        <div class="ti-text">${escapeHtml(t.text)}</div>
        <div class="ti-meta">${t.priority && t.priority !== 'none' ? `<span class="ti-prio ${t.priority}">${t.priority === 'high' ? '高' : t.priority === 'mid' ? '中' : '低'}</span>` : ''}</div>
        <div class="ti-actions"><button data-act="edit" title="编辑">✎</button><button data-act="del" class="del" title="删除">🗑</button></div>
      </li>`
    ).join('') : '<li class="todo-empty">这一天还没有待办，加一个吧 ✨</li>';
    openModal({
      title: `📅 ${dateLabel}`,
      body:
        (isAnni ? `<div class="cal-anni-banner">💞 这是你们的纪念日！在一起的第 ${Math.max(0, Math.floor((new Date(y, 11, 4) - new Date(2023, 11, 4)) / 86400000))} 天</div>` : '') +
        `<ul class="todo-list" id="calTodoList">${listHtml}</ul>
        <button class="pixel-btn primary" id="calAdd" style="margin-top:10px;width:100%;">+ 在这一天加待办</button>`,
      foot: `<button class="pixel-btn ghost" id="calClose">关闭</button>`
    });
    $('#calClose').addEventListener('click', closeModal);
    $('#calAdd').addEventListener('click', () => openTodoModal(null, key));
    $('#calTodoList').addEventListener('click', (e) => {
      const item = e.target.closest('.todo-item');
      if (!item) return;
      const id = item.dataset.id;
      const act = e.target.dataset.act;
      const t = state.todos.find(x => x.id === id);
      if (!t) return;
      if (act === 'toggle') { t.done = !t.done; t.updatedAt = Date.now(); save(); openCalDay(key); renderCalendar(); renderTodo(); }
      else if (act === 'edit') { openTodoModal(id); }
      else if (act === 'del') {
        if (confirm('确认删除这条待办？')) {
          t.deleted = true; t.updatedAt = Date.now();
          save(); openCalDay(key); renderCalendar(); renderTodo(); toast('已删除');
        }
      }
    });
  }

  // 日历导航与点击
  const calPrev = $('#calPrev'), calNext = $('#calNext'), calToday = $('#calToday');
  if (calPrev) calPrev.addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
  if (calNext) calNext.addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
  if (calToday) calToday.addEventListener('click', () => { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); calSelected = null; renderCalendar(); });
  const calGrid = $('#calGrid');
  if (calGrid) calGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (cell) openCalDay(cell.dataset.date);
  });

  // ==========================================
  // 7. 健身
  // ==========================================
  function renderFitness() {
    const d = new Date();
    const wk = d.getDay();
    $('#fitnessToday').textContent = `${d.getMonth()+1}月${d.getDate()}日 · ${weekName(wk)} · ${state.fitnessPlan[wk].name}`;

    // 周条
    const strip = $('#weekStrip');
    strip.innerHTML = [0,1,2,3,4,5,6].map(i => {
      const p = state.fitnessPlan[i];
      const isToday = i === wk;
      const todayDate = new Date();
      const dayDate = new Date(todayDate);
      dayDate.setDate(todayDate.getDate() + (i - wk));
      const dateKey = `${dayDate.getFullYear()}-${String(dayDate.getMonth()+1).padStart(2,'0')}-${String(dayDate.getDate()).padStart(2,'0')}`;
      const hasRecord = state.trainings.some(t => t.date === dateKey && t.muscle !== '休息' && !t.deleted);
      return `
        <div class="wd ${isToday ? 'is-today' : ''} ${p.muscle==='rest' ? 'is-rest' : ''} ${hasRecord ? 'is-done' : ''}" data-wd="${i}">
          <span class="wd-name">${weekName(i).replace('周','')}</span>
          <span class="wd-plan">${p.muscle === 'rest' ? '休' : p.name.split('+')[0]}</span>
        </div>
      `;
    }).join('');

    // 今日计划
    const plan = state.fitnessPlan[wk];
    const isRest = plan.muscle === 'rest';
    $('#todayPlanTitle').textContent = isRest ? '今日休息 🌿' : `今日计划：${plan.name}`;
    $('#todayPlanBadge').textContent = isRest ? 'REST' : 'TRAIN';
    $('#todayPlanBadge').className = 'badge ' + (isRest ? 'gray' : 'pink');
    const tags = isRest
      ? `<span class="plan-tag rest">休息</span><span class="plan-tag">恢复</span>`
      : plan.name.split('+').map(m => `<span class="plan-tag muscle">${escapeHtml(m.trim())}</span>`).join('');
    const today = todayKey();
    const todayRecords = state.trainings.filter(t => t.date === today && !t.deleted);
    $('#todayPlanBody').innerHTML = `
      <div>${tags}</div>
      <p>${escapeHtml(plan.desc)}</p>
      ${!isRest ? `<p style="margin-top:6px;color:var(--puffer-orange-deep);">点击右上角「+ 记录训练」开始今天的训练记录</p>` : ''}
      ${todayRecords.length > 0 ? `
        <div style="margin-top:10px;padding:10px;background:var(--puffer-cream);border:2px solid var(--border);">
          <div style="font-family:var(--font-pixel);font-size:10px;color:var(--border);margin-bottom:6px;">今日已记录 ${todayRecords.length} 条</div>
          ${todayRecords.map(r => `
            <div style="font-size:13px;padding:4px 0;border-bottom:1px dashed var(--border);">
              <strong>${escapeHtml(r.muscle || '')}</strong>: ${escapeHtml(r.content || '')}
            </div>
          `).join('')}
        </div>
      ` : ''}
    `;

    // 训练记录列表
    const list = live(state.trainings).slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    $('#trainCount').textContent = `${list.length} 条`;
    const tl = $('#trainList');
    if (list.length === 0) {
      tl.innerHTML = '<li class="train-empty">还没有训练记录，开始你的第一次吧 💪</li>';
    } else {
      tl.innerHTML = list.map(t => {
        const d2 = new Date(t.date);
        return `
          <li class="train-item" data-id="${t.id}">
            <div class="train-date">
              <div>${d2.getMonth()+1}月</div>
              <span class="d">${d2.getDate()}</span>
            </div>
            <div class="train-body">
              <div class="train-muscle">${escapeHtml(t.muscle || '')}</div>
              <div class="train-content">${escapeHtml(t.content || '')}</div>
              ${t.note ? `<div class="train-content" style="color:var(--muted);font-size:12px;margin-top:4px;">📝 ${escapeHtml(t.note)}</div>` : ''}
              <div class="train-foot">
                <span class="pill">${escapeHtml(weekName(d2.getDay()))}</span>
                ${t.weight ? `<span class="pill">重量: ${escapeHtml(t.weight)}</span>` : ''}
                ${t.duration ? `<span class="pill">时长: ${escapeHtml(t.duration)}</span>` : ''}
                <button class="pill del-btn" data-act="del-train" style="cursor:pointer;background:var(--puffer-pink-deep);color:#fff;border:2px solid var(--border);">删除</button>
              </div>
            </div>
          </li>
        `;
      }).join('');
    }
  }

  function openTrainModal() {
    const d = new Date();
    const wk = d.getDay();
    const plan = state.fitnessPlan[wk];
    const today = todayKey();
    const defaultMuscle = plan.muscle === 'rest' ? '' : plan.name;
    openModal({
      title: '💪 记录训练',
      body: `
        <div class="form-row">
          <label>训练部位</label>
          <input class="pixel-input" id="trainMuscle" value="${escapeHtml(defaultMuscle)}" placeholder="例：胸 + 肩 + 二头" />
        </div>
        <div class="form-row">
          <label>日期</label>
          <input class="pixel-input" type="date" id="trainDate" value="${today}" />
        </div>
        <div class="form-row">
          <label>动作 / 组数 / 次数 / 重量（自由记录）</label>
          <textarea class="pixel-textarea" id="trainContent" placeholder="例：&#10;卧推 4×10 60kg&#10;上斜哑铃 3×12 25kg&#10;侧平举 4×15 8kg"></textarea>
        </div>
        <div class="form-row">
          <div class="row-2">
            <div>
              <label>总重量（可选）</label>
              <input class="pixel-input" id="trainWeight" placeholder="kg" />
            </div>
            <div>
              <label>总时长（可选）</label>
              <input class="pixel-input" id="trainDuration" placeholder="分钟" />
            </div>
          </div>
        </div>
        <div class="form-row">
          <label>备注</label>
          <input class="pixel-input" id="trainNote" placeholder="今天状态、感觉……" />
        </div>
      `,
      foot: `
        <button class="pixel-btn ghost" id="trainCancel">取消</button>
        <button class="pixel-btn primary" id="trainSave">保存记录</button>
      `
    });
    $('#trainCancel').addEventListener('click', closeModal);
    $('#trainSave').addEventListener('click', () => {
      const muscle = $('#trainMuscle').value.trim();
      const date = $('#trainDate').value || today;
      const content = $('#trainContent').value.trim();
      const weight = $('#trainWeight').value.trim();
      const duration = $('#trainDuration').value.trim();
      const note = $('#trainNote').value.trim();
      if (!content) { toast('请填写训练内容', 'error'); return; }
      state.trainings.push({
        id: uid(), muscle, date, content, weight, duration, note,
        createdAt: Date.now(), updatedAt: Date.now()
      });
      save(); closeModal(); renderFitness();
      toast('训练记录已保存 💪');
    });
  }

  function openPlanModal() {
    const days = [1,2,3,4,5,6,0]; // 周一 -> 周日
    openModal({
      title: '📅 编辑周期计划',
      body: `
        <div class="form-row">
          <p class="muted">按你给的计划：周一胸肩二头、周二背三头、周三腿腹、周四休息、周五胸肩二头、周六背三头、周日休息</p>
        </div>
        ${days.map(i => `
          <div class="form-row">
            <label>${weekName(i)}</label>
            <input class="pixel-input" data-day="${i}" value="${escapeHtml(state.fitnessPlan[i].name)}" />
          </div>
        `).join('')}
      `,
      foot: `
        <button class="pixel-btn ghost" id="planReset">恢复默认</button>
        <button class="pixel-btn primary" id="planSave">保存</button>
      `
    });
    $('#planReset').addEventListener('click', () => {
      Object.assign(state.fitnessPlan, defaultPlan);
      save(); closeModal(); renderFitness();
      toast('已恢复默认计划');
    });
    $('#planSave').addEventListener('click', () => {
      $$('input[data-day]').forEach(inp => {
        const i = parseInt(inp.dataset.day, 10);
        const name = inp.value.trim() || '自定义';
        const isRest = name.includes('休');
        state.fitnessPlan[i] = {
          name,
          muscle: isRest ? 'rest' : 'custom',
          desc: isRest ? '好好休息 🌿' : '自定义训练日',
          updatedAt: Date.now()
        };
      });
      save(); closeModal(); renderFitness();
      toast('计划已更新');
    });
  }

  $('#addTrainBtn').addEventListener('click', openTrainModal);
  $('#openPlanBtn').addEventListener('click', openPlanModal);

  $('#trainList').addEventListener('click', (e) => {
    if (e.target.dataset.act === 'del-train') {
      const item = e.target.closest('.train-item');
      if (confirm('删除这条训练记录？')) {
        const tr = state.trainings.find(x => x.id === item.dataset.id);
        if (tr) { tr.deleted = true; tr.updatedAt = Date.now(); }
        save(); renderFitness();
        toast('已删除');
      }
    }
  });

  // ==========================================
  // 11. 同步 / 数据管理
  // ==========================================
  function updateSyncPill() {
    const code = state.settings.syncCode;
    const cloud = state.settings.cloudUrl;
    const dot = $('#syncDot');
    const text = $('#syncText');
    if (state.settings.room && state.settings.room.joined) {
      dot.className = 'sync-dot cloud';
      text.textContent = '共享:' + state.settings.room.id;
    } else if (cloud) {
      dot.className = 'sync-dot cloud';
      text.textContent = '云端';
    } else if (code) {
      dot.className = 'sync-dot cloud';
      text.textContent = `码:${code.slice(0, 4)}`;
    } else {
      dot.className = 'sync-dot';
      text.textContent = '本地';
    }
  }

  // 导出 JSON
  function exportJSON() {
    const data = JSON.stringify(state, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pufferwork-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出备份文件');
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = (ev) => {
        try {
          const data = JSON.parse(ev.target.result);
          if (confirm('确认导入？这将覆盖当前所有数据！')) {
            Object.assign(state, data);
            state.settings = Object.assign({ partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 }, me: 'a', city: '杭州', syncCode: '', cloudUrl: '' }, state.settings || {});
            save();
            updateSyncPill();
            onPageEnter($('.nav-item.active').dataset.page);
            toast('导入成功 ✨');
          }
        } catch (err) {
          toast('导入失败：' + err.message, 'error');
        }
      };
      r.readAsText(f);
    };
    input.click();
  }

  // 二维码同步：把数据编码到 URL hash
  function openSyncModal() {
    openModal({
      title: '🔄 同步与备份',
      body: `
        <div class="form-row">
          <label>两位成员称呼</label>
          <div class="row-2">
            <input class="pixel-input" id="partnerA" value="${escapeHtml((state.settings.partners || {}).a || '孙大炮')}" placeholder="成员 A 称呼" />
            <input class="pixel-input" id="partnerB" value="${escapeHtml((state.settings.partners || {}).b || '童大侠')}" placeholder="成员 B 称呼" />
          </div>
          <div class="file-hint">显示在标题与问候中，两人均可修改并同步给对方</div>
          <label style="margin-top:8px;">所在城市（天气显示用）</label>
          <input class="pixel-input" id="cityInput" value="${escapeHtml(state.settings.city || '杭州')}" placeholder="如 杭州 / 上海 / 北京" />
        </div>
        <div class="form-row">
          <p class="muted">在不同设备间同步你的工作台数据。最简单的方式：用 <strong>导出 / 导入</strong> 备份文件。</p>
        </div>
        <div class="form-row" style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="pixel-btn primary" id="syncExport">📥 导出 JSON 备份</button>
          <button class="pixel-btn" id="syncImport">📤 导入 JSON 备份</button>
        </div>
        <div class="form-row" style="margin-top:20px;border-top:2px dashed var(--border);padding-top:14px;">
          <p class="muted">🔳 <strong>二维码同步</strong>：把数据生成二维码，手机扫码即可同步（适合数据量较小的场景）。</p>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="pixel-btn" id="syncQR">生成同步二维码</button>
            <button class="pixel-btn" id="syncFromQR">从二维码导入</button>
          </div>
        </div>
        <div class="form-row" style="margin-top:20px;border-top:2px dashed var(--border);padding-top:14px;">
          <p class="muted">🤝 <strong>共享房间（两人协作）</strong>：两人填入同一个「房间 ID + 口令」，即可实时同步待办 / 健身 / 素材 / 推文 / AI 视频。删除也会同步，不会互相覆盖。</p>
          <div class="file-hint">后端支持 <strong>Supabase</strong>（推荐，国内可访问，免费）或 Cloudflare Workers（workers.dev 在大陆常被墙，需自备域名）。</div>
          <div class="row-2" style="margin-top:8px;">
            <select id="roomBackend" class="pixel-input">
              <option value="supabase" ${state.settings.room.backend !== 'worker' ? 'selected' : ''}>Supabase（推荐）</option>
              <option value="worker" ${state.settings.room.backend === 'worker' ? 'selected' : ''}>Cloudflare Workers</option>
            </select>
            <input class="pixel-input" id="roomUrl" value="${escapeHtml(state.settings.room.url || '')}" placeholder="${state.settings.room.backend === 'worker' ? '房间地址，如 https://puffer-share.xxx.workers.dev' : '项目 URL，如 https://xxxx.supabase.co'}" />
          </div>
          <input class="pixel-input" id="roomAnon" value="${escapeHtml(state.settings.room.anon || '')}" placeholder="Supabase Anon Key（公开密钥，可安全填入前端）" style="margin-top:8px;${state.settings.room.backend === 'worker' ? 'display:none' : ''}" />
          <div class="row-2" style="margin-top:8px;">
            <input class="pixel-input" id="roomId" value="${escapeHtml(state.settings.room.id || '')}" placeholder="房间 ID（两人一致）" />
            <input class="pixel-input" id="roomPass" type="password" value="${escapeHtml(state.settings.room.pass || '')}" placeholder="访问口令" />
          </div>
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="pixel-btn primary" id="roomJoin">🤝 加入房间</button>
            <button class="pixel-btn" id="roomSync">立即同步</button>
            <button class="pixel-btn danger" id="roomLeave">退出</button>
          </div>
          <div id="roomStatus" class="file-hint" style="margin-top:8px;">尚未加入共享房间</div>
        </div>
        <div class="form-row" style="margin-top:20px;border-top:2px dashed var(--border);padding-top:14px;">
          <p class="muted">🌐 <strong>云端同步（可选）</strong>：配置一个简单的 JSON 存储 API（如 JSONBin、npoint、自建），输入 URL 即可。</p>
          <input class="pixel-input" id="cloudUrl" value="${escapeHtml(state.settings.cloudUrl || '')}" placeholder="https://api.jsonbin.io/v3/b/xxxxx 或自建 API" style="margin-top:6px;" />
          <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;">
            <button class="pixel-btn primary" id="cloudSave">保存并测试</button>
            <button class="pixel-btn ghost" id="cloudClear">清除</button>
          </div>
        </div>
        <div class="form-row" style="margin-top:20px;border-top:2px dashed var(--border);padding-top:14px;">
          <p class="muted">⚠️ 危险操作</p>
          <button class="pixel-btn danger" id="wipeAll" style="margin-top:6px;">清空所有数据</button>
        </div>
        <div id="qrArea" style="margin-top:16px;display:none;text-align:center;">
          <div id="qrCanvas" style="display:inline-block;padding:10px;background:#fff;border:3px solid var(--border);box-shadow:4px 4px 0 var(--border);"></div>
          <p class="muted" style="margin-top:8px;">手机扫码即可同步，或长按图片保存</p>
        </div>
      `,
      foot: `<button class="pixel-btn ghost" id="syncClose">关闭</button>`
    });
    $('#syncClose').addEventListener('click', closeModal);
    const pA = $('#partnerA'), pB = $('#partnerB'), cI = $('#cityInput');
    if (pA) pA.addEventListener('input', (e) => {
      if (!state.settings.partners) state.settings.partners = { a: '孙大炮', b: '童大侠', updatedAt: 0 };
      state.settings.partners.a = e.target.value.trim() || '孙大炮';
      state.settings.partners.updatedAt = Date.now();
      save(); updateOwnerUI(); scheduleRoomPush();
    });
    if (pB) pB.addEventListener('input', (e) => {
      if (!state.settings.partners) state.settings.partners = { a: '孙大炮', b: '童大侠', updatedAt: 0 };
      state.settings.partners.b = e.target.value.trim() || '童大侠';
      state.settings.partners.updatedAt = Date.now();
      save(); updateOwnerUI(); scheduleRoomPush();
    });
    if (cI) cI.addEventListener('input', (e) => {
      state.settings.city = e.target.value.trim() || '杭州';
      save(); fetchWeather(true);
    });
    $('#syncExport').addEventListener('click', () => { exportJSON(); });
    $('#syncImport').addEventListener('click', () => { importJSON(); });
    $('#syncQR').addEventListener('click', generateQR);
    $('#syncFromQR').addEventListener('click', importFromQR);
    $('#cloudSave').addEventListener('click', testCloud);
    $('#cloudClear').addEventListener('click', () => {
      state.settings.cloudUrl = '';
      save(); updateSyncPill(); toast('已清除云端配置');
    });
    $('#roomBackend').addEventListener('change', (e) => {
      state.settings.room.backend = e.target.value;
      const isSb = state.settings.room.backend === 'supabase';
      $('#roomAnon').style.display = isSb ? '' : 'none';
      $('#roomUrl').placeholder = isSb ? '项目 URL，如 https://xxxx.supabase.co' : '房间地址，如 https://puffer-share.xxx.workers.dev';
      save();
    });
    $('#roomUrl').addEventListener('input', (e) => { state.settings.room.url = e.target.value.trim(); save(); });
    $('#roomAnon').addEventListener('input', (e) => { state.settings.room.anon = e.target.value.trim(); save(); });
    $('#roomId').addEventListener('input', (e) => { state.settings.room.id = e.target.value.trim(); save(); });
    $('#roomPass').addEventListener('input', (e) => { state.settings.room.pass = e.target.value.trim(); save(); });
    $('#roomJoin').addEventListener('click', joinRoom);
    $('#roomSync').addEventListener('click', () => { pushToRoom(); updateRoomStatus(); });
    $('#roomLeave').addEventListener('click', leaveRoom);
    $('#wipeAll').addEventListener('click', () => {
      if (confirm('真的要清空所有数据吗？此操作不可恢复！')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    });
    updateRoomStatus();
  }

  function generateQR() {
    // 把数据压缩为最小可恢复格式
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(state))));
    const url = location.origin + location.pathname + '#sync=' + data;
    $('#qrArea').style.display = 'block';
    $('#qrCanvas').innerHTML = '';
    if (window.QRCode) {
      QRCode.toCanvas(document.createElement('canvas'), url, { width: 220, margin: 1, color: { dark: '#4A2C17', light: '#FFF4E0' } }, (err, canvas) => {
        if (err) { toast('生成失败：' + err.message, 'error'); return; }
        $('#qrCanvas').appendChild(canvas);
      });
    } else {
      $('#qrCanvas').textContent = '二维码库加载失败';
    }
    toast('二维码已生成（URL 长度: ' + url.length + '）');
  }

  function importFromQR() {
    const text = prompt('请粘贴二维码对应的 URL 或 base64 数据：');
    if (!text) return;
    try {
      let data = text;
      const m = text.match(/#sync=(.+)$/);
      if (m) data = m[1];
      const json = decodeURIComponent(escape(atob(data)));
      const obj = JSON.parse(json);
      if (confirm('确认导入该数据？这将覆盖当前所有内容！')) {
        Object.assign(state, obj);
        state.settings = Object.assign({ ownerName: '胖头鱼', syncCode: '', cloudUrl: '' }, state.settings || {});
        save();
        updateSyncPill();
        closeModal();
        onPageEnter($('.nav-item.active').dataset.page);
        toast('已同步 ✨');
      }
    } catch (e) {
      toast('导入失败：' + e.message, 'error');
    }
  }

  async function testCloud() {
    const url = $('#cloudUrl').value.trim();
    if (!url) { toast('请填写云端 URL', 'error'); return; }
    try {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state)
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      state.settings.cloudUrl = url;
      save(); updateSyncPill();
      toast('云端同步已配置 ✓');
    } catch (e) {
      toast('云端测试失败：' + e.message, 'error');
    }
  }

  // 同步 pill 点击
  $('#syncPill').addEventListener('click', openSyncModal);
  $('#settingsBtn').addEventListener('click', openSyncModal);

  // 处理 URL hash 中的同步数据
  function handleHashSync() {
    const m = location.hash.match(/#sync=(.+)$/);
    if (m) {
      try {
        const json = decodeURIComponent(escape(atob(m[1])));
        const obj = JSON.parse(json);
        if (confirm('检测到同步数据，是否导入？\n（导入将覆盖当前所有内容）')) {
          Object.assign(state, obj);
          state.settings = Object.assign({ ownerName: '胖头鱼', syncCode: '', cloudUrl: '' }, state.settings || {});
          save();
          updateSyncPill();
          toast('已从 URL 同步 ✨');
        }
        history.replaceState(null, '', location.pathname);
      } catch (e) {
        toast('同步数据解析失败', 'error');
      }
    }
  }

  // ==========================================
  // 12. 导航初始化
  // ==========================================
  $$('.nav-item, .bn-item').forEach(n => n.addEventListener('click', () => goPage(n.dataset.page)));

  // 跨标签页同步
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      load();
      const active = $('.nav-item.active');
      if (active) onPageEnter(active.dataset.page);
      toast('已从其他标签页同步数据');
    }
  });

  // 暴露 goPage 到全局（仪表板跳转）
  window.goPage = goPage;

  // ==========================================
  // 11b. 共享房间（两人协作）
  // ==========================================
  let roomTimer = null;
  let pushTimer = null;

  function roomActive() {
    const r = state.settings.room;
    if (r.backend === 'supabase') return !!(r && r.joined && r.url && r.anon && r.id && r.pass);
    return !!(r && r.joined && r.url && r.id && r.pass);
  }

  // 仅同步数据部分，不同步个人设置（ownerName 等各自保留）
  function serializeRoom() {
    return {
      todos: state.todos,
      trainings: state.trainings,
      messages: state.messages,
      gallery: state.gallery,
      meals: state.meals,
      partners: state.settings.partners,
      fitnessPlan: state.fitnessPlan,
      syncedAt: Date.now()
    };
  }

  // 按条目 id 合并两个数组：删除标记优先，内容以 updatedAt 较新者胜（平局时本地优先）
  function mergeArr(localArr, remoteArr) {
    const map = new Map();
    const put = (it) => {
      if (!it || it.id == null) return;
      const ex = map.get(it.id);
      if (!ex) { map.set(it.id, it); return; }
      if (it.deleted && !ex.deleted) { map.set(it.id, it); return; }
      if (!it.deleted && ex.deleted) { return; }
      const tIt = it.updatedAt || it.createdAt || 0;
      const tEx = ex.updatedAt || ex.createdAt || 0;
      if (tIt > tEx) map.set(it.id, it);
    };
    (remoteArr || []).forEach(put);
    (localArr || []).forEach(put);
    return [...map.values()];
  }

  // 计划按「星期」键合并，自定义（带 updatedAt）优先
  function mergePlan(local, remote) {
    const out = JSON.parse(JSON.stringify(local || {}));
    const r = remote || {};
    const keys = new Set([...Object.keys(out), ...Object.keys(r)]);
    keys.forEach(k => {
      const l = out[k], rv = r[k];
      if (!rv) return;
      if (!l) { out[k] = rv; return; }
      if ((rv.updatedAt || 0) > (l.updatedAt || 0)) out[k] = rv;
    });
    return out;
  }

  function mergeState(local, remote) {
    if (!remote) return;
    Object.assign(local, {
      todos: mergeArr(local.todos, remote.todos),
      trainings: mergeArr(local.trainings, remote.trainings),
      messages: mergeArr(local.messages, remote.messages),
      gallery: mergeArr(local.gallery, remote.gallery),
      meals: mergeArr(local.meals, remote.meals),
      fitnessPlan: mergePlan(local.fitnessPlan, remote.fitnessPlan),
    });
    if (remote.partners) local.settings.partners = mergePlan(local.settings.partners, remote.partners);
  }

  async function roomGet(url, id, pass) {
    const r = state.settings.room;
    if (r.backend === 'supabase') {
      const base = url.replace(/\/$/, '');
      const res = await fetch(`${base}/rest/v1/rooms?id=eq.${encodeURIComponent(id)}&select=id,data,rev,updated_at&pass=eq.${encodeURIComponent(pass)}`, {
        headers: { 'apikey': r.anon, 'Authorization': 'Bearer ' + r.anon }
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const arr = await res.json();
      if (!Array.isArray(arr) || arr.length === 0) throw new Error('房间不存在');
      const row = arr[0];
      return { ok: true, data: row.data, rev: row.rev, updatedAt: row.updated_at };
    }
    // Cloudflare Workers 后端
    const res = await fetch(`${url.replace(/\/$/, '')}/api/${encodeURIComponent(id)}?pass=${encodeURIComponent(pass)}`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error === 'forbidden') throw new Error('口令错误');
      if (e.error === 'not_found') throw new Error('房间不存在');
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  }

  async function roomPut(url, id, pass, data) {
    const r = state.settings.room;
    if (r.backend === 'supabase') {
      const base = url.replace(/\/$/, '');
      const body = { id, data, rev: Date.now(), pass, updated_at: new Date().toISOString() };
      const res = await fetch(`${base}/rest/v1/rooms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': r.anon,
          'Authorization': 'Bearer ' + r.anon,
          'Prefer': 'resolution=merge-duplicates, return=representation'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error('HTTP ' + res.status + (t ? ' ' + t.slice(0, 120) : ''));
      }
      const arr = await res.json();
      const rev = (arr && arr[0] && arr[0].rev) || Date.now();
      return { ok: true, rev, updatedAt: Date.now() };
    }
    // Cloudflare Workers 后端
    const res = await fetch(`${url.replace(/\/$/, '')}/api/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass, data })
    });
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error === 'forbidden') throw new Error('口令错误');
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  }

  function scheduleRoomPush() {
    if (!roomActive()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushToRoom, 1000);
  }

  // 返回 true 表示成功，false 表示失败（内部已 toast）
  async function pushToRoom() {
    if (!roomActive()) return false;
    const r = state.settings.room;
    try {
      const remote = await roomGet(r.url, r.id, r.pass);
      mergeState(state, remote.data);
      r.lastRev = remote.rev;
    } catch (e) {
      if (e.message !== '房间不存在') { toast('同步失败：' + e.message, 'error'); return false; }
    }
    try {
      const resp = await roomPut(r.url, r.id, r.pass, serializeRoom());
      r.lastRev = resp.rev;
      r.lastSync = Date.now();
      save();
      renderCurrent();
      return true;
    } catch (e) {
      toast('同步失败：' + e.message, 'error');
      return false;
    }
  }

  async function pollRoom() {
    if (!roomActive()) return;
    const r = state.settings.room;
    try {
      const remote = await roomGet(r.url, r.id, r.pass);
      if (remote.rev === r.lastRev) return; // 无变化
      mergeState(state, remote.data);
      r.lastRev = remote.rev;
      r.lastSync = Date.now();
      save();
      renderCurrent();
      toast('已收到对方的更新 ✨');
    } catch (e) { /* 轮询静默失败 */ }
  }

  function renderCurrent() {
    const active = $('.nav-item.active');
    if (active) onPageEnter(active.dataset.page);
    else renderDashboard();
  }

  function startRoomPolling() {
    if (roomTimer) clearInterval(roomTimer);
    roomTimer = setInterval(pollRoom, 12000);
  }

  async function joinRoom() {
    const r = state.settings.room;
    if (r.backend === 'supabase' && (!r.url || !r.anon || !r.id || !r.pass)) { toast('请填写 Supabase 项目 URL、Anon Key、房间 ID 和口令', 'error'); return; }
    if (r.backend !== 'supabase' && (!r.url || !r.id || !r.pass)) { toast('请填写房间地址、ID 和口令', 'error'); return; }
    r.joined = true; save();
    const ok = await pushToRoom();
    if (ok) {
      startRoomPolling();
      updateSyncPill();
      updateRoomStatus();
      toast('已加入共享房间 🤝');
      closeModal();
    } else {
      r.joined = false; save();
      updateSyncPill();
    }
  }

  function leaveRoom() {
    if (roomTimer) { clearInterval(roomTimer); roomTimer = null; }
    state.settings.room.joined = false;
    save();
    updateSyncPill();
    updateRoomStatus();
    toast('已退出共享房间');
  }

  function fmtAgo(ts) {
    if (!ts) return '—';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
    return Math.floor(s / 3600) + ' 小时前';
  }

  function updateRoomStatus() {
    const el = document.getElementById('roomStatus');
    if (!el) return;
    const r = state.settings.room;
    if (r.joined) {
      el.innerHTML = `已加入房间「<strong>${escapeHtml(r.id)}</strong>」· 最近同步 ${fmtAgo(r.lastSync)} · 每 12 秒自动拉取对方更新`;
    } else {
      el.textContent = '尚未加入共享房间';
    }
  }

  // 每周自动清理：删除 7 天前的旧待办与旧留言，避免持续占用存储
  function runWeeklyCleanup() {
    const s = state.settings;
    const now = Date.now();
    const WEEK = 7 * 24 * 60 * 60 * 1000;
    // 首次运行只建立基线，不立即删除（避免部署当天误删现有数据）
    if (!s.lastClean) { s.lastClean = now; save(); return; }
    if (now - s.lastClean < WEEK) return; // 未满一周，跳过

    const cutoff = now - WEEK;
    let delTodos = 0, delMsgs = 0;
    (state.todos || []).forEach(t => {
      if (!t.deleted && t.createdAt && t.createdAt < cutoff) { t.deleted = true; t.updatedAt = now; delTodos++; }
    });
    (state.messages || []).forEach(m => {
      if (!m.deleted && m.createdAt && m.createdAt < cutoff) { m.deleted = true; m.updatedAt = now; delMsgs++; }
    });
    s.lastClean = now;
    save(); // save 内部会在已加入房间时自动同步给对方
    if (delTodos || delMsgs) {
      const parts = [];
      if (delTodos) parts.push(delTodos + ' 条旧待办');
      if (delMsgs) parts.push(delMsgs + ' 条旧留言');
      toast('🧹 每周清理：已自动删除 ' + parts.join('、') + '（7 天前）', 'info');
    }
  }

  // ==========================================
  // 启动
  // ==========================================
  load();
  if (!state.settings.partners) state.settings.partners = { a: (state.settings.ownerName || '孙大炮'), b: '童大侠', updatedAt: 0 };
  if (!state.settings.me) state.settings.me = 'a';
  if (!state.settings.city) state.settings.city = '杭州';
  runWeeklyCleanup(); // 打开页面时检查是否已满一周，自动清理旧待办/留言
  updateSyncPill();
  handleHashSync();
  if (state.settings.room && state.settings.room.joined) {
    updateSyncPill();
    pushToRoom();
    startRoomPolling();
  }
  goPage('dashboard');
})();
