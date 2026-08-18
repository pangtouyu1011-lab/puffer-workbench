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
  const activeSubmissionLocks = new Set();
  async function runSubmission(button, task, key = button) {
    const lockKey = key || button || task;
    if (activeSubmissionLocks.has(lockKey) || button?.dataset.submitting === '1') return false;
    activeSubmissionLocks.add(lockKey);
    if (button) {
      button.dataset.submitting = '1';
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
      button.classList.add('is-submitting');
    }
    try { return await task(); }
    finally {
      activeSubmissionLocks.delete(lockKey);
      if (button) {
        delete button.dataset.submitting;
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.classList.remove('is-submitting');
      }
    }
  }
  const isLifeMode = () => document.documentElement.classList.contains('life-boot') || !!document.getElementById('lifeApp');
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
  // Worker rooms upload new images to R2. Embedded images remain only as an
  // offline/Supabase fallback, so keep a clear safety margin for that case.
  const EMBEDDED_IMAGE_MAX_BYTES = 500 * 1024;
  const LOCAL_STORAGE_WARN_BYTES = Math.floor(3.8 * 1024 * 1024);
  const LOCAL_STORAGE_HARD_BYTES = Math.floor(4.5 * 1024 * 1024);
  const ROOM_PAYLOAD_WARN_BYTES = Math.floor(6.4 * 1024 * 1024);
  const ROOM_PAYLOAD_HARD_BYTES = Math.floor(7.2 * 1024 * 1024);
  // Text is kept in the room payload. Validate on every write path instead of
  // truncating history, so a large paste cannot unexpectedly block future sync.
  const TEXT_LIMITS = Object.freeze({
    message: 1200,
    todo: 160,
    trainingContent: 800,
    trainingMeta: 80,
    trainingNote: 800,
    travelPlace: 120,
    travelNote: 1200,
    wish: 160,
    moodNote: 240,
    photoCaption: 200,
    imageUrl: 2048
  });
  function textWithinLimit(value, max, label) {
    const text = String(value == null ? '' : value).trim();
    if (text.length > max) {
      toast(`${label}最多 ${max} 个字`, 'error');
      return null;
    }
    return text;
  }
  const byteSize = value => new TextEncoder().encode(String(value || '')).byteLength;
  const formatBytes = bytes => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  function currentStorageUsage() {
    const local = byteSize(JSON.stringify(state));
    let room = 0;
    try { room = byteSize(JSON.stringify(serializeRoom())); } catch (_) { room = local; }
    return { local, room };
  }
  function storageUsageLabel() {
    const usage = currentStorageUsage();
    const near = usage.local >= LOCAL_STORAGE_WARN_BYTES || usage.room >= ROOM_PAYLOAD_WARN_BYTES;
    return { near, text: `当前数据约 ${formatBytes(usage.local)}；同步内容约 ${formatBytes(usage.room)}` };
  }
  async function compressRoomImage(file) {
    let dataUrl = await compressImage(file, 1280, 0.8);
    if (byteSize(dataUrl) > EMBEDDED_IMAGE_MAX_BYTES) dataUrl = await compressImage(file, 1024, 0.72);
    if (byteSize(dataUrl) > EMBEDDED_IMAGE_MAX_BYTES) dataUrl = await compressImage(file, 800, 0.65);
    if (byteSize(dataUrl) > EMBEDDED_IMAGE_MAX_BYTES) throw new Error('图片压缩后仍然过大，请换一张照片或裁剪后再试');
    return dataUrl;
  }
  function canAddEmbeddedImage(dataUrl) {
    const usage = currentStorageUsage();
    const extra = byteSize(dataUrl) + 2048;
    if (usage.local + extra > LOCAL_STORAGE_HARD_BYTES || usage.room + extra > ROOM_PAYLOAD_HARD_BYTES) {
      toast('为避免本地保存或同步突然失败，这张图片没有保存。请先在“我们与同步”中导出备份，再清理一些旧图片。', 'error');
      return false;
    }
    if (usage.local + extra >= LOCAL_STORAGE_WARN_BYTES || usage.room + extra >= ROOM_PAYLOAD_WARN_BYTES) {
      toast('图片已保存，但存储空间接近上限；建议尽快导出备份并整理旧图片。', 'info');
    }
    return true;
  }
  async function storeRoomImage(dataUrl) {
    const room = state.settings.room || {};
    // 未加入 Worker 房间时仍允许仅本机保存，保持离线记录体验。
    if (!room.joined || room.backend === 'supabase') {
      if (!canAddEmbeddedImage(dataUrl)) return null;
      return { dataUrl, url: '' };
    }
    const base = String(room.url || '').replace(/\/$/, '');
    const endpoint = `${base}/api/v1/rooms/${encodeURIComponent(room.id)}/media?pass=${encodeURIComponent(room.pass)}`;
    const blob = await (await fetch(dataUrl)).blob();
    const res = await syncFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: blob }, SYNC_UPLOAD_TIMEOUT_MS);
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) {
      if (body.error === 'payload_too_large') throw new Error('图片过大，请换一张或裁剪后再试');
      throw new Error('图片上传失败，请检查网络后重试');
    }
    return { dataUrl: '', url: body.url };
  }

  const MUSIC_DATA = window.PufferMusicData;
  if (!MUSIC_DATA) throw new Error('Puffer music data did not load');
  const {
    APPLE_PLAYLIST_URL,
    NETEASE_PLAYLIST_URL,
    NETEASE_PROFILE_TAGS,
    APPLE_PROFILE_TAGS,
    MUSIC_LYRICS,
    MUSIC_LIBRARY
  } = MUSIC_DATA;
  const STORAGE_KEY = 'pufferwork:v1';
  const INPUT_DRAFT_STORAGE_KEY = 'puffer-input-drafts:v1';
  const INPUT_DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;
  const INPUT_DRAFT_MAX_RECORDS = 24;
  const INPUT_DRAFT_MAX_FIELD_LENGTH = 4000;

  // 输入草稿只保存在当前浏览器，不挂到 state，也不会进入房间同步快照。
  function inputDraftKey(scope) {
    const room = state.settings?.room || {};
    const place = room.joined && room.id ? `room:${room.id}` : 'local';
    return `${place}:${state.settings?.me || 'a'}:${String(scope || '').slice(0, 120)}`;
  }

  function readInputDraftStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(INPUT_DRAFT_STORAGE_KEY) || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const cutoff = Date.now() - INPUT_DRAFT_TTL_MS;
      return Object.fromEntries(Object.entries(parsed).filter(([, record]) => (
        record && typeof record === 'object' && Number(record.updatedAt || 0) >= cutoff &&
        record.fields && typeof record.fields === 'object' && !Array.isArray(record.fields)
      )));
    } catch (_) {
      return {};
    }
  }

  function writeInputDraftStore(store) {
    try {
      const entries = Object.entries(store).sort((left, right) => Number(right[1]?.updatedAt || 0) - Number(left[1]?.updatedAt || 0));
      localStorage.setItem(INPUT_DRAFT_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, INPUT_DRAFT_MAX_RECORDS))));
      return true;
    } catch (error) {
      console.warn('Input draft persistence failed', error);
      return false;
    }
  }

  function getInputDraft(scope) {
    const record = readInputDraftStore()[inputDraftKey(scope)];
    if (!record) return null;
    return { updatedAt: Number(record.updatedAt || 0), fields: { ...record.fields } };
  }

  function setInputDraft(scope, fields) {
    const normalized = Object.fromEntries(Object.entries(fields || {}).map(([name, value]) => [
      String(name).slice(0, 80),
      String(value == null ? '' : value).slice(0, INPUT_DRAFT_MAX_FIELD_LENGTH)
    ]));
    if (!Object.keys(normalized).length) return false;
    const store = readInputDraftStore();
    store[inputDraftKey(scope)] = { updatedAt: Date.now(), fields: normalized };
    return writeInputDraftStore(store);
  }

  function clearInputDraft(scope) {
    const store = readInputDraftStore();
    const key = inputDraftKey(scope);
    if (!Object.prototype.hasOwnProperty.call(store, key)) return true;
    delete store[key];
    return writeInputDraftStore(store);
  }

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
    '坚持就是胜利！', '专注当下，一步一步来',
    '我们一起慢慢变好 🐡', '今天也要开开心心！', '你笑起来最好看 😊',
    '别担心，我在呢～', '小小目标，慢慢达成 🌟', '摸摸头，充电完成 🔋'
  ];

  // 胖头鱼交互：戳一下会鼓起来 + 说句鼓励的话
  let mascotGreeting = '';
  let mascotRevertTimer = null;
  let mascotPuffTimer = null;
  function mascotPoke(img) {
    if (!img) return;
    img.classList.remove('puff');
    void img.offsetWidth; // 强制重排以重放动画
    img.classList.add('puff');
    clearTimeout(mascotPuffTimer);
    mascotPuffTimer = setTimeout(() => img.classList.remove('puff'), 600);
    const q = mascotQuotes[Math.floor(Math.random() * mascotQuotes.length)];
    const bubble = document.getElementById('mascotBubble');
    if (bubble) {
      bubble.textContent = q;
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
    }
    const quote = document.getElementById('mascotQuote');
    if (quote) quote.textContent = q;
    clearTimeout(mascotRevertTimer);
    mascotRevertTimer = setTimeout(() => {
      if (bubble && mascotGreeting) bubble.textContent = mascotGreeting;
      // 侧栏河豚恢复当前页的应景文案
      const activePage = document.querySelector('.nav-item.active');
      if (activePage) pageMascotQuote(activePage.dataset.page);
    }, 3600);
  }
  function bindMascot() {
    const dash = document.querySelector('.dw-mascot .mascot-img');
    if (dash) {
      dash.tabIndex = 0;
      dash.setAttribute('role', 'button');
      dash.title = '戳一戳我 🐡';
      dash.addEventListener('click', () => mascotPoke(dash));
      dash.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mascotPoke(dash); } });
    }
    const mini = document.querySelector('.mascot-mini img');
    if (mini) {
      mini.tabIndex = 0;
      mini.setAttribute('role', 'button');
      mini.title = '戳一戳我 🐡';
      mini.addEventListener('click', () => mascotPoke(mini));
    }
  }
  bindMascot();

  // 背景视差：桌面端鼠标移动时，光斑层与漂浮物层按不同深度平移，制造景深感
  function bindBgParallax() {
    // 用「精确指针 + 零触点」判断桌面，避开 headless 无 hover 设备/触屏笔记本
    const isDesktop = window.matchMedia('(pointer: fine)').matches && navigator.maxTouchPoints === 0;
    if (!isDesktop) return;
    const layers = Array.from(document.querySelectorAll('.bg-bubbles, .bg-motes'));
    if (!layers.length) return;
    const st = layers.map((el, i) => ({ el, curX: 0, curY: 0, tx: 0, ty: 0, f: i === 0 ? 18 : 34 }));
    let raf = null;
    const apply = () => {
      for (const s of st) {
        s.curX += (s.tx - s.curX) * 0.07;
        s.curY += (s.ty - s.curY) * 0.07;
        s.el.style.transform = `translate3d(${s.curX.toFixed(2)}px, ${s.curY.toFixed(2)}px, 0)`;
      }
    };
    const onMove = (e) => {
      const nx = e.clientX / window.innerWidth - 0.5;
      const ny = e.clientY / window.innerHeight - 0.5;
      for (const s of st) { s.tx = nx * -s.f; s.ty = ny * -s.f * 0.8; }
      apply(); // 立即反馈一帧
      if (!raf) raf = requestAnimationFrame(function loop() {
        apply();
        // 接近目标则停
        if (st.some(s => Math.abs(s.tx - s.curX) > 0.05 || Math.abs(s.ty - s.curY) > 0.05)) {
          raf = requestAnimationFrame(loop);
        } else {
          raf = null;
        }
      });
    };
    window.addEventListener('mousemove', onMove, { passive: true });
  }
  bindBgParallax();

  const DEFAULT_WORKER_URL = 'https://sync.20051011.xyz';
  const DEFAULT_SUPABASE_URL = 'https://chfczfrkgndgudcxoump.supabase.co';
  const DEFAULT_SUPABASE_ANON = 'sb_publishable_tOeCrvhq0WXTIRzUpaQAuQ_NrnmRwQq';

  const state = {
    todos: [],
    fitnessPlan: { ...defaultPlan },
    trainings: [],
    messages: [],
    gallery: [],
    travels: [],
    meals: defaultMeals(),
    wishes: [],
    water: {},
    hydrationLog: [],
    dailyStatus: {},
    interactionHistory: {},
    challengeAnswers: [],
    fortune: null,          // 两人各自的祈福签：{ date, by: { a, b } }
    settings: {
      partners: { a: '孙大炮', b: '童大侠', updatedAt: 0 },
      me: 'a',
      city: '杭州',
      syncCode: '',
      cloudUrl: '',  // 可选：自建云同步 API
      room: { backend: 'worker', url: DEFAULT_WORKER_URL, anon: '', id: '', pass: '', joined: false, lastSync: 0, lastRev: 0, pendingSyncAt: 0, pendingMessageIds: [], lastPushError: '' },
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
        // fitnessPlan 必须为 7 项（0=周日…6=周六），每项含 name/muscle/desc；
        // 兼容空对象 / 旧对象形式 {0..6} / 残缺数组，缺项一律用默认补齐
        {
          const base = [];
          for (let i = 0; i < 7; i++) base[i] = defaultPlan[i] ? { ...defaultPlan[i] } : { name: '休息', muscle: 'rest', desc: '' };
          const src = state.fitnessPlan;
          if (src && typeof src === 'object') {
            for (let i = 0; i < 7; i++) { const u = src[i]; if (u && typeof u === 'object' && !Array.isArray(u)) base[i] = { ...base[i], ...u }; }
          }
          state.fitnessPlan = base;
        }
        if (!state.trainings) state.trainings = [];
        if (!state.todos) state.todos = [];
      if (!state.messages) state.messages = [];
      if (!state.gallery) state.gallery = [];
      if (!state.travels) state.travels = [];
      if (!state.meals) state.meals = defaultMeals();
      if (!state.wishes) state.wishes = [];
      if (!state.water) state.water = {};
      if (!Array.isArray(state.hydrationLog)) state.hydrationLog = [];
      migrateLegacyWater();
      if (!state.dailyStatus || typeof state.dailyStatus !== 'object') state.dailyStatus = {};
      if (!state.interactionHistory || typeof state.interactionHistory !== 'object') state.interactionHistory = {};
      if (!Array.isArray(state.challengeAnswers)) state.challengeAnswers = [];
      compactRoomState();
      save({ silent: true });
      // 迁移旧版共享抽签（settings.fortune 单一签）→ 顶层双人结构（旧签归 a）
      if (state.settings && state.settings.fortune && state.settings.fortune.date && state.settings.fortune.sign) {
        state.fortune = { date: state.settings.fortune.date, by: { a: state.settings.fortune.sign, b: null } };
        delete state.settings.fortune;
      }
      if (!state.fortune) state.fortune = null;
      if (state.settings.lastClean === undefined) state.settings.lastClean = 0;
        if (!state.settings.room) state.settings.room = { backend: 'worker', url: DEFAULT_WORKER_URL, anon: '', id: '', pass: '', joined: false, lastSync: 0, lastRev: 0, pendingSyncAt: 0, pendingMessageIds: [], lastPushError: '' };
        else {
          const rm = state.settings.room;
          // 旧版使用 Cloudflare Worker；将旧默认 Worker 和当前默认 Supabase 房间统一切到同一 Worker。
          const isLegacyWorker = rm.url === 'https://puffer-share.pangtouyu1011.workers.dev';
          const isDefaultSupabase = rm.backend === 'supabase' && rm.url === DEFAULT_SUPABASE_URL;
          if (isLegacyWorker || isDefaultSupabase) {
            rm.backend = 'worker';
            rm.url = DEFAULT_WORKER_URL;
            rm.anon = '';
          } else if (!rm.backend) rm.backend = (rm.url && (rm.url.includes('workers.dev') || rm.url.includes('20051011.xyz'))) ? 'worker' : 'supabase';
          if (rm.anon === undefined) rm.anon = rm.backend === 'supabase' ? DEFAULT_SUPABASE_ANON : '';
          if (!Number.isFinite(Number(rm.pendingSyncAt))) rm.pendingSyncAt = 0;
          if (!Array.isArray(rm.pendingMessageIds)) rm.pendingMessageIds = [];
          rm.pendingMessageIds = [...new Set(rm.pendingMessageIds.map(String).filter(Boolean))];
          if (typeof rm.lastPushError !== 'string') rm.lastPushError = '';
        }
        // 清理历史重复的默认菜单（按菜名去重，软删除多余的）
        const removed = dedupeMeals();
        if (removed > 0) save();
      }
    } catch (e) {
      console.warn('Load failed', e);
    }
  }

  function save(opts) {
    try {
      updateInteractionHistory();
      if (!opts || !opts.silent) markPendingSync();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      window.dispatchEvent(new CustomEvent('puffer-state-change'));
      emitSyncStatus();
      // 用户操作触发推送；但推送/轮询内部保存时用 silent 跳过，
      // 否则「推送成功→save→再推送」会形成每 1 秒一次的无限循环，
      // 双人在线时互相抢写，rev 疯涨，版本冲突变成必然。
      if (!opts || !opts.silent) {
        if (state.settings.room && state.settings.room.joined) scheduleRoomPush();
      }
    } catch (e) {
      toast('保存失败：' + e.message, 'error');
    }
  }

  // 仅返回未软删除的条目（共享模式下删除通过 deleted 标记同步，避免被对方覆盖回来）
  function live(arr) { return (arr || []).filter(x => !x.deleted); }

  function todayChallengeQuestion() {
    return window.PufferChallenge?.getDailyQuestion?.(todayKey()) || null;
  }

  function todayChallengeAnswers(source = state) {
    const question = todayChallengeQuestion(), date = todayKey();
    if (!question) return {};
    return live(source.challengeAnswers).filter(item => item.date === date && item.questionId === question.id).reduce((out, item) => {
      if (item.author === 'a' || item.author === 'b') out[item.author] = item;
      return out;
    }, {});
  }

  function isTodayInteractionComplete(source = state) {
    const date = todayKey();
    const fortune = source.fortune && source.fortune.date === date ? source.fortune.by || {} : {};
    const todos = live(source.todos).filter(item => item.date === date);
    const todosDone = !todos.length || todos.every(item => item.done);
    const messageOnDate = item => { const d = new Date(item.createdAt); return item.author && `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` === date; };
    const answers = todayChallengeAnswers(source);
    const complete = person => !!fortune[person] && !!source.dailyStatus?.[date]?.[person]?.mood && live(source.messages).some(item => item.author === person && messageOnDate(item)) && todosDone && !!answers[person];
    return complete('a') && complete('b');
  }

  function updateInteractionHistory() {
    let changed = false;
    const date = todayKey();
    const complete = isTodayInteractionComplete(state);
    if (complete && !state.interactionHistory[date]) {
      state.interactionHistory[date] = { completedAt: Date.now(), a: true, b: true };
      changed = true;
    }
    const cutoff = new Date(Date.now() - 370 * 86400000).toISOString().slice(0, 10);
    Object.keys(state.interactionHistory).forEach(key => { if (key < cutoff) { delete state.interactionHistory[key]; changed = true; } });
    return changed;
  }

  // ==========================================
  // 2. 路由 / 导航
  // ==========================================
  // 每个页面的陪伴文案（侧栏河豚；dashboard 用随机语录，不走这里）
  const PAGE_QUOTES = {
    todo: '把待办和日历一起理一理 📆',
    fitness: '练完记得拉伸，好好休息 🌿',
    messages: 'TA 的心里话都藏在这里 💌',
    wishes: '心愿不怕多，慢慢都会实现 🛎️',
    horoscope: '看看今天的星座运势，抽一支签吧 ✨',
  };
  function pageMascotQuote(name) {
    const q = PAGE_QUOTES[name];
    const el = document.getElementById('mascotQuote');
    if (q && el) el.textContent = q;
  }

  function goPage(name) {
    if (name === 'messages' && document.getElementById('lifeApp')) {
      window.dispatchEvent(new CustomEvent('puffer-life-messages'));
      return;
    }
    // 新版四页界面把「首页」统一收敛到“今天”。从旧工具页返回首页时，恢复新版外壳，避免落回隐藏的旧仪表板。
    if (name === 'dashboard' && document.getElementById('lifeApp')) {
      document.body.classList.add('life-mode');
      window.dispatchEvent(new CustomEvent('puffer-life-home'));
      return;
    }
    if (isLifeMode()) return;
    document.body.dataset.page = name;
    $$('.page').forEach(p => p.classList.remove('active'));
    const target = $(`#page-${name}`);
    if (target) target.classList.add('active');

    $$('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));
    $$('.bn-item').forEach(n => n.classList.toggle('active', n.dataset.page === name));

    // 进入留言页：清零未读红点与标题角标（仅本机状态，不触发房间上传）
    if (name === 'messages') markMessagesRead();
    else {
      updateMsgBadge();
      updateTitleBadge();
    }
    pageMascotQuote(name); // 侧栏河豚说一句应景的话

    // 滚动到顶部
    window.scrollTo({ top: 0, behavior: 'smooth' });

    // 触发渲染
    onPageEnter(name);
  }

  function onPageEnter(name) {
    if (isLifeMode()) return;
    switch (name) {
      case 'dashboard': renderDashboard(); break;
      case 'todo': renderTodoPage(); break;
      case 'fitness': renderFitness(); break;
      case 'messages': renderMessages(); break;
      case 'wishes': renderWishes(); break;
      case 'horoscope': renderHoroscope(); renderFortune(); break;
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
    if (!force && cached && (Date.now() - (cached.ts || 0) < 3600 * 1000)) { renderWeather(); renderMusicWidget(); return; }
    try {
      const c = CITY_COORDS[city] || CITY_COORDS['杭州'];
      const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + c.lat + '&longitude=' + c.lon + '&current=temperature_2m,weather_code&timezone=Asia%2FShanghai';
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      const cur = j.current || {};
      state._weather = { ts: Date.now(), city: city, temp: Math.round(cur.temperature_2m), code: cur.weather_code, time: cur.time };
      save({ silent: true }); // 天气是本地缓存，不值得推送给对方（否则会形成推送循环）
      renderWeather();
      renderMusicWidget();
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
  const MUSIC_DAYPARTS = {
    morning: { label: '早晨', title: '给今天开个场', icon: '☀', greeting: '早上好，今天也要元气满满！' },
    noon: { label: '午间', title: '午后的轻松一首', icon: '◒', greeting: '午安，忙了一上午，听首歌歇一会儿。' },
    night: { label: '夜晚', title: '把今天慢慢收好', icon: '☾', greeting: '晚上好，辛苦一天了，听首歌慢慢放松。' }
  };
  const MusicRecommend = window.PufferMusicRecommend;
  const MusicState = window.PufferMusicState;
  MusicState.configure({ getState: () => state, todayKey, save });
  MusicRecommend.configure({ getState: () => state, todayKey, save });
  const { currentMusicDaypart, musicWeatherProfile, musicWeekProfile, musicSongKey, musicSlotKey, musicSettings, pickMusicFor, getMusicSlotSong } = MusicRecommend;
  function renderMusicWidget() {
    const list = $('#musicList'); if (!list) return;
    const weather = musicWeatherProfile(); const week = musicWeekProfile();
    const chip = $('#musicWeatherChip'); const title = $('#musicWidgetTitle'); const intro = $('#musicIntro'); const reason = $('#musicReason');
    if (chip) chip.textContent = weather.icon + ' ' + weather.label;
    if (title) title.textContent = '今天听什么';
    if (intro) intro.textContent = MUSIC_DAYPARTS[currentMusicDaypart()].greeting;
    if (reason) reason.textContent = week.label + ' · ' + weather.reason;
    const part = currentMusicDaypart(); const info = MUSIC_DAYPARTS[part];
    const renderSong = (song, label, stream, slotKey) => { if (!song) return ''; const lyric = MUSIC_LYRICS[song.title] || '让这首歌陪你把此刻过完'; const key = musicSongKey(song); const liked = musicSettings()._musicLikes[key]; const feedbackData = ' data-music-stream="' + stream + '" data-music-key="' + escapeHtml(key) + '" data-music-slot-key="' + escapeHtml(slotKey) + '"'; return '<div class="music-person-label">' + label + '</div><article class="music-track"><span class="music-track-cover">' + info.icon + '<small class="music-track-time">' + info.label + '</small></span><div><div class="music-track-title">' + escapeHtml(song.title) + '</div><div class="music-track-artist">' + escapeHtml(song.artist) + '</div><span class="music-track-source">' + escapeHtml(song.source || '风格推荐') + '</span><div class="music-lyric">“' + escapeHtml(lyric) + '”</div><div class="music-feedback-label">喜欢这首歌吗？</div><div class="music-feedback"><button data-music-feedback="like"' + feedbackData + ' class="' + (liked === 1 ? 'active' : '') + '">👍 喜欢</button><button data-music-feedback="dislike"' + feedbackData + '>👎 换一首</button><button data-music-feedback="block"' + feedbackData + '>🚫 不再推荐</button></div></div><a href="' + escapeHtml(song.url) + '" target="_blank" rel="noopener">↗</a></article>'; };
    const neteaseSource = '你们的网易云歌单'; const appleSources = ['你们的 Apple Music 歌单', '相似推荐'];
    list.innerHTML = renderSong(getMusicSlotSong(part, neteaseSource), '我的推荐 · 网易云歌单', 'netease', musicSlotKey(part, neteaseSource)) + renderSong(getMusicSlotSong(part, appleSources), '对方推荐 · Apple Music + 相似风格', 'apple', musicSlotKey(part, appleSources));
    list.dataset.musicRenderedSlot = todayKey() + ':' + part;
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-music-feedback]'); if (!button) return;
    event.preventDefault(); event.stopPropagation(); const key = button.dataset.musicKey; const action = button.dataset.musicFeedback; const slotKey = button.dataset.musicSlotKey;
    if (MusicRecommend.recordFeedback(key, action, slotKey)) renderMusicWidget();
  });
  let musicSlotTimer = null;
  function notifyMusicRecommendation() {
    const part = currentMusicDaypart(); const day = todayKey(); const slotKey = day + ':' + part;
    if (state.settings._musicNotifiedSlot === slotKey) return;
    const song = getMusicSlotSong(part); if (!song) return;
    state.settings._musicNotifiedSlot = slotKey; save({ silent: true }); renderMusicWidget();
    // 今日音乐已在首页固定呈现；首次打开不再用弹窗或系统通知重复打断。
  }
  function infoMusicToast(part, song, lyric) { return '♫ ' + MUSIC_DAYPARTS[part].label + '：' + song.title + ' · “' + lyric + '”'; }
  function startMusicSlotTimer() {
    clearInterval(musicSlotTimer); musicSlotTimer = setInterval(() => { renderMusicWidget(); notifyMusicRecommendation(); }, 30000);
  }

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
    // 新版首页会单独按需渲染照片。旧仪表盘在启动期是隐藏的，避免它提前下载整个相册。
    if (document.documentElement.classList.contains('life-boot')) return;
    const el = $('#gallerySlider');
    if (!el) return;
    const dotsWrap = $('#galleryDots');
    const prev = $('#galleryPrev');
    const next = $('#galleryNext');
    const items = live(state.gallery);
    if (galleryTimer) { clearInterval(galleryTimer); galleryTimer = null; }
    if (items.length === 0) {
      const hero = $('#galleryHero');
      if (hero) hero.classList.add('is-empty'); // 空状态压缩 Hero 高度
      el.innerHTML =
        '<div class="gallery-empty">还没有共同回忆<br><span class="ge-sub">添加第一张照片，给今天留个记号</span>' +
        '<button class="pixel-btn primary gallery-cta" id="galleryEmptyCta">＋ 添加第一张照片</button></div>';
      const cta = $('#galleryEmptyCta');
      if (cta) cta.addEventListener('click', openGalleryManager);
      if (dotsWrap) dotsWrap.innerHTML = '';
      if (prev) prev.hidden = true;
      if (next) next.hidden = true;
      return;
    }
    const hero = $('#galleryHero');
    if (hero) hero.classList.remove('is-empty');
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
      if (hint) { const usage = storageUsageLabel(); hint.textContent = '上传图片会自动压缩并检查同步空间 · 已存 ' + its.length + '/' + GALLERY_MAX + ' 张 · ' + usage.text + (usage.near ? '（建议备份）' : ''); }
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
    $('#galClose')?.addEventListener('click', closeModal);
    const galleryAdd = $('#galAdd');
    galleryAdd?.addEventListener('click', () => runSubmission(galleryAdd, async () => {
      const url = $('#galUrl').value.trim();
      const cap = $('#galCap').value.trim();
      const file = $('#galFile').files[0];
      const safeUrl = textWithinLimit(url, TEXT_LIMITS.imageUrl, '图片链接');
      const safeCaption = textWithinLimit(cap, TEXT_LIMITS.photoCaption, '照片说明');
      if (safeUrl === null || safeCaption === null) return false;
      if (live(state.gallery).length >= GALLERY_MAX) {
        toast('最多只能保存 ' + GALLERY_MAX + ' 张照片，请先删除', 'error');
        return false;
      }
      if (file) {
        try {
          toast('压缩中...');
          const dataUrl = await compressRoomImage(file);
          // 旧相册入口也必须复用统一存储策略：已加入 Worker 房间时上传到 R2，
          // 仅离线或未加入房间时才保留压缩 data URL，避免兼容入口重新撑大 KV 快照。
          const stored = await storeRoomImage(dataUrl);
          if (!stored) return false;
          state.gallery.push({ id: uid(), dataUrl: stored.dataUrl || '', url: stored.url || '', caption: safeCaption, createdAt: Date.now(), updatedAt: Date.now() });
        } catch (error) {
          toast(error && error.message ? error.message : '图片处理失败', 'error');
          return false;
        }
      } else if (safeUrl) {
        state.gallery.push({ id: uid(), dataUrl: '', url: safeUrl, caption: safeCaption, createdAt: Date.now(), updatedAt: Date.now() });
      } else {
        toast('请选择图片或填链接', 'error');
        return false;
      }
      save(); renderList(); renderGallerySlider(); scheduleRoomPush(); toast('已添加 ✨');
      return true;
    }, 'legacy-gallery-add'));
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
      // 按天分组：今天 / 昨天 / M月D日
      const dayLabel = (ts) => {
        const d = new Date(ts), t = new Date();
        const k = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
        const tk = t.getFullYear() + '-' + t.getMonth() + '-' + t.getDate();
        const y = new Date(t.getTime() - 86400000);
        const yk = y.getFullYear() + '-' + y.getMonth() + '-' + y.getDate();
        if (k === tk) return '今天';
        if (k === yk) return '昨天';
        return (d.getMonth() + 1) + '月' + d.getDate() + '日';
      };
      let lastDay = '', html = '';
      items.forEach(m => {
        const label = dayLabel(m.createdAt);
        if (label !== lastDay) { html += '<div class="msg-day">' + label + '</div>'; lastDay = label; }
        const who = m.author === 'a' ? partners.a : partners.b;
        const mine = m.author === me;
        html += '<div class="msg-item ' + (mine ? 'mine' : '') + '">' +
          '<div class="msg-meta"><span class="msg-author">' + escapeHtml(who) + '</span><span class="msg-time">' + fmtTime(m.createdAt) + '</span>' + (mine ? messageReceiptMarkup(m.id) : '') + '</div>' +
          '<div class="msg-text">' + escapeHtml(m.text) + '</div>' +
          (m.image ? '<img class="msg-image" src="' + escapeHtml(m.image) + '" alt="留言图片">' : '') +
          (mine ? '<button class="msg-del" data-id="' + m.id + '" title="删除">✕</button>' : '') +
        '</div>';
      });
      list.innerHTML = html;
      list.scrollTop = list.scrollHeight;
    }
    $$('#msgIdentitySeg .seg-btn').forEach(b => b.classList.toggle('active', b.dataset.me === me));
    // 进入留言页即视为已读，清零未读角标
    markMessagesRead();
  }
  function sendMessage() {
    const ta = $('#msgInput');
    const text = ta.value.trim();
    if (!text) { toast('写点什么吧', 'error'); return; }
    const safeText = textWithinLimit(text, TEXT_LIMITS.message, '留言');
    if (safeText === null) return;
    const message = { id: uid(), author: state.settings.me || 'a', text: safeText, createdAt: Date.now(), updatedAt: Date.now() };
    state.messages.push(message);
    markPendingMessage(message.id);
    save(); ta.value = ''; renderMessages(); toast(roomActive() ? '已保存，正在同步' : '已保存到本机');
  }

  // ==========================================
  // 5.5 心愿墙（两人共享，可匿名偷偷写）
  // ==========================================
  const WISH_ICONS = ['✨','💖','🌟','🌈','🍀','🎁','🌸','🦋','🌙','🔥'];
  const WISH_ICON_TIP = { '✨':'星光','💖':'爱心','🌟':'星星','🌈':'彩虹','🍀':'幸运','🎁':'礼物','🌸':'花','🦋':'蝴蝶','🌙':'月亮','🔥':'热情' };
  const WISH_COLORS = ['peach','mint','sky','lilac','lemon'];

  function renderWishes() {
    const wall = $('#wishWall');
    if (!wall) return;
    const me = state.settings.me || 'a';
    const partners = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const items = live(state.wishes).slice().sort((a, b) => b.createdAt - a.createdAt);
    if (items.length === 0) {
      wall.innerHTML =
        '<div class="wish-empty">' +
          '<div class="we-glow"><span class="we-icon">🛎️</span></div>' +
          '<div class="we-title">心愿墙还是空的</div>' +
          '<div class="we-sub">偷偷写下你的小心愿<br>等 TA 来点亮 ✨</div>' +
          '<button class="pixel-btn primary" id="wishEmptyBtn">✍️ 写第一个心愿</button>' +
        '</div>';
      const wb = $('#wishEmptyBtn');
      if (wb) wb.addEventListener('click', openWishModal);
      return;
    }
    wall.innerHTML = items.map(w => {
      const who = w.anonymous ? '匿名' : (w.author === 'a' ? partners.a : partners.b);
      const whoIcon = w.anonymous ? '🤫' : '👤';
      const mine = w.author === me;
      // 点亮反馈：被 TA 点亮后显示；自己写的心愿不显示点亮按钮
      const litCtrl = w.lit
        ? '<span class="wish-lit">已被 TA 看到 💗</span>'
        : (mine ? '' : '<button class="wish-lit-btn" data-act="lit-wish" data-id="' + w.id + '" title="点亮 TA 的心愿">点亮 🛎️</button>');
      return '<div class="wish-note note-' + (w.color || 'peach') + '"' + (w.tilt ? ' style="--tilt:' + w.tilt + 'deg"' : '') + '>' +
        '<div class="wish-pin"></div>' +
        '<div class="wish-icon">' + (w.icon || '✨') + '</div>' +
        '<div class="wish-text">' + escapeHtml(w.text) + '</div>' +
        '<div class="wish-foot">' +
          '<span class="wish-who">' + whoIcon + ' ' + escapeHtml(who) + '</span>' +
          litCtrl +
          '<span class="wish-date">' + monthDay(w.createdAt) + '</span>' +
          (mine ? '<button class="wish-del" data-act="del-wish" data-id="' + w.id + '" title="撕掉这张心愿">✕</button>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function openWishModal() {
    const opts = WISH_ICONS.map((i, idx) =>
      '<button class="wish-icon-opt' + (idx === 0 ? ' sel' : '') + '" data-icon="' + i + '" title="' + (WISH_ICON_TIP[i] || '') + '">' + i + '</button>'
    ).join('');
    openModal({
      title: '🛎️ 写下一个心愿',
      body: '<div class="form-row">' +
        '<label>心愿内容</label>' +
        '<textarea class="pixel-textarea" id="wishText" placeholder="比如：想去海边看一次日出 🌅" maxlength="120"></textarea>' +
        '<div class="file-hint">不超过 120 字，写点真心话</div>' +
      '</div>' +
      '<div class="form-row">' +
        '<label>配个小图标</label>' +
        '<div class="wish-icon-pick" id="wishIconPick">' + opts + '</div>' +
      '</div>' +
      '<div class="checkbox-row">' +
        '<label class="switch"><input type="checkbox" id="wishAnonymous" checked /><span></span>匿名写下（不显示名字）</label>' +
      '</div>',
      foot: '<button class="pixel-btn ghost" data-act="modal-cancel">取消</button>' +
            '<button class="pixel-btn primary" id="wishSubmit">贴上心愿墙 ✨</button>'
    });
    // 图标选择
    $$('#wishIconPick .wish-icon-opt').forEach(b => b.addEventListener('click', () => {
      $$('#wishIconPick .wish-icon-opt').forEach(x => x.classList.remove('sel'));
      b.classList.add('sel');
    }));
    const wishSubmit = $('#wishSubmit');
    const submitWishOnce = () => runSubmission(wishSubmit, () => submitWish(), 'legacy-wish-submit');
    wishSubmit?.addEventListener('click', submitWishOnce);
    const cancel = $('[data-act="modal-cancel"]');
    if (cancel) cancel.addEventListener('click', closeModal);
    const ta = $('#wishText');
    if (ta) {
      ta.focus();
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitWishOnce(); });
    }
  }

  function submitWish() {
    const ta = $('#wishText');
    const text = ta.value.trim();
    if (!text) { toast('写点什么吧', 'error'); return; }
    const safeText = textWithinLimit(text, TEXT_LIMITS.wish, '心愿');
    if (safeText === null) return;
    const sel = $('#wishIconPick .wish-icon-opt.sel');
    state.wishes.push({
      id: uid(),
      text: safeText,
      icon: sel ? sel.dataset.icon : '✨',
      anonymous: $('#wishAnonymous') ? $('#wishAnonymous').checked : true,
      author: state.settings.me || 'a',
      color: WISH_COLORS[Math.floor(Math.random() * WISH_COLORS.length)],
      tilt: (Math.random() * 8 - 4).toFixed(1),
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    save(); closeModal(); renderWishes(); scheduleRoomPush(); toast('心愿已贴上 ✨');
  }

  // 心愿墙按钮与删除/点亮事件（只绑一次）
  const addWishBtn = $('#addWishBtn');
  if (addWishBtn) addWishBtn.addEventListener('click', openWishModal);
  document.addEventListener('click', (e) => {
    const wd = e.target.closest('[data-act="del-wish"]');
    if (wd) {
      const w = state.wishes.find(x => x.id === wd.dataset.id);
      if (w) { w.deleted = true; w.updatedAt = Date.now(); }
      save(); renderWishes(); scheduleRoomPush(); toast('已撕掉这张心愿');
    }
    const lit = e.target.closest('[data-act="lit-wish"]');
    if (lit) {
      const w = state.wishes.find(x => x.id === lit.dataset.id);
      if (w && !w.lit) { w.lit = true; w.litAt = Date.now(); w.updatedAt = Date.now(); }
      save(); renderWishes(); scheduleRoomPush(); toast('已点亮 TA 的心愿 💗');
    }
  });

  // 留言板 / 照片管理 事件绑定（脚本加载时只绑一次）
  const msgSendBtn = $('#msgSend');
  if (msgSendBtn) msgSendBtn.addEventListener('click', () => runSubmission(msgSendBtn, () => sendMessage(), 'legacy-message-send'));
  // 系统通知开关
  const msgNotifyBtn = $('#msgNotifyToggle');
  if (msgNotifyBtn) msgNotifyBtn.addEventListener('click', () => {
    const on = state.settings.notifySystem === false; // 当前为关 → 切换为开
    state.settings.notifySystem = on;
    save();
    if (on) {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(p => {
          toast(p === 'granted' ? '系统通知已开启 🔔' : '已开启红点提醒（系统通知未授权）', p === 'granted' ? 'success' : 'info');
          updateTitleBadge();
        }).catch(() => { toast('系统通知已开启 🔔'); });
      } else if ('Notification' in window && Notification.permission === 'granted') {
        toast('系统通知已开启 🔔');
      } else if ('Notification' in window && Notification.permission === 'denied') {
        toast('系统通知被浏览器拒绝：点地址栏左侧图标 → 网站设置 → 通知 → 允许', 'info');
      } else {
        toast('已开启红点提醒（当前浏览器不支持系统通知，手机可留意标题角标）', 'info');
      }
    } else {
      toast('系统通知已关闭');
    }
    updateMsgNotifyBtn();
  });
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
      changeIdentity(seg.dataset.me).then(() => renderMessages());
    }
  });

  // ==========================================
  // 11c. 吃什么（已下线：功能移除，保留默认菜单数据层供同步兼容）
  // ==========================================
  function defaultMeals() {
    const names = ['火锅', '麻辣烫', '烧烤', '日料', '汉堡', '披萨', '盖浇饭', '面条', '沙拉', '饺子', '黄焖鸡', '螺蛳粉'];
    const now = Date.now();
    // 用稳定 id（基于菜名），否则每次部署/清缓存都会生成新 id，
    // 与云端已同步的默认项 id 不同，mergeArr 不去重 → 默认菜单层层叠加
    return names.map(n => ({ id: 'm-def-' + n, name: n, createdAt: now, updatedAt: now, deleted: false }));
  }
  // 按菜名去重：同名只保留第一条未删除的，其余软删除。返回被清理的条数
  function dedupeMeals(arr) {
    const list = arr || state.meals;
    const seen = new Map();
    let removed = 0;
    (list || []).forEach(m => {
      if (m.deleted) return;
      if (seen.has(m.name)) { m.deleted = true; m.updatedAt = Date.now(); removed++; }
      else seen.set(m.name, m);
    });
    return removed;
  }

  // 💧 饮水记录：新版本按条目保存，避免两台设备同时记录时互相覆盖。
  const WATER_GOAL_ML = 1500;
  const DRINK_WARN_ML = 500;
  const DEFAULT_HYDRATION_ML = 500;
  // 旧数字 → 双人对象（历史共享值归 a）
  function normWater(v) {
    if (v && typeof v === 'object') return { a: Number(v.a) || 0, b: Number(v.b) || 0 };
    return { a: (typeof v === 'number' ? v : 0), b: 0 };
  }
  function migrateLegacyWater() {
    if (!Array.isArray(state.hydrationLog)) state.hydrationLog = [];
    const known = new Set(state.hydrationLog.map(item => item && item.id));
    Object.entries(state.water && typeof state.water === 'object' ? state.water : {}).forEach(([date, value]) => {
      const legacy = normWater(value);
      ['a', 'b'].forEach(person => {
        const ml = Math.max(0, Math.round(Number(legacy[person]) || 0) * 250);
        const id = `hydration-legacy-${date}-${person}`;
        if (!ml || known.has(id)) return;
        const createdAt = new Date(`${date}T12:00:00`).getTime() || 1;
        state.hydrationLog.push({ id, author: person, kind: 'water', ml, date, legacy: true, createdAt, updatedAt: createdAt, deleted: false });
        known.add(id);
      });
    });
  }
  function hydrationTotals(person = state.settings.me || 'a', date = todayKey()) {
    return (state.hydrationLog || []).reduce((total, item) => {
      if (!item || item.deleted || item.author !== person || item.date !== date) return total;
      const kind = item.kind === 'drink' ? 'drink' : 'water';
      total[kind] += Math.max(0, Number(item.ml) || 0);
      return total;
    }, { water: 0, drink: 0 });
  }
  function addHydration(kind, amount) {
    const type = kind === 'drink' ? 'drink' : 'water';
    const ml = Math.round(Number(amount));
    if (!Number.isFinite(ml) || ml < 1 || ml > 3000) {
      toast('请输入 1–3000 ml 的饮用量', 'error');
      return false;
    }
    const now = Date.now();
    state.hydrationLog.push({ id: uid(), author: state.settings.me || 'a', kind: type, ml, date: todayKey(), createdAt: now, updatedAt: now, deleted: false });
    save();
    const total = hydrationTotals();
    if (type === 'water' && total.water >= WATER_GOAL_ML && total.water - ml < WATER_GOAL_ML) toast('今天的喝水目标完成啦 💧🎉');
    else if (type === 'drink' && total.drink > DRINK_WARN_ML && total.drink - ml <= DRINK_WARN_ML) toast('今天饮料有点多啦，接下来喝水吧', 'info');
    else toast(`已记录 ${ml} ml ${type === 'water' ? '水' : '饮料'}`);
    return true;
  }
  function deleteHydration(id) {
    const item = (state.hydrationLog || []).find(entry => entry && entry.id === id && !entry.deleted);
    if (!item) return false;
    item.deleted = true;
    item.updatedAt = Date.now();
    save();
    return true;
  }
  // 兼容旧入口：加一杯改为 500 ml；减一杯改为撤销今天最近一条水记录。
  function addWater(delta) {
    if (Number(delta) > 0) return addHydration('water', DEFAULT_HYDRATION_ML);
    const me = state.settings.me || 'a';
    const latest = (state.hydrationLog || []).filter(item => item && !item.deleted && item.author === me && item.kind === 'water' && item.date === todayKey()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    if (latest) deleteHydration(latest.id);
    return !!latest;
  }
  function todayWater() {
    const totals = hydrationTotals();
    return { a: state.settings.me === 'b' ? 0 : totals.water, b: state.settings.me === 'b' ? totals.water : 0 };
  }
  function renderWater() {
    const w = hydrationTotals();
    const me = state.settings.me || 'a';
    const ta = me === 'a' ? 'b' : 'a';
    const partners = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const c = w.water, tc = hydrationTotals(ta).water;
    const $ = (id) => document.querySelector(id);
    const cnt = $('#waterCount');
    if (cnt) {
      // 只更新首个文本节点（保留后面的 <span class="water-unit">/8杯</span>）
      if (cnt.firstChild && cnt.firstChild.nodeType === 3) cnt.firstChild.nodeValue = Math.round(c / 250);
      else cnt.textContent = Math.round(c / 250); // 兜底
    }
    const taEl = $('#waterTaText');
    if (taEl) taEl.textContent = `${partners[ta]} ${tc} ml`;
    const fill = $('#waterFill');
    if (fill) fill.style.width = Math.min(100, Math.round(c / WATER_GOAL_ML * 100)) + '%';
  }
  const wm = $('#waterMinus'), wp = $('#waterPlus');
  if (wm) wm.addEventListener('click', () => addWater(-1));
  if (wp) wp.addEventListener('click', () => addWater(1));

  // ==========================================
  // 3. Toast
  // ==========================================
  let toastTimer = null;
  function toast(msg, type = 'success') {
    const el = $('#toast');
    el.textContent = msg;
    el.title = msg;
    el.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = 'toast'; }, 2200);
  }

  // ==========================================
  // 3b. 留言通知 A+B 方案
  //   A = toast 提示 + 导航红点未读角标
  //   B = 浏览器系统通知（Notification API，可开关）
  // ==========================================
  function isMessagesActive() {
    if (document.querySelector('.life-sheet-mask.show .life-chat-sheet')) return true;
    const a = document.querySelector('.nav-item.active');
    return !!(a && a.dataset.page === 'messages');
  }

  function persistUnreadMessages() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { console.warn('Unread message persistence failed', error); }
  }

  function markMessagesRead() {
    const changed = Number(state.settings.unreadMsgCount || 0) > 0;
    state.settings.unreadMsgCount = 0;
    if (changed) persistUnreadMessages();
    updateMsgBadge();
    updateTitleBadge();
    return changed;
  }

  // 在留言导航项（桌面侧边栏 + 移动底部栏）上渲染未读红点
  function updateMsgBadge() {
    const count = state.settings.unreadMsgCount || 0;
    $$('.nav-item[data-page="messages"], .bn-item[data-page="messages"]').forEach(el => {
      let b = el.querySelector('.msg-badge');
      if (!b) {
        b = document.createElement('span');
        b.className = 'msg-badge';
        el.appendChild(b);
      }
      if (count > 0) { b.textContent = count > 99 ? '99+' : String(count); b.hidden = false; }
      else { b.hidden = true; }
    });
  }

  // 收到对方新留言时：新版界面显示可点开的站内卡片，旧界面保留 toast；
  // 未读数只记在当前设备，系统通知与 Web Push 仍互相去重。
  function notifyNewMessages(messages) {
    const incoming = Array.isArray(messages) ? messages.filter(Boolean) : [];
    if (!incoming.length) return [];
    const viewingMessages = isMessagesActive();
    const m = incoming[incoming.length - 1];
    const partners = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const who = (m.author === 'a' ? partners.a : partners.b) || 'TA';
    const text = m.text || (m.image ? '发来了一张照片' : '发来一条新留言');
    if (!viewingMessages) {
      state.settings.unreadMsgCount = Number(state.settings.unreadMsgCount || 0) + incoming.length;
      persistUnreadMessages();
      updateMsgBadge();
      updateTitleBadge();
    }
    window.dispatchEvent(new CustomEvent('puffer-new-messages', {
      detail: { messages: incoming, count: incoming.length, viewingMessages }
    }));
    if (!document.getElementById('lifeApp') && !viewingMessages) {
      toast('💬 ' + who + '：' + (text.length > 16 ? text.slice(0, 16) + '…' : text), 'info');
    }
    // B：浏览器系统通知
    try {
      if (!viewingMessages && state.settings.notifySystem !== false && 'Notification' in window) {
        if (Notification.permission === 'granted' && localStorage.getItem('puffer-push-enabled') !== '1') {
          // Web Push already displays this item through service-worker.js.
          // Keep the in-page toast but avoid a second system notification.
          const title = incoming.length > 1 ? `💬 ${incoming.length} 条新留言 · ${who}` : `💬 新留言 · ${who}`;
          const n = new Notification(title, { body: text, tag: `puffer-messages-${m.id}` });
          n.onclick = () => { try { window.focus(); } catch (e) {} if (document.getElementById('lifeApp')) window.dispatchEvent(new CustomEvent('puffer-life-messages')); else goPage('messages'); n.close(); };
        } else if (Notification.permission === 'default') {
          // 轮询回调里 requestPermission 无用户手势会被浏览器忽略，这里改为引导用户去开启
          if (!document.getElementById('lifeApp') && !state.settings._notifyHintShown) {
            state.settings._notifyHintShown = true;
            save({ silent: true });
            toast('收到新留言啦～点留言板右上角 🔔 可开启系统通知', 'info');
          }
        } else if (Notification.permission === 'denied') {
          if (!document.getElementById('lifeApp') && !state.settings._notifyHintDeniedShown) {
            state.settings._notifyHintDeniedShown = true;
            save({ silent: true });
            toast('系统通知被浏览器拒绝：点地址栏左侧图标 → 网站设置 → 通知 → 允许', 'info');
          }
        }
      }
    } catch (e) { /* 系统通知不可用则忽略，仅保留 A/C 方案 */ }
    return incoming;
  }

  // 标题未读角标：后台/最小化时也能看到有新留言（不依赖系统通知权限）
  const BASE_TITLE = document.title;
  function updateTitleBadge() {
    const n = state.settings.unreadMsgCount || 0;
    document.title = (n > 0 && !isMessagesActive()) ? '💌(' + n + ') ' + BASE_TITLE : BASE_TITLE;
  }

  // 反映系统通知开关按钮状态
  function updateMsgNotifyBtn() {
    const b = $('#msgNotifyToggle');
    if (b) b.classList.toggle('active', state.settings.notifySystem !== false);
  }

  // ==========================================
  // 4. 模态框
  // ==========================================
  function openModal({ title, body, foot, onClose }) {
    const wasOpen = $('#modalMask').classList.contains('show');
    $('#modalTitle').textContent = title;
    $('#modalBody').innerHTML = body;
    $('#modalFoot').innerHTML = foot || '';
    $('#modal').classList.toggle('settings-modal', body.includes('settings-layout'));
    $('#modalMask').classList.add('show');
    if (onClose) $('#modalMask').dataset.closeHook = '1';
    else delete $('#modalMask').dataset.closeHook;
    if (!wasOpen) window.dispatchEvent(new CustomEvent('puffer-modal-open'));
  }
  function closeModal() {
    const wasOpen = $('#modalMask').classList.contains('show');
    $('#modalMask').classList.remove('show');
    $('#modal').classList.remove('settings-modal');
    $('#modalBody').innerHTML = '';
    $('#modalFoot').innerHTML = '';
    if (wasOpen) window.dispatchEvent(new CustomEvent('puffer-modal-close'));
  }
  $('#modalClose')?.addEventListener('click', closeModal);
  $('#modalMask')?.addEventListener('click', (e) => {
    if (e.target.id === 'modalMask') closeModal();
  });

  // ==========================================
  // 5. 仪表板
  // ==========================================
  function updateOwnerUI() {
    const p = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const sub = $('#brandSub');
    if (sub) sub.textContent = `${p.a} & ${p.b} 的小窝`;
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


    // 本周完成动作数（按训练记录里每行动作统计，不再按"天"）
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - wk);
    weekStart.setHours(0,0,0,0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 7);
    const weekActions = state.trainings.reduce((sum, t) => {
      if (t.deleted) return sum;
      const td = new Date(t.date);
      if (td < weekStart || td >= weekEnd) return sum;
      const lines = (t.content || '').split('\n').map(s => s.trim()).filter(Boolean);
      return sum + lines.length;
    }, 0);
    $('#statWeek').textContent = weekActions;

    // 喝水记录
    renderWater();

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
    mascotGreeting = `${p.a}、${p.b}，${greet}`;
    $('#mascotBubble').textContent = mascotGreeting;
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
    if (isLifeMode()) return;
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

  // 待办日期友好格式化：今年内 → "M月D日"，跨年 → "YYYY年M月D日"
  function fmtMDate(s) {
    if (!s) return '';
    const p = s.split('-');
    const y = +p[0], m = +p[1], d = +p[2];
    if (y !== new Date().getFullYear()) return y + '年' + m + '月' + d + '日';
    return m + '月' + d + '日';
  }
  // 待办排序：有日期的按日期近→远（未到期在前，过期的最前）；无日期的排最后，按创建时间新→旧
  function sortTodos(arr) {
    return arr.slice().sort((a, b) => {
      const ad = a.date ? new Date(a.date + 'T00:00:00').getTime() : Infinity;
      const bd = b.date ? new Date(b.date + 'T00:00:00').getTime() : Infinity;
      if (ad !== bd) return ad - bd;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  }

  function renderTodo() {
    const list = $('#todoList');
    let items = sortTodos(live(state.todos));
    if (todoFilter === 'active') items = items.filter(t => !t.done);
    if (todoFilter === 'done') items = items.filter(t => t.done);
    if (calSelected) items = items.filter(t => t.date === calSelected); // 选中日期时只看那一天
    renderTodoDayBar();

    if (items.length === 0) {
      list.innerHTML = `<li class="todo-empty">${live(state.todos).length === 0 ? '还没有待办，点 + 新建一个吧 ✨' : (calSelected ? '这一天还没有待办，点上面「+ 加待办」✨' : '当前筛选下没有待办')}</li>`;
      return;
    }
    list.innerHTML = items.map(t => `
      <li class="todo-item ${t.done ? 'done' : ''}" data-id="${t.id}">
        <span class="todo-check ${t.done ? 'done' : ''}" data-act="toggle"></span>
        <div class="ti-main">
          <div class="ti-text">${escapeHtml(t.text)}</div>
          <div class="ti-meta">
            ${t.date ? `<span class="ti-date">📅 ${fmtMDate(t.date)}</span>` : ''}
            ${t.priority && t.priority !== 'none' ? `<span class="ti-prio ${t.priority}">${t.priority === 'high' ? '高优先级' : t.priority === 'mid' ? '中优先级' : '低优先级'}</span>` : ''}
          </div>
        </div>
        <div class="ti-actions">
          <button data-act="edit" title="编辑">✎</button>
          <button data-act="cal" class="cal" title="添加到 iOS 日历">📱</button>
          <button data-act="del" class="del" title="删除">🗑</button>
        </div>
      </li>
    `).join('');
  }

  // 待办日历页：月历 + 待办列表一起渲染
  function renderTodoPage() {
    renderCalendar();
    renderTodo();
  }

  // 选中日期时的顶部提示条（含纪念日横幅 / 显示全部 / 加待办）
  function renderTodoDayBar() {
    const bar = $('#todoDayBar');
    if (!bar) return;
    if (!calSelected) { bar.hidden = true; bar.innerHTML = ''; return; }
    bar.hidden = false;
    const parts = calSelected.split('-');
    const y = +parts[0], m = +parts[1], d = +parts[2];
    const dateLabel = `${y}年${m}月${d}日`;
    const isAnni = (m === 12 && d === 4);
    const anniDays = isAnni ? Math.max(0, Math.floor((new Date(y, 11, 4) - new Date(2023, 11, 4)) / 86400000)) : 0;
    const count = live(state.todos).filter(t => t.date === calSelected).length;
    bar.innerHTML =
      (isAnni ? `<div class="cal-anni-banner" style="margin-bottom:10px;">💞 这是你们的纪念日！在一起的第 ${anniDays} 天</div>` : '') +
      `<div class="todo-day-bar">
        <span class="tdb-label">📅 ${dateLabel} 的待办（${count} 条）</span>
        <button class="pixel-btn ghost" id="calClearBtn">显示全部</button>
        <button class="pixel-btn primary" id="calDayAdd">+ 加待办</button>
      </div>`;
    const clearBtn = $('#calClearBtn');
    if (clearBtn) clearBtn.addEventListener('click', clearCalSelect);
    const addBtn = $('#calDayAdd');
    if (addBtn) addBtn.addEventListener('click', () => openTodoModal(null, calSelected));
  }

  // 点击月历某天：页内过滤待办列表
  function selectCalDay(key) {
    calSelected = key;
    renderCalendar();
    renderTodo();
  }
  function clearCalSelect() {
    calSelected = null;
    renderCalendar();
    renderTodo();
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
    $('#todoCancel')?.addEventListener('click', closeModal);
    const todoSave = $('#todoSave');
    todoSave?.addEventListener('click', () => runSubmission(todoSave, () => {
      const text = $('#todoText').value.trim();
      const p = (document.querySelector('input[name="prio"]:checked') || {}).value || 'none';
      const date = $('#todoDate').value.trim();
      if (!text) { toast('内容不能为空', 'error'); return; }
      const safeText = textWithinLimit(text, TEXT_LIMITS.todo, '待办');
      if (safeText === null) return;
      if (editing) {
        editing.text = safeText;
        editing.priority = p;
        editing.date = date || '';
        editing.updatedAt = Date.now();
      } else {
        state.todos.push({ id: uid(), author: state.settings.me || 'a', text: safeText, priority: p, date: date || '', done: false, createdAt: Date.now(), updatedAt: Date.now() });
      }
      save();
      closeModal();
      renderTodo();
      renderCalendar();
      toast(editing ? '已更新' : '已添加');
      return true;
    }, 'legacy-todo-save'));
  }

  $('#addTodoBtn')?.addEventListener('click', () => openTodoModal());
  $('#exportCalBtn')?.addEventListener('click', () => {
    const dated = live(state.todos).filter(t => t.date);
    if (!dated.length) { toast('还没有带日期的待办，先在待办里选个日期', 'error'); return; }
    exportTodosToCalendar(dated, '河豚工作台待办');
  });

  // 列表交互
  $('#todoList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.todo-item');
    if (!item) return;
    const id = item.dataset.id;
    const act = e.target.dataset.act;
    if (act === 'toggle') {
      const t = state.todos.find(x => x.id === id);
      if (!t) return;
      t.done = !t.done;
      t.updatedAt = Date.now();
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

  // 日历导航与点击（合并进待办页：点击日期 → 页内过滤）
  const calPrev = $('#calPrev'), calNext = $('#calNext'), calToday = $('#calToday');
  if (calPrev) calPrev.addEventListener('click', () => { calMonth--; if (calMonth < 0) { calMonth = 11; calYear--; } clearCalSelect(); });
  if (calNext) calNext.addEventListener('click', () => { calMonth++; if (calMonth > 11) { calMonth = 0; calYear++; } clearCalSelect(); });
  if (calToday) calToday.addEventListener('click', () => { const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth(); clearCalSelect(); });
  const calGrid = $('#calGrid');
  if (calGrid) calGrid.addEventListener('click', (e) => {
    const cell = e.target.closest('[data-date]');
    if (cell) selectCalDay(cell.dataset.date);
  });

  // ==========================================
  // 6.5 每日星座（双子座 × 天秤座）+ 祈福抽签
  // ==========================================
  const HOROS = {
    gemini: { name: '双子座', icon: '♊', dates: '5.21 - 6.21', tag: '灵动 · 好奇 · 百变', cls: 'sign-gemini' },
    libra:  { name: '天秤座', icon: '♎', dates: '9.23 - 10.23', tag: '优雅 · 平衡 · 温柔', cls: 'sign-libra' },
  };
  const HORO_OVERALL = [
    '今天状态在线，适合把积压的事一件件清掉，效率会比想象中高。',
    '心情像天气一样明亮，遇到的每个人都会对你好一点。',
    '有一点小懒散，但没关系，今天更适合慢下来整理自己。',
    '灵感很多，想到什么就记下来，说不定就是好点子。',
    '今天适合把话说开，坦诚会让关系更轻松。',
    '能量满满的一天，去完成一件一直拖着的事吧。',
    '今天适合安静独处一小会儿，充电后再出发。',
    '小惊喜可能在今天出现，留意身边的小确幸。',
  ];
  const HORO_LOVE = [
    '和 TA 相处特别舒服，一起做顿饭或散个步都是好选择。',
    '今天很适合表达心意，一句「想你了」就能点亮彼此。',
    '小摩擦容易发生，但一个拥抱就能化解。',
    '你们之间的默契越来越深，不用说都懂。',
    '今天适合聊聊未来，两个人一起规划很幸福。',
    '平淡里藏着温柔，记得多夸夸 TA。',
    '晚上可以一起看看月亮，讲讲心里话。',
    'TA 今天比平时更依赖你，多陪陪 TA。',
  ];
  const HORO_CAREER = [
    '专注力在线，重要的事放在上午做效率最高。',
    '团队协作顺利，你的想法容易被认可。',
    '今天适合整理和复盘，别急着往前冲。',
    '多任务有点缠人，一件一件来会更稳。',
    '灵感突现，创意工作者的高光日。',
    '沟通上多听少说，会有意外收获。',
    '适合学点新东西，为以后铺路。',
    '任务不急的话，今天可以把细节打磨好。',
  ];
  const HORO_HEALTH = [
    '多喝水，久坐记得起来活动一下。',
    '今天适合散步或拉伸，身体会感谢你。',
    '早点睡，比什么补品都有效。',
    '注意肩颈，看屏幕久了眨眨眼。',
    '吃点清淡的，给肠胃放个假。',
    '情绪影响身体，今天保持好心情最重要。',
    '适合来一场小小的运动，出汗更舒畅。',
    '按时吃饭，别因为忙忘了照顾好自己。',
  ];
  const HORO_COLORS = ['珊瑚橙', '暖米', '薄荷绿', '天空蓝', '蜜桃粉', '薰衣草紫', '奶油黄', '燕麦棕'];

  // 基于日期+星座的稳定伪随机（每天固定，次日自动更换）
  function daySeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return (h >>> 0) / 4294967295;
  }
  function dailyHoroscope(sign) {
    const r = daySeed(todayKey() + ':' + sign);
    const pick = (arr) => arr[Math.floor(r * arr.length)];
    return {
      overall: pick(HORO_OVERALL),
      love: pick(HORO_LOVE),
      career: pick(HORO_CAREER),
      health: pick(HORO_HEALTH),
      color: pick(HORO_COLORS),
      num: 1 + Math.floor(r * 9),
      stars: 2 + Math.round(r * 3), // 2-5 星
    };
  }

  function renderHoroscope() {
    const grid = $('#horoGrid');
    if (!grid) return;
    const d = new Date();
    grid.innerHTML = ['gemini', 'libra'].map(sign => {
      const h = HOROS[sign];
      const f = dailyHoroscope(sign);
      const stars = '★'.repeat(f.stars) + '<span class="off">' + '★'.repeat(5 - f.stars) + '</span>';
      return `<div class="card pixel-border horo-card ${h.cls}">
        <div class="horo-head">
          <span class="horo-icon">${h.icon}</span>
          <div>
            <div class="horo-name">${h.name}<span class="horo-date">${h.dates}</span></div>
            <div class="horo-tag">${h.tag}</div>
          </div>
          <div class="horo-stars">${stars}</div>
        </div>
        <div class="horo-row"><span class="hr-label">综合</span><span>${f.overall}</span></div>
        <div class="horo-row"><span class="hr-label">爱情</span><span>${f.love}</span></div>
        <div class="horo-row"><span class="hr-label">事业</span><span>${f.career}</span></div>
        <div class="horo-row"><span class="hr-label">健康</span><span>${f.health}</span></div>
        <div class="horo-foot">🍀 幸运色 ${f.color} · 幸运数字 ${f.num}</div>
      </div>`;
    }).join('') +
    `<div class="horo-note">运势仅供今天参考 · ${d.getMonth() + 1}月${d.getDate()}日 · 明天自动更新 ✨</div>`;
  }

  // 祈福抽签：每日一次（温暖治愈签文库）
  const FORTUNE_SIGNS = [
    { level: '上上', cls: 'lv-upper', text: '时来运转，万事顺遂', tip: '今天适合迈出第一步，好运正站在你这边。' },
    { level: '上上', cls: 'lv-upper', text: '心有阳光，遇见美好', tip: '主动一点，惊喜就会靠近；保持微笑，好运自然来。' },
    { level: '上上', cls: 'lv-upper', text: '风起正当时', tip: '等待已久的转机在今天出现，大胆去做吧。' },
    { level: '上上', cls: 'lv-upper', text: '良缘相守，情意更浓', tip: '两个人的心今天贴得很近，好好珍惜这一刻。' },
    { level: '上', cls: 'lv-good', text: '稳步向前，心想事成', tip: '不急不躁，按自己的节奏走，结果不会差。' },
    { level: '上', cls: 'lv-good', text: '贵人相助，小步快跑', tip: '今天会遇到帮你的那个人，记得说谢谢。' },
    { level: '上', cls: 'lv-good', text: '平平淡淡，小确幸', tip: '没有大事，但处处都是小事里的甜。' },
    { level: '上', cls: 'lv-good', text: '柳暗花明，转念即通', tip: '卡住的事换个角度看，答案就在眼前。' },
    { level: '上', cls: 'lv-good', text: '心想之愿，正在路上', tip: '你惦记的那件事，正在朝你靠近。' },
    { level: '上', cls: 'lv-good', text: '家和万事兴', tip: '今天适合一起做点小事，感情在细节里升温。' },
    { level: '中', cls: 'lv-mid', text: '静待花开，不急于一时', tip: '耐心是今天的功课，慢一点反而更稳。' },
    { level: '中', cls: 'lv-mid', text: '小憩一下，再出发', tip: '累了就休息，充电后再走更快。' },
    { level: '中', cls: 'lv-mid', text: '以柔克刚', tip: '今天适合温和沟通，硬碰硬只会更累。' },
    { level: '中', cls: 'lv-mid', text: '脚踏实地，步步为营', tip: '别想太远，把今天做好就是最好的安排。' },
    { level: '中', cls: 'lv-mid', text: '随遇而安', tip: '计划赶不上变化时，顺其自然也是一种智慧。' },
    { level: '中', cls: 'lv-mid', text: '三思而后行', tip: '遇到选择别急着定，睡一觉再做决定。' },
    { level: '下', cls: 'lv-low', text: '小有波折，稳字当头', tip: '今天可能会有点小不顺，稳住心态就好，都会过去。' },
    { level: '下', cls: 'lv-low', text: '宜静不宜动', tip: '今天适合休息和整理，不适合做重大决定。' },
    { level: '下', cls: 'lv-low', text: '戒骄戒躁', tip: '越是着急越容易出错，深呼吸，放轻松。' },
    { level: '下', cls: 'lv-low', text: '有舍才有得', tip: '放下一点执念，腾出空间给更好的可能。' },
  ];

  // 祈福抽签：两人各自抽，各自可见（state.fortune = { date, by: { a, b } }）
  function renderFortune() {
    const body = $('#fortuneBody');
    if (!body) return;
    const today = todayKey();
    const me = state.settings.me || 'a';
    const ta = me === 'a' ? 'b' : 'a';
    const partners = state.settings.partners || { a: '孙大炮', b: '童大侠' };
    const st = state.fortune || {};
    const fresh = st.date === today;
    const mySign = (fresh && st.by && st.by[me]) || null;
    const taSign = (fresh && st.by && st.by[ta]) || null;
    const myHtml = mySign
      ? `<div class="fortune-bamboo">🎋</div><div class="ft-sign ${mySign.cls}">${mySign.level}签</div><div class="ft-text">${mySign.text}</div><div class="ft-tip">${mySign.tip}</div><div class="ft-date">今天已祈福 · 明天再来</div>`
      : `<div class="fortune-bamboo" id="fortuneBamboo">🎋</div><div class="fortune-done">${partners[me]}，闭上眼默念一件心愿，摇一摇这支签～</div><button class="pixel-btn primary fortune-pick" id="fortunePick">🙏 摇签</button>`;
    const taHtml = taSign
      ? `<div class="fortune-bamboo">🎋</div><div class="ft-sign ${taSign.cls}">${taSign.level}签</div><div class="ft-text">${taSign.text}</div><div class="ft-tip">${taSign.tip}</div><div class="ft-date">${partners[ta]} 今天抽到的签</div>`
      : `<div class="fortune-bamboo">🎋</div><div class="fortune-done">${partners[ta]} 今天还没抽签，等 TA 来摇～</div>`;
    body.innerHTML =
      `<div class="fortune-grid">
        <div class="fortune-col"><div class="fortune-title">${partners[me]} 的祈福</div>${myHtml}</div>
        <div class="fortune-col ta-col"><div class="fortune-title">${partners[ta]} 的祈福</div>${taHtml}</div>
      </div>`;
    const pick = $('#fortunePick');
    if (pick) pick.addEventListener('click', drawFortune);
  }

  function drawFortune() {
    const bamboo = $('#fortuneBamboo');
    if (bamboo) bamboo.classList.add('shake');
    setTimeout(() => {
      const idx = Math.floor(Math.random() * FORTUNE_SIGNS.length);
      const s = FORTUNE_SIGNS[idx];
      const me = state.settings.me || 'a';
      const today = todayKey();
      if (!state.fortune || state.fortune.date !== today) state.fortune = { date: today, by: { a: null, b: null } };
      state.fortune.by[me] = { level: s.level, cls: s.cls, text: s.text, tip: s.tip, ts: Date.now() };
      save(); renderFortune(); scheduleRoomPush(); // 同步给 TA 看到你抽的签
    }, 700);
  }

  // ==========================================
  // 7. 健身
  // ==========================================
  let fitnessSelDate = '';
  function shiftDateKey(key, delta) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);
    return `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
  }
  function formatDateLabel(key) {
    const [y, m, d] = key.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return `${m}月${d}日 ${weekName(dt.getDay())}`;
  }
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

    // 训练日记：按选中日期查看，可前后翻看每天
    if (!fitnessSelDate) fitnessSelDate = todayKey();
    const selList = live(state.trainings).filter(t => t.date === fitnessSelDate)
      .sort((a, b) => b.createdAt - a.createdAt);
    const selActions = selList.reduce((s, t) => s + (t.content || '').split('\n').map(x => x.trim()).filter(Boolean).length, 0);
    const selLabelEl = $('#trainSelDate');
    if (selLabelEl) selLabelEl.textContent = formatDateLabel(fitnessSelDate) + (fitnessSelDate === todayKey() ? ' · 今天' : '');
    const sumEl = $('#trainSummary');
    if (sumEl) sumEl.textContent = selList.length ? `${selList.length} 次训练 · ${selActions} 个动作` : '这天还没有训练记录';
    const tl = $('#trainList');
    if (selList.length === 0) {
      tl.innerHTML = '<li class="train-empty">这天还没记录，点右上角「+ 记录训练」补上吧 💪</li>';
    } else {
      tl.innerHTML = selList.map(t => {
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
                <span class="train-actions">
                  <button class="pill" data-act="edit-train">✎ 编辑</button>
                  <button class="pill del-btn" data-act="del-train">删除</button>
                </span>
              </div>
            </div>
          </li>
        `;
      }).join('');
    }
  }

  function openTrainModal(editId) {
    const editing = editId ? state.trainings.find(t => t.id === editId) : null;
    const d = new Date();
    const wk = d.getDay();
    const plan = state.fitnessPlan[wk];
    const today = todayKey();
    const defaultMuscle = plan.muscle === 'rest' ? '' : plan.name;
    const val = (k, fb) => editing ? (editing[k] || '') : fb;
    openModal({
      title: editing ? '✎ 编辑训练' : '💪 记录训练',
      body: `
        <div class="form-row">
          <label>训练部位</label>
          <input class="pixel-input" id="trainMuscle" value="${escapeHtml(val('muscle', defaultMuscle))}" placeholder="例：胸 + 肩 + 二头" />
        </div>
        <div class="form-row">
          <label>日期</label>
          <input class="pixel-input" type="date" id="trainDate" value="${editing ? editing.date : today}" />
        </div>
        <div class="form-row">
          <label>动作 / 组数 / 次数 / 重量（每行一个动作）</label>
          <textarea class="pixel-textarea" id="trainContent" placeholder="例：&#10;卧推 4×10 60kg&#10;上斜哑铃 3×12 25kg">${escapeHtml(val('content', ''))}</textarea>
        </div>
        <div class="form-row">
          <div class="row-2">
            <div>
              <label>总重量（可选）</label>
              <input class="pixel-input" id="trainWeight" placeholder="kg" value="${escapeHtml(val('weight', ''))}" />
            </div>
            <div>
              <label>总时长（可选）</label>
              <input class="pixel-input" id="trainDuration" placeholder="分钟" value="${escapeHtml(val('duration', ''))}" />
            </div>
          </div>
        </div>
        <div class="form-row">
          <label>备注</label>
          <input class="pixel-input" id="trainNote" placeholder="今天状态、感觉……" value="${escapeHtml(val('note', ''))}" />
        </div>
      `,
      foot: `
        <button class="pixel-btn ghost" id="trainCancel">取消</button>
        <button class="pixel-btn primary" id="trainSave">${editing ? '保存修改' : '保存记录'}</button>
      `
    });
    $('#trainCancel')?.addEventListener('click', closeModal);
    const trainSave = $('#trainSave');
    trainSave?.addEventListener('click', () => runSubmission(trainSave, () => {
      const muscle = $('#trainMuscle').value.trim();
      const date = $('#trainDate').value || today;
      const content = $('#trainContent').value.trim();
      const weight = $('#trainWeight').value.trim();
      const duration = $('#trainDuration').value.trim();
      const note = $('#trainNote').value.trim();
      if (!content) { toast('请填写训练内容', 'error'); return; }
      const safeMuscle = textWithinLimit(muscle, TEXT_LIMITS.trainingMeta, '训练部位');
      const safeContent = textWithinLimit(content, TEXT_LIMITS.trainingContent, '训练内容');
      const safeWeight = textWithinLimit(weight, TEXT_LIMITS.trainingMeta, '训练重量');
      const safeDuration = textWithinLimit(duration, TEXT_LIMITS.trainingMeta, '训练时长');
      const safeNote = textWithinLimit(note, TEXT_LIMITS.trainingNote, '训练备注');
      if ([safeMuscle, safeContent, safeWeight, safeDuration, safeNote].some(value => value === null)) return;
      if (editing) {
        Object.assign(editing, { muscle: safeMuscle, date, content: safeContent, weight: safeWeight, duration: safeDuration, note: safeNote, updatedAt: Date.now() });
      } else {
        state.trainings.push({
          id: uid(), muscle: safeMuscle, date, content: safeContent, weight: safeWeight, duration: safeDuration, note: safeNote,
          createdAt: Date.now(), updatedAt: Date.now()
        });
      }
      save(); closeModal(); renderFitness();
      toast(editing ? '已更新训练记录 ✏️' : '训练记录已保存 💪');
      return true;
    }, 'legacy-training-save'));
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
    $('#planReset')?.addEventListener('click', () => {
      Object.assign(state.fitnessPlan, defaultPlan);
      save(); closeModal(); renderFitness();
      toast('已恢复默认计划');
    });
    $('#planSave')?.addEventListener('click', () => {
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

  $('#addTrainBtn')?.addEventListener('click', () => openTrainModal());
  $('#openPlanBtn')?.addEventListener('click', openPlanModal);
  $('#trainPrev')?.addEventListener('click', () => { fitnessSelDate = shiftDateKey(fitnessSelDate || todayKey(), -1); renderFitness(); });
  $('#trainNext')?.addEventListener('click', () => { fitnessSelDate = shiftDateKey(fitnessSelDate || todayKey(), 1); renderFitness(); });
  $('#trainToday')?.addEventListener('click', () => { fitnessSelDate = todayKey(); renderFitness(); });

  $('#trainList')?.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-act]');
    if (!actBtn) return;
    const item = e.target.closest('.train-item');
    if (!item) return;
    const act = actBtn.dataset.act;
    if (act === 'del-train') {
      if (confirm('删除这条训练记录？')) {
        const tr = state.trainings.find(x => x.id === item.dataset.id);
        if (tr) { tr.deleted = true; tr.updatedAt = Date.now(); }
        save(); renderFitness();
        toast('已删除');
      }
    } else if (act === 'edit-train') {
      openTrainModal(item.dataset.id);
    }
  });

  // ==========================================
  // 11. 同步 / 数据管理
  // ==========================================
  let syncBusy = false;
  // Presence is deliberately kept outside the room payload: it must not create sync conflicts
  // or retain exact locations in shared history. The Worker stores only each person's latest point.
  let roomPresence = {};
  let roomPresenceDistanceKm = null;
  let presenceTimer = null;
  let lastPresenceLocation = null;
  let lastPresenceLocationAt = 0;
  const PRESENCE_INTERVAL_MS = 30000;
  const LOCATION_REFRESH_MS = 5 * 60 * 1000;
  const CLEANUP_QUEUE_KEY = 'puffer-remote-cleanup-v1';
  const presenceStorageKey = context => `puffer-location-share:${context?.id || 'local'}:${context?.person || 'a'}`;
  const presenceKey = () => presenceStorageKey(roomContext());
  const locationSharingEnabled = () => localStorage.getItem(presenceKey()) === '1';
  function roomContext(room = state.settings?.room, person = state.settings?.me || 'a') { const value=room||{}; return { backend:value.backend||'worker', url:String(value.url||''), id:String(value.id||''), pass:String(value.pass||''), person:String(person||'a') }; }
  function presenceUi() { const me=state.settings?.me||'a', ta=me==='a'?'b':'a', mine=roomPresence[me]||{}, partner=roomPresence[ta]||{}; return { mine:{ sharing:locationSharingEnabled(), hasLocation:!!mine.hasLocation, locationUpdatedAt:Number(mine.locationUpdatedAt)||0 }, partner:{ online:!!partner.online, lastSeen:Number(partner.lastSeen)||0, hasLocation:!!partner.hasLocation, locationUpdatedAt:Number(partner.locationUpdatedAt)||0, distanceKm:Number.isFinite(roomPresenceDistanceKm)?roomPresenceDistanceKm:null } }; }
  function emitPresence() { window.dispatchEvent(new CustomEvent('puffer-presence-change')); }
  function readCleanupQueue() { try { const value=JSON.parse(localStorage.getItem(CLEANUP_QUEUE_KEY)||'[]'); return Array.isArray(value)?value:[]; } catch (_) { return []; } }
  function writeCleanupQueue(items) { if(items.length)localStorage.setItem(CLEANUP_QUEUE_KEY,JSON.stringify(items.slice(-20)));else localStorage.removeItem(CLEANUP_QUEUE_KEY); }
  function queueCleanup(task) { const items=readCleanupQueue(), key=[task.type,task.url,task.id,task.person||'',task.endpoint||''].join('|'), next=items.filter(item=>[item.type,item.url,item.id,item.person||'',item.endpoint||''].join('|')!==key); next.push({...task,queuedAt:Date.now()}); writeCleanupQueue(next); }
  async function requestPresenceCleanup(context, removeRecord) { if(!context?.url||!context.id||!context.pass||context.backend==='supabase')return true; const endpoint=`${String(context.url).replace(/\/$/,'')}/api/v1/rooms/${encodeURIComponent(context.id)}/presence`, payload={pass:context.pass,person:context.person}; if(!removeRecord)payload.location=null; const res=await syncFetch(endpoint,{method:removeRecord?'DELETE':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},10000); return res.ok; }
  async function runCleanupTask(task) { try { if(task.type==='presence-delete'||task.type==='presence-clear')return await requestPresenceCleanup(task,task.type==='presence-delete'); if(task.type==='push-unsubscribe'&&task.endpoint&&window.PufferPush?.removeServer){await window.PufferPush.removeServer(task,task.endpoint);return true;} } catch (_) {} return false; }
  async function retryPendingCleanups() { if(navigator.onLine===false)return; const items=readCleanupQueue(); if(!items.length)return; const keep=[]; for(const item of items){if(!(await runCleanupTask(item)))keep.push(item);} writeCleanupQueue(keep); }
  async function cleanPresence(context, removeRecord) { try { if(await requestPresenceCleanup(context,removeRecord))return true; } catch (_) {} queueCleanup({...context,type:removeRecord?'presence-delete':'presence-clear'}); return false; }
  async function cleanPush(context) { if(!window.PufferPush?.disable)return true; try { await window.PufferPush.disable(context); return true; } catch(error) { if(error?.endpoint)queueCleanup({...context,type:'push-unsubscribe',endpoint:error.endpoint}); return false; } }
  async function cleanupRoomContext(context,{presence='delete',push=true}={}) { const tasks=[cleanPresence(context,presence==='delete')]; if(push)tasks.push(cleanPush(context)); const results=await Promise.all(tasks); return results.every(Boolean); }
  function applyPresenceResponse(body) { roomPresence={}; (body.presence||[]).forEach(item=>{roomPresence[item.person]={...item,hasLocation:!!(item.hasLocation||item.location),locationUpdatedAt:Number(item.locationUpdatedAt||item.location?.updatedAt)||0};}); roomPresenceDistanceKm=Number.isFinite(Number(body.distanceKm))&&body.distanceKm!==null?Number(body.distanceKm):null; emitPresence(); }
  async function sendPresence(location = undefined) { if (!roomActive()) return false; const context=roomContext(),session=roomSession; if (context.backend === 'supabase') return false; const base=String(context.url||'').replace(/\/$/, ''), endpoint=`${base}/api/v1/rooms/${encodeURIComponent(context.id)}/presence`; const payload={ pass:context.pass, person:context.person }; if (location !== undefined) payload.location=location; try { const res=await syncFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},10000); const body=await res.json().catch(()=>({})); if(!res.ok||session!==roomSession||!sameRoomContext(context,roomContext())) return false; applyPresenceResponse(body); return true; } catch (_) { return false; } }
  function refreshPresenceLocation(force=false) { if (!locationSharingEnabled()) return sendPresence(null); if (!force && lastPresenceLocation && Date.now()-lastPresenceLocationAt<LOCATION_REFRESH_MS) return sendPresence(lastPresenceLocation); if (!navigator.geolocation) return sendPresence(); navigator.geolocation.getCurrentPosition(pos=>{ if(!locationSharingEnabled()){sendPresence(null);return;} lastPresenceLocation={lat:pos.coords.latitude,lon:pos.coords.longitude}; lastPresenceLocationAt=Date.now(); sendPresence(lastPresenceLocation); },()=>sendPresence(),{enableHighAccuracy:false,maximumAge:LOCATION_REFRESH_MS,timeout:12000}); }
  function startPresencePolling() { if (presenceTimer) clearInterval(presenceTimer); refreshPresenceLocation(true); presenceTimer=setInterval(()=>refreshPresenceLocation(false),PRESENCE_INTERVAL_MS); }
  function stopPresencePolling() { if (presenceTimer) clearInterval(presenceTimer); presenceTimer=null; roomPresence={};roomPresenceDistanceKm=null;emitPresence(); }
  async function setLocationSharing(enabled) { if (enabled) { localStorage.setItem(presenceKey(),'1'); refreshPresenceLocation(true); return true; } const context=roomContext(); localStorage.removeItem(presenceKey()); lastPresenceLocation=null; lastPresenceLocationAt=0; roomPresenceDistanceKm=null; if(roomPresence[context.person]){roomPresence[context.person].hasLocation=false;roomPresence[context.person].locationUpdatedAt=0;}emitPresence();await cleanPresence(context,false);return false; }

  // 同步状态只保存在当前设备，不进入 serializeRoom()，避免两台设备互相覆盖各自的上传进度。
  function ensureRoomSyncMeta() {
    state.settings = state.settings || {};
    const room = state.settings.room = state.settings.room || { backend: 'worker', url: DEFAULT_WORKER_URL, anon: '', id: '', pass: '', joined: false, lastSync: 0, lastRev: 0 };
    if (!Number.isFinite(Number(room.pendingSyncAt))) room.pendingSyncAt = 0;
    if (!Array.isArray(room.pendingMessageIds)) room.pendingMessageIds = [];
    room.pendingMessageIds = [...new Set(room.pendingMessageIds.map(String).filter(Boolean))];
    if (typeof room.lastPushError !== 'string') room.lastPushError = '';
    return room;
  }

  function markPendingSync() {
    const room = ensureRoomSyncMeta();
    room.pendingSyncAt = Math.max(Date.now(), Number(room.pendingSyncAt || 0) + 1);
    return room.pendingSyncAt;
  }

  function markPendingMessage(id) {
    const value = String(id || '');
    if (!value) return;
    const room = ensureRoomSyncMeta();
    if (!room.pendingMessageIds.includes(value)) room.pendingMessageIds.push(value);
  }

  function acknowledgeRoomSnapshot(room, generation, uploadedMessageIds) {
    const uploaded = new Set((uploadedMessageIds || []).map(String));
    room.pendingMessageIds = (Array.isArray(room.pendingMessageIds) ? room.pendingMessageIds : []).map(String).filter(id => !uploaded.has(id));
    // 上传请求发出后如果又发生本地修改，只确认旧快照，不清除新一代待同步状态。
    if (Number(room.pendingSyncAt || 0) === Number(generation || 0)) room.pendingSyncAt = 0;
  }

  function getRoomSyncStatus() {
    const room = ensureRoomSyncMeta();
    const joined = !!room.joined;
    const pending = Number(room.pendingSyncAt || 0) > 0;
    const failed = !!(syncFailed || room.lastPushError || room.lastError);
    let key = 'local', label = '仅本机';
    if (joined && syncBusy) { key = 'syncing'; label = '同步中'; }
    else if (joined && failed) { key = 'failed'; label = '同步失败'; }
    else if (joined && pending) { key = 'pending'; label = '待同步'; }
    else if (joined) { key = 'synced'; label = '已同步'; }
    return {
      key, label, joined, pending, busy: joined && !!syncBusy, failed: joined && failed,
      lastSync: Number(room.lastSync || 0), error: String(room.lastPushError || room.lastError || ''),
      canRetry: joined && key === 'failed'
    };
  }

  function getMessageReceipt(id) {
    const sync = getRoomSyncStatus();
    if (!sync.joined) return { key: 'local', label: '仅本机', icon: 'device-mobile', canRetry: false };
    const pending = ensureRoomSyncMeta().pendingMessageIds.includes(String(id || ''));
    if (!pending) return { key: 'synced', label: '已同步', icon: 'checks', canRetry: false };
    if (sync.key === 'failed') return { key: 'failed', label: '同步失败', icon: 'warning-circle', canRetry: true };
    if (sync.key === 'syncing') return { key: 'syncing', label: '同步中', icon: 'arrows-clockwise', canRetry: false };
    return { key: 'pending', label: '待同步', icon: 'clock', canRetry: false };
  }

  function emitSyncStatus() {
    updateSyncPill();
    window.dispatchEvent(new CustomEvent('puffer-sync-status', { detail: getRoomSyncStatus() }));
  }

  function persistSyncMeta() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { console.warn('Sync status persistence failed', error); }
    emitSyncStatus();
  }

  function messageReceiptMarkup(id, className = 'msg-receipt') {
    const receipt = getMessageReceipt(id);
    const tag = receipt.canRetry ? 'button' : 'span';
    const attrs = receipt.canRetry ? ' type="button" data-sync-retry aria-label="同步失败，点按重试"' : '';
    return `<${tag} class="${className} is-${receipt.key}"${attrs}><i class="ph ph-${receipt.icon}"></i><span>${receipt.label}</span></${tag}>`;
  }

  function updateSyncPill() {
    const code = state.settings.syncCode;
    const cloud = state.settings.cloudUrl;
    const dot = $('#syncDot');
    const text = $('#syncText');
    if (!dot || !text) return;
    if (state.settings.room && state.settings.room.joined) {
      const sync = getRoomSyncStatus();
      dot.className = `sync-dot ${sync.key === 'failed' ? 'error' : sync.key === 'pending' ? 'pending' : sync.key === 'syncing' ? 'busy' : 'cloud'}`;
      text.textContent = sync.key === 'failed' ? '同步失败·点重试' : sync.key === 'syncing' ? '同步中…' : sync.key === 'pending' ? '等待同步' : '同步正常';
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

  // 同步进行中：pill 显示「同步中…」；结束(on=false)按最新状态刷新最终态
  function setSyncPillBusy(on) {
    syncBusy = !!on;
    emitSyncStatus();
  }

  function describeRemoteChange(before, remoteData) {
    const labels = { messages: '留言', gallery: '照片', todos: '待办', trainings: '训练记录', wishes: '心愿' };
    const changes = [];
    Object.entries(labels).forEach(([key, label]) => {
      const known = before[key] || new Set();
      const count = (remoteData && Array.isArray(remoteData[key]) ? remoteData[key] : []).filter(item => item && !item.deleted && !known.has(item.id)).length;
      if (count) changes.push(`${count} 条${label}`);
    });
    return changes.length ? changes.join('、') : '共同内容';
  }

  function safeTransferState() {
    const backup = JSON.parse(JSON.stringify(state));
    const room = backup.settings && backup.settings.room;
    if (room) {
      room.pass = '';
      room.anon = '';
      room.joined = false;
      room.pendingSyncAt = 0;
      room.pendingMessageIds = [];
      room.lastPushError = '';
      room.lastError = '';
    }
    if (backup.settings) {
      backup.settings.cloudUrl = '';
      backup.settings.syncCode = '';
    }
    return backup;
  }

  // 导出 JSON
  function exportJSON() {
    const data = JSON.stringify(safeTransferState(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pufferwork-backup-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('已导出备份文件（房间口令已脱敏）');
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
            if (!Array.isArray(state.hydrationLog)) state.hydrationLog = [];
            if (!state.water || typeof state.water !== 'object') state.water = {};
            migrateLegacyWater();
            save();
            updateSyncPill();
            const activePage = $('.nav-item.active');
            if (activePage) onPageEnter(activePage.dataset.page);
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
    const usage = storageUsageLabel();
    const sync = getRoomSyncStatus();
    const syncHero = { syncing: ['正在同步', '正在把本机更新保存到共同空间。'], pending: ['等待同步', '本机内容已保存，稍后会自动上传。'], failed: ['同步需要重试', '本机内容仍然安全，点“立即同步”即可重试。'], synced: ['同步正常', '前台会自动接收彼此的更新。'], local: ['管理共同空间', '加入同一个房间后，数据会自动同步。'] }[sync.key];
    openModal({
      title: '我们与同步',
      body: `
        <div class="settings-layout">
          <div class="settings-hero">
            <div class="settings-hero-icon"><i class="ph ph-cloud-check"></i></div>
            <div><strong>${syncHero[0]}</strong><p>${syncHero[1]}</p></div>
          </div>
          <section class="settings-card">
            <div class="settings-card-head"><span class="settings-icon"><i class="ph ph-heart"></i></span><div><h4>你们的信息</h4><p>这些内容会显示在首页标题和问候里。</p></div></div>
            <div class="settings-fields">
              <div class="settings-field"><label for="partnerA">成员 A</label><input class="pixel-input" id="partnerA" value="${escapeHtml((state.settings.partners || {}).a || '孙大炮')}" placeholder="成员 A 称呼" /></div>
              <div class="settings-field"><label for="partnerB">成员 B</label><input class="pixel-input" id="partnerB" value="${escapeHtml((state.settings.partners || {}).b || '童大侠')}" placeholder="成员 B 称呼" /></div>
            </div>
            <div class="settings-field settings-field-wide"><label for="cityInput">所在城市</label><input class="pixel-input" id="cityInput" value="${escapeHtml(state.settings.city || '杭州')}" placeholder="如 杭州 / 上海 / 北京" /><span class="settings-hint">用于获取天气和生成音乐推荐。</span></div>
          </section>
          <section class="settings-card settings-card-featured">
            <div class="settings-card-head"><span class="settings-icon"><i class="ph ph-users-three"></i></span><div><h4>共享房间</h4><p>两台设备使用同一个房间 ID 和口令，数据会自动同步。</p></div></div>
            <div class="settings-note">使用 <strong>Cloudflare 同步</strong>。已有房间请直接加入，不要重复创建。</div>
            <div class="settings-fields settings-fields-wide">
              <div class="settings-field settings-field-wide settings-field-system"><label for="roomUrl">同步地址</label><input class="pixel-input" id="roomUrl" value="${escapeHtml(state.settings.room.url || DEFAULT_WORKER_URL)}" placeholder="https://sync.20051011.xyz" /></div>
              <div class="settings-field"><label for="roomId">房间 ID</label><input class="pixel-input" id="roomId" value="${escapeHtml(state.settings.room.id || '')}" placeholder="两人保持一致" /></div>
              <div class="settings-field"><label for="roomPass">访问口令</label><input class="pixel-input" id="roomPass" type="password" value="${escapeHtml(state.settings.room.pass || '')}" placeholder="房间口令" /></div>
            </div>
            <div class="settings-actions"><button class="pixel-btn primary" id="roomJoin">加入房间</button><button class="pixel-btn" id="roomCreate">创建房间</button><button class="pixel-btn" id="roomSync">立即同步</button><button class="pixel-btn" id="pushEnable">开启后台通知</button><button class="pixel-btn" id="pushTest">发送测试通知</button><button class="pixel-btn danger" id="roomLeave">退出房间</button></div>
            <div id="pushStatus" class="settings-status push-status">后台通知状态检查中…</div>
            <div id="roomStatus" class="settings-status">尚未加入共享房间</div>
          </section>
          <details class="settings-advanced">
            <summary><span><i class="ph ph-sliders-horizontal"></i> 备份与高级设置</span><i class="ph ph-caret-down"></i></summary>
          <section class="settings-card settings-card-advanced">
            <div class="settings-card-head"><span class="settings-icon"><i class="ph ph-shield-check"></i></span><div><h4>备份与迁移</h4><p>换设备、扫码或手动备份时使用。</p></div></div>
            <div class="settings-status ${usage.near ? 'is-warning' : ''}">${escapeHtml(usage.text)}${usage.near ? ' · 建议现在导出备份并整理旧图片' : ''}</div>
            <div class="settings-actions"><button class="pixel-btn primary" id="syncExport">导出备份</button><button class="pixel-btn" id="syncImport">导入备份</button><button class="pixel-btn" id="syncQR">生成迁移码</button><button class="pixel-btn" id="syncFromQR">导入迁移码</button></div>
            <div id="qrArea" class="settings-qr"><div id="qrCanvas"></div><p>手机扫码即可同步，或长按图片保存。</p></div>
          </section>
          </details>
          <section class="settings-danger"><div><strong>危险操作</strong><p>清空所有本地数据，且无法恢复。</p></div><button class="pixel-btn danger" id="wipeAll">清空所有数据</button></section>
        </div>
      `,
      foot: `<button class="pixel-btn ghost" id="syncClose">关闭</button>`
    });
    $('#syncClose')?.addEventListener('click', closeModal);
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
    $('#syncExport')?.addEventListener('click', () => { exportJSON(); });
    $('#syncImport')?.addEventListener('click', () => { importJSON(); });
    $('#syncQR')?.addEventListener('click', generateQR);
    $('#syncFromQR')?.addEventListener('click', importFromQR);
    // Supabase 与其他旧云端入口不在日常界面显示；保留兼容代码，不删除用户历史文件。
    state.settings.room.backend = 'worker';
    state.settings.room.anon = '';
    // Keep edits as a draft while connected. Otherwise polling can silently
    // jump to a half-typed room before the user presses “加入房间”.
    $('#roomUrl')?.addEventListener('input', (e) => { if (!state.settings.room.joined) { state.settings.room.url = e.target.value.trim() || DEFAULT_WORKER_URL; save(); } });
    $('#roomId')?.addEventListener('input', (e) => { if (!state.settings.room.joined) { state.settings.room.id = e.target.value.trim(); save(); } });
    $('#roomPass')?.addEventListener('input', (e) => { if (!state.settings.room.joined) { state.settings.room.pass = e.target.value.trim(); save(); } });
    const roomJoin = $('#roomJoin'), roomCreate = $('#roomCreate'), roomSync = $('#roomSync');
    roomJoin?.addEventListener('click', () => runSubmission(roomJoin, () => connectRoomFromForm(false), 'room-connect'));
    roomCreate?.addEventListener('click', () => runSubmission(roomCreate, () => connectRoomFromForm(true), 'room-connect'));
    roomSync?.addEventListener('click', () => runSubmission(roomSync, async () => { const ok=await pushToRoom();updateRoomStatus();return ok; }, 'room-sync'));
    const pushEnableButton = $('#pushEnable');
    if (pushEnableButton && !$('#pushTest')) {
      pushEnableButton.insertAdjacentHTML('afterend', '<button class="pixel-btn" id="pushTest">发送测试通知</button>');
    }
    $('#pushTest')?.addEventListener('click', async () => {
      const room = state.settings.room;
      if (!room?.joined || !room.url || !room.id || !room.pass) { toast('请先加入房间并开启后台通知', 'info'); return; }
      const button = $('#pushTest');
      button.disabled = true;
      try {
        const response = await fetch(`${String(room.url).replace(/\/$/, '')}/api/v1/rooms/${encodeURIComponent(room.id)}/push/test`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pass: room.pass, person: state.settings.me || 'a' })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || '测试通知发送失败');
        toast(result.sent ? '测试通知已发送，请稍等查看' : '当前设备还没有推送订阅，请先开启后台通知', result.sent ? 'success' : 'info');
      } catch (error) { toast(error?.message || '测试通知发送失败', 'error'); }
      finally { button.disabled = false; }
    });
    const refreshPushStatus = async () => {
      const el = $('#pushStatus'), button = $('#pushEnable'); if (!el) return;
      const info = await window.PufferPush?.status?.() || {};
      const ready = info.permission === 'granted' && info.subscribed && info.serverSubscribed;
      const acceptedAt = Number(info.lastAcceptedPush?.acceptedAt || 0);
      const acceptedText = acceptedAt ? ` · 最近提交 ${new Date(acceptedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}` : '';
      el.textContent = ready ? `后台通知已开启 · 当前设备已登记${acceptedText}` : info.permission === 'denied' ? '通知权限被拒绝 · 请在系统“通知”设置中允许胖头鱼通知' : info.subscribed && !info.serverSubscribed ? '浏览器已有订阅，但服务器未登记 · 请重新开启后台通知' : '后台通知尚未完成 · 请点击开启后台通知';
      el.classList.toggle('is-success', ready);
      if (button) { button.textContent = info.subscribed ? '关闭后台通知' : '开启后台通知'; button.dataset.enabled = info.subscribed ? '1' : '0'; }
    };
    $('#pushEnable')?.addEventListener('click', async () => {
      const button = $('#pushEnable');
      button.disabled = true;
      try {
        if (button.dataset.enabled === '1') { const context=roomContext(); const ok=await cleanPush(context); toast(ok?'后台通知已关闭':'设备通知已关闭，服务器记录将在联网后自动清理',ok?'success':'info'); }
        else { await window.PufferPush?.enable(); toast('后台通知已开启 ✓'); }
        await refreshPushStatus();
      }
      catch (error) { toast(error?.message || '后台通知操作失败', 'error'); }
      finally { button.disabled = false; }
    });
    refreshPushStatus();
    const roomLeave = $('#roomLeave');
    roomLeave?.addEventListener('click', () => runSubmission(roomLeave, leaveRoom, 'room-leave'));
    $('#wipeAll')?.addEventListener('click', () => {
      if (confirm('真的要清空所有数据吗？此操作不可恢复！')) {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(INPUT_DRAFT_STORAGE_KEY);
        location.reload();
      }
    });
    updateRoomStatus();
  }

  function generateQR() {
    // 把数据压缩为最小可恢复格式
    const data = btoa(unescape(encodeURIComponent(JSON.stringify(safeTransferState()))));
    const url = location.origin + location.pathname + '#sync=' + data;
    $('#qrArea').style.display = 'block';
    $('#qrCanvas').innerHTML = '';
    if (window.QRCode) {
      try { new QRCode($('#qrCanvas'), { text:url, width:220, height:220, colorDark:'#4A2C17', colorLight:'#FFF4E0', correctLevel:QRCode.CorrectLevel.L }); }
      catch (error) { toast('生成失败：' + error.message, 'error'); }
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
        const activePage = $('.nav-item.active');
        if (activePage) onPageEnter(activePage.dataset.page);
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
  $('#syncPill')?.addEventListener('click', () => {
    if (getRoomSyncStatus().canRetry) { runSubmission($('#syncPill'), pushToRoom, 'room-sync'); }   // 失败后点药丸直接重试，不必进设置
    else openSyncModal();
  });
  document.addEventListener('click', (event) => {
    const retry = event.target.closest('[data-sync-retry]');
    if (!retry) return;
    event.preventDefault();
    runSubmission(retry, pushToRoom, 'room-sync');
  });
  window.addEventListener('puffer-sync-status', () => {
    if (!isLifeMode() && $('.nav-item.active')?.dataset.page === 'messages') renderMessages();
  });
  $('#settingsBtn')?.addEventListener('click', openSyncModal);

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
  if (!isLifeMode()) $$('.nav-item, .bn-item').forEach(n => n.addEventListener('click', () => goPage(n.dataset.page)));

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
  let pollInFlight = null;
  let roomSession = 0;

  function roomActive() {
    const r = state.settings.room;
    if (r.backend === 'supabase') return !!(r && r.joined && r.url && r.anon && r.id && r.pass);
    return !!(r && r.joined && r.url && r.id && r.pass);
  }

  // Keep sync payloads bounded: remove old tombstones and cap growing collections.
  const ROOM_TOMBSTONE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
  const ROOM_ARRAY_LIMITS = { todos: 500, trainings: 300, messages: 300, gallery: 60, travels: 300, meals: 300, wishes: 200, hydrationLog: 1200, challengeAnswers: 800 };
  // 图片会以压缩后的 data URL 随相册同步，8MB 足够日常使用，同时仍能拦截异常膨胀。
  const MAX_ROOM_PAYLOAD_BYTES = 8 * 1024 * 1024;
  function roomItemTime(item) { return Number(item && (item.updatedAt || item.createdAt)) || 0; }
  function compactRoomArray(arr, limit, now = Date.now()) {
    const kept = (Array.isArray(arr) ? arr : []).filter((item) => {
      if (!item || item.id == null) return false;
      return !item.deleted || !item.updatedAt || now - item.updatedAt <= ROOM_TOMBSTONE_RETENTION_MS;
    });
    kept.sort((a, b) => roomItemTime(b) - roomItemTime(a));
    return kept.slice(0, limit).sort((a, b) => roomItemTime(a) - roomItemTime(b));
  }
  function compactRoomWater(water, now = Date.now()) {
    const cutoff = new Date(now - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Object.fromEntries(Object.entries(water && typeof water === 'object' ? water : {}).filter(([date]) => date >= cutoff));
  }
  // 心情只供近期回看和当日陪伴使用；同步包保留约 13 个月，避免每天一条状态无限增长。
  function compactRoomDailyStatus(status, now = Date.now()) {
    const cutoff = new Date(now - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return Object.fromEntries(Object.entries(status && typeof status === 'object' ? status : {}).filter(([date, value]) => date >= cutoff && value && typeof value === 'object'));
  }
  function compactRoomState() {
    // 本地状态不做物理截断，避免加载或定期清理时静默丢失历史数据。
    // 仅在 serializeRoom() 构造同步 payload 时做有界压缩。
  }

  // 仅同步数据部分，不同步个人设置（ownerName 等各自保留）
  function serializeRoom() {
    const now = Date.now();
    return {
      todos: compactRoomArray(state.todos, ROOM_ARRAY_LIMITS.todos, now),
      trainings: compactRoomArray(state.trainings, ROOM_ARRAY_LIMITS.trainings, now),
      messages: compactRoomArray(state.messages, ROOM_ARRAY_LIMITS.messages, now),
      gallery: compactRoomArray(state.gallery, ROOM_ARRAY_LIMITS.gallery, now),
      travels: compactRoomArray(state.travels, ROOM_ARRAY_LIMITS.travels, now),
      meals: compactRoomArray(state.meals, ROOM_ARRAY_LIMITS.meals, now),
      wishes: compactRoomArray(state.wishes, ROOM_ARRAY_LIMITS.wishes, now),
      water: compactRoomWater(state.water, now),
      hydrationLog: compactRoomArray(state.hydrationLog, ROOM_ARRAY_LIMITS.hydrationLog, now),
      challengeAnswers: compactRoomArray(state.challengeAnswers, ROOM_ARRAY_LIMITS.challengeAnswers, now),
      dailyStatus: compactRoomDailyStatus(state.dailyStatus, now),
      interactionHistory: state.interactionHistory,
      fortune: state.fortune,
      partners: state.settings.partners,
      fitnessPlan: state.fitnessPlan,
      syncedAt: Date.now()
    };
  }

  // 同一时间戳的极少数并发编辑也要得出同一结果，不能让两端各自保留本地版本。
  function stableRecord(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableRecord).join(',') + ']';
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableRecord(value[key])).join(',') + '}';
  }
  const REMOTE_CHANGE_ARRAYS = {
    messages: 'messages',
    todo: 'todos',
    gallery: 'gallery',
    travel: 'travels',
    wishes: 'wishes',
    challenge: 'challengeAnswers',
    hydration: 'hydrationLog'
  };
  function remoteArrayStamp(items, person = '') {
    return stableRecord((Array.isArray(items) ? items : [])
      .filter(item => item && (!person || item.author === person))
      .map(item => [String(item.id ?? ''), String(item.author || ''), !!item.deleted, Number(item.updatedAt || item.createdAt || 0)])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  }
  function remoteFeatureStamps(source = state) {
    const me = source?.settings?.me || state.settings.me || 'a';
    const partner = me === 'a' ? 'b' : 'a';
    const stamps = {};
    Object.entries(REMOTE_CHANGE_ARRAYS).forEach(([feature, key]) => {
      const partnerOnly = feature === 'messages' || feature === 'challenge' || feature === 'hydration';
      stamps[feature] = remoteArrayStamp(source?.[key], partnerOnly ? partner : '');
    });
    stamps.mood = stableRecord(Object.entries(source?.dailyStatus || {}).map(([date, people]) => {
      const value = people?.[partner];
      return [date, value?.mood || '', value?.text || '', Number(value?.updatedAt || 0)];
    }).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
    const fortune = source?.fortune;
    const partnerFortune = fortune?.by?.[partner];
    stamps.fortune = stableRecord([fortune?.date || '', partnerFortune || null]);
    return stamps;
  }
  function changedRemoteFeatures(before, source = state) {
    const after = remoteFeatureStamps(source);
    return Object.keys(after).filter(feature => before?.[feature] !== after[feature]);
  }
  function emitRemoteChanges(before, announce = true) {
    if (!announce) return [];
    const changes = changedRemoteFeatures(before);
    if (changes.length) window.dispatchEvent(new CustomEvent('puffer-remote-changes', { detail: { changes } }));
    return changes;
  }
  // 按条目 id 合并两个数组：删除标记优先，内容以 updatedAt 较新者胜。
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
      if (tIt > tEx || (tIt === tEx && stableRecord(it) > stableRecord(ex))) map.set(it.id, it);
    };
    // 先放本地版本：时间戳相同时保留本地状态；远端只有在明确更新时才覆盖。
    (localArr || []).forEach(put);
    (remoteArr || []).forEach(put);
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
  function mergeDailyStatus(local, remote) {
    const out = Object.assign({}, local || {});
    Object.keys(remote || {}).forEach(date => {
      const l = out[date] || {}, r = remote[date] || {}, next = Object.assign({}, l);
      ['a','b'].forEach(person => { if (r[person] && (!l[person] || (r[person].updatedAt || 0) > (l[person].updatedAt || 0))) next[person] = r[person]; });
      out[date] = next;
    });
    return out;
  }

  function mergeInteractionHistory(local, remote) {
    const out = Object.assign({}, local || {});
    Object.entries(remote || {}).forEach(([date, value]) => {
      const previous = out[date];
      if (!previous || Number(value?.completedAt || 0) > Number(previous?.completedAt || 0)) out[date] = value;
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
      travels: mergeArr(local.travels, remote.travels),
      meals: (() => { const m = mergeArr(local.meals, remote.meals); dedupeMeals(m); return m; })(),
      wishes: mergeArr(local.wishes, remote.wishes),
      hydrationLog: mergeArr(local.hydrationLog, remote.hydrationLog),
      challengeAnswers: mergeArr(local.challengeAnswers, remote.challengeAnswers),
      fitnessPlan: mergePlan(local.fitnessPlan, remote.fitnessPlan),
      // 喝水分人：按日期取两人各自的最大杯数（兼容旧数字格式）
      water: (() => {
        const out = Object.assign({}, local.water || {});
        Object.keys(remote.water || {}).forEach(k => {
          const ln = normWater(out[k]), rn = normWater(remote.water[k]);
          out[k] = { a: Math.max(ln.a, rn.a), b: Math.max(ln.b, rn.b) };
        });
        return out;
      })(),
      dailyStatus: mergeDailyStatus(local.dailyStatus, remote.dailyStatus),
      interactionHistory: mergeInteractionHistory(local.interactionHistory, remote.interactionHistory),
      // 祈福抽签：两人各自抽，按 by.a/by.b 的 ts 取新（同一日期）
      fortune: mergeFortune(local.fortune, remote.fortune),
    });
    if (remote.partners) local.settings.partners = mergePlan(local.settings.partners, remote.partners);
    migrateLegacyWater();
    compactRoomState();
  }

  // 合并两人的祈福签：同日期下 each 取 ts 更大的一支
  function mergeFortune(local, remote) {
    const l = (local && local.by) ? local : null;
    const r = (remote && remote.by) ? remote : null;
    if (!l && !r) return local || remote || null;
    const today = todayKey();
    const dates = [l && l.date, r && r.date].filter(Boolean);
    const date = dates.includes(today) ? today : (dates.sort().pop() || today);
    const sameDay = (entry) => entry && entry.date === date;
    const pick = (a, b) => {
      if (!a && !b) return null;
      if (!a) return b;
      if (!b) return a;
      return ((a.ts || 0) >= (b.ts || 0)) ? a : b;
    };
    return {
      date,
      by: {
        a: pick(sameDay(l) && l.by.a, sameDay(r) && r.by.a),
        b: pick(sameDay(l) && l.by.b, sameDay(r) && r.by.b),
      },
    };
  }

  // 移动网络偶发 DNS / IPv6 / TLS 路由卡住时，原生 fetch 可能长时间保持 pending。
  // 给同步请求设置明确的截止时间，确保 finally 能执行并把失败状态反馈给用户。
  const SYNC_REQUEST_TIMEOUT_MS = 20000;
  const SYNC_UPLOAD_TIMEOUT_MS = 60000;
  async function syncFetch(input, init, timeoutMs = SYNC_REQUEST_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const options = Object.assign({}, init || {}, {
        signal: controller.signal,
        cache: 'no-store',
        // 不额外发送 Cache-Control 请求头：跨域 Worker 的预检不需要它，
        // 否则部分手机浏览器会因 CORS 请求头未获允许而直接拦截同步。
        headers: Object.assign({}, (init && init.headers) || {})
      });
      return await fetch(input, options);
    } catch (e) {
      if (e && e.name === 'AbortError') {
        throw new Error('同步超时，请检查当前网络后重试');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  async function snapshotHash(data) {
    const raw = JSON.stringify(data);
    const bytes = new TextEncoder().encode(raw);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function roomGet(url, id, pass) {
    const r = state.settings.room;
    if (r.backend === 'supabase') {
      // 走 Edge Function：anon 永远拿不到表 / pass 明文
      const base = url.replace(/\/$/, '');
      const res = await syncFetch(`${base}/functions/v1/room-get`, {
        method: 'POST',
        headers: {
          'apikey': r.anon,
          'Authorization': 'Bearer ' + r.anon,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id, pass })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === 'forbidden') throw new Error('口令错误');
        if (body.error === 'not_found') throw new Error('房间不存在');
        if (body.error === 'need_migration') throw new Error('房间需要迁移，请在原设备同步一次');
        throw new Error('HTTP ' + res.status);
      }
      return { ok: true, data: body.data, rev: body.rev, updatedAt: body.updatedAt };
    }
    // Cloudflare Workers 后端
    const base = url.replace(/\/$/, ''); const syncStamp = Date.now(); const v1Url = `${base}/api/v1/rooms/${encodeURIComponent(id)}?pass=${encodeURIComponent(pass)}&_sync=${syncStamp}`;
    let res = await syncFetch(v1Url);
    if (res.status === 404) res = await syncFetch(`${base}/api/${encodeURIComponent(id)}?pass=${encodeURIComponent(pass)}&_sync=${syncStamp}`);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error === 'forbidden') throw new Error('口令错误');
      if (e.error === 'not_found') throw new Error('房间不存在');
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  }

  async function roomPut(url, id, pass, data, dataHash) {
    const payloadBytes = new TextEncoder().encode(JSON.stringify(data)).byteLength;
    if (payloadBytes > MAX_ROOM_PAYLOAD_BYTES) {
      throw new Error('同步数据超过 8MB 安全上限，请清理旧图片或历史记录后重试');
    }
    const r = state.settings.room;
    if (r.backend === 'supabase') {
      // 走 Edge Function：服务端写 pass 哈希，客户端不再持有明文存储
      const base = url.replace(/\/$/, '');
      const res = await syncFetch(`${base}/functions/v1/room-put`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': r.anon,
          'Authorization': 'Bearer ' + r.anon,
        },
        body: JSON.stringify({ id, pass, data, dataHash, rev: r.lastRev })
      }, SYNC_UPLOAD_TIMEOUT_MS);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (body.error === 'forbidden') throw new Error('口令错误');
        if (body.error === 'conflict') throw new Error('版本冲突（请稍后重试）');
        if (body.error === 'data_hash_mismatch') throw new Error('上传内容校验失败，请重试');
        if (body.error === 'payload_too_large') throw new Error('同步数据超过 8MB 安全上限，请清理旧图片或历史记录后重试');
        throw new Error('HTTP ' + res.status);
      }
      if (body.dataHash && body.dataHash !== dataHash) throw new Error('服务器确认内容摘要不一致');
      return { ok: true, rev: body.rev, updatedAt: Date.now() };
    }
    // Cloudflare Workers 后端
    const base = url.replace(/\/$/, ''); const v1Url = `${base}/api/v1/rooms/${encodeURIComponent(id)}`;
    let res = await syncFetch(v1Url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ schemaVersion: 1, roomId: id, pass, baseRev: Number(r.lastRev || 0), author: state.settings.me || 'a', data })
    }, SYNC_UPLOAD_TIMEOUT_MS);
    if (res.status === 404) res = await syncFetch(`${base}/api/${encodeURIComponent(id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass, baseRev: Number(r.lastRev || 0), data }) }, SYNC_UPLOAD_TIMEOUT_MS);
    if (!res.ok) {
      const e = await res.json().catch(() => ({}));
      if (e.error === 'forbidden') throw new Error('口令错误');
      if (e.error === 'payload_too_large') throw new Error('同步数据超过 8MB 安全上限，请清理旧图片或历史记录后重试');
      if (e.error === 'conflict') throw new Error('版本冲突（请稍后重试）');
      throw new Error('HTTP ' + res.status);
    }
    return res.json();
  }

  function scheduleRoomPush() {
    if (!roomActive()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushToRoom({ queueIfBusy: true }); }, 1000);
  }

  // 同步失败自动重试（指数退避），同时把错误留在 pill 上供一键重试
  let syncFailed = false;
  let syncRetryCount = 0;
  let syncRetryTimer = null;
  const MAX_SYNC_RETRY = 6;
  // 版本冲突自动重试：重新拉取→合并→再写，最多 4 次（化解双端竞态）
  let conflictRetryCount = 0;
  const MAX_CONFLICT_RETRY = 4;
  function scheduleSyncRetry() {
    if (!roomActive()) return;
    if (syncRetryCount >= MAX_SYNC_RETRY) return;
    syncRetryCount++;
    const delay = Math.min(120000, 5000 * (2 ** (syncRetryCount - 1))); // 5s / 10s / 20s / 40s / 80s / 120s
    clearTimeout(syncRetryTimer);
    syncRetryTimer = setTimeout(() => { pushToRoom(); }, delay);
  }

  // 返回 true 表示成功，false 表示失败（内部已 toast）
  async function pushToRoomOnce(options = {}) {
    if (!roomActive()) return false;
    const r = state.settings.room;
    const context = roomContext();
    const session = roomSession;
    const allowCreate = !!options.allowCreate;
    setSyncPillBusy(true);
    try {
      try {
        const prevIds = new Set(state.messages.map(m => m.id));
        const remoteBefore = remoteFeatureStamps();
        const announceRemoteChanges = Number(r.lastRev || 0) > 0;
        const remote = await roomGet(context.url, context.id, context.pass);
        if (session !== roomSession || !sameRoomContext(context, roomContext())) return false;
        mergeState(state, remote.data);
        r.lastRev = remote.rev;
        emitRemoteChanges(remoteBefore, announceRemoteChanges);
        checkNewMessages(prevIds); // 打开/同步时立即发现对方新留言
      } catch (e) {
        if (session !== roomSession || !sameRoomContext(context, roomContext())) return false;
        if (e.message !== '房间不存在' || !allowCreate) {
          r.lastError = e.message || '未知错误';
          r.lastPushError = r.lastError;
          toast('上传未完成，内容已保存在本机，将自动重试', 'error');
          syncFailed = true;
          persistSyncMeta();
          updateRoomStatus();
          scheduleSyncRetry();
          return false;
        }
      }
      try {
        // 合并到对方刚完成的互动后，先把连续记录写进这次快照。
        updateInteractionHistory();
        const uploadGeneration = Number(r.pendingSyncAt || 0);
        const pendingMessageIds = new Set((r.pendingMessageIds || []).map(String));
        const snapshot = serializeRoom();
        const snapshotMessageIds = new Set((snapshot.messages || []).map(item => String(item.id)));
        const uploadedPendingMessageIds = [...pendingMessageIds].filter(id => snapshotMessageIds.has(id));
        const dataHash = await snapshotHash(snapshot);
        if (session !== roomSession || !sameRoomContext(context, roomContext())) return false;
        const resp = await roomPut(context.url, context.id, context.pass, snapshot, dataHash);
        if (session !== roomSession || !sameRoomContext(context, roomContext())) return false;
        r.lastRev = resp.rev;
        r.lastSync = Date.now();
        r.lastError = '';
        r.lastPushError = '';
        acknowledgeRoomSnapshot(r, uploadGeneration, uploadedPendingMessageIds);
        syncFailed = false; syncRetryCount = 0; clearTimeout(syncRetryTimer);
        conflictRetryCount = 0;
        if (Number(r.pendingSyncAt || 0) > 0) pushQueued = true;
        save({ silent: true });
        updateRoomStatus();
        renderCurrent();
        return true;
      } catch (e) {
        if (session !== roomSession || !sameRoomContext(context, roomContext())) return false;
        const isConflict = e.message === '版本冲突（请稍后重试）';
        if (isConflict && conflictRetryCount < MAX_CONFLICT_RETRY) {
          // 对方也在写：快照过期。重新拉取-合并-再写，自动化解竞态
          conflictRetryCount++;
          await new Promise(r => setTimeout(r, 260 + Math.floor(Math.random() * 420)));
          return pushToRoomOnce(options);
        }
        conflictRetryCount = 0;
        r.lastError = e.message || '未知错误';
        r.lastPushError = r.lastError;
        toast('上传未完成，内容已保存在本机，将自动重试', 'error');
        syncFailed = true;
        persistSyncMeta();
        updateRoomStatus();
        scheduleSyncRetry();
        return false;
      }
    } finally {
      setSyncPillBusy(false); // 无论成功失败，都按最新状态实时刷新 pill
    }
  }

  // 检测来自对方的新留言（pollRoom 与 pushToRoom 共用）。留言页打开时由
  // life.js 原地刷新对话，其余页面显示可点击的站内新消息卡片。
  function checkNewMessages(prevIds) {
    const me = state.settings.me || 'a';
    const incoming = live(state.messages).filter(m => !prevIds.has(m.id) && m.author !== me);
    return notifyNewMessages(incoming);
  }

  async function pollRoomOnce() {
    if (!roomActive()) return;
    const r = state.settings.room;
    const context = roomContext();
    const session = roomSession;
    try {
      const remote = await roomGet(context.url, context.id, context.pass);
      if (session !== roomSession || !sameRoomContext(context, roomContext())) return;
      // 成功访问服务器就代表同步链路正常，即使数据版本没有变化也要清除旧错误状态
      r.lastSync = Date.now();
      r.lastError = r.lastPushError || '';
      syncFailed = !!r.lastPushError;
      emitSyncStatus();
      updateRoomStatus();
      const remoteMessages = Array.isArray(remote.data?.messages) ? remote.data.messages : [];
      const localMessages = new Map((state.messages || []).map(item => [String(item.id), item]));
      const hasMessageDelta = remoteMessages.some(item => {
        const local = localMessages.get(String(item?.id));
        return item?.id != null && (!local || Number(item.updatedAt || item.createdAt || 0) > Number(local.updatedAt || local.createdAt || 0));
      });
      if (remote.rev === r.lastRev && !hasMessageDelta) return; // 版本相同但 D1 补回了留言时仍需合并
      const before = { messages: new Set(state.messages.map(m => m.id)), gallery: new Set(state.gallery.map(m => m.id)), todos: new Set(state.todos.map(m => m.id)), trainings: new Set(state.trainings.map(m => m.id)), wishes: new Set(state.wishes.map(m => m.id)) };
      const prevIds = before.messages;
      const remoteBefore = remoteFeatureStamps();
      mergeState(state, remote.data);
      r.lastRev = remote.rev;
      const interactionChanged = updateInteractionHistory();
      save({ silent: true });
      // 轮询合并后首次满足双方完成时，补发一次记录给另一台设备。
      if (interactionChanged) scheduleRoomPush();
      const incomingMessages = checkNewMessages(prevIds);
      renderCurrent();
      emitRemoteChanges(remoteBefore);
      // 新留言已有更明确、可点击的提示，避免通用同步 toast 紧接着把它覆盖。
      if (!incomingMessages.length) toast('共同空间已更新：' + describeRemoteChange(before, remote.data), 'success');
    } catch (e) {
      if (session !== roomSession || !sameRoomContext(context, roomContext())) return;
      syncFailed = true;
      const message = e && e.message ? e.message : '网络或服务器错误';
      const changed = r.lastError !== message;
      r.lastError = message;
      updateRoomStatus();
      persistSyncMeta();
      if (changed) toast('暂时无法检查更新，正在后台重试', 'error');
      // 轮询本身会继续重试，不要把拉取失败误当成写入失败再触发上传
    }
  }

  // 接收端避免并发请求：前台每 3 秒检查一次，回到页面/重新获得焦点时立即检查
  async function pollRoom() {
    if (!roomActive() || document.hidden || pollInFlight) return pollInFlight;
    const run = pollRoomOnce();
    pollInFlight = run;
    try { return await run; }
    finally { if (pollInFlight === run) pollInFlight = null; }
  }

  let pushInFlight = null;
  let pushQueued = false;
  let pushQueuedAllowCreate = false;

  // 所有写入共用一个队列：手动同步、自动保存、轮询不会并发覆盖彼此。
  async function pushToRoom(options = {}) {
    if (!roomActive()) return false;
    if (pushInFlight) {
      // 自动保存才允许排队；重复点击“立即同步”直接复用当前请求，不再多上传一轮。
      if (options.queueIfBusy) {
        pushQueued = true;
        pushQueuedAllowCreate = pushQueuedAllowCreate || !!options.allowCreate;
      }
      return pushInFlight;
    }
    const run = (async () => {
      let ok = await pushToRoomOnce(options);
      while (pushQueued && roomActive()) {
        const next = { allowCreate: pushQueuedAllowCreate };
        pushQueued = false;
        pushQueuedAllowCreate = false;
        ok = await pushToRoomOnce(next);
      }
      return ok;
    })();
    pushInFlight = run;
    try {
      return await run;
    } finally {
      if (pushInFlight === run) {
        pushInFlight = null;
        if (pushQueued && roomActive()) scheduleRoomPush();
      }
    }
  }

  function renderCurrent() {
    if (isLifeMode()) return;
    const active = $('.nav-item.active');
    if (active) onPageEnter(active.dataset.page);
    else renderDashboard();
  }

  function startRoomPolling() {
    if (roomTimer) clearInterval(roomTimer);
    roomTimer = setInterval(pollRoom, 3000);
    pollRoom();
    startPresencePolling();
  }

  function stopRoomConnections() {
    roomSession++;
    if (roomTimer) { clearInterval(roomTimer); roomTimer = null; }
    clearTimeout(pushTimer);
    clearTimeout(syncRetryTimer);
    pushQueued = false;
    pushQueuedAllowCreate = false;
    pushInFlight = null;
    pollInFlight = null;
    stopPresencePolling();
  }

  function sameRoomContext(left, right) {
    return left.backend === right.backend && left.url.replace(/\/$/,'') === right.url.replace(/\/$/,'') && left.id === right.id && left.pass === right.pass;
  }

  async function connectRoomFromForm(create) {
    const previousRoom = {...(state.settings.room || {})};
    const previous = roomContext(previousRoom);
    const next = {
      backend: 'worker',
      url: $('#roomUrl').value.trim() || DEFAULT_WORKER_URL,
      id: $('#roomId').value.trim(),
      pass: $('#roomPass').value.trim(),
      person: state.settings.me || 'a'
    };
    if (!next.url || !next.id || !next.pass) { toast('请填写房间地址、ID 和口令', 'error'); return false; }
    if (create && !confirm('这个操作会在当前后端创建一个新房间，并上传本机当前数据。确定继续吗？')) return false;
    const switching = !!previousRoom.joined && !sameRoomContext(previous, next);
    const restorePush = switching && localStorage.getItem('puffer-push-enabled') === '1';
    const restoreLocation = switching && localStorage.getItem(presenceStorageKey(previous)) === '1';
    if (switching && !create) {
      try { await roomGet(next.url, next.id, next.pass); }
      catch (error) { toast(error?.message || '无法加入这个房间', 'error'); return false; }
    }
    if (switching) {
      stopRoomConnections();
      localStorage.removeItem(presenceStorageKey(previous));
      await cleanupRoomContext(previous);
    }
    Object.assign(state.settings.room, { backend:'worker', anon:'', url:next.url, id:next.id, pass:next.pass, joined:switching?false:!!previousRoom.joined });
    save();
    const ok = await (create ? createRoom(true) : joinRoom());
    if (!ok && switching) {
      Object.assign(state.settings.room, previousRoom);
      if (restoreLocation) localStorage.setItem(presenceStorageKey(previous), '1');
      save();
      startRoomPolling();
    }
    if (ok && restorePush) {
      try { await window.PufferPush?.enable?.(); } catch (_) { toast('房间已切换，请在设置中重新开启后台通知', 'info'); }
    } else if (!ok && switching && restorePush) {
      try { await window.PufferPush?.enable?.(); } catch (_) { toast('已恢复原房间，请重新开启后台通知', 'info'); }
    }
    return ok;
  }

  async function joinRoom() {
    const r = state.settings.room;
    if (r.backend === 'supabase' && (!r.url || !r.anon || !r.id || !r.pass)) { toast('请填写 Supabase 项目 URL、Anon Key、房间 ID 和口令', 'error'); return false; }
    if (r.backend !== 'supabase' && (!r.url || !r.id || !r.pass)) { toast('请填写房间地址、ID 和口令', 'error'); return false; }
    r.joined = true; save();
    const ok = await pushToRoom();
    if (ok) {
      startRoomPolling();
      updateSyncPill();
      updateRoomStatus();
      toast('已连接 #' + r.id + '，正在同步已有内容', 'success');
      closeModal();
      return true;
    } else {
      r.joined = false; save();
      updateSyncPill();
      updateRoomStatus();
      return false;
    }
  }

  async function createRoom(confirmed = false) {
    const r = state.settings.room;
    if (r.backend === 'supabase' && (!r.url || !r.anon || !r.id || !r.pass)) { toast('请填写 Supabase 项目 URL、Anon Key、房间 ID 和口令', 'error'); return false; }
    if (r.backend !== 'supabase' && (!r.url || !r.id || !r.pass)) { toast('请填写房间地址、ID 和口令', 'error'); return false; }
    if (!confirmed && !confirm('这个操作会在当前后端创建一个新房间，并上传本机当前数据。确定继续吗？')) return false;
    r.joined = true; save();
    const ok = await pushToRoom({ allowCreate: true });
    if (ok) {
      startRoomPolling();
      updateSyncPill();
      updateRoomStatus();
      toast('已创建并连接 #' + r.id, 'success');
      closeModal();
      return true;
    } else {
      r.joined = false; save();
      updateSyncPill();
      updateRoomStatus();
      return false;
    }
  }

  async function leaveRoom() {
    const context = roomContext();
    stopRoomConnections();
    localStorage.removeItem(presenceStorageKey(context));
    state.settings.room.joined = false;
    save();
    updateSyncPill();
    updateRoomStatus();
    const clean = await cleanupRoomContext(context);
    toast(clean ? '已退出共享房间，通知和位置已清理' : '已退出共享房间；离线清理将在联网后自动完成', clean ? 'success' : 'info');
    return true;
  }

  async function changeIdentity(me) {
    if (me !== 'a' && me !== 'b') return false;
    const oldPerson = state.settings.me || 'a';
    if (me === oldPerson) return true;
    const context = roomContext(state.settings.room, oldPerson);
    const active = roomActive();
    const restorePush = active && localStorage.getItem('puffer-push-enabled') === '1';
    if (active) {
      roomSession++;
      stopPresencePolling();
      localStorage.removeItem(presenceStorageKey(context));
      await cleanupRoomContext(context);
    }
    state.settings.me = me;
    lastPresenceLocation = null;
    lastPresenceLocationAt = 0;
    save();
    if (active) {
      startPresencePolling();
      if (restorePush) {
        try { await window.PufferPush?.enable?.(); } catch (_) { toast('身份已切换，请重新开启后台通知', 'info'); }
      }
    }
    return true;
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
      const backend = r.backend === 'supabase' ? 'Supabase' : 'Worker';
      const error = r.lastError ? `<br><span style="color:var(--danger)">同步错误：${escapeHtml(r.lastError)}</span>` : '';
      el.innerHTML = `已加入房间「<strong>${escapeHtml(r.id)}</strong>」· ${backend} · 最近检查 ${fmtAgo(r.lastSync)} · 前台每 3 秒自动拉取对方更新${error}`;
    } else {
      el.textContent = '尚未加入共享房间';
    }
  }

  // 历史记录是共同生活的一部分，绝不按时间自动删除。
  // 同步包大小仍由 serializeRoom() 的边界控制；长期归档将交由 D1，不能以删除留言换空间。
  function runWeeklyCleanup() {
    // 保留调用点以兼容旧版本，但不再自动删除任何待办或留言。
  }

  // ==========================================
  // 启动
  // ==========================================
  load();
  const musicToggle = $('#musicFloatToggle');
  const musicPanel = $('#musicFloatPanel');
  if (musicToggle && musicPanel) musicToggle.addEventListener('click', () => {
    const open = musicToggle.getAttribute('aria-expanded') === 'true';
    musicToggle.setAttribute('aria-expanded', String(!open));
    musicPanel.hidden = open;
    if (!open && !musicPanel.querySelector('[data-music-rendered-slot]')) renderMusicWidget();
  });
  const musicClose = $('#musicPanelClose');
  if (musicClose && musicToggle && musicPanel) musicClose.addEventListener('click', () => {
    musicToggle.setAttribute('aria-expanded', 'false');
    musicPanel.hidden = true;
  });
  renderMusicWidget();
  notifyMusicRecommendation();
  startMusicSlotTimer();
  if (!state.settings.partners) state.settings.partners = { a: (state.settings.ownerName || '孙大炮'), b: '童大侠', updatedAt: 0 };
  if (!state.settings.me) state.settings.me = 'a';
  if (!state.settings.city) state.settings.city = '杭州';
  if (state.settings.notifySystem === undefined) state.settings.notifySystem = true;
  if (state.settings.unreadMsgCount === undefined) state.settings.unreadMsgCount = 0;
  runWeeklyCleanup(); // 打开页面时检查是否已满一周，自动清理旧待办/留言
  updateSyncPill();
  handleHashSync();
  if (state.settings.room && state.settings.room.joined) {
    updateSyncPill();
    pushToRoom();
    startRoomPolling();
  }
  retryPendingCleanups();
  // 切回前台：立即拉一次最新数据并刷新角标（后台 tab 定时器会被浏览器节流，靠这个补偿）
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      pollRoom();
      if (roomActive()) pushToRoom();
      updateMsgBadge();
      updateTitleBadge();
      renderMusicWidget();
      notifyMusicRecommendation();
    }
  });
  window.addEventListener('online', () => {
    retryPendingCleanups();
    pollRoom();
    if (roomActive()) pushToRoom();
    refreshPresenceLocation(true);
  });
  window.addEventListener('puffer-push-ready', retryPendingCleanups);
  window.addEventListener('focus', () => { pollRoom(); refreshPresenceLocation(true); });
  navigator.serviceWorker?.addEventListener('message', async event => {
    if (event.data?.type === 'puffer-room-update') await pollRoom();
    if (event.data?.type === 'puffer-open-messages' || event.data?.type === 'puffer-open-notification') {
      await pollRoom();
      const kind = event.data?.type === 'puffer-open-messages' ? 'messages' : event.data?.kind;
      const target = kind === 'messages' ? 'messages' : kind === 'gallery' ? 'gallery' : kind === 'todos' ? 'todo' : kind === 'hydration' ? 'hydration' : '';
      if (target) window.dispatchEvent(new CustomEvent(`puffer-life-${target}`));
    }
  });
  updateMsgBadge();
  updateMsgNotifyBtn();
  window.PufferLife = {
    getState() {
      return JSON.parse(JSON.stringify({
        todos: state.todos,
        trainings: state.trainings,
        messages: state.messages,
        gallery: state.gallery,
        travels: state.travels,
        wishes: state.wishes,
        fortune: state.fortune,
        dailyStatus: state.dailyStatus,
        interactionHistory: state.interactionHistory,
        water: state.water,
        hydrationLog: state.hydrationLog,
        challengeAnswers: state.challengeAnswers,
        fitnessPlan: state.fitnessPlan,
        settings: state.settings,
        weather: state._weather || null,
      }));
    },
    open(page) { goPage(page); },
    getHoroscopes() { return ['gemini','libra'].map(sign => ({ sign, meta: HOROS[sign], data: dailyHoroscope(sign) })); },
    getDailyMusic() { const part = currentMusicDaypart(), neteaseSource = '\u4f60\u4eec\u7684\u7f51\u6613\u4e91\u6b4c\u5355', appleSources = ['\u4f60\u4eec\u7684 Apple Music \u6b4c\u5355', '\u76f8\u4f3c\u63a8\u8350']; return { netease: getMusicSlotSong(part, neteaseSource) || pickMusicFor(part, new Set(), neteaseSource)[0] || null, apple: getMusicSlotSong(part, appleSources) || pickMusicFor(part, new Set(), appleSources)[0] || null }; },
    getSyncStatus() { return { ...getRoomSyncStatus() }; },
    notify(message, type = 'success') { toast(String(message || ''), type); return true; },
    markMessagesRead() { return markMessagesRead(); },
    getMessageReceipt(id) { return { ...getMessageReceipt(id) }; },
    getInputDraft(scope) { return getInputDraft(scope); },
    setInputDraft(scope, fields) { return setInputDraft(scope, fields); },
    clearInputDraft(scope) { return clearInputDraft(scope); },
    getPresence() { return presenceUi(); },
    refreshPresence() { refreshPresenceLocation(true); return true; },
    setLocationSharing(enabled) { return setLocationSharing(!!enabled); },
    getTodayChallenge() { const question = todayChallengeQuestion(); return question ? { question, answers: todayChallengeAnswers(state) } : null; },
    answerTodayChallenge(answer) {
      const question = todayChallengeQuestion(), me = state.settings.me || 'a', date = todayKey();
      if (!question || !question.options.some(option => option.id === answer)) return false;
      if (live(state.challengeAnswers).some(item => item.date === date && item.questionId === question.id && item.author === me)) return false;
      state.challengeAnswers.push({ id: `${date}:${me}`, date, questionId: question.id, source: question.source || 'builtin', author: me, answer: String(answer), createdAt: Date.now(), updatedAt: Date.now(), deleted: false });
      save();
      return true;
    },
    isTodayInteractionComplete() { return isTodayInteractionComplete(state); },
    setDailyStatus(person, mood, text) { const safeText = textWithinLimit(text, TEXT_LIMITS.moodNote, '状态说明'); if (safeText === null) return false; const date = todayKey(); state.dailyStatus[date] = state.dailyStatus[date] || {}; state.dailyStatus[date][person] = { mood: String(mood || ''), text: safeText, updatedAt: Date.now() }; save(); return true; },
    addTodo(input) { const text = textWithinLimit(input && input.text, TEXT_LIMITS.todo, '待办'); if (!text) return false; state.todos.push({ id: uid(), author: state.settings.me || 'a', text, date: String(input && input.date || ''), priority: String(input && input.priority || 'none'), done: false, createdAt: Date.now(), updatedAt: Date.now() }); save(); return true; },
    updateTodo(id, input) { const todo = state.todos.find(item => item.id === id && !item.deleted); const text = textWithinLimit(input && input.text, TEXT_LIMITS.todo, '待办'); if (!todo || !text) return false; todo.text = text; todo.date = String(input && input.date || ''); todo.priority = String(input && input.priority || 'none'); todo.updatedAt = Date.now(); save(); return true; },
    toggleTodo(id) { const todo = state.todos.find(item => item.id === id && !item.deleted); if (!todo) return false; todo.done = !todo.done; todo.updatedAt = Date.now(); save(); return true; },
    addTraining(input) { const value=input||{}, content=textWithinLimit(value.content, TEXT_LIMITS.trainingContent, '训练内容'), muscle=textWithinLimit(value.muscle || 'custom', TEXT_LIMITS.trainingMeta, '训练部位'), weight=textWithinLimit(value.weight, TEXT_LIMITS.trainingMeta, '训练重量'), duration=textWithinLimit(value.duration, TEXT_LIMITS.trainingMeta, '训练时长'), note=textWithinLimit(value.note, TEXT_LIMITS.trainingNote, '训练备注'); if (!content || [muscle,weight,duration,note].some(v=>v===null)) return false; state.trainings.push({ id:uid(), author:state.settings.me || 'a', muscle, date:String(value.date || todayKey()), content, weight, duration, note, createdAt:Date.now(), updatedAt:Date.now() }); save(); return true; },
    updateTraining(id, input) { const item = state.trainings.find(x=>x.id===id&&!x.deleted), value=input||{}, content=textWithinLimit(value.content, TEXT_LIMITS.trainingContent, '训练内容'), muscle=textWithinLimit(value.muscle || 'custom', TEXT_LIMITS.trainingMeta, '训练部位'), weight=textWithinLimit(value.weight, TEXT_LIMITS.trainingMeta, '训练重量'), duration=textWithinLimit(value.duration, TEXT_LIMITS.trainingMeta, '训练时长'), note=textWithinLimit(value.note, TEXT_LIMITS.trainingNote, '训练备注'); if(!item || !content || [muscle,weight,duration,note].some(v=>v===null))return false; Object.assign(item,{muscle,date:String(value.date||todayKey()),content,weight,duration,note,updatedAt:Date.now()}); save(); return true; },
    deleteTraining(id) { const item=state.trainings.find(x=>x.id===id&&!x.deleted); if(!item)return false; item.deleted=true;item.updatedAt=Date.now();save();return true; },
    updateFitnessPlan(plan) { if(!plan||typeof plan!=='object')return false; Object.keys(plan).forEach(day=>{const name=String(plan[day]||'').trim();if(name)state.fitnessPlan[day]={name,muscle:name.includes('休')?'rest':'custom',desc:name.includes('休')?'好好休息':'自定义训练日',updatedAt:Date.now()};});save();return true; },
    addWish(input) { const text=textWithinLimit(input&&input.text, TEXT_LIMITS.wish, '心愿');if(!text)return false;state.wishes.push({id:uid(),text,icon:String(input.icon||'✨'),anonymous:!!(input&&input.anonymous),author:state.settings.me||'a',color:'peach',tilt:'0',createdAt:Date.now(),updatedAt:Date.now()});save();return true; },
    deleteWish(id) { const item=state.wishes.find(x=>x.id===id&&!x.deleted);if(!item)return false;item.deleted=true;item.updatedAt=Date.now();save();return true; },
    deleteMessage(id) { const item=state.messages.find(x=>x.id===id&&!x.deleted);if(!item)return false;item.deleted=true;item.updatedAt=Date.now();save();return true; },
    deleteGallery(id) { const item=state.gallery.find(x=>x.id===id&&!x.deleted);if(!item)return false;item.deleted=true;item.updatedAt=Date.now();save();return true; },
    deleteTravel(id) { const item=state.travels.find(x=>x.id===id&&!x.deleted);if(!item)return false;item.deleted=true;item.updatedAt=Date.now();save();return true; },
    addGalleryUrl(url, caption) { const value=textWithinLimit(url, TEXT_LIMITS.imageUrl, '图片链接'), safeCaption=textWithinLimit(caption, TEXT_LIMITS.photoCaption, '照片说明');if(!value||safeCaption===null||live(state.gallery).length>=GALLERY_MAX)return false;state.gallery.push({id:uid(),author:state.settings.me||'a',dataUrl:'',url:value,caption:safeCaption,createdAt:Date.now(),updatedAt:Date.now()});save();return true; },
    addWater(delta) { addWater(Number(delta)||0); return hydrationTotals(); },
    getHydrationToday() { const me=state.settings.me||'a', ta=me==='a'?'b':'a', todayRecords=person=>(state.hydrationLog||[]).filter(item=>item&&!item.deleted&&item.author===person&&item.date===todayKey()).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)); return { me:hydrationTotals(me), partner:hydrationTotals(ta), goal:WATER_GOAL_ML, drinkLimit:DRINK_WARN_ML, defaultMl:DEFAULT_HYDRATION_ML, records:todayRecords(me), partnerRecords:todayRecords(ta) }; },
    addHydration(kind, ml) { return addHydration(kind, ml); },
    deleteHydration(id) { return deleteHydration(id); },
    setIdentity(me) { return changeIdentity(me); },
    setNotifySystem(on) { state.settings.notifySystem=!!on;save();if(on&&'Notification'in window&&Notification.permission==='default')Notification.requestPermission().catch(()=>{});return state.settings.notifySystem; },
    updateProfile(input) { const p=input||{};state.settings.partners=state.settings.partners||{};if(p.a!=null)state.settings.partners.a=String(p.a).trim();if(p.b!=null)state.settings.partners.b=String(p.b).trim();if(p.city!=null)state.settings.city=String(p.city).trim();state.settings.partners.updatedAt=Date.now();save();if(p.city!=null)fetchWeather(true);return true; },
    syncNow() { return pushToRoom(); },
    configureRoom(input) { const value=input||{},room=state.settings.room=state.settings.room||{};if(room.joined)return false;['backend','url','anon','id','pass'].forEach(key=>{if(value[key]!=null)room[key]=String(value[key]).trim();});save();return true; },
    joinConfiguredRoom(create) { return create ? createRoom() : joinRoom(); },
    leaveConfiguredRoom() { return leaveRoom(); },
    exportBackup() { exportJSON(); return true; },
    importBackup() { importJSON(); return true; },
    exportTodos() { exportTodosToCalendar(live(state.todos).filter(t=>t.date),'情侣工作台待办'); return true; },
    addMessage(text) { const value = textWithinLimit(text, TEXT_LIMITS.message, '留言'); if (!value) return false; const message={ id: uid(), author: state.settings.me || 'a', text: value, createdAt: Date.now(), updatedAt: Date.now() }; state.messages.push(message); markPendingMessage(message.id); save(); return true; },
    lightWish(id) { const wish = state.wishes.find(x => x.id === id && !x.deleted); if (!wish || wish.lit) return false; wish.lit = true; wish.litAt = Date.now(); wish.updatedAt = Date.now(); save(); return true; },
    async addMessageFile(file, text) { const value = textWithinLimit(text, TEXT_LIMITS.message, '留言'); if (value === null || (!file && !value)) return false; const imageData = file ? await compressRoomImage(file) : ''; const stored = imageData ? await storeRoomImage(imageData) : { dataUrl: '', url: '' }; if (!stored) return false; const message={ id: uid(), author: state.settings.me || 'a', text: value, image: stored.dataUrl || stored.url, createdAt: Date.now(), updatedAt: Date.now() }; state.messages.push(message); markPendingMessage(message.id); save(); return true; },
    async addGalleryFile(file, caption) { const safeCaption = textWithinLimit(caption, TEXT_LIMITS.photoCaption, '照片说明'); if (!file || safeCaption === null || live(state.gallery).length >= GALLERY_MAX) return false; const dataUrl = await compressRoomImage(file); const stored = await storeRoomImage(dataUrl); if (!stored) return false; state.gallery.push({ id: uid(), author: state.settings.me || 'a', dataUrl: stored.dataUrl, url: stored.url, caption: safeCaption, createdAt: Date.now(), updatedAt: Date.now() }); save(); return true; },
    async addTravel(input, file) { const value=input||{}, place=textWithinLimit(value.place, TEXT_LIMITS.travelPlace, '地点'), note=textWithinLimit(value.note, TEXT_LIMITS.travelNote, '旅行记录'); if(!place||note===null)return false; let stored={dataUrl:'',url:''}; if(file){const dataUrl=await compressRoomImage(file);stored=await storeRoomImage(dataUrl);if(!stored)return false;} const lat=Number(value.lat),lng=Number(value.lng),status=value.status==='wish'?'wish':'visited'; state.travels.push({id:uid(),author:state.settings.me||'a',place,date:String(value.date||todayKey()),note,status,lat:Number.isFinite(lat)?Math.max(-90,Math.min(90,lat)):null,lng:Number.isFinite(lng)?Math.max(-180,Math.min(180,lng)):null,dataUrl:stored.dataUrl||'',url:stored.url||'',createdAt:Date.now(),updatedAt:Date.now()});save();return true; },
    drawFortuneNative() { const me = state.settings.me || 'a', date = todayKey(), sign = FORTUNE_SIGNS[Math.floor(Math.random() * FORTUNE_SIGNS.length)]; if (!state.fortune || state.fortune.date !== date) state.fortune = { date, by: { a: null, b: null } }; state.fortune.by[me] = { level: sign.level, cls: sign.cls, text: sign.text, tip: sign.tip, ts: Date.now() }; save(); return state.fortune.by[me]; }
  };
  // The Life UI owns the initial render when the page is in life-boot mode.
  // Keep the legacy dashboard available for compatibility, but do not try to
  // render it into elements that the Life shell intentionally omits.
  if (!document.documentElement.classList.contains('life-boot')) goPage('dashboard');
})();
