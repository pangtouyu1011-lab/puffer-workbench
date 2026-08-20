(() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[ch]);
  const live = items => (Array.isArray(items) ? items : []).filter(item => item && !item.deleted);
  const icon = name => `<i class="ph ph-${name}"></i>`;
  const dayKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const state = () => window.PufferLife?.getState?.() || null;
  const slot = name => root.querySelector(`[data-life-page="${name}"]`);
  const when = value => { const d = new Date(value || Date.now()); return Number.isFinite(d.getTime()) ? `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` : '刚刚'; };
  function syncStatus() { return window.PufferLife?.getSyncStatus?.() || { key:'local', label:'仅本机', joined:false }; }
  function messageReceiptMarkup(id) {
    const receipt=window.PufferLife?.getMessageReceipt?.(id);
    if(!receipt)return '';
    const tag=receipt.canRetry?'button':'span',retry=receipt.canRetry?' type="button" data-sync-retry aria-label="同步失败，点按重试"':'';
    return `<${tag} class="life-message-receipt is-${esc(receipt.key)}" data-message-receipt="${esc(id)}"${retry}>${icon(receipt.icon||'clock')}<span>${esc(receipt.label)}</span></${tag}>`;
  }
  function messageMetaMarkup(message, label) { const me=state()?.settings?.me||'a',receipt=message.author===me?messageReceiptMarkup(message.id):''; return `<footer class="life-message-meta"><time>${esc(label)}</time>${receipt}</footer>`; }
  const sameDay = value => dayKey(new Date(value || 0)) === dayKey();
  function takeReusableMedia(container) {
    const pool = new Map();
    container?.querySelectorAll('img[src]').forEach(image => {
      const source = image.getAttribute('src') || '';
      if (!source || /^\/?assets\//.test(source)) return;
      if (!pool.has(source)) pool.set(source, []);
      pool.get(source).push(image);
      image.remove();
    });
    return pool;
  }
  function restoreReusableMedia(container, pool) {
    if (!container || !pool?.size) return;
    container.querySelectorAll('img[src]').forEach(image => {
      const source = image.getAttribute('src') || '';
      const reusable = pool.get(source)?.shift();
      if (!reusable) return;
      reusable.className = image.className;
      reusable.alt = image.alt;
      if (image.loading) reusable.loading = image.loading;
      if (image.decoding) reusable.decoding = image.decoding;
      image.replaceWith(reusable);
    });
  }
  const root = document.createElement('div');
  root.id = 'lifeApp'; root.className = 'life-app';
  function lifeTimePhase(hour = new Date().getHours()) {
    if (hour >= 5 && hour < 11) return 'morning';
    if (hour >= 11 && hour < 18) return 'day';
    if (hour >= 18 && hour < 20) return 'evening';
    return 'night';
  }
  function syncTimeAtmosphere(now = new Date()) {
    const phase = lifeTimePhase(now.getHours());
    const changed = root.dataset.lifeTime !== phase;
    root.dataset.lifeTime = phase;
    document.body.dataset.lifeTime = phase;
    return changed;
  }
  const navMeta = { today:{label:'今天',icon:'sun'},days:{label:'日子',icon:'calendar-blank'},things:{label:'小事',icon:'note'},us:{label:'我们',icon:'heart'} };
  const pagePet = page => ({today:'puffer.webp',days:'puffer-page-days.webp',things:'puffer-page-things.webp',us:'puffer-page-us.webp'}[page] || 'puffer.webp');
  const navButton = page => `<button type="button" class="${page==='today'?'active':''}" data-life-tab="${page}" aria-label="${navMeta[page].label}" ${page==='today'?'aria-current="page"':''}>${page==='today'?`<img class="life-nav-pet" src="assets/${pagePet(page)}" alt="">`:icon(navMeta[page].icon)}<span>${navMeta[page].label}</span></button>`;
  root.innerHTML = `<section class="life-page active" data-life-page="today"></section><section class="life-page" data-life-page="days"></section><section class="life-page" data-life-page="things"></section><section class="life-page" data-life-page="us"></section><nav class="life-nav">${Object.keys(navMeta).map(navButton).join('')}</nav>`;
  document.body.append(root);
  const mask = document.createElement('div'); mask.className = 'life-sheet-mask'; document.body.append(mask);
  mask.addEventListener('touchmove', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.life-sheet-body')) event.preventDefault();
  }, { passive: false });
  const liveMessageNotice = document.createElement('button');
  liveMessageNotice.type = 'button';
  liveMessageNotice.id = 'lifeLiveMessageNotice';
  liveMessageNotice.className = 'life-live-message-notice';
  liveMessageNotice.setAttribute('aria-live', 'polite');
  liveMessageNotice.setAttribute('aria-atomic', 'true');
  liveMessageNotice.hidden = true;
  liveMessageNotice.innerHTML = `<span class="life-live-message-icon">${icon('chat-circle-text')}</span><span class="life-live-message-copy"><small></small><b></b></span><span class="life-live-message-action">查看</span>`;
  document.body.append(liveMessageNotice);
  mask.addEventListener('click', event => { const kind=event.target.closest('[data-travel-kind]'); if(!kind)return; const input=mask.querySelector('#lifeTravelStatus'); if(input){input.value=kind.dataset.travelKind;input.dispatchEvent(new Event('change',{bubbles:true}));} mask.querySelectorAll('[data-travel-kind]').forEach(button=>button.classList.toggle('active',button===kind)); });
  let calendarCursor = new Date();
  let photoCarouselTimer = null;
  let companionSheetTimer = null;
  let activeLifeTab = 'today';
  const tabScrollPositions = { today:0, days:0, things:0, us:0 };
  let tabTransitionTimer = null;
  let hydrationAudience = 'me';
  let tabTransitionToken = 0;
  let activeSheetDraft = null;
  let liveMessageNoticeTimer = null;
  let overlayScrollLock = null;
  let overlayHistoryKind = '';
  let overlayReturnFocus = null;
  let closingOverlayFromHistory = false;
  let companionNudgeFrame = null;
  let sheetViewportBaseline = 0;
  let sheetViewportFrame = null;
  let sheetKeyboardRestore = null;
  let sheetKeyboardWasOpen = false;
  let sheetKeyboardDock = null;
  let lastSheetField = null;
  let sheetCloseTimer = null;
  let sheetClosing = false;
  let sheetClosingFromHistory = false;
  let pendingCompanionReaction = null;
  let pendingCompanionReactionTimer = null;
  let lifeRenderReady = false;
  const REMOTE_UPDATE_TYPES = new Set(['messages','mood','fortune','todo','gallery','travel','wishes','challenge','hydration']);
  const REMOTE_UPDATE_SELECTORS = {
    messages: '[data-life-page="today"] .life-partner-note,[data-life-page="things"] [data-life-open="messages"]',
    mood: '.life-partner-mood',
    fortune: '.life-partner-fortune',
    todo: '[data-life-page="today"] .life-today-priority [data-life-open="todo"],[data-life-page="days"] .life-all-todos',
    gallery: '[data-life-page="things"] .life-things-gallery,[data-life-page="us"] [data-life-open="gallery"]',
    travel: '[data-life-page="things"] .life-things-travel,[data-life-page="us"] [data-life-open="travel"]',
    wishes: '[data-life-page="things"] [data-life-open="wishes"],[data-life-page="us"] [data-life-open="wishes"]',
    challenge: '.life-challenge-entry',
    hydration: '[data-hydration-audience="partner"]'
  };
  const REMOTE_UPDATE_TABS = {messages:['things'],mood:['today'],fortune:['today'],todo:['days'],gallery:['things'],travel:['things'],wishes:['things'],challenge:['today'],hydration:['today']};
  let remoteUpdateScopeKey = '';
  let remoteUnreadUpdates = new Set();
  let remotePendingHighlights = new Set();
  let remoteUpdateFrame = null;

  function currentRemoteUpdateScope() {
    const current=state(),room=current?.settings?.room,member=current?.settings?.me||'a';
    const roomId=room?.joined&&room.id?room.id:'local';
    return `puffer-remote-updates:v1:${encodeURIComponent(roomId)}:${member}`;
  }
  function ensureRemoteUpdateScope() {
    const key=currentRemoteUpdateScope();
    if(key===remoteUpdateScopeKey)return;
    remoteUpdateScopeKey=key;
    try{
      const saved=JSON.parse(localStorage.getItem(key)||'{}');
      remoteUnreadUpdates=new Set((saved.unread||[]).filter(value=>REMOTE_UPDATE_TYPES.has(value)));
      remotePendingHighlights=new Set((saved.pending||[]).filter(value=>REMOTE_UPDATE_TYPES.has(value)));
    }catch(_){remoteUnreadUpdates=new Set();remotePendingHighlights=new Set();}
  }
  function saveRemoteUpdateState() {
    ensureRemoteUpdateScope();
    try{localStorage.setItem(remoteUpdateScopeKey,JSON.stringify({unread:[...remoteUnreadUpdates],pending:[...remotePendingHighlights]}));}catch(_){}
  }
  function applyRemoteUpdateUi() {
    ensureRemoteUpdateScope();
    root.querySelectorAll('.life-remote-update-target').forEach(node=>{node.classList.remove('life-remote-update-target','has-remote-update');node.removeAttribute('data-remote-update-kind');});
    root.querySelectorAll('.life-nav [data-life-tab].has-remote-update').forEach(node=>node.classList.remove('has-remote-update'));
    remoteUnreadUpdates.forEach(kind=>{
      root.querySelectorAll(REMOTE_UPDATE_SELECTORS[kind]||'').forEach(node=>{node.classList.add('life-remote-update-target','has-remote-update');node.dataset.remoteUpdateKind=kind;});
      (REMOTE_UPDATE_TABS[kind]||[]).forEach(tab=>root.querySelector(`[data-life-tab="${tab}"]`)?.classList.add('has-remote-update'));
    });
    let consumed=false;
    const viewportTop=window.visualViewport?.offsetTop||0,navTop=root.querySelector('.life-nav')?.getBoundingClientRect().top??window.innerHeight;
    const viewportBottom=Math.min(viewportTop+(window.visualViewport?.height||window.innerHeight),navTop);
    remotePendingHighlights.forEach(kind=>{
      const targets=[...root.querySelectorAll(REMOTE_UPDATE_SELECTORS[kind]||'')].filter(node=>{
        if(!node.closest('.life-page')?.classList.contains('active'))return false;
        const rect=node.getBoundingClientRect();
        return rect.bottom>viewportTop&&rect.top<viewportBottom;
      });
      if(!targets.length)return;
      targets.forEach(node=>{node.classList.remove('is-remote-highlight');void node.offsetWidth;node.classList.add('is-remote-highlight');setTimeout(()=>node.classList.remove('is-remote-highlight'),1100);});
      remotePendingHighlights.delete(kind);consumed=true;
    });
    if(consumed)saveRemoteUpdateState();
  }
  function queueRemoteUpdateUi() {
    if(remoteUpdateFrame)return;
    remoteUpdateFrame=requestAnimationFrame(()=>{remoteUpdateFrame=null;applyRemoteUpdateUi();});
  }
  function registerRemoteUpdates(changes) {
    ensureRemoteUpdateScope();
    let changed=false;
    (Array.isArray(changes)?changes:[]).forEach(kind=>{
      if(!REMOTE_UPDATE_TYPES.has(kind))return;
      if(kind==='messages'&&mask.classList.contains('show')&&mask.querySelector('.life-chat-sheet'))return;
      remoteUnreadUpdates.add(kind);remotePendingHighlights.add(kind);changed=true;
    });
    if(!changed)return false;
    saveRemoteUpdateState();applyRemoteUpdateUi();return true;
  }
  function markRemoteUpdateRead(kind) {
    const normalized=kind==='partner-mood'?'mood':kind;
    if(!REMOTE_UPDATE_TYPES.has(normalized))return false;
    ensureRemoteUpdateScope();
    const unreadChanged=remoteUnreadUpdates.delete(normalized),highlightChanged=remotePendingHighlights.delete(normalized);
    if(!unreadChanged&&!highlightChanged)return false;
    saveRemoteUpdateState();applyRemoteUpdateUi();return true;
  }

  function finishActiveSheetDraft(save = true) {
    const draft = activeSheetDraft;
    activeSheetDraft = null;
    if (!draft) return;
    clearTimeout(draft.timer);
    clearInterval(draft.interval);
    if (save) draft.flush();
  }

  function syncRestoredDraftControls() {
    const travelStatus = mask.querySelector('#lifeTravelStatus')?.value;
    if (travelStatus) mask.querySelectorAll('[data-travel-kind]').forEach(button => button.classList.toggle('active', button.dataset.travelKind === travelStatus));
    const hydrationMl = mask.querySelector('#lifeHydrationMl')?.value;
    if (hydrationMl) mask.querySelectorAll('[data-hydration-ml]').forEach(button => button.classList.toggle('active', button.dataset.hydrationMl === hydrationMl));
    const mood = mask.querySelector('#lifeMoodValue')?.value;
    if (mood) applyMoodSelection(mood);
  }

  function bindSheetDraft() {
    const form = mask.querySelector('[data-life-draft]');
    if (!form) return;
    const scope = form.dataset.lifeDraft;
    const fields = [...form.querySelectorAll('[data-life-draft-field]')];
    if (!scope || !fields.length) return;
    const saved = window.PufferLife?.getInputDraft?.(scope)?.fields || {};
    fields.forEach(field => {
      const name = field.dataset.lifeDraftField;
      if (!Object.prototype.hasOwnProperty.call(saved, name)) return;
      if (field.type === 'checkbox' || field.type === 'radio') field.checked = saved[name] === '1';
      else field.value = saved[name];
    });
    syncRestoredDraftControls();
    const readFields = () => Object.fromEntries(fields.map(field => [
      field.dataset.lifeDraftField,
      field.type === 'checkbox' || field.type === 'radio' ? (field.checked ? '1' : '0') : field.value
    ]));
    const draft = {
      scope,
      timer: null,
      interval: null,
      lastSerialized: JSON.stringify(readFields()),
      flush() {
        const values = readFields();
        const serialized = JSON.stringify(values);
        if (serialized === draft.lastSerialized) return;
        draft.lastSerialized = serialized;
        window.PufferLife?.setInputDraft?.(scope, values);
      }
    };
    const schedule = () => {
      clearTimeout(draft.timer);
      draft.timer = setTimeout(() => draft.flush(), 180);
    };
    fields.forEach(field => {
      field.addEventListener('input', schedule);
      field.addEventListener('change', schedule);
    });
    draft.interval = setInterval(() => draft.flush(), 1000);
    activeSheetDraft = draft;
  }

  function clearSheetDraft(button) {
    const form = button?.closest('[data-life-draft]');
    const scope = form?.dataset.lifeDraft;
    if (!scope) return;
    if (activeSheetDraft?.scope === scope) finishActiveSheetDraft(false);
    window.PufferLife?.clearInputDraft?.(scope);
  }

  const sheetKeyboardActionSelector = '[data-save-message],[data-save-wish],[data-save-training],[data-save-travel],[data-save-todo],[data-save-mood],[data-save-hydration],[data-save-photo]';
  const isSheetEditable = node => node instanceof HTMLElement && node.matches('input:not([type="hidden"]):not([type="file"]),textarea,select,[contenteditable="true"]');

  function clearSheetKeyboardDock() {
    if (!sheetKeyboardDock) return;
    sheetKeyboardDock.observer?.disconnect();
    sheetKeyboardDock.dock?.remove();
    sheetKeyboardDock = null;
  }

  function showSheetKeyboardDock(field) {
    if (!field?.isConnected) return clearSheetKeyboardDock();
    const scope = field.closest('[data-life-draft],.life-message-composer,.life-travel-form,.life-travel-compose') || mask.querySelector('.life-sheet-body');
    const source = scope?.querySelector(sheetKeyboardActionSelector) || mask.querySelector(sheetKeyboardActionSelector);
    const sheet = mask.querySelector('.life-sheet');
    if (!source || !sheet) return clearSheetKeyboardDock();
    if (sheetKeyboardDock?.source === source && sheetKeyboardDock.dock?.isConnected) return;
    clearSheetKeyboardDock();
    const dock = document.createElement('div');
    dock.className = 'life-keyboard-dock';
    const proxy = source.cloneNode(true);
    proxy.type = 'button';
    proxy.removeAttribute('id');
    [...proxy.attributes].forEach(attribute => {
      if (attribute.name.startsWith('data-')) proxy.removeAttribute(attribute.name);
    });
    const syncProxy = () => {
      if (!source.isConnected || !proxy.isConnected) return;
      proxy.innerHTML = source.innerHTML;
      proxy.disabled = source.disabled;
      proxy.className = `${source.className} life-keyboard-action`.trim();
      if (source.hasAttribute('aria-busy')) proxy.setAttribute('aria-busy', source.getAttribute('aria-busy'));
      else proxy.removeAttribute('aria-busy');
    };
    proxy.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (!source.disabled) source.click();
      requestAnimationFrame(syncProxy);
    });
    dock.append(proxy);
    sheet.append(dock);
    const observer = new MutationObserver(syncProxy);
    observer.observe(source, { attributes:true, childList:true, subtree:true, characterData:true });
    sheetKeyboardDock = { dock, proxy, source, observer };
    syncProxy();
  }

  function sheetScrollContainer(field = lastSheetField) {
    return field?.closest?.('.life-travel-panel') || mask.querySelector('.life-sheet-body');
  }

  function ensureSheetFieldVisible(field) {
    if (!field?.isConnected || !sheetKeyboardDock?.dock?.isConnected) return;
    const container = sheetScrollContainer(field);
    if (!container) return;
    const visual = window.visualViewport;
    const viewportTop = Math.round(visual?.offsetTop || 0);
    const containerRect = container.getBoundingClientRect();
    const fieldRect = field.getBoundingClientRect();
    const dockRect = sheetKeyboardDock.dock.getBoundingClientRect();
    const visibleTop = Math.max(viewportTop + 10, containerRect.top + 10);
    const visibleBottom = Math.min(viewportTop + (visual?.height || window.innerHeight) - 10, containerRect.bottom - 10, dockRect.top - 10);
    if (fieldRect.bottom > visibleBottom) container.scrollTop += fieldRect.bottom - visibleBottom;
    else if (fieldRect.top < visibleTop) container.scrollTop -= visibleTop - fieldRect.top;
  }

  function syncSheetViewport(ensureField = false) {
    sheetViewportFrame = null;
    if (!mask.classList.contains('show')) return;
    const visual = window.visualViewport;
    const visualHeight = Math.max(1, Math.round(visual?.height || window.innerHeight));
    const visualTop = Math.max(0, Math.round(visual?.offsetTop || 0));
    if (!sheetViewportBaseline) sheetViewportBaseline = Math.max(window.innerHeight, visualHeight);
    const keyboardDelta = Math.max(0, sheetViewportBaseline - visualHeight);
    const keyboardOpen = keyboardDelta > 96 && !!lastSheetField?.isConnected;
    mask.style.setProperty('--life-visual-height', `${visualHeight}px`);
    mask.style.setProperty('--life-visual-top', `${visualTop}px`);
    mask.classList.toggle('is-keyboard-open', keyboardOpen);
    if (keyboardOpen) {
      sheetKeyboardWasOpen = true;
      showSheetKeyboardDock(lastSheetField);
      if (ensureField) requestAnimationFrame(() => ensureSheetFieldVisible(lastSheetField));
      return;
    }
    clearSheetKeyboardDock();
    if (sheetKeyboardWasOpen && sheetKeyboardRestore?.container?.isConnected) {
      sheetKeyboardRestore.container.scrollTop = sheetKeyboardRestore.scrollTop;
    }
    sheetKeyboardWasOpen = false;
    if (!isSheetEditable(document.activeElement) || !mask.contains(document.activeElement)) {
      lastSheetField = null;
      sheetKeyboardRestore = null;
      sheetViewportBaseline = Math.max(window.innerHeight, visualHeight);
    }
  }

  function queueSheetViewportSync(ensureField = false) {
    if (sheetViewportFrame) cancelAnimationFrame(sheetViewportFrame);
    sheetViewportFrame = requestAnimationFrame(() => syncSheetViewport(ensureField));
  }

  function resetSheetViewport() {
    if (sheetViewportFrame) cancelAnimationFrame(sheetViewportFrame);
    sheetViewportFrame = null;
    clearSheetKeyboardDock();
    sheetKeyboardRestore = null;
    sheetKeyboardWasOpen = false;
    lastSheetField = null;
    const visual = window.visualViewport;
    sheetViewportBaseline = Math.max(window.innerHeight, visual?.height || 0);
    mask.classList.remove('is-keyboard-open');
    mask.style.setProperty('--life-visual-height', `${Math.max(1, Math.round(visual?.height || window.innerHeight))}px`);
    mask.style.setProperty('--life-visual-top', `${Math.max(0, Math.round(visual?.offsetTop || 0))}px`);
  }

  function lockPageScroll() {
    if (overlayScrollLock) return;
    overlayScrollLock = { y: window.scrollY };
    document.body.classList.add('life-sheet-open');
    document.documentElement.classList.add('life-sheet-open');
  }

  function unlockPageScroll() {
    const lock = overlayScrollLock;
    if (!lock) return;
    overlayScrollLock = null;
    document.body.classList.remove('life-sheet-open');
    document.documentElement.classList.remove('life-sheet-open');
    if (Math.abs(window.scrollY - lock.y) > 1) {
      window.scrollTo(0, lock.y);
    }
  }

  function beginOverlaySession(kind, focusTarget) {
    if (!overlayHistoryKind) {
      overlayReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      lockPageScroll();
      const previous = history.state && typeof history.state === 'object' ? history.state : {};
      try {
        if (previous.pufferOverlay !== kind) history.pushState({ ...previous, pufferOverlay:kind }, '', location.href);
      } catch (_) {}
    }
    overlayHistoryKind = kind;
    requestAnimationFrame(() => {
      try { focusTarget?.focus?.({ preventScroll:true }); } catch (_) { focusTarget?.focus?.(); }
    });
  }

  function finishOverlaySession(kind, fromHistory = false) {
    if (overlayHistoryKind !== kind) return;
    const focusTarget = overlayReturnFocus;
    const ownsHistoryEntry = history.state?.pufferOverlay === kind;
    overlayHistoryKind = '';
    overlayReturnFocus = null;
    unlockPageScroll();
    requestAnimationFrame(() => {
      if (!focusTarget?.isConnected) return;
      try { focusTarget.focus({ preventScroll:true }); } catch (_) { focusTarget.focus(); }
    });
    if (!fromHistory && ownsHistoryEntry) history.back();
  }

  function openSheet(html, modifier = '') {
    // A notification or a fast tap can open a sheet before DOMContentLoaded's
    // first render. Ensure the page underneath the sheet is not an empty shell.
    const activePage = root.querySelector('.life-page.active');
    if (!lifeRenderReady || !activePage?.children.length) {
      try { render(); lifeRenderReady = true; } catch (_) {}
    }
    const reopeningAfterHistoryClose = sheetClosing && sheetClosingFromHistory;
    const reuseOverlay = (mask.classList.contains('show') || sheetClosing) && !reopeningAfterHistoryClose;
    if (reopeningAfterHistoryClose) finishOverlaySession('life-sheet', true);
    clearTimeout(sheetCloseTimer);
    sheetCloseTimer = null;
    sheetClosing = false;
    sheetClosingFromHistory = false;
    mask.classList.remove('is-closing');
    removeCompanionNudge();
    finishActiveSheetDraft(true);
    mask.innerHTML = `<section class="life-sheet ${esc(modifier)}" role="dialog" aria-modal="true"><div class="life-sheet-top"><div class="life-sheet-handle"></div><button class="life-sheet-close" data-sheet-close aria-label="关闭">×</button></div><div class="life-sheet-body">${html}</div></section>`;
    if (!mask.classList.contains('show')) { mask.classList.remove('show'); void mask.offsetWidth; }
    mask.classList.add('show');
    resetSheetViewport();
    if (!reuseOverlay) beginOverlaySession('life-sheet', mask.querySelector('.life-sheet-close'));
    bindSheetDraft();
    bindLifeFormFeedback();
    queueSheetViewportSync();
    const sheet = mask.querySelector('.life-sheet'), top = mask.querySelector('.life-sheet-top');
    let start = 0, offset = 0, dragging = false;
    top.addEventListener('pointerdown', e => { dragging = true; start = e.clientY; offset = 0; top.setPointerCapture?.(e.pointerId); sheet.style.transition = 'none'; });
    top.addEventListener('pointermove', e => { if (!dragging) return; offset = Math.max(0, e.clientY - start); sheet.style.transform = `translateY(${offset}px)`; });
    top.addEventListener('pointerup', () => { if (!dragging) return; dragging = false; sheet.style.transition = 'transform 210ms cubic-bezier(.22,.61,.36,1)'; if (offset > 112) closeSheet(false, true); else sheet.style.transform = 'translateY(0)'; });
    top.addEventListener('pointercancel', () => { if (!dragging) return; dragging = false; sheet.style.transition = 'transform 210ms cubic-bezier(.22,.61,.36,1)'; sheet.style.transform = 'translateY(0)'; });
  }
  function closeSheet(fromHistory = false, dragged = false) {
    const wasOpen = mask.classList.contains('show');
    if (!wasOpen || sheetClosing) return false;
    sheetClosing = true;
    sheetClosingFromHistory = !!fromHistory;
    finishActiveSheetDraft(true);
    clearTimeout(companionSheetTimer);
    companionSheetTimer=null;
    const preview = mask.querySelector('#lifeMessageImagePreview');
    if (preview?.dataset.objectUrl) URL.revokeObjectURL(preview.dataset.objectUrl);
    const sheet = mask.querySelector('.life-sheet');
    if (sheet) {
      sheet.style.transition = 'transform 210ms cubic-bezier(.22,.61,.36,1),opacity 180ms ease';
      if (dragged) sheet.style.transform = 'translateY(100%)';
      else { sheet.style.removeProperty('transform'); }
    }
    mask.classList.add('is-closing');
    mask.classList.remove('show');
    const duration=window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?0:210;
    clearTimeout(sheetCloseTimer);
    const finishClose=()=>{
      if(!sheetClosing)return;
      sheetClosing=false;
      sheetClosingFromHistory=false;
      sheetCloseTimer=null;
      mask.classList.remove('is-closing');
      resetSheetViewport();
      mask.innerHTML='';
      finishOverlaySession('life-sheet', fromHistory);
      setTimeout(maybeOfferReview, duration?40:0);
    };
    if(duration)sheetCloseTimer=setTimeout(finishClose,duration);else finishClose();
    return true;
  }
  mask.addEventListener('focusin', event => {
    if (!isSheetEditable(event.target)) return;
    lastSheetField = event.target;
    const container = sheetScrollContainer(lastSheetField);
    if (!sheetKeyboardRestore || sheetKeyboardRestore.container !== container) {
      sheetKeyboardRestore = { container, scrollTop:container?.scrollTop || 0 };
    }
    queueSheetViewportSync(true);
    setTimeout(() => queueSheetViewportSync(true), 120);
    setTimeout(() => queueSheetViewportSync(true), 320);
  });
  mask.addEventListener('focusout', () => {
    setTimeout(() => {
      if (isSheetEditable(document.activeElement) && mask.contains(document.activeElement)) lastSheetField = document.activeElement;
      queueSheetViewportSync(true);
    }, 0);
  });
  window.visualViewport?.addEventListener('resize', () => queueSheetViewportSync(true));
  window.visualViewport?.addEventListener('scroll', () => queueSheetViewportSync(true));
  window.addEventListener('orientationchange', () => setTimeout(() => queueSheetViewportSync(true), 120));
  function hideLiveMessageNotice(immediate = false) {
    clearTimeout(liveMessageNoticeTimer);
    liveMessageNoticeTimer = null;
    liveMessageNotice.classList.remove('show');
    if (immediate) liveMessageNotice.hidden = true;
    else setTimeout(() => { if (!liveMessageNotice.classList.contains('show')) { liveMessageNotice.hidden = true; maybeOfferReview(); } }, 180);
  }
  function messageHistoryMarkup(s) {
    const me=s.settings?.me||'a',names=s.settings?.partners||{},chats=live(s.messages).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)).slice(-40);
    return chats.map(m=>`<article class="life-chat ${m.author===me?'mine':''}" data-life-message-id="${esc(m.id)}">${m.image?`<img class="life-chat-image" loading="lazy" decoding="async" src="${esc(m.image)}" alt="留言图片">`:''}<p>${esc(m.text)||'发来了一张照片'}</p>${messageMetaMarkup(m,`${m.author===me?(names[me]||'我'):(names[m.author]||'TA')} · ${when(m.createdAt)}`)}</article>`).join('')||'<div class="life-chat-empty">还没有对话，先留一句给 TA 吧。</div>';
  }
  function refreshOpenMessageSheet(forceScroll = false) {
    const panel=mask.querySelector('.life-chat-sheet'),history=panel?.querySelector('.life-message-history'),s=state();
    if(!mask.classList.contains('show')||!panel||!history||!s)return false;
    const nearBottom=history.scrollHeight-history.scrollTop-history.clientHeight<72;
    history.innerHTML=messageHistoryMarkup(s);
    if(forceScroll||nearBottom)requestAnimationFrame(()=>{history.scrollTop=history.scrollHeight;});
    return true;
  }
  function showLiveMessageNotice(detail) {
    const messages=Array.isArray(detail?.messages)?detail.messages.filter(Boolean):[];
    if(!messages.length)return;
    if(mask.classList.contains('show')&&mask.querySelector('.life-chat-sheet')){
      hideLiveMessageNotice(true);
      window.PufferLife?.markMessagesRead?.();
      refreshOpenMessageSheet(true);
      return;
    }
    const s=state(),last=messages[messages.length-1],names=s?.settings?.partners||{},who=names[last.author]||'TA',preview=String(last.text||'发来了一张照片').trim();
    liveMessageNotice.querySelector('small').textContent=messages.length>1?`${who} 发来 ${messages.length} 条新留言`:`${who} 发来一条新留言`;
    liveMessageNotice.querySelector('b').textContent=preview;
    liveMessageNotice.setAttribute('aria-label',`${who} 的新留言：${preview}，点按查看`);
    liveMessageNotice.hidden=false;
    requestAnimationFrame(()=>liveMessageNotice.classList.add('show'));
    clearTimeout(liveMessageNoticeTimer);
    liveMessageNoticeTimer=setTimeout(()=>hideLiveMessageNotice(),5600);
  }
  let lifeFeedbackSequence = 0;
  function lifeFormScope(button) { return button?.closest('[data-life-draft]') || button?.closest('.life-chat-sheet,.life-travel-compose') || mask.querySelector('.life-sheet-body'); }
  function removeLifeFieldError(field) {
    if (!field) return;
    const errorId = field.dataset.lifeErrorId;
    if (errorId) document.getElementById(errorId)?.remove();
    delete field.dataset.lifeErrorId;
    field.classList.remove('is-invalid');
    field.removeAttribute('aria-invalid');
    field.removeAttribute('aria-errormessage');
  }
  function clearLifeFormFeedback(button) {
    const form = lifeFormScope(button);
    form?.querySelectorAll('.is-invalid').forEach(removeLifeFieldError);
    form?.querySelectorAll('.life-field-error').forEach(node => node.remove());
    const feedback = form?.querySelector('.life-form-feedback');
    if (feedback) { feedback.hidden = true; feedback.textContent = ''; feedback.className = 'life-form-feedback'; }
  }
  function lifeFormFeedbackNode(button) {
    const form = lifeFormScope(button);
    if (!form) return null;
    let feedback = form.querySelector('.life-form-feedback');
    if (!feedback) {
      feedback = document.createElement('p');
      feedback.className = 'life-form-feedback';
      feedback.hidden = true;
      const anchor = button?.closest('.life-message-actions') || button;
      if (anchor) anchor.insertAdjacentElement('beforebegin', feedback);
      else form.append(feedback);
    }
    return feedback;
  }
  function showLifeFormFeedback(button, message, type = 'error') {
    const feedback = lifeFormFeedbackNode(button);
    if (!feedback) return;
    feedback.className = `life-form-feedback is-${type}`;
    feedback.setAttribute('role', type === 'error' ? 'alert' : 'status');
    feedback.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    feedback.textContent = message;
    feedback.hidden = false;
  }
  function showLifeFieldError(button, field, message, focusTarget = field) {
    if (!field) { showLifeFormFeedback(button, message); return false; }
    removeLifeFieldError(field);
    const error = document.createElement('p');
    const errorId = `life-field-error-${++lifeFeedbackSequence}`;
    error.id = errorId;
    error.className = 'life-field-error';
    error.setAttribute('role', 'alert');
    error.textContent = message;
    field.dataset.lifeErrorId = errorId;
    field.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');
    field.setAttribute('aria-errormessage', errorId);
    field.insertAdjacentElement('afterend', error);
    requestAnimationFrame(() => {
      focusTarget?.focus?.({ preventScroll: true });
      focusTarget?.scrollIntoView?.({ block: 'center', behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
    return false;
  }
  function bindLifeFormFeedback() {
    mask.querySelectorAll('textarea[maxlength],input[maxlength]').forEach(field => {
      if (field.type === 'hidden') return;
      const counter = document.createElement('span');
      counter.className = 'life-field-counter';
      const update = () => {
        const length = [...String(field.value || '')].length;
        counter.textContent = `${length}/${field.maxLength}`;
        counter.classList.toggle('is-near-limit', length >= field.maxLength * .8);
      };
      field.insertAdjacentElement('afterend', counter);
      field.addEventListener('input', update);
      update();
    });
    mask.querySelectorAll('input,textarea,select').forEach(field => {
      const clear = () => {
        removeLifeFieldError(field);
        const feedback = lifeFormScope(field)?.querySelector('.life-form-feedback');
        if (feedback?.classList.contains('is-error')) { feedback.hidden = true; feedback.textContent = ''; }
      };
      field.addEventListener('input', clear);
      field.addEventListener('change', clear);
    });
  }
  function validateLifeSubmission(button) {
    clearLifeFormFeedback(button);
    const scope = lifeFormScope(button);
    const tooLong = [...(scope?.querySelectorAll('textarea[maxlength],input[maxlength]') || [])].find(field => [...String(field.value || '')].length > field.maxLength);
    if (tooLong) return showLifeFieldError(button, tooLong, `最多可以填写 ${tooLong.maxLength} 个字`);
    if (button.matches('[data-save-travel]')) {
      const field = mask.querySelector('#lifeTravelPlace');
      if (!field?.value.trim()) return showLifeFieldError(button, field, '请先填写这次旅行的地点');
    }
    if (button.matches('[data-save-hydration]')) {
      const field = mask.querySelector('#lifeHydrationMl'), amount = Number(field?.value);
      if (!field?.value || !Number.isFinite(amount) || amount < 1 || amount > 3000) return showLifeFieldError(button, field, '请输入 1–3000 ml 的饮用量');
    }
    if (button.matches('[data-save-mood]')) {
      const field = mask.querySelector('#lifeMoodValue');
      if (!field?.value) return showLifeFieldError(button, field, '请先选择现在的心情', mask.querySelector('[data-life-mood]'));
    }
    if (button.matches('[data-save-todo]')) {
      const field = mask.querySelector('#lifeTodoText');
      if (!field?.value.trim()) return showLifeFieldError(button, field, '请先写下要完成的事情');
    }
    if (button.matches('[data-save-training]')) {
      const field = mask.querySelector('#lifeTrainContent');
      if (!field?.value.trim()) return showLifeFieldError(button, field, '请先填写今天的训练内容');
    }
    if (button.matches('[data-save-message]')) {
      const field = mask.querySelector('#lifeMessageText'), file = mask.querySelector('#lifeMessageImage')?.files?.[0];
      if (!field?.value.trim() && !file) return showLifeFieldError(button, field, '写一句话，或者选择一张照片再发送');
    }
    if (button.matches('[data-save-photo]')) {
      const field = mask.querySelector('#lifePhotoFile');
      if (!field?.files?.[0]) return showLifeFieldError(button, field, '请先选择一张要保存的照片');
      if (live(state()?.gallery).length >= 5) return showLifeFieldError(button, field, '共同相册最多保留 5 张照片，请先整理旧照片');
    }
    if (button.matches('[data-save-wish]')) {
      const field = mask.querySelector('#lifeWishText');
      if (!field?.value.trim()) return showLifeFieldError(button, field, '请先写下一个小心愿');
    }
    return true;
  }
  function notifyLifeSaved(label) {
    const message = syncStatus().joined ? `${label}已保存，正在同步` : `${label}已保存到本机`;
    window.PufferLife?.notify?.(message, 'success');
  }
  function lifeSubmissionError(error) {
    const message = String(error?.message || '').trim();
    return message && message !== 'Failed to fetch' ? message : '没有保存成功，请检查网络后重试';
  }
  const lifeSubmissionLocks = new Set();
  const lifeSubmitSelector = '[data-save-travel],[data-save-hydration],[data-save-mood],[data-save-todo],[data-save-training],[data-save-message],[data-save-photo],[data-save-wish],[data-life-draw-fortune]';
  async function runLifeSubmission(button, task) {
    const key='life-sheet-submit';
    if(!button||lifeSubmissionLocks.has(key)||button.dataset.submitting==='1')return false;
    if(!validateLifeSubmission(button))return false;
    lifeSubmissionLocks.add(key);
    button.dataset.submitting='1';
    button.disabled=true;
    button.setAttribute('aria-busy','true');
    button.classList.add('is-submitting');
    showLifeFormFeedback(button, button.matches('[data-save-travel],[data-save-message],[data-save-photo]')?'正在处理图片并保存，请稍候…':'正在保存…', 'info');
    try{const ok=await task();if(!ok&&button.isConnected)showLifeFormFeedback(button,'没有保存成功，请检查填写内容后重试');return ok;}
    catch(error){const message=lifeSubmissionError(error);showLifeFormFeedback(button,message);window.PufferLife?.notify?.(message,'error');return false;}
    finally{lifeSubmissionLocks.delete(key);delete button.dataset.submitting;button.disabled=false;button.removeAttribute('aria-busy');button.classList.remove('is-submitting');}
  }
  async function handleLifeSubmission(button) {
    return runLifeSubmission(button,async()=>{
      if(button.matches('[data-save-travel]')){const data={place:mask.querySelector('#lifeTravelPlace')?.value,date:mask.querySelector('#lifeTravelDate')?.value,status:mask.querySelector('#lifeTravelStatus')?.value,note:mask.querySelector('#lifeTravelNote')?.value,lat:mask.querySelector('#lifeTravelLat')?.value,lng:mask.querySelector('#lifeTravelLng')?.value},file=mask.querySelector('#lifeTravelPhoto')?.files?.[0],ok=await window.PufferLife?.addTravel?.(data,file);if(ok){clearSheetDraft(button);travelSheet();notifyLifeSaved('旅行记录');}return !!ok;}
      if(button.matches('[data-save-hydration]')){const ok=window.PufferLife?.addHydration?.(button.dataset.saveHydration,mask.querySelector('#lifeHydrationMl')?.value);if(ok){clearSheetDraft(button);closeSheet();requestCompanionReaction('hydration');}return !!ok;}
      if(button.matches('[data-save-mood]')){const ok=window.PufferLife?.setDailyStatus?.(state().settings?.me||'a',mask.querySelector('#lifeMoodValue')?.value||mask.querySelector('[data-life-mood].active')?.dataset.lifeMood||'',mask.querySelector('#lifeMoodNote')?.value||'');if(ok){clearSheetDraft(button);closeSheet();notifyLifeSaved('心情');}return !!ok;}
      if(button.matches('[data-save-todo]')){const data={text:mask.querySelector('#lifeTodoText')?.value,date:mask.querySelector('#lifeTodoDate')?.value,priority:mask.querySelector('#lifeTodoPriority')?.value},ok=button.dataset.saveTodo?window.PufferLife?.updateTodo?.(button.dataset.saveTodo,data):window.PufferLife?.addTodo?.(data);if(ok){clearSheetDraft(button);closeSheet();notifyLifeSaved('待办');}return !!ok;}
      if(button.matches('[data-save-training]')){const data={content:mask.querySelector('#lifeTrainContent')?.value,date:mask.querySelector('#lifeTrainDate')?.value,muscle:mask.querySelector('#lifeTrainMuscle')?.value,duration:mask.querySelector('#lifeTrainDuration')?.value,note:mask.querySelector('#lifeTrainNote')?.value},ok=button.dataset.saveTraining?window.PufferLife?.updateTraining?.(button.dataset.saveTraining,data):window.PufferLife?.addTraining?.(data);if(ok){clearSheetDraft(button);closeSheet();notifyLifeSaved('训练记录');}return !!ok;}
      if(button.matches('[data-save-message]')){const file=mask.querySelector('#lifeMessageImage')?.files?.[0],text=mask.querySelector('#lifeMessageText')?.value||'',ok=file?await window.PufferLife?.addMessageFile?.(file,text):window.PufferLife?.addMessage?.(text);if(ok){clearSheetDraft(button);closeSheet();notifyLifeSaved('留言');requestCompanionReaction('message');}return !!ok;}
      if(button.matches('[data-save-photo]')){const file=mask.querySelector('#lifePhotoFile')?.files?.[0],ok=file&&await window.PufferLife?.addGalleryFile?.(file,mask.querySelector('#lifePhotoCaption')?.value);if(ok){clearSheetDraft(button);closeSheet();notifyLifeSaved('照片');}return !!ok;}
      if(button.matches('[data-save-wish]')){const ok=window.PufferLife?.addWish?.({text:mask.querySelector('#lifeWishText')?.value,icon:'✨'});if(ok){clearSheetDraft(button);closeSheet();notifyLifeSaved('心愿');}return !!ok;}
      if(button.matches('[data-life-draw-fortune]')){const ok=window.PufferLife?.drawFortuneNative?.();if(ok)fortuneSheet();return !!ok;}
      return false;
    });
  }
  function selectTab(page) {
    const target = slot(page);
    if (!target || !navMeta[page]) return;
    const previousPage = activeLifeTab;
    const changed = activeLifeTab !== page;
    if (changed) tabScrollPositions[previousPage] = window.scrollY;
    activeLifeTab = page;
    const transitionToken = ++tabTransitionToken;
    clearTimeout(tabTransitionTimer);
    tabTransitionTimer = null;
    root.querySelectorAll('.life-page').forEach(node => {
      node.classList.remove('life-page-entering');
      node.classList.toggle('active', node === target);
    });
    root.querySelectorAll('[data-life-tab]').forEach(node => {
      const tabPage = node.dataset.lifeTab, active = tabPage === page;
      node.classList.toggle('active', active);
      if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
      node.innerHTML = `${active ? `<img class="life-nav-pet" src="assets/${pagePet(tabPage)}" alt="">` : icon(navMeta[tabPage].icon)}<span>${navMeta[tabPage].label}</span>`;
    });
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (changed && !reduceMotion) {
      target.classList.add('life-page-entering');
      tabTransitionTimer = setTimeout(() => {
        if (transitionToken === tabTransitionToken) target.classList.remove('life-page-entering');
        tabTransitionTimer = null;
      }, 240);
    }
    renderCompanionFloat(state());
    renderCompanionNudge(state());
    applyRemoteUpdateUi();
    if (page === 'today') maybeOfferReview();
    const targetScroll = changed ? tabScrollPositions[page] || 0 : 0;
    requestAnimationFrame(() => {
      if (!changed && !reduceMotion) window.scrollTo({ top:0, left:0, behavior:'smooth' });
      else window.scrollTo(0, targetScroll);
    });
  }
  function weatherInfo(s) { const w = s.weather || {}, code = w.code, seed = Number(`${new Date().getFullYear()}${new Date().getMonth()+1}${new Date().getDate()}`) + (Number(code) || 0), pick = list => list[Math.abs(seed) % list.length]; if ([0,1].includes(code)) return { label:'今天晴朗', temp:`${w.temp ?? '--'}° · 晴`, copy:pick(['天气不错，<br>适合一起出门走走。','阳光正好，<br>把散步留给傍晚。','晒晒太阳，<br>今天会是好日子。']), pet:'weather-sunny-pet.webp' }; if ([71,73,75,77,85,86].includes(code)) return { label:'今天有雪', temp:`${w.temp ?? '--'}° · 雪`, copy:pick(['注意保暖，<br>回家一起喝杯热的。','雪天慢一点，<br>把手揣暖再出门。','路面会湿滑，<br>今天走慢一点。']), pet:'weather-snow-pet.webp' }; if ([51,53,55,56,57,61,63,65,66,67,80,81,82].includes(code)) return { label:'今天有雨', temp:`${w.temp ?? '--'}° · 雨`, copy:pick(['记得带伞，<br>回来一起喝杯热的。','雨声很轻，<br>路上慢一点走。','下雨天也好，<br>适合早点回家。']), pet:'weather-rain-pet.webp' }; return { label:'今天多云', temp:`${w.temp ?? '--'}° · 阴`, copy:pick(['云会慢慢散开，<br>傍晚适合一起走走。','阴天也温柔，<br>一起慢慢走回家。','风有一点凉，<br>出门记得带外套。']), pet:'weather-cloud-pet.webp' }; }
  // 新陪伴形象仅由既有状态推导；拖动位置只保存在当前设备，不进入房间同步。
  function companionPet(s) { const me=s.settings?.me||'a', ta=me==='a'?'b':'a', mood=String(s.dailyStatus?.[dayKey()]?.[ta]?.mood||'').trim(), phase=lifeTimePhase(); if(phase==='night') return {asset:'puffer-state-goodnight.webp',label:'晚安陪伴',tone:'goodnight'}; if(activeLifeTab==='days') return {asset:'puffer-page-days.webp',label:'日子陪伴',tone:'days'}; if(activeLifeTab==='things') return {asset:'puffer-page-things.webp',label:'小事陪伴',tone:'things'}; if(activeLifeTab==='us') return {asset:'puffer-page-us.webp',label:'我们的小窝',tone:'home'}; if(mood==='想你') return {asset:'puffer-state-missing.webp',label:'想你',tone:'missing'}; if(mood==='开心') return {asset:'puffer-state-happy.webp',label:'开心',tone:'happy'}; if(phase==='morning') return {asset:'puffer-state-happy.webp',label:'早安陪伴',tone:'morning'}; if(phase==='evening') return {asset:'puffer-state-missing.webp',label:'傍晚陪伴',tone:'evening'}; return {asset:'puffer-state-quiet.webp',label:'安静陪伴',tone:'quiet'}; }
  // 保留心情选择事件的兼容入口；页面内不再渲染新形象。
  function statusPet(mood) { return companionPet({settings:{me:'a'},dailyStatus:{[dayKey()]:{a:{mood}}},interactionHistory:{}}); }
  function keyOf(value) { const d=new Date(value||0); return Number.isFinite(d.getTime())?dayKey(d):''; }
  function rediscovery(s) { const markers=[365,100,30,7], gallery=live(s.gallery).filter(x=>x.dataUrl||x.url), messages=live(s.messages); for(const days of markers){const date=new Date();date.setDate(date.getDate()-days);const key=dayKey(date),photo=gallery.find(x=>keyOf(x.createdAt)===key),message=messages.find(x=>keyOf(x.createdAt)===key);if(photo)return {id:`photo:${photo.id||key}`,days,type:'photo',title:`${days} 天前的这张照片`,text:photo.caption||'你们那天留下的共同瞬间。',image:photo.dataUrl||photo.url};if(message)return {id:`message:${message.id||key}`,days,type:'message',title:`${days} 天前的一句话`,text:message.text||'那天，TA 发来了一张照片。',image:message.image||''};}return null; }
  let companionAiLine=null, companionAiPending='';
  function greetingSlot(hour=new Date().getHours()){return hour>=5&&hour<11?'morning':hour>=11&&hour<14?'noon':hour>=14&&hour<18?'afternoon':hour>=18&&hour<20?'evening':'night';}
  function scheduledGreeting(s) { const hour=new Date().getHours(), me=s.settings?.me||'a', ta=me==='a'?'b':'a', weather=weatherInfo(s), todos=live(s.todos).filter(t=>!t.done&&(!t.date||t.date===dayKey())), messages=live(s.messages).filter(x=>sameDay(x.createdAt)), photos=live(s.gallery).filter(x=>(x.dataUrl||x.url)&&sameDay(x.createdAt)), status=s.dailyStatus?.[dayKey()]?.[ta]?.mood||'', pet=companionPet(s), todoHint=todos[0]?`先从「${todos[0].text}」开始也很好。`:'今天的安排还很轻，慢慢开始也很好。'; const ai=companionAiLine?.day===dayKey()&&companionAiLine?.slot===greetingSlot()?companionAiLine.line:''; if(hour>=5&&hour<11)return {id:'greeting:morning',kind:'greeting',title:'胖头鱼的早安',text:ai||`${weather.label}，早上慢慢来。${todoHint}`,asset:pet.asset}; if(hour>=11&&hour<14)return {id:'greeting:noon',kind:'greeting',title:'胖头鱼的午间提醒',text:ai||(status?`到中午啦，先吃点东西、休息一会儿。TA 今天是「${status}」，有空可以回一句。`:'到中午啦，先吃点东西、休息一会儿。吃饭前也可以给 TA 留一句话。'),asset:pet.asset}; if(hour>=14&&hour<18)return {id:'greeting:afternoon',kind:'greeting',title:'胖头鱼的下午加油',text:ai||(todos.length?`下午好，先喝几口水再继续。今天还有 ${todos.length} 件小事，慢慢做就好。`:'下午好，喝几口水再继续。今天没有着急的待办，也别忘了照顾自己。'),asset:pet.asset}; if(hour>=18&&hour<20)return {id:'greeting:evening',kind:'greeting',title:'胖头鱼的傍晚问候',text:ai||`${weather.label}，天色慢慢晚了。${messages.length||photos.length?'今天已经留下了一点共同生活。':'有空时，和 TA 说说今天发生的小事吧。'}`,asset:pet.asset}; return {id:'greeting:night',kind:'greeting',title:'胖头鱼的晚安',text:ai||`今天收下了 ${photos.length} 张照片、${messages.length} 句话。${photos.length||messages.length?'去把今天好好收进回顾里吧。':'还没有留下记录，也可以只说一句晚安。'}`,action:'review',actionLabel:'一起回顾今天',asset:pet.asset}; }
  async function fetchCompanionAiLine(s){const room=s?.settings?.room||{},slot=greetingSlot(),cacheKey=`puffer-companion-ai:${room.id||''}:${dayKey()}:${slot}`;if(!room.joined||room.backend==='supabase'||!room.url||!room.id||!room.pass||companionAiPending===cacheKey)return;try{const local=JSON.parse(localStorage.getItem(cacheKey)||'null');if(local?.line){companionAiLine=local;return;}}catch(_){}companionAiPending=cacheKey;try{const res=await fetch(`${String(room.url).replace(/\/$/,'')}/api/v1/rooms/${encodeURIComponent(room.id)}/companion`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:room.pass})});const data=await res.json();if(res.ok&&data?.line){companionAiLine={line:String(data.line),day:data.day||dayKey(),slot:data.slot||slot};localStorage.setItem(cacheKey,JSON.stringify(companionAiLine));const nudge=document.querySelector('#lifeCompanionNudge[data-life-greeting-slot] b');if(nudge&&nudge.parentElement.dataset.lifeGreetingSlot===slot)nudge.textContent=companionAiLine.line;}}catch(_){}finally{companionAiPending='';}}
  function companionCue(s) { const me=s.settings?.me||'a', challenge=todayChallenge(s), mine=participation(s,me), first=!challenge.mine?{key:'challenge'}:mine.find(item=>!item.done), memory=rediscovery(s); if(first){const copy={challenge:['今天的默契问题来了，先选一个答案吧。','今日默契'],fortune:['今天还没抽签，先摇一支签吧。','去抽签'],mood:['今天还没留下心情，让 TA 看见你现在的状态。','记录心情'],message:['今天还没留一句话，告诉 TA 一件小事吧。','说句话'],todo:['今天还有待办，完成一件也很好。','查看待办']}[first.key];return {id:`guide:${first.key}`,kind:'guide',title:'胖头鱼的小提醒',text:copy[0],action:first.key,actionLabel:copy[1]};}if(memory)return {...memory,kind:'memory'};return {id:'complete',kind:'complete',title:'今天一起完成啦',text:'你们已经点亮了今天的互动，慢慢享受现在吧。',action:'',actionLabel:''}; }
  function openRediscovery(cue) { openSheet(`<section class="life-rediscovery-sheet"><div><span>胖头鱼带你重新遇见</span><h2>${esc(cue.title)}</h2><p>${esc(cue.text)}</p></div>${cue.image?`<img src="${esc(cue.image)}" alt="共同回忆">`:''}</section><div class="life-review-actions"><button data-life-open="gallery">去相册看看</button><button class="life-sheet-primary" data-sheet-close>收下这次遇见</button></div>`); }
  function companionResponseSheet(selectedCue) { const cue=selectedCue||scheduledGreeting(state()), guide=cue.kind==='greeting'?'<button class="life-sheet-secondary" data-life-companion-action="guide">看看今天的小提醒</button>':''; if(cue.kind==='memory') return openRediscovery(cue); const asset=cue.asset||`puffer-state-${cue.kind==='complete'?'celebrate':'quiet'}.webp`,action=cue.action?`<button class="life-sheet-primary" data-life-companion-action="${cue.action}">${esc(cue.actionLabel)}</button>`:'<button class="life-sheet-primary" data-sheet-close>好呀</button>'; openSheet(`<section class="life-companion-response"><img src="assets/${asset}" alt="胖头鱼"><div><span>${esc(cue.title)}</span><p>${esc(cue.text)}</p></div></section>${action}${guide}`); clearTimeout(companionSheetTimer); companionSheetTimer=setTimeout(closeSheet,5000); }
  function removeCompanionNudge() {
    const node=document.querySelector('#lifeCompanionNudge');
    if(!node)return;
    clearTimeout(node._hideTimer);
    node.remove();
  }
  function positionCompanionNudge() {
    const nudge=document.querySelector('#lifeCompanionNudge'),pet=document.querySelector('#lifeCompanionFloat');
    if(!nudge||!pet)return;
    if(mask.classList.contains('show'))return removeCompanionNudge();
    const visual=window.visualViewport,r=pet.getBoundingClientRect(),w=nudge.offsetWidth||218,h=nudge.offsetHeight||56,gap=8;
    const viewportLeft=Math.round(visual?.offsetLeft||0)+8,viewportRight=Math.round((visual?.offsetLeft||0)+(visual?.width||window.innerWidth))-8;
    const navTop=document.querySelector('.life-nav')?.getBoundingClientRect().top??Infinity;
    const viewportTop=Math.max(72,Math.round(visual?.offsetTop||0)+8),viewportBottom=Math.min(Math.round((visual?.offsetTop||0)+(visual?.height||window.innerHeight))-8,navTop-8);
    const clampLeft=value=>Math.max(viewportLeft,Math.min(viewportRight-w,value));
    const clampTop=value=>Math.max(viewportTop,Math.min(Math.max(viewportTop,viewportBottom-h),value));
    const leftCandidate=r.left-w-gap,rightCandidate=r.right+gap;
    const leftFits=leftCandidate>=viewportLeft,rightFits=rightCandidate+w<=viewportRight;
    const petOnRight=r.left+r.width/2>viewportLeft+(viewportRight-viewportLeft)/2;
    let placement,left;
    if(petOnRight){placement=leftFits?'left':rightFits?'right':'above';left=placement==='left'?leftCandidate:placement==='right'?rightCandidate:r.left+(r.width-w)/2;}
    else{placement=rightFits?'right':leftFits?'left':'above';left=placement==='right'?rightCandidate:placement==='left'?leftCandidate:r.left+(r.width-w)/2;}
    left=clampLeft(left);
    const top=clampTop(placement==='above'?r.top-h-gap:r.top+(r.height-h)/2);
    nudge.style.left=`${Math.round(left)}px`;
    nudge.style.top=`${Math.round(top)}px`;
    nudge.style.right='auto';nudge.style.bottom='auto';
    nudge.dataset.placement=placement;
    nudge.classList.toggle('is-left',placement==='right');
  }
  function queueCompanionNudgePosition(){if(companionNudgeFrame)return;companionNudgeFrame=requestAnimationFrame(()=>{companionNudgeFrame=null;positionCompanionNudge();});}
  function emitCompanionExpression(node) { const tone=node.dataset.tone||'quiet', glyphs={quiet:['·','☺'],missing:['♥','♡'],happy:['✦','♥'],morning:['✦','☀'],evening:['⋆','♥'],celebrate:['✦','♥'],goodnight:['z','⋆'],days:['✦','•'],things:['☺','✦'],home:['♥','⌂']}[tone]||['·'];const accent=document.createElement('span');accent.className='life-companion-accent';accent.textContent=glyphs[Math.floor(Math.random()*glyphs.length)];accent.style.setProperty('--life-accent-shift',`${Math.round((Math.random()-.5)*30)}px`);node.append(accent);setTimeout(()=>accent.remove(),1450); }
  function ensureCompanionBlink(node) { if(!node)return; const revision='20260811-pet-blink-light-1',frames={'puffer-state-quiet.webp':'puffer-state-quiet-blink-v2.webp','puffer-state-missing.webp':'puffer-state-missing-blink-v2.webp','puffer-state-happy.webp':'puffer-state-happy-blink-v2.webp','puffer-state-celebrate.webp':'puffer-state-celebrate-blink-v2.webp','puffer-state-goodnight.webp':'puffer-state-goodnight-blink-v2.webp'},prepare=asset=>{const file=frames[asset];if(!file||node._blinkReady?.[file]||node._blinkLoading===file)return;node._blinkLoading=file;node._blinkReady=node._blinkReady||{};const preload=new Image();preload.onload=()=>{node._blinkReady[file]=true;node._blinkLoading='';};preload.onerror=()=>{node._blinkLoading='';};preload.src=`assets/${file}?v=${revision}`;};prepare(node._pet?.asset);if(node._blinkTimer)return;const blink=()=>{const image=node.querySelector('img'),asset=node._pet?.asset,closed=frames[asset];prepare(asset);if(!closed||!node._blinkReady?.[closed]||node.classList.contains('is-dragging')||node.classList.contains('is-swimming')||node._reactionActive||document.hidden||!image)return;image.src=`assets/${closed}?v=${revision}`;setTimeout(()=>{if(node._pet?.asset===asset&&!node.classList.contains('is-swimming')&&!node._reactionActive)image.src=`assets/${asset}`;},135);};node._blinkTimer=setInterval(blink,11800);setTimeout(blink,7600); }
  function ensureCompanionIdle(node) { if(!node||node._idleTimer)return; const animate=()=>{if(node.classList.contains('is-dragging')||node._reactionActive||document.hidden||!node._pet)return;const image=node.querySelector('img'),tone=node.dataset.tone||'quiet';node.classList.remove('is-idle-action');void node.offsetWidth;node.classList.add('is-idle-action');if(Math.random()<.25)setTimeout(()=>emitCompanionExpression(node),180);if(tone==='goodnight'){setTimeout(()=>node.classList.remove('is-idle-action'),850);return;}const frames=['puffer-swim-1.webp','puffer-swim-2.webp','puffer-swim-3.webp'];let frame=0;clearInterval(node._idleFrameTimer);image.src=`assets/${frames[frame]}`;node._idleFrameTimer=setInterval(()=>{frame=(frame+1)%frames.length;image.src=`assets/${frames[frame]}`;},135);setTimeout(()=>{clearInterval(node._idleFrameTimer);if(!node._reactionActive){image.src=`assets/${node._pet.asset}`;image.dataset.asset=node._pet.asset;}node.classList.remove('is-idle-action');},620);};node._idleTimer=setInterval(animate,21000);setTimeout(animate,12000); }
  function clearPendingCompanionReaction() {
    clearTimeout(pendingCompanionReactionTimer);
    pendingCompanionReactionTimer = null;
    pendingCompanionReaction = null;
  }
  function playCompanionReaction(kind) {
    const config={
      hydration:{asset:'puffer-reaction-hydration-v1.png',tone:'happy',label:'补水回应',text:'这一杯记下啦，继续照顾好自己。'},
      message:{asset:'puffer-reaction-message-v1.png',tone:'things',label:'留言回应',text:'这句话已经替你送到啦。'},
      todo:{asset:'puffer-reaction-todo-v1.png',tone:'celebrate',label:'完成回应',text:'完成一件，今天就轻一点。'}
    }[kind];
    if(!config||document.hidden)return false;
    renderCompanionFloat(state());
    const node=document.querySelector('#lifeCompanionFloat'),image=node?.querySelector('img');
    if(!node||!image)return false;
    clearTimeout(node._reactionTimer);
    node.querySelector('.life-companion-action-feedback')?.remove();
    document.querySelector('#lifeCompanionNudge')?.remove();
    node._reactionActive=true;
    node._pet={asset:config.asset,label:config.label,tone:config.tone};
    node.dataset.tone=config.tone;
    image.dataset.asset=config.asset;
    image.src=`assets/${config.asset}`;
    image.alt=`${config.label}胖头鱼`;
    const feedback=document.createElement('span');
    feedback.className='life-companion-action-feedback';
    feedback.setAttribute('role','status');
    feedback.setAttribute('aria-live','polite');
    feedback.textContent=config.text;
    const rect=node.getBoundingClientRect();
    feedback.classList.toggle('is-right',rect.left+rect.width/2<window.innerWidth/2);
    node.append(feedback);
    node.classList.remove('is-action-reaction');
    void node.offsetWidth;
    node.classList.add('is-action-reaction');
    node._reactionTimer=setTimeout(()=>{
      node._reactionActive=false;
      node.classList.remove('is-action-reaction');
      feedback.remove();
      renderCompanionFloat(state());
    },900);
    return true;
  }
  function requestCompanionReaction(kind) {
    const sync=syncStatus();
    clearPendingCompanionReaction();
    if(!sync.joined){requestAnimationFrame(()=>playCompanionReaction(kind));return true;}
    if(sync.failed||sync.key==='failed')return false;
    pendingCompanionReaction={kind,expiresAt:Date.now()+8000};
    pendingCompanionReactionTimer=setTimeout(clearPendingCompanionReaction,8000);
    if(sync.key==='synced'&&!sync.pending&&!sync.busy){
      clearPendingCompanionReaction();
      requestAnimationFrame(()=>playCompanionReaction(kind));
    }
    return true;
  }
  function resolvePendingCompanionReaction(status=syncStatus()) {
    if(!pendingCompanionReaction)return;
    if(status.failed||status.key==='failed'||Date.now()>pendingCompanionReaction.expiresAt){clearPendingCompanionReaction();return;}
    if(status.key!=='synced'||status.pending||status.busy)return;
    const {kind}=pendingCompanionReaction;
    clearPendingCompanionReaction();
    requestAnimationFrame(()=>playCompanionReaction(kind));
  }
  function renderCompanionNudge(s) {
    const old=document.querySelector('#lifeCompanionNudge');
    if(activeLifeTab!=='today'||mask.classList.contains('show')){removeCompanionNudge();return;}
    if(old){positionCompanionNudge();return;}
    const shownKey=`puffer-companion-nudge-shown:${dayKey()}`;
    if(sessionStorage.getItem(shownKey))return;
    const greeting=scheduledGreeting(s),greetingKey=`puffer-companion-nudge:${dayKey()}:${greeting.id}`,cue=!localStorage.getItem(greetingKey)?greeting:companionCue(s),key=cue===greeting?greetingKey:`puffer-companion-nudge:${dayKey()}:${cue.id}`;
    if(localStorage.getItem(key))return;
    const node=document.createElement('button');
    node.type='button';node.id='lifeCompanionNudge';node.className='life-companion-nudge';
    if(cue===greeting)node.dataset.lifeGreetingSlot=greetingSlot();
    node.innerHTML=`<span>${esc(cue.kind==='memory'?'重新遇见':cue.title||'胖头鱼提醒')}</span><b>${esc(cue.kind==='memory'?cue.title:cue.text)}</b>`;
    sessionStorage.setItem(shownKey,'1');
    node.addEventListener('click',()=>{clearTimeout(node._hideTimer);localStorage.setItem(key,'1');node.remove();companionResponseSheet(cue);});
    document.body.append(node);
    requestAnimationFrame(()=>{positionCompanionNudge();node.classList.add('show');});
    node._hideTimer=setTimeout(()=>{node.classList.remove('show');setTimeout(()=>node.remove(),220);},4000);
  }
  function renderCompanionFloat(s) {
    if(!s)return;
    let pet=companionPet(s),node=document.querySelector('#lifeCompanionFloat');
    if(!node){
      node=document.createElement('div');node.id='lifeCompanionFloat';node.className='life-companion-float';node.innerHTML='<img alt="">';node.tabIndex=0;node.setAttribute('role','button');
      document.body.append(node);
      const read=()=>{try{return JSON.parse(localStorage.getItem('puffer-companion-float-position')||'');}catch{return null;}};
      const place=pos=>{const width=node.offsetWidth||86,height=node.offsetHeight||86,edge=8,y=Math.max(72,Math.min(window.innerHeight-height-104,Math.round((window.innerHeight-height)*Number(pos?.y??.58))));node.style.left=`${pos?.side==='left'?edge:Math.max(edge,window.innerWidth-width-edge)}px`;node.style.top=`${y}px`;};
      node._place=place;
      requestAnimationFrame(()=>place(read()||{side:'right',y:.58}));
      const stopSwimming=()=>{clearInterval(node._swimTimer);node._swimTimer=null;node.classList.remove('is-swimming');if(node._pet){const image=node.querySelector('img');image.src=`assets/${node._pet.asset}`;image.dataset.asset=node._pet.asset;image.alt=`${node._pet.label}胖头鱼`;}};
      const startSwimming=()=>{if(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)return;const image=node.querySelector('img'),frames=['puffer-swim-1.webp','puffer-swim-2.webp','puffer-swim-3.webp'];let frame=0;clearInterval(node._swimTimer);node.classList.add('is-swimming');image.src=`assets/${frames[frame]}`;node._swimTimer=setInterval(()=>{frame=(frame+1)%frames.length;image.src=`assets/${frames[frame]}`;},120);};
      let drag=null;
      node.addEventListener('pointerdown',event=>{
        if(event.pointerType==='mouse'&&event.button!==0)return;
        drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:node.offsetLeft,top:node.offsetTop,moved:false};
        node.setPointerCapture?.(event.pointerId);
      });
      node.addEventListener('pointermove',event=>{
        if(!drag||event.pointerId!==drag.pointerId)return;
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
        if(!drag.moved&&Math.hypot(dx,dy)<7)return;
        if(!drag.moved){drag.moved=true;node.classList.add('is-dragging');startSwimming();}
        node.style.left=`${Math.max(8,Math.min(window.innerWidth-node.offsetWidth-8,drag.left+dx))}px`;
        node.style.top=`${Math.max(72,Math.min(window.innerHeight-node.offsetHeight-104,drag.top+dy))}px`;
      });
      const finishDrag=event=>{
        if(!drag||(event?.pointerId!=null&&event.pointerId!==drag.pointerId))return;
        const moved=drag.moved;
        if(moved){
          const pos={side:node.offsetLeft+node.offsetWidth/2<window.innerWidth/2?'left':'right',y:node.offsetTop/Math.max(1,window.innerHeight-node.offsetHeight)};
          localStorage.setItem('puffer-companion-float-position',JSON.stringify(pos));
          node._suppressClickUntil=performance.now()+300;
          node.classList.remove('is-dragging');stopSwimming();place(pos);
        }
        drag=null;
      };
      node.addEventListener('pointerup',finishDrag);
      node.addEventListener('pointercancel',finishDrag);
      node.addEventListener('click',event=>{if(performance.now()<(node._suppressClickUntil||0)){event.preventDefault();event.stopImmediatePropagation();}});
      node.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();node.click();}});
      window.addEventListener('resize',()=>place(read()||{side:'right',y:.58}));
    }
    if(node._reactionActive)return;
    node._pet=pet;node.dataset.tone=pet.tone||'quiet';node.setAttribute('aria-label',`${pet.label}胖头鱼，点击查看陪伴内容，拖动可调整位置`);
    const image=node.querySelector('img');
    if(!node.classList.contains('is-swimming')&&image.dataset.asset!==pet.asset){image.dataset.asset=pet.asset;image.src=`assets/${pet.asset}`;image.alt=`${pet.label}胖头鱼`;node.classList.remove('is-updated');void node.offsetWidth;node.classList.add('is-updated');}
  }
  function participation(s, person) { const today = dayKey(), fortune = s.fortune?.date === today ? s.fortune.by || {} : {}, todos = live(s.todos).filter(t => t.date === today), todosDone = !todos.length || todos.every(t => t.done); return [{ key:'fortune', label:'今日抽签', done:!!fortune[person] },{ key:'mood', label:'选择心情', done:!!s.dailyStatus?.[today]?.[person]?.mood },{ key:'message', label:'留一句话', done:live(s.messages).some(m => m.author === person && sameDay(m.createdAt)) },{ key:'todo', label:'完成待办', done:todosDone }]; }
  function todayChallenge(s) { const data=window.PufferLife?.getTodayChallenge?.(), question=data?.question, me=s.settings?.me||'a', ta=me==='a'?'b':'a', answers=data?.answers||{}; return {question,me,ta,mine:answers[me]||null,theirs:answers[ta]||null,answers}; }
  function challengeStateCopy(challenge) { if(!challenge.question)return '今天的问题正在准备'; if(challenge.mine&&challenge.theirs){return challenge.mine.answer===challenge.theirs.answer?'今天居然想到一起去了':'今天想到两个方向去了';} if(challenge.theirs)return 'TA 已经回答了，轮到你啦'; if(challenge.mine)return '已经选好了，等待 TA'; return '今天的问题来了'; }
  function challengeOption(question, answer) { return question?.options?.find(option=>option.id===answer)?.label||'已选择'; }
  function challengeSheet() { markRemoteUpdateRead('challenge'); const s=state(), challenge=todayChallenge(s), q=challenge.question; if(!q)return; const p=s.settings?.partners||{}, mineName=p[challenge.me]||'我', theirName=p[challenge.ta]||'TA', both=challenge.mine&&challenge.theirs, same=both&&challenge.mine.answer===challenge.theirs.answer; if(both){return openSheet(`<section class="life-challenge-sheet life-challenge-result ${same?'is-same':'is-different'}"><div class="life-challenge-eyebrow">今日默契</div>${same?'<img src="assets/puffer-state-celebrate.webp" alt="庆祝的胖头鱼">':''}<h2>${esc(q.question)}</h2><div class="life-challenge-result-grid"><article><small>${esc(mineName)}</small><b>${esc(challengeOption(q,challenge.mine.answer))}</b></article><span>${same?'=':icon('arrows-left-right')}</span><article><small>${esc(theirName)}</small><b>${esc(challengeOption(q,challenge.theirs.answer))}</b></article></div><p>${same?'居然想到一起去了。':'今天想到两个方向去了，<br>下次得商量一下了。'}</p></section>`); } const selected=challenge.mine?.answer||'', note=challenge.theirs&&!challenge.mine?'TA 已经偷偷回答了 👀<br>回答后才能揭晓':challenge.mine?'已经选好了，等待 TA 回答。':'选一个更像你现在的答案。'; return openSheet(`<section class="life-challenge-sheet"><div class="life-challenge-eyebrow">今日默契</div><h2>${esc(q.question)}</h2><div class="life-challenge-options">${q.options.map(option=>`<button type="button" class="${selected===option.id?'selected':''}" ${selected?'disabled':''} data-life-answer-challenge="${esc(option.id)}"><span>${esc(option.label)}</span>${selected===option.id?icon('check-circle'):icon('caret-right')}</button>`).join('')}</div><p class="life-challenge-note">${note}</p></section>`); }
  function interactionStreak(s) { const history=s.interactionHistory||{}, cursor=new Date(); if(!history[dayKey()]) cursor.setDate(cursor.getDate()-1); let days=0; while(days<365){const key=`${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')}`;if(!history[key])break;days++;cursor.setDate(cursor.getDate()-1);}return days; }
  function hydrationGauge(kind,total,goal,readonly=false){const water=kind==='water',ratio=Math.max(0,Math.min(100,Math.round(total/goal*100))),fill=Math.round(ratio*(water?.47:.45)),complete=water&&total>=goal,warning=!water&&total>goal;return `<button class="life-hydration-gauge ${kind} ${complete?'is-complete':''} ${warning?'is-warning':''} ${readonly?'is-readonly':''}" data-life-hydration-kind="${kind}" style="--hydration-fill:${fill}%"><span class="life-hydration-visual"><i class="life-hydration-liquid"></i><img src="assets/hydration-${kind}-cup-empty.webp" alt="${water?'水杯':'饮料杯'}">${complete?'<span class="life-hydration-celebrate">✦ ♥ ✦</span>':''}${warning?'<span class="life-hydration-angry">╬</span>':''}</span><span class="life-hydration-copy"><small>${water?'今天喝水':'今天饮料'}</small><b>${total} <em>ml</em></b><span>${water?`${Math.min(total,goal)} / ${goal} ml`:warning?'今天有点多，接下来喝水吧':`${total} / ${goal} ml 内`}</span></span>${icon(readonly?'eye':'plus')}</button>`;}
  function presenceLabel(info){if(!info)return {text:'状态准备中',cls:'is-idle'};const minutes=Math.max(0,Math.floor((Date.now()-Number(info.lastSeen||0))/60000));const seen=info.online?'在线':info.lastSeen?(minutes<1?'刚刚来过':`${minutes} 分钟前`):'暂未上线';const distance=Number.isFinite(info.distanceKm)?`${info.distanceKm<10?info.distanceKm.toFixed(1):Math.round(info.distanceKm)} km`:'';return {text:distance?`${seen} · ${distance}`:seen,cls:info.online?'is-online':'is-idle'};}
  function renderToday(s) {
    if (photoCarouselTimer) { clearInterval(photoCarouselTimer); photoCarouselTimer = null; }
    // The legacy music markup is replaced below by PufferMusicView. Keep a
    // harmless placeholder while the old template is still being phased out.
    const music = {};
    const p = s.settings?.partners || {}, me = s.settings?.me || 'a', ta = me === 'a' ? 'b' : 'a', weather = weatherInfo(s), todos = live(s.todos).filter(t => (!t.done && (!t.date || t.date === dayKey())) || (t.done && (t.date === dayKey() || (!t.date && sameDay(t.updatedAt))))).sort((a,b)=>Number(a.done)-Number(b.done)||(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0)).slice(0, 3), mine = participation(s, me), theirs = participation(s, ta), photo = live(s.gallery).filter(x => x.dataUrl || x.url).sort((a,b) => (b.createdAt||0)-(a.createdAt||0))[0], latestMessage = live(s.messages).filter(m => m.author === ta && sameDay(m.createdAt)).sort((a,b) => (b.createdAt||0)-(a.createdAt||0))[0], status = s.dailyStatus?.[dayKey()]?.[ta], fortune = s.fortune?.date === dayKey() ? s.fortune.by?.[ta] : null;
    const horoscopes = window.PufferLife?.getHoroscopes?.() || [], partnerHoro = horoscopes[ta === 'a' ? 0 : 1], partnerNote = status?.text || latestMessage?.text || '', streak=interactionStreak(s);
    const dots = (items, owner) => items.map(item => `<button class="life-participation-item ${item.done?'is-done':''}" data-life-participation="${item.key}" data-life-person="${owner}" aria-label="${item.label}"><span>${icon(item.key==='fortune'?'scroll':item.key==='mood'?'smiley':item.key==='message'?'chat-circle-text':'check-square')}</span><small>${item.label}</small><i>${item.done ? icon('check') : icon('plus')}</i></button>`).join('');
    const todoHtml = todos.length ? todos.map(t => `<div class="life-home-todo ${t.done?'is-complete':''}"><button data-life-todo-toggle="${esc(t.id)}" aria-label="${t.done?'已完成，点击恢复待办':'完成待办'}" aria-pressed="${t.done?'true':'false'}">${icon(t.done?'check':'circle')}</button><button class="life-home-todo-content" data-life-edit-todo="${esc(t.id)}"><span>${esc(t.text)}</span><small>${t.done?'已完成':t.date === dayKey()?'今天':'待完成'}</small></button></div>`).join('') : `<div class="life-home-empty">今天没有待办，已经为你们留出轻松时间。</div>`;
    const partnerToday = `<section class="life-section life-partner-today"><div class="life-section-head"><h2 class="life-section-title">${esc(p[ta] || 'TA')} 的今天</h2><span class="life-label">已同步的今日状态</span></div><div class="life-card life-partner-summary"><div class="life-partner-summary-grid"><button type="button" class="life-partner-mood" data-life-open="partner-mood" aria-label="查看对方今天的心情"><span>${icon('smiley')}</span><small>现在心情</small><b>${esc(status?.mood || '还没记录')}</b></button><article><span>${icon('scroll')}</span><small>今日抽签</small><b>${esc(fortune ? `${fortune.level}签 · ${fortune.text}` : '还没抽签')}</b></article></div><button class="life-partner-insight" data-life-open="horoscope"><span>${icon('sparkle')}</span><div><small>星座相处提醒</small><b>${esc(partnerHoro?.data?.love || '今天的双人运势正在准备。')}</b></div>${icon('caret-right')}</button><button class="life-partner-note" data-life-open="messages"><span>${icon('chat-circle-text')}</span><div><small>想对你说</small><b>${esc(partnerNote || 'TA 还没有留下一句话。')}</b></div>${icon('caret-right')}</button></div></section>`;
    const hydration=window.PufferLife?.getHydrationToday?.()||{me:{water:0,drink:0},goal:1500,drinkLimit:500};
    const hydrationReadOnly=hydrationAudience==='partner',hydrationTotalsView=hydrationReadOnly?hydration.partner:hydration.me;
    const hydrationSection=`<section class="life-section life-home-hydration"><div class="life-section-head"><div><h2 class="life-section-title">今天喝了什么</h2><p class="life-section-caption">水和饮料分开记，更容易照顾好自己。</p></div>${hydrationReadOnly?'<span class="life-hydration-readonly">仅查看</span>':'<button class="life-pill" data-life-open="hydration">记录</button>'}</div><div class="life-hydration-toolbar"><div class="life-hydration-audience" role="group" aria-label="查看谁的饮水记录"><button class="${hydrationAudience==='me'?'active':''}" data-hydration-audience="me">我</button><button class="${hydrationAudience==='partner'?'active':''}" data-hydration-audience="partner">TA</button></div><span>${hydrationReadOnly?'对方当天的记录':'只记录当前成员'}</span></div><div class="life-hydration-card">${hydrationGauge('water',hydrationTotalsView.water,hydration.goal,hydrationReadOnly)}${hydrationGauge('drink',hydrationTotalsView.drink,hydration.drinkLimit,hydrationReadOnly)}</div></section>`;
    slot('today').innerHTML = `<header class="life-head"><div class="life-eyebrow">${new Date().getMonth()+1} 月 ${new Date().getDate()} 日 · 星期${'日一二三四五六'[new Date().getDay()]}</div><h1 class="life-title">今天</h1><p class="life-sub">${esc(p.a || '我们')} 和 ${esc(p.b || '我们')} 的共同生活</p></header>${photo ? `<section class="life-photo-hero"><img src="${esc(photo.dataUrl || photo.url)}" alt="共同照片"><span class="life-photo-count">${live(s.gallery).length} 张照片</span><div class="life-photo-shade"><b>${esc(photo.caption || '你们保存下来的共同瞬间')}</b><span>${when(photo.createdAt)}</span></div></section>` : ''}<section class="life-card life-weather"><div><span class="life-weather-label">${weather.label} · ${esc(s.settings?.city || '')}</span><div class="life-temp">${weather.temp}</div><p class="life-weather-copy">${weather.copy}</p></div><img class="life-pet" src="assets/${weather.pet}" alt="胖头鱼"></section>${partnerToday}<section class="life-section life-today-priority"><div class="life-section-head"><h2 class="life-section-title">今天最重要</h2><button class="life-pill" data-life-open="todo">查看全部</button></div><div class="life-home-todos">${todoHtml}</div></section>${hydrationSection}<section class="life-section life-today-together"><div class="life-section-head"><h2 class="life-section-title">今天的互动</h2><span class="life-label">一起点亮 ${mine.filter(x=>x.done).length + theirs.filter(x=>x.done).length} / 8</span></div><div class="life-together-card"><div class="life-participation-row"><span>${esc(p[me] || '我')}</span><div>${dots(mine, me)}</div><small>${mine.filter(x=>x.done).length}/4</small></div><div class="life-participation-row"><span>${esc(p[ta] || 'TA')}</span><div>${dots(theirs, ta)}</div><small>${theirs.filter(x=>x.done).length}/4</small></div><div class="life-interaction-streak">${icon('heart')} <b>连续互动 <em>${streak}</em> 天</b><span>${streak?'明天继续':'从今天开始'}</span></div></div></section><section class="life-section life-home-music"><div class="life-section-head"><h2 class="life-section-title">今日音乐</h2></div><div class="life-music-pair"><button class="life-music-person netease" data-life-music><span>我 · 网易云</span><b>${esc(music.netease?.title || '今天的歌')}</b><small>${esc(music.netease?.artist || '正在准备')}</small></button><button class="life-music-person apple" data-life-music><span>TA · Apple Music</span><b>${esc(music.apple?.title || '今天的歌')}</b><small>${esc(music.apple?.artist || '正在准备')}</small></button></div></section><section class="life-section life-home-companion"><div class="life-section-head"><h2 class="life-section-title">今日陪伴</h2></div><div class="life-companion-row"><button data-life-open="horoscope">${icon('sparkle')} 双人运势</button><button data-life-open="fortune">${icon('scroll')} 今日抽签</button></div></section>`;
    const musicSection = slot('today').querySelector('.life-home-music');
    if (musicSection && window.PufferMusicView?.renderHomeMarkup) musicSection.outerHTML = window.PufferMusicView.renderHomeMarkup();
    slot('today').querySelector('.life-pet')?.addEventListener('click', e => { const card = e.currentTarget.closest('.life-weather'); card.classList.remove('life-pet-love'); void card.offsetWidth; card.classList.add('life-pet-love'); });
    const interactionSlot=slot('today'),interaction=interactionSlot?.querySelector('.life-today-together'),partnerSection=interactionSlot?.querySelector('.life-partner-today'),challenge=todayChallenge(s);if(interaction&&partnerSection){partnerSection.after(interaction);const head=interaction.querySelector('.life-section-head'),label=head?.querySelector('.life-label'),card=interaction.querySelector('.life-together-card'),done=mine.filter(x=>x.done).length+theirs.filter(x=>x.done).length;if(label)label.remove();if(card){card.insertAdjacentHTML('afterbegin',`<button type="button" class="life-challenge-entry" data-life-open="challenge"><span>${icon('heart')}</span><div><small>今日默契</small><b>${esc(challengeStateCopy(challenge))}</b></div>${icon('caret-right')}</button><div class="life-interaction-subhead"><span>今天的小互动</span><b>${done} / 8</b></div>`);}}
    const todaySlot=slot('today'),presence=presenceLabel(window.PufferLife?.getPresence?.()?.partner),partnerHeader=todaySlot.querySelector('.life-partner-today .life-section-head');if(partnerHeader){partnerHeader.querySelector('.life-label')?.remove();partnerHeader.insertAdjacentHTML('beforeend',`<button class="life-presence-pill ${presence.cls}" data-life-open="presence"><span></span><b>${esc(presence.text)}</b></button>`);}const fortuneCard=todaySlot.querySelector('.life-partner-summary-grid article:nth-child(2)');if(fortuneCard){const trigger=document.createElement('button'),brief=fortune?`${fortune.level}签 · ${String(fortune.text||'').split(/[，,。]/)[0]}`:'还没有抽签';trigger.type='button';trigger.className='life-partner-fortune';trigger.dataset.lifeOpen='fortune';trigger.setAttribute('aria-label','查看今日抽签');trigger.innerHTML=fortuneCard.innerHTML;trigger.querySelector('b').textContent=brief;trigger.insertAdjacentHTML('beforeend',icon('caret-right'));fortuneCard.replaceWith(trigger);}const photoHero=todaySlot.querySelector('.life-photo-hero'),photos=live(s.gallery).filter(x=>x.dataUrl||x.url).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0)).slice(0,8);if(photoHero&&photos.length>1){let current=0,startX=0;photoHero.innerHTML=`<div class="life-photo-track">${photos.map(item=>`<img loading="lazy" decoding="async" src="${esc(item.dataUrl||item.url)}" alt="共同照片">`).join('')}</div><span class="life-photo-count">${photos.length} 张照片</span><div class="life-photo-shade"><b></b><span></span></div><div class="life-photo-dots">${photos.map((_,i)=>`<i class="${i===0?'active':''}"></i>`).join('')}</div>`;const track=photoHero.querySelector('.life-photo-track'),title=photoHero.querySelector('.life-photo-shade b'),time=photoHero.querySelector('.life-photo-shade span'),dots=[...photoHero.querySelectorAll('.life-photo-dots i')],show=index=>{current=(index+photos.length)%photos.length;track.style.transform=`translateX(-${current*100}%)`;title.textContent=photos[current].caption||'你们保存下来的共同瞬间';time.textContent=when(photos[current].createdAt);dots.forEach((dot,i)=>dot.classList.toggle('active',i===current));};show(0);photoCarouselTimer=setInterval(()=>show(current+1),5000);photoHero.addEventListener('pointerdown',e=>{startX=e.clientX;photoHero.setPointerCapture?.(e.pointerId);});photoHero.addEventListener('pointerup',e=>{const delta=e.clientX-startX;if(Math.abs(delta)>34)show(current+(delta<0?1:-1));});}
  }
  function renderDays(s) { const d = new Date(), y=d.getFullYear(), m=d.getMonth(), first=new Date(y,m,1).getDay(), total=new Date(y,m+1,0).getDate(), marked=new Set(live(s.todos).map(t=>t.date)); let cells=['日','一','二','三','四','五','六'].map(x=>`<span class="week">${x}</span>`).join(''); for(let i=0;i<first;i++) cells += '<span></span>'; for(let n=1;n<=total;n++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`;cells += `<span class="${key===dayKey()?'today ':''}${marked.has(key)?'marked':''}">${n}</span>`;} const todos=live(s.todos).sort((a,b)=>Number(a.done)-Number(b.done)); slot('days').innerHTML=`<header class="life-head"><div class="life-eyebrow">把值得记住的日子放在一起</div><h1 class="life-title">日子</h1><p class="life-sub">接下来的日子，和值得回看的日子。</p></header><section class="life-hero"><strong class="life-hero-number">${Math.max(0,Math.floor((Date.now()-new Date(2023,11,4))/86400000))} 天</strong><p>从 2023 年 12 月 4 日开始，一起走过的日子。</p></section><section class="life-section life-all-todos"><div class="life-section-head"><h2 class="life-section-title">全部待办</h2><button class="life-pill" data-life-add-todo>添加</button></div><div class="life-mini-list">${todos.map(t=>`<div class="life-row ${t.done?'is-complete':''}"><button data-life-toggle-todo="${esc(t.id)}" class="life-icon" aria-label="${t.done?'已完成，点击恢复待办':'完成待办'}" aria-pressed="${t.done?'true':'false'}">${icon(t.done?'check':'circle')}</button><span class="life-row-main"><span class="life-value">${esc(t.text)}</span><span class="life-label">${esc(t.date || '未设日期')}${t.done?' · 已完成':''}</span></span><button class="life-row-action" data-life-edit-todo="${esc(t.id)}">查看</button></div>`).join('') || '<div class="life-data-empty">还没有待办。</div>'}</div></section><section class="life-section"><div class="life-section-head"><h2 class="life-section-title">这个月</h2><button class="life-pill" data-life-open="todo">待办日历</button></div><div class="life-card life-calendar">${cells}</div></section>`; }
  function renderThings(s) { const me=s.settings?.me||'a', msgs=live(s.messages).slice(-3).sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)), wishes=live(s.wishes).slice(-4).reverse(), photos=live(s.gallery).filter(x=>x.dataUrl||x.url), trips=live(s.travels).filter(x=>x.status!=='wish'); slot('things').innerHTML=`<header class="life-head"><div class="life-eyebrow">不必整理得很完美</div><h1 class="life-title">小事</h1><p class="life-sub">照片、旅途和说过的话，<br>都在这里慢慢积累。</p></header><section class="life-things-portals"><button class="life-things-portal life-things-gallery" data-life-open="gallery"><div><span>共同相册</span><b>${photos.length?`已经收下 ${photos.length} 张照片`:'保存你们看见的此刻'}</b><small>上传、查看与整理共同照片</small></div><img loading="lazy" decoding="async" src="assets/puffer-camera.webp" alt="拿着相机的胖头鱼">${icon('caret-right')}</button><button class="life-things-portal life-things-travel" data-life-open="travel"><div><span>我们的足迹</span><b>${trips.length?`一起去过 ${trips.length} 个地方`:'从第一段旅途开始'}</b><small>打开世界地图，记下去过的地方</small></div><img loading="lazy" decoding="async" src="assets/puffer-travel.webp" alt="拿着地图、背着旅行包的胖头鱼">${icon('caret-right')}</button></section><section class="life-section"><div class="life-section-head"><h2 class="life-section-title">留给你</h2><button class="life-pill" data-life-open="messages">说句话</button></div><div class="life-inline-chat">${msgs.map(m=>`<div class="life-chat ${m.author===me?'mine':''}">${m.image?`<img class="life-chat-image" loading="lazy" decoding="async" src="${esc(m.image)}" alt="留言图片">`:''}<p>${esc(m.text)||'发来了一张照片'}</p>${messageMetaMarkup(m,when(m.createdAt))}</div>`).join('') || '<div class="life-data-empty">还没有留言，写一句给对方吧。</div>'}</div></section><section class="life-section"><div class="life-section-head"><h2 class="life-section-title">小心愿墙</h2><button class="life-pill" data-life-open="wishes">查看全部</button></div><div class="life-wish-grid">${wishes.map(w=>`<article class="life-wish ${w.lit?'lit':''}"><span>${esc(w.icon||'✨')}</span><b>${esc(w.text)}</b><small>${when(w.createdAt)}</small></article>`).join('') || '<div class="life-data-empty">心愿墙还是空的。</div>'}</div></section>`; }
  function renderUs(s) { const p=s.settings?.partners||{}, photos=live(s.gallery).length, messages=live(s.messages).length, wishes=live(s.wishes).length, travels=live(s.travels).length, todayMessages=live(s.messages).filter(item=>sameDay(item.createdAt)).length, todayPhotos=live(s.gallery).filter(item=>sameDay(item.createdAt)).length, todayTodos=live(s.todos).filter(item=>sameDay(item.updatedAt||item.createdAt)&&item.done).length, received=todayMessages+todayPhotos+todayTodos; const nestCopy=received?`今天，小窝收下了 ${received} 个共同瞬间。`:'今天的小窝很安静，留下一句话也很好。'; slot('us').innerHTML=`<header class="life-head"><div class="life-eyebrow">一份慢慢积累的共同生活</div><h1 class="life-title">我们</h1><p class="life-sub">只属于你们两个人的空间。</p></header><section class="life-card life-couple"><div class="life-person"><div class="life-avatar">${esc((p.a||'我').slice(0,1))}</div><small>${esc(p.a||'成员 A')}</small></div><div class="life-link">${icon('heart')}</div><div class="life-person"><div class="life-avatar">${esc((p.b||'TA').slice(0,1))}</div><small>${esc(p.b||'成员 B')}</small></div></section><button class="life-home-nest life-home-nest-button" data-life-open="nest"><div><span>胖头鱼的小窝</span><b>${esc(nestCopy)}</b><p>点进来看看，今天的小屋收下了什么。</p></div><img loading="lazy" decoding="async" src="assets/puffer-page-us.webp" alt="胖头鱼的小窝">${icon('caret-right')}</button><section class="life-section"><h2 class="life-section-title">共同积累</h2><div class="life-card" style="padding:16px"><span class="life-label">已同步的共同记录</span><strong class="life-hero-number">${photos+messages+wishes+travels+live(s.todos).length} 条</strong><p class="life-sub">照片 ${photos} 张 · 足迹 ${travels} 个 · 留言 ${messages} 条</p></div></section><section class="life-section"><h2 class="life-section-title">我们的空间</h2><div class="life-mini-list"><button class="life-row life-row-button" data-life-open="gallery"><span class="life-icon">${icon('image')}</span><span class="life-row-main"><span class="life-value">共同相册</span><span class="life-label">已保存 ${photos} 张照片</span></span></button><button class="life-row life-row-button" data-life-open="travel"><span class="life-icon">${icon('map-trifold')}</span><span class="life-row-main"><span class="life-value">我们的足迹</span><span class="life-label">已保存 ${travels} 个旅行地点</span></span></button><button class="life-row life-row-button" data-life-open="wishes"><span class="life-icon">${icon('heart')}</span><span class="life-row-main"><span class="life-value">心愿</span><span class="life-label">已保存 ${wishes} 个共同心愿</span></span></button><button class="life-row life-row-button" data-life-settings><span class="life-icon">${icon('gear-six')}</span><span class="life-row-main"><span class="life-value">我们与同步</span><span class="life-label">查看共同空间与资料</span></span></button></div></section>`; }
  function renderRoomCapsule(s) { const header=slot('today').querySelector('.life-head'), room=s.settings?.room||{}, sync=syncStatus(), stateClass={local:'is-idle',pending:'is-pending',syncing:'is-busy',failed:'is-error',synced:'is-ok'}[sync.key]||'is-idle', stateText={local:'未加入',pending:'待同步',syncing:'同步中',failed:'异常',synced:'已同步'}[sync.key]||sync.label, roomLabel=room.joined&&room.id?`#${room.id}`:'共同空间'; if(!header) return; header.insertAdjacentHTML('beforeend',`<button class="life-room-capsule ${stateClass}" data-life-settings aria-label="查看同步状态"><span></span><b>${esc(roomLabel)}</b><small>${esc(stateText)}</small></button>`); }
  function refreshSyncUi() {
    const sync=syncStatus(), capsule=root.querySelector('.life-room-capsule'), stateClass={local:'is-idle',pending:'is-pending',syncing:'is-busy',failed:'is-error',synced:'is-ok'}[sync.key]||'is-idle', stateText={local:'未加入',pending:'待同步',syncing:'同步中',failed:'异常',synced:'已同步'}[sync.key]||sync.label;
    if(capsule){capsule.classList.remove('is-idle','is-pending','is-busy','is-error','is-ok');capsule.classList.add(stateClass);const label=capsule.querySelector('small');if(label)label.textContent=stateText;}
    document.querySelectorAll('[data-message-receipt]').forEach(node=>{const html=messageReceiptMarkup(node.dataset.messageReceipt);if(html)node.outerHTML=html;});
  }
  function render() { const s=state(); if(!s) return; syncTimeAtmosphere(); const reusableMedia=takeReusableMedia(root); renderToday(s); renderRoomCapsule(s); renderDays(s); renderThings(s); renderUs(s); restoreReusableMedia(root,reusableMedia); renderCompanionFloat(s); const companion=document.querySelector('#lifeCompanionFloat'); ensureCompanionIdle(companion); ensureCompanionBlink(companion); renderCompanionNudge(s); fetchCompanionAiLine(s); applyRemoteUpdateUi(); }
  function todoSheet(todo) { const t=todo||{},draftKey=`todo:${t.id||'new'}`; openSheet(`<section data-life-draft="${esc(draftKey)}"><h2>${todo?'编辑待办':'添加待办'}</h2><textarea id="lifeTodoText" data-life-draft-field="text" maxlength="160" placeholder="想一起完成什么？">${esc(t.text||'')}</textarea><input class="life-sheet-input" id="lifeTodoDate" data-life-draft-field="date" type="date" value="${esc(t.date||dayKey())}"><select class="life-sheet-input" id="lifeTodoPriority" data-life-draft-field="priority"><option value="none">不设置优先级</option><option value="high" ${t.priority==='high'?'selected':''}>高优先级</option><option value="mid" ${t.priority==='mid'?'selected':''}>中优先级</option><option value="low" ${t.priority==='low'?'selected':''}>低优先级</option></select><button class="life-sheet-primary" data-save-todo="${esc(t.id||'')}">保存</button></section>`); }
  function calendarSheet() { markRemoteUpdateRead('todo'); const s=state(), base=new Date(calendarCursor.getFullYear(),calendarCursor.getMonth(),1), y=base.getFullYear(),m=base.getMonth(),first=base.getDay(),total=new Date(y,m+1,0).getDate(),todos=live(s.todos).filter(t=>String(t.date||'').startsWith(`${y}-${String(m+1).padStart(2,'0')}`)).sort((a,b)=>Number(a.done)-Number(b.done));let grid=['日','一','二','三','四','五','六'].map(x=>`<span class="week">${x}</span>`).join('');for(let i=0;i<first;i++)grid+='<span></span>';for(let n=1;n<=total;n++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(n).padStart(2,'0')}`;grid+=`<span class="${key===dayKey()?'today ':''}${todos.some(t=>t.date===key)?'marked':''}">${n}</span>`;}openSheet(`<div class="life-calendar-head"><button data-life-calendar-shift="-1">${icon('caret-left')}</button><h2>${y} 年 ${m+1} 月</h2><button data-life-calendar-shift="1">${icon('caret-right')}</button></div><p>橙色日期表示今天，浅色日期表示已有待办。</p><div class="life-sheet-calendar">${grid}</div><h3 class="life-sheet-subtitle">本月待办</h3><div class="life-mini-list">${todos.map(t=>`<div class="life-row ${t.done?'is-complete':''}"><button data-life-toggle-todo="${esc(t.id)}" class="life-icon" aria-label="${t.done?'已完成，点击恢复待办':'完成待办'}" aria-pressed="${t.done?'true':'false'}">${icon(t.done?'check':'circle')}</button><span class="life-row-main"><span class="life-value">${esc(t.text)}</span><span class="life-label">${esc(t.date)}${t.done?' · 已完成':''}</span></span><button class="life-row-action" data-life-edit-todo="${esc(t.id)}">查看</button></div>`).join('')||'<div class="life-data-empty">这个月还没有待办。</div>'}</div>`); }
  function messageSheet() {
    markRemoteUpdateRead('messages');
    hideLiveMessageNotice(true);
    window.PufferLife?.markMessagesRead?.();
    const s=state(),me=s.settings?.me||'a',names=s.settings?.partners||{};
    openSheet(`<div class="life-chat-sheet" data-life-draft="message"><div class="life-chat-title"><h2>留给你</h2><span>${esc(names[me==='a'?'b':'a']||'TA')}</span></div><div class="life-message-history">${messageHistoryMarkup(s)}</div><div class="life-message-composer"><textarea id="lifeMessageText" data-life-draft-field="text" maxlength="1200" placeholder="写点什么给 TA..."></textarea><div class="life-message-actions"><label class="life-photo-button" for="lifeMessageImage">${icon('image')}</label><input id="lifeMessageImage" type="file" accept="image/*"><button class="life-sheet-primary" data-save-message>发送</button></div><div id="lifeMessageImagePreview" class="life-message-image-preview" hidden></div></div></div>`);
    requestAnimationFrame(()=>{const history=mask.querySelector('.life-message-history');if(history)history.scrollTop=history.scrollHeight;});
  }
  function gallerySheet() { markRemoteUpdateRead('gallery'); const s=state(),items=live(s.gallery).filter(x=>x.dataUrl||x.url);openSheet(`<section data-life-draft="gallery"><h2>共同相册</h2><input id="lifePhotoFile" type="file" accept="image/*"><textarea id="lifePhotoCaption" data-life-draft-field="caption" maxlength="200" placeholder="写一句照片说明（可选）"></textarea><button class="life-sheet-primary" data-save-photo>上传照片</button><div class="life-media-grid">${items.map(x=>`<article><img loading="lazy" decoding="async" src="${esc(x.dataUrl||x.url)}" alt="共同照片"><span>${esc(x.caption||'共同瞬间')}</span><button class="life-media-delete" type="button" data-life-delete-gallery="${esc(x.id)}">删除照片</button></article>`).join('')||'<div class="life-data-empty">还没有照片。</div>'}</div></section>`); }
  const knownTravelCoords={杭州:[120.16,30.27],上海:[121.47,31.23],三亚:[109.51,18.25],北京:[116.41,39.90],重庆:[106.55,29.56],香港:[114.17,22.32],澳门:[113.54,22.20],成都:[104.07,30.57],广州:[113.26,23.13],深圳:[114.06,22.55]};
  function travelCoords(item){const lat=Number(item?.lat),lng=Number(item?.lng);if(Number.isFinite(lat)&&Number.isFinite(lng))return[lng,lat];const name=String(item?.place||'');const key=Object.keys(knownTravelCoords).find(city=>name.includes(city));return key?knownTravelCoords[key]:null;}
  function travelMapSvg(items){const located=items.map(item=>({item,coords:travelCoords(item)})).filter(x=>x.coords),point=([lng,lat])=>[10+(lng+180)/360*340,10+(90-lat)/180*160],markers=located.map(({item,coords})=>{const[x,y]=point(coords);return `<button class="life-travel-marker ${item.status==='wish'?'is-wish':''}" style="--travel-x:${x/3.6}%;--travel-y:${y/1.8}%" data-travel-detail="${esc(item.id)}" aria-label="${esc(item.place)}"><i></i><span>${esc(item.place)}</span></button>`}).join('');return `<div class="life-travel-world" aria-label="世界旅行地图"><svg viewBox="0 0 360 180" role="img" aria-label="世界地图"><g><path d="M17 55l20-23 39-8 28 13 21 3 13 18-16 15-27 0-19 21-15 31-16-18 4-28-19-12z"/><path d="M104 99l23 8 14 22-3 34-17 14-12-31-15-22z"/><path d="M143 45l25-20 35 7 17 13 38-12 48 14 39 24-10 22-39 1-29 13-21-9-18 16-20-21-26 4-17-21-27-13z"/><path d="M189 98l38 4 25 29-6 42-30-5-18-35z"/><path d="M291 126l28-10 27 17-7 28-34 5-22-20z"/></g></svg>${markers}<div class="life-travel-map-copy"><span>我们的世界地图</span><b>${items.length?`已经留下 ${items.length} 个地点`:'地图还在等第一枚足迹'}</b></div></div>`;}
  function travelPanel(view, items) {
    const visited = items.filter(item => item.status !== 'wish');
    const wishes = items.filter(item => item.status === 'wish');
    const row = item => {
      const media = item.dataUrl || item.url
        ? `<img loading="lazy" decoding="async" src="${esc(item.dataUrl || item.url)}" alt="${esc(item.place)}">`
        : `<span class="life-travel-row-icon">${icon(item.status === 'wish' ? 'heart' : 'map-pin')}</span>`;
      const note = item.note ? ` · ${esc(item.note)}` : '';
      return `<article class="life-travel-row">${media}<div><b>${esc(item.place)}</b><small>${esc(item.date || '未填写日期')}${note}</small></div><button data-delete-travel="${esc(item.id)}" aria-label="删除${esc(item.place)}">${icon('trash')}</button></article>`;
    };

    if (view === 'footprints') {
      return `<div class="life-travel-panel-head"><div><span>去过的地方</span><b>${visited.length} 枚足迹</b></div><button data-travel-close-panel>收起</button></div><div class="life-travel-list">${visited.map(row).join('') || '<div class="life-data-empty">还没有旅行记录，<br>从一次散步或一段远行开始都可以。</div>'}</div>`;
    }
    if (view === 'recent') {
      const recent = [...visited].sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
      if (!recent) return '<div class="life-travel-panel-head"><div><span>最近一次</span><b>还没有足迹</b></div><button data-travel-close-panel>收起</button></div><div class="life-data-empty">记录一次去过的地方，<br>这里就会出现最近的旅途。</div>';
      const photo = recent.dataUrl || recent.url ? `<img loading="lazy" decoding="async" src="${esc(recent.dataUrl || recent.url)}" alt="${esc(recent.place)}">` : '';
      return `<div class="life-travel-panel-head"><div><span>最近一次</span><b>${esc(recent.place)}</b></div><button data-travel-close-panel>收起</button></div><article class="life-travel-recent">${photo}<div><small>${esc(recent.date || '')}</small><h3>${esc(recent.place)}</h3><p>${esc(recent.note || '这次旅行还没有写下文字。')}</p></div></article>`;
    }
    if (view === 'wishes') {
      return `<div class="life-travel-panel-head"><div><span>以后想去</span><b>${wishes.length} 个地方</b></div><button data-travel-close-panel>收起</button></div><div class="life-travel-list">${wishes.map(row).join('') || '<div class="life-data-empty">还没有想去的地方。</div>'}</div>`;
    }
    if (view === 'add') {
      return `<div class="life-travel-panel-head"><div><span>记下一个地方</span><b>去过或想去都可以</b></div><button data-travel-close-panel>收起</button></div><div class="life-travel-form"><label>地点<input class="life-sheet-input" id="lifeTravelPlace" maxlength="120" placeholder="城市、景点或一条街"></label><div class="life-travel-form-two"><label>日期<input class="life-sheet-input" id="lifeTravelDate" type="date" value="${dayKey()}"></label><label>类型<select class="life-sheet-input" id="lifeTravelStatus"><option value="visited">已经去过</option><option value="wish">以后想去</option></select></label></div><button class="life-travel-location" data-travel-locate>${icon('crosshair')}<span><b>使用当前位置</b><small id="lifeTravelLocationText">只有主动点击时才会定位</small></span></button><input id="lifeTravelLat" type="hidden"><input id="lifeTravelLng" type="hidden"><label>写下一点<textarea id="lifeTravelNote" maxlength="1200" placeholder="当时发生了什么？一句话也可以。"></textarea></label><label class="life-travel-photo">${icon('camera')}<span id="lifeTravelPhotoText">加入一张真实照片（可选）</span><input id="lifeTravelPhoto" type="file" accept="image/*"></label><button class="life-sheet-primary" data-save-travel>保存到我们的地图</button></div>`;
    }
    return '';
  }

  function travelDateLabel(value){const date=value?new Date(`${value}T12:00:00`):null;if(!date||Number.isNaN(date.getTime()))return '未填写日期';return `${date.getFullYear()} 年 ${date.getMonth()+1} 月 ${date.getDate()} 日`;}
  function travelForm(){return `<section class="life-travel-compose" data-life-draft="travel:new"><div class="life-travel-compose-head"><span>新的旅行记录</span><h2>这一站，<br>想怎么留下？</h2><p>地点是必填，其他都可以慢慢补上。</p></div><div class="life-travel-quick-form"><label class="life-travel-place-field"><span>地点</span><input class="life-sheet-input" id="lifeTravelPlace" data-life-draft-field="place" maxlength="120" placeholder="这次去了哪里？"></label><div class="life-travel-quick-row"><div class="life-travel-kind-picker"><span>类型</span><div><button type="button" class="active" data-travel-kind="visited">${icon('map-pin')} 去过</button><button type="button" data-travel-kind="wish">${icon('heart')} 想去</button></div><input id="lifeTravelStatus" data-life-draft-field="status" type="hidden" value="visited"></div><label class="life-travel-date-field"><span>日期</span><input id="lifeTravelDate" data-life-draft-field="date" type="date" value="${dayKey()}"></label></div><label class="life-travel-note-field"><span>想写一句</span><textarea id="lifeTravelNote" data-life-draft-field="note" maxlength="1200" placeholder="发生了什么？可不写。"></textarea></label><div class="life-travel-extra-actions"><label class="life-travel-photo">${icon('camera')}<span id="lifeTravelPhotoText">加照片</span><input id="lifeTravelPhoto" type="file" accept="image/*"></label><button class="life-travel-location" type="button" data-travel-locate>${icon('crosshair')}<span id="lifeTravelLocationText">记录位置</span></button></div><input id="lifeTravelLat" data-life-draft-field="lat" type="hidden"><input id="lifeTravelLng" data-life-draft-field="lng" type="hidden"><button class="life-sheet-primary" type="button" data-save-travel>记下这一站</button></div></section>`;}
  function travelTimelineRow(item){const photo=item.dataUrl||item.url,located=Number.isFinite(Number(item.lat))&&Number.isFinite(Number(item.lng)),type=item.status==='wish'?'想去':'已去过';return `<article class="life-travel-entry ${item.status==='wish'?'is-wish':''}"><i class="life-travel-dot"></i><div class="life-travel-entry-card"><div class="life-travel-entry-meta"><time>${esc(travelDateLabel(item.date))}</time><span>${type}</span></div><h3>${esc(item.place||'未命名地点')}</h3>${located?`<p class="life-travel-entry-location">${icon('map-pin')} 已记录当前位置</p>`:''}${item.note?`<p class="life-travel-entry-note">${esc(item.note)}</p>`:''}${photo?`<img loading="lazy" decoding="async" src="${esc(photo)}" alt="${esc(item.place||'旅行照片')}">`:''}<div class="life-travel-entry-foot"><span>${item.author===state().settings?.me?'我':'TA'} 留下</span><button type="button" data-delete-travel="${esc(item.id)}">删除</button></div></div></article>`;}
  function travelSheet(view = '') {
    markRemoteUpdateRead('travel');
    const items=live(state().travels).sort((a,b)=>String(b.date||'').localeCompare(String(a.date||''))||((b.updatedAt||0)-(a.updatedAt||0))),visited=items.filter(item=>item.status!=='wish').length,wishes=items.length-visited;
    const content=view==='add'?travelForm():`<section class="life-travel-summary"><img src="assets/puffer-travel.webp" alt="旅行胖头鱼"><div class="life-travel-summary-copy"><span>我们的旅行记录</span><h2>把走过的路，<br>放进时间里。</h2><p>${visited?`已经收好 ${visited} 段去过的路程。`:'从第一次出发开始，把地点收进这里。'}</p></div><footer class="life-travel-summary-counts"><span><b>${visited}</b> 去过</span><span><b>${wishes}</b> 想去</span></footer></section><section class="life-travel-timeline-wrap"><div class="life-travel-section-head"><div><span>按日期留下</span><h2>旅行时间线</h2></div></div>${items.length?`<div class="life-travel-timeline">${items.map(travelTimelineRow).join('')}</div>`:`<button type="button" class="life-travel-empty" data-travel-open-add>${icon('plus-circle')}<b>记下第一段旅行</b><span>一次散步、一次出发，<br>都值得留下。</span></button>`}</section>`;
openSheet(`<div class="life-travel-page life-travel-timeline-page"><header><button type="button" class="life-travel-back" ${view==='add'?'data-travel-back-timeline aria-label="返回旅行记录"':'data-sheet-close aria-label="返回小事"'}>${icon('caret-left')}</button><div><b>${view==='add'?'新的旅行':'旅行记录'}</b><small>${view==='add'?'只要几步，收好这一站':'去过和想去，都留在这里'}</small></div>${view==='add'?'<span class="life-travel-header-spacer"></span>':`<button type="button" class="life-travel-header-add" data-travel-open-add aria-label="新增旅行">${icon('plus')}</button>`}</header><main>${content}</main></div>`, 'life-sheet-travel');
  }
  function legacyTravelMapSheet(view = '') {
    const items = live(state().travels).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    openSheet(`<div class="life-travel-page"><header><button data-sheet-close>${icon('caret-left')} 小事</button><div><b>我们的足迹</b><small>地图就是旅行主页</small></div><button data-travel-view="add">记下</button></header>${travelMapSvg(items)}${view ? `<section class="life-travel-panel">${travelPanel(view, items)}</section>` : ''}<nav class="life-travel-dock"><button class="${view === 'footprints' ? 'active' : ''}" data-travel-view="footprints">${icon('map-trifold')}<span>足迹</span></button><button class="${view === 'recent' ? 'active' : ''}" data-travel-view="recent">${icon('clock')}<span>最近</span></button><button class="${view === 'wishes' ? 'active' : ''}" data-travel-view="wishes">${icon('heart')}<span>想去</span></button><button class="${view === 'add' ? 'active' : ''}" data-travel-view="add">${icon('plus-circle')}<span>新增</span></button></nav></div>`, 'life-sheet-travel');
  }
  function hydrationSheet(selected='water',audience=hydrationAudience) { if(audience==='partner')markRemoteUpdateRead('hydration'); const info=window.PufferLife?.getHydrationToday?.()||{me:{water:0,drink:0},partner:{water:0,drink:0},goal:1500,drinkLimit:500,records:[],partnerRecords:[]},readonly=audience==='partner',totals=readonly?info.partner:info.me,kind=selected==='drink'?'drink':'water',items=(readonly?info.partnerRecords:info.records||[]).slice(0,8),draft=readonly?'':` data-life-draft="hydration:${kind}:${dayKey()}"`,editor=readonly?'':`<label class="life-field-label" for="lifeHydrationMl">这次喝了多少</label><div class="life-hydration-presets"><button data-hydration-ml="250">250 ml</button><button class="active" data-hydration-ml="500">一杯 · 500 ml</button><button data-hydration-ml="750">750 ml</button></div><div class="life-hydration-custom"><input id="lifeHydrationMl" data-life-draft-field="ml" class="life-sheet-input" type="number" inputmode="numeric" min="1" max="3000" step="50" value="500"><span>ml</span></div><button class="life-sheet-primary" data-save-hydration="${kind}">记录${kind==='water'?'喝水':'饮料'}</button>`;openSheet(`<section${draft}><section class="life-hydration-sheet-hero ${readonly?'is-readonly':''}"><span class="life-hydration-sheet-icon">${icon(readonly?'eye':'drop')}</span><div><small>${readonly?'TA 的今天':'今天喝了什么'}</small><h2>${readonly?'对方的饮用记录':'记下一次饮用'}</h2><p>${readonly?'这里只用于查看，记录和撤销需要由对方在自己的设备完成。':'水和饮料分开记录，默认一杯是 500 ml。'}</p></div></section><div class="life-hydration-kind"><button class="${kind==='water'?'active':''}" ${readonly?'':'data-hydration-select="water"'}>${icon('drop')} 水 <b>${totals.water} ml</b></button><button class="${kind==='drink'?'active':''}" ${readonly?'':'data-hydration-select="drink"'}>${icon('coffee')} 饮料 <b>${totals.drink} ml</b></button></div>${editor}<h3 class="life-sheet-subtitle">今天的记录</h3><div class="life-mini-list life-hydration-history">${items.length?items.map(item=>`<div class="life-row"><span class="life-icon">${icon(item.kind==='drink'?'coffee':'drop')}</span><span class="life-row-main"><span class="life-value">${item.kind==='drink'?'饮料':'水'} · ${item.ml} ml</span><span class="life-label">${when(item.createdAt)}</span></span>${readonly?'':`<button class="life-row-action" data-delete-hydration="${esc(item.id)}">撤销</button>`}</div>`).join(''):'<div class="life-data-empty">今天还没有记录。</div>'}</div></section>`); }
  function trainingSheet(date) { const s=state(), all=live(s.trainings), groups={}; all.forEach(t=>{const key=t.date||'未标注日期';(groups[key]||(groups[key]=[])).push(t);}); if(date){const rows=(groups[date]||[]).map(t=>`<div class="life-row"><span class="life-icon">${icon('barbell')}</span><span class="life-row-main"><span class="life-value">${esc(t.content)}</span><span class="life-label">${esc(t.muscle||'训练')}${t.duration?` · ${esc(t.duration)}`:''}</span></span><button class="life-row-action" data-life-edit-training="${esc(t.id)}">编辑</button></div>`).join('');return openSheet(`<h2>${esc(date)} 的训练</h2><div class="life-mini-list">${rows}</div>`);} const rows=Object.entries(groups).sort((a,b)=>b[0].localeCompare(a[0])).map(([d,items])=>`<button class="life-row life-row-button" data-life-training-day="${esc(d)}"><span class="life-icon">${icon('barbell')}</span><span class="life-row-main"><span class="life-value">${esc(d)} · ${items.length} 条训练</span><span class="life-label">${esc([...new Set(items.map(x=>x.muscle||x.content))].join(' · '))}</span></span></button>`).join('');openSheet(`<h2>训练记录</h2><div class="life-mini-list">${rows||'<div class="life-data-empty">还没有训练记录。</div>'}</div><button class="life-sheet-primary" data-life-add-training>记录训练</button>`); }
  function trainingEdit(item) { const t=item||{},draftKey=`training:${t.id||'new'}`;openSheet(`<section data-life-draft="${esc(draftKey)}"><h2>${item?'编辑训练':'记录训练'}</h2><textarea id="lifeTrainContent" data-life-draft-field="content" maxlength="800" placeholder="今天练了什么？">${esc(t.content||'')}</textarea><input class="life-sheet-input" id="lifeTrainDate" data-life-draft-field="date" type="date" value="${esc(t.date||dayKey())}"><input class="life-sheet-input" id="lifeTrainMuscle" data-life-draft-field="muscle" maxlength="80" placeholder="部位，例如：胸肩" value="${esc(t.muscle||'')}"><input class="life-sheet-input" id="lifeTrainDuration" data-life-draft-field="duration" maxlength="80" placeholder="时长（可选）" value="${esc(t.duration||'')}"><textarea id="lifeTrainNote" data-life-draft-field="note" maxlength="800" placeholder="备注（可选）">${esc(t.note||'')}</textarea><button class="life-sheet-primary" data-save-training="${esc(t.id||'')}">保存</button></section>`); }
  function wishSheet() { markRemoteUpdateRead('wishes'); const s=state(),me=s.settings?.me||'a',items=live(s.wishes).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));openSheet(`<section data-life-draft="wish"><h2>心愿墙</h2><textarea id="lifeWishText" data-life-draft-field="text" maxlength="160" placeholder="写下一个小心愿…"></textarea><button class="life-sheet-primary" data-save-wish>贴上心愿</button><div class="life-wish-grid">${items.map(w=>`<article class="life-wish ${w.lit?'lit':''}"><span>${esc(w.icon||'✨')}</span><b>${esc(w.text)}</b><small>${when(w.createdAt)}</small>${w.author!==me&&!w.lit?`<button data-life-light-wish="${esc(w.id)}">点亮</button>`:''}</article>`).join('')||'<div class="life-data-empty">心愿墙还是空的。</div>'}</div></section>`); }
  function nestSheet() { const s=state(),photos=live(s.gallery).filter(x=>x.dataUrl||x.url),messages=live(s.messages),todayPhotos=photos.filter(x=>sameDay(x.createdAt)),todayMessages=messages.filter(x=>sameDay(x.createdAt)),todayDone=live(s.todos).filter(x=>x.done&&sameDay(x.updatedAt||x.createdAt)),latestPhoto=[...photos].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0],latestMessage=[...messages].sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))[0],memory=rediscovery(s),shelf=memory|| (latestPhoto?{title:'窗边的一张照片',text:latestPhoto.caption||'你们最近收下的共同瞬间。',image:latestPhoto.dataUrl||latestPhoto.url}:latestMessage?{title:'留在桌上的一句话',text:latestMessage.text||'TA 发来了一张照片。',image:latestMessage.image||''}:null);openSheet(`<div class="life-nest-page"><section class="life-nest-room"><img decoding="async" src="assets/puffer-nest-room.webp" alt="胖头鱼的小屋"><div><span>胖头鱼的小窝</span><h2>把普通的日子，<br>慢慢放进家里。</h2><p>这里不需要打卡，<br>只收下你们想留下的东西。</p></div></section><section class="life-nest-section"><div class="life-nest-title"><span>今天收下</span><small>只统计真实记录</small></div><div class="life-nest-counts"><article><b>${todayPhotos.length}</b><span>张照片</span></article><article><b>${todayMessages.length}</b><span>句话</span></article><article><b>${todayDone.length}</b><span>件完成</span></article></div></section><section class="life-nest-section"><div class="life-nest-title"><span>${shelf?'窗边回忆':'小屋还很安静'}</span>${memory?'<small>重新遇见</small>':''}</div>${shelf?`<article class="life-nest-shelf ${shelf.image?'has-image':''}">${shelf.image?`<img src="${esc(shelf.image)}" alt="共同回忆">`:''}<div><b>${esc(shelf.title)}</b><p>${esc(shelf.text)}</p></div></article>`:'<div class="life-data-empty">上传一张照片或留一句话，<br>小屋就会慢慢有内容。</div>'}</section><section class="life-nest-section"><div class="life-nest-title"><span>给小屋添一点</span></div><div class="life-nest-actions"><button data-life-open="gallery">${icon('image')} 放一张照片</button><button data-life-open="messages">${icon('chat-circle-text')} 留一句话</button><button data-life-open="wishes">${icon('heart')} 贴一张心愿</button></div></section></div>`); }
  function horoscopeSheet() { const cards=(window.PufferLife?.getHoroscopes?.()||[]).map(x=>`<article class="life-zodiac-person"><span>${esc(x.meta.name)} · ${'★'.repeat(x.data.stars)}</span><b>${esc(x.data.overall)}</b><p>相处提醒：${esc(x.data.love)}</p></article>`).join('');openSheet(`<section class="life-ritual-sheet-hero life-zodiac-hero"><div><span>胖头鱼观星处</span><h2>今天的双人运势</h2><p>把两个人的星星，放在同一片夜空下看。</p></div><img src="assets/puffer-zodiac.webp?v=1" alt="胖头鱼观星"></section><div class="life-zodiac-pair">${cards}</div>`); }
  function fortuneSheet() { markRemoteUpdateRead('fortune'); const s=state(),me=s.settings?.me||'a',ta=me==='a'?'b':'a',names=s.settings?.partners||{},signs=s.fortune?.date===dayKey()?s.fortune.by||{}:{},card=(person)=>{const f=signs[person],pending=person===me?'闭上眼默念一件心愿，再摇一支签。':'等 TA 来摇今天的签。';return `<article class="life-zodiac-person life-fortune-person ${f?'is-drawn':'is-pending'}"><span>${esc(names[person]||'TA')} 的签</span><b>${esc(f?`${f.level}签 · ${f.text}`:'还没有抽签')}</b><p>${esc(f?f.tip:pending)}</p></article>`};openSheet(`<section class="life-ritual-sheet-hero life-fortune-hero"><div><span>胖头鱼祈福处</span><h2>今日抽签</h2><p>今天的心愿，也想和 TA 一起知道。</p></div><img src="assets/puffer-fortune.webp?v=1" alt="胖头鱼祈福"></section><div class="life-zodiac-pair life-fortune-pair">${card(me)}${card(ta)}</div>${signs[me]?'':`<button class="life-sheet-primary" data-life-draw-fortune>摇一支签</button>`}`); }
  function applyMoodSelection(value) { const mood=String(value||''),active=[...mask.querySelectorAll('[data-life-mood]')].find(button=>button.dataset.lifeMood===mood);if(!active)return;mask.querySelectorAll('[data-life-mood]').forEach(button=>{button.classList.toggle('active',button===active);const mark=button.querySelector('i');if(mark)mark.innerHTML=button===active?icon('check-circle'):icon('circle');});const hidden=mask.querySelector('#lifeMoodValue');if(hidden)hidden.value=mood;const pet=statusPet(mood),img=mask.querySelector('[data-life-mood-pet]'),label=mask.querySelector('#lifeMoodPetLabel');if(img){img.src=`assets/${pet.asset}`;img.alt=`${pet.label}胖头鱼`;}if(label)label.textContent=pet.label; }
  function partnerMoodSheet() { markRemoteUpdateRead('mood'); const s=state(),me=s.settings?.me||'a',ta=me==='a'?'b':'a',names=s.settings?.partners||{},status=s.dailyStatus?.[dayKey()]?.[ta],pet=companionPet(s),mood=status?.mood||'还没记录';openSheet(`<section class="life-mood-hero life-partner-mood-hero"><div><span>${esc(names[ta]||'TA')} 的今天</span><h2>${esc(mood)}</h2><p>${esc(status?.text||'TA 今天还没有留下心情说明。')}</p></div><img src="assets/${pet.asset}" alt="${esc(pet.label)}胖头鱼"></section><div class="life-partner-mood-note">这里只展示对方今天主动分享的状态。</div>`); }
  function moodSheet() { const s=state(),me=s.settings?.me||'a',old=s.dailyStatus?.[dayKey()]?.[me]||{},current=old.mood||'平静',pet=statusPet(current),items=[['开心','今天有一点小雀跃','puffer-state-happy.webp'],['想你','想把这份心情告诉 TA','puffer-state-missing.webp'],['平静','慢慢来，也很好','puffer-state-quiet.webp'],['有点累','先照顾好自己','puffer-state-quiet.webp']];openSheet(`<section data-life-draft="mood:${dayKey()}"><section class="life-mood-hero"><div><span>今天的我</span><h2>现在是什么心情？</h2><p id="lifeMoodPetLabel">${esc(current==='平静'?'安静陪伴':current)}</p></div><img data-life-mood-pet src="assets/${pet.asset}" alt="${esc(pet.label)}胖头鱼"></section><input id="lifeMoodValue" data-life-draft-field="mood" type="hidden" value="${esc(current)}"><div class="life-mood-options">${items.map(([name,desc,asset])=>`<button class="life-mood-option ${current===name?'active':''}" data-life-mood="${name}" data-life-mood-asset="${asset}"><span class="life-mood-option-icon">${icon(name==='开心'?'smiley':name==='想你'?'heart':name==='平静'?'moon':'coffee')}</span><span><b>${name}</b><small>${desc}</small></span><i>${current===name?icon('check-circle'):icon('circle')}</i></button>`).join('')}</div><label class="life-field-label" for="lifeMoodNote">想对 TA 说一句（可选）</label><textarea id="lifeMoodNote" data-life-draft-field="note" maxlength="240" placeholder="例如：晚上见，想和你一起吃饭。">${esc(old.text||'')}</textarea><button class="life-sheet-primary" data-save-mood>记录今天的状态</button></section>`); }
  function presenceSheet(){const info=window.PufferLife?.getPresence?.()||{},partner=presenceLabel(info.partner),minutes=info.partner?.locationUpdatedAt?Math.max(0,Math.floor((Date.now()-Number(info.partner.locationUpdatedAt))/60000)):0,distance=Number.isFinite(info.partner?.distanceKm)?`距你约 ${info.partner.distanceKm<10?info.partner.distanceKm.toFixed(1):Math.round(info.partner.distanceKm)} km`:'双方开启位置共享后，会显示相距距离。';openSheet(`<section class="life-presence-sheet"><span class="life-presence-sheet-icon">${icon('map-pin')}</span><div><small>共同位置</small><h2>${esc(partner.text)}</h2><p>${esc(distance)}${info.partner?.locationUpdatedAt?`<br>位置更新于 ${minutes<1?'刚刚':`${minutes} 分钟前`}`:''}</p></div></section><div class="life-presence-note">位置只在网页打开时更新，不显示具体地址；你随时可以停止共享。</div><div class="life-review-actions"><button data-life-presence-refresh>更新状态</button>${info.mine?.sharing?'<button class="life-sheet-primary" data-life-presence-stop>停止共享位置</button>':'<button class="life-sheet-primary" data-life-presence-start>开启位置共享</button>'}</div>`);}
  let reviewOfferTimer=null;
  function rangeId(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
  function reviewRange(type){const now=new Date(),start=new Date(now),end=new Date(now);start.setHours(0,0,0,0);end.setHours(23,59,59,999);if(type==='week'){end.setDate(end.getDate()-1);start.setTime(end.getTime());start.setDate(start.getDate()-6);start.setHours(0,0,0,0);}if(type==='month'){end.setDate(0);end.setHours(23,59,59,999);start.setTime(end.getTime());start.setDate(1);start.setHours(0,0,0,0);}return {start,end,id:`${type}:${rangeId(start)}:${rangeId(end)}`};}
  function inRange(value,range){const time=new Date(value||0).getTime();return Number.isFinite(time)&&time>=range.start.getTime()&&time<=range.end.getTime();}
  function reviewTravelMemory(s,range,type){const now=new Date(),travels=live(s.travels).filter(item=>item.status!=='wish'),dated=travels.map(item=>({item,date:new Date(`${item.date||''}T12:00:00`)})).filter(row=>Number.isFinite(row.date.getTime())),lastYear=dated.find(row=>row.date.getFullYear()===now.getFullYear()-1&&row.date.getMonth()===now.getMonth()&&row.date.getDate()===now.getDate()),during=dated.find(row=>row.date>=range.start&&row.date<=range.end),picked=lastYear||during;if(!picked)return null;const prefix=lastYear?'去年今天':type==='week'?'上周':type==='month'?'上个月':'今天';return {item:picked.item,label:`${prefix}，你们去了 ${picked.item.place||'一个特别的地方'}。`};}
  function reviewSheet(type){const s=state(),range=reviewRange(type),messages=live(s.messages).filter(x=>inRange(x.createdAt,range)),photos=[...live(s.gallery),...messages.filter(x=>x.imageUrl||x.imageDataUrl)].filter(x=>x.dataUrl||x.url||x.imageUrl||x.imageDataUrl),todos=live(s.todos).filter(x=>inRange(x.updatedAt||x.createdAt||x.date,range)),done=todos.filter(x=>x.done).length,trainings=live(s.trainings).filter(x=>inRange(x.updatedAt||x.createdAt||x.date,range)),moods=[];Object.values(s.dailyStatus||{}).forEach(day=>Object.values(day||{}).forEach(item=>{if(inRange(item.updatedAt,range)&&item.mood)moods.push(item.mood);}));const cfg={night:{eyebrow:'今晚一起回顾',title:'把今天收好',copy:'把今天的小事，<br>留在你们这里。',asset:'puffer-review-night.png',action:'收藏今天'},week:{eyebrow:'上周回顾',title:'这一周的你们',copy:'这一周的日子，<br>慢慢成为共同生活。',asset:'puffer-review-week.png',action:'收下这一周'},month:{eyebrow:'上月回顾',title:'这个月的你们',copy:'普通的日子，<br>也慢慢发光。',asset:'puffer-review-month.png',action:'收下这个月'}}[type],photo=photos[0],memory=reviewTravelMemory(s,range,type),moodText=[...new Set(moods)].slice(0,2).join(' · ')||'还没有留下心情',travelPhoto=memory&&(memory.item.dataUrl||memory.item.url);openSheet(`<section class="life-review-hero life-review-${type}"><div><span>${cfg.eyebrow}</span><h2>${cfg.title}</h2><p>${cfg.copy}</p></div><img src="assets/${cfg.asset}" alt="胖头鱼回顾"></section><section class="life-review-stats"><article><b>${messages.length}</b><span>句留言</span></article><article><b>${photos.length}</b><span>张照片</span></article><article><b>${done}</b><span>项完成</span></article><article><b>${trainings.length}</b><span>次训练</span></article></section><section class="life-review-list"><article><span>${icon('smiley')}</span><div><small>这段时间的心情</small><b>${esc(moodText)}</b></div></article><article><span>${icon('chat-circle-text')}</span><div><small>留给彼此的话</small><b>${messages.length?`已经说了 ${messages.length} 句话，<br>继续把日常告诉 TA。`:'还没有留下话，<br>现在说一句也很好。'}</b></div></article>${memory?`<article class="life-review-travel">${travelPhoto?`<img src="${esc(travelPhoto)}" alt="${esc(memory.item.place||'旅行回忆')}">`:`<span>${icon('map-pin')}</span>`}<div><small>旅行回忆</small><b>${esc(memory.label)}</b>${memory.item.note?`<p>${esc(memory.item.note)}</p>`:''}</div></article>`:''}${photo?`<article class="life-review-photo"><img src="${esc(photo.dataUrl||photo.url||photo.imageDataUrl||photo.imageUrl)}" alt="这段时间的照片"><div><small>共同照片</small><b>这一张，<br>也值得被好好记住。</b></div></article>`:''}</section><div class="life-review-actions"><button data-life-review-later="${range.id}">晚点再看</button><button class="life-sheet-primary" data-life-review-save="${range.id}">${cfg.action}</button></div>`);}
  function reviewOfferType(now=new Date()){if(now.getDate()===1)return 'month';if(now.getDay()===1)return 'week';return now.getHours()>=20?'night':'';}
  function reviewOfferBlocked(){return document.hidden||activeLifeTab!=='today'||mask.classList.contains('show')||(!liveMessageNotice.hidden&&liveMessageNotice.classList.contains('show'));}
  function reviewAutoMarker(type,current=state()){const me=current?.settings?.me||'a';return {key:`puffer-review-auto-shown:${me}`,value:`${dayKey()}:${type}`};}
  function reviewReentryType(){const type=reviewOfferType(),current=state();if(!type||!current)return '';const marker=reviewAutoMarker(type,current),seenKey=`puffer-review-seen:${reviewRange(type).id}:${current.settings?.me||'a'}`;return localStorage.getItem(marker.key)===marker.value||localStorage.getItem(seenKey)?type:'';}
  function openCompanionOrReview(){const type=reviewReentryType();return type?reviewSheet(type):companionResponseSheet();}
  function maybeOfferReview(){
    if(reviewOfferBlocked())return false;
    const type=reviewOfferType();
    if(!type)return false;
    const current=state();
    if(!current)return false;
    const marker=reviewAutoMarker(type,current),seenKey=`puffer-review-seen:${reviewRange(type).id}:${current.settings?.me||'a'}`;
    if(localStorage.getItem(marker.key)===marker.value||localStorage.getItem(seenKey)||reviewOfferTimer)return false;
    const scheduledDay=dayKey();
    reviewOfferTimer=setTimeout(()=>{
      reviewOfferTimer=null;
      if(reviewOfferBlocked()||dayKey()!==scheduledDay)return;
      const freshType=reviewOfferType(),freshState=state();
      if(!freshType||!freshState)return;
      const freshMarker=reviewAutoMarker(freshType,freshState),freshSeenKey=`puffer-review-seen:${reviewRange(freshType).id}:${freshState.settings?.me||'a'}`;
      if(localStorage.getItem(freshMarker.key)===freshMarker.value||localStorage.getItem(freshSeenKey))return;
      localStorage.setItem(freshMarker.key,freshMarker.value);
      document.querySelector('#lifeCompanionNudge')?.remove();
      reviewSheet(freshType);
    },550);
    return true;
  }
  function toggleLifeTodo(id) {
    const todo=live(state()?.todos).find(item=>item.id===id);
    const wasDone=!!todo?.done;
    const ok=window.PufferLife?.toggleTodo?.(id);
    if(ok&&!wasDone)requestCompanionReaction('todo');
    return !!ok;
  }
  root.addEventListener('click', e => { const audience=e.target.closest('[data-hydration-audience]');if(audience){e.stopImmediatePropagation();hydrationAudience=audience.dataset.hydrationAudience==='partner'?'partner':'me';if(hydrationAudience==='partner')markRemoteUpdateRead('hydration');render();return;}const gauge=e.target.closest('[data-life-hydration-kind]');if(gauge&&hydrationAudience==='partner'){e.stopImmediatePropagation();hydrationSheet(gauge.dataset.lifeHydrationKind,'partner');} }, true);
  root.addEventListener('click', e => { const tab=e.target.closest('[data-life-tab]'); if(tab) return selectTab(tab.dataset.lifeTab); const gauge=e.target.closest('[data-life-hydration-kind]');if(gauge)return hydrationSheet(gauge.dataset.lifeHydrationKind); const open=e.target.closest('[data-life-open]'); if(open){if(open.dataset.lifeOpen!=='hydration')markRemoteUpdateRead(open.dataset.lifeOpen);const map={todo:calendarSheet,messages:messageSheet,gallery:gallerySheet,travel:travelSheet,training:trainingSheet,wishes:wishSheet,horoscope:horoscopeSheet,fortune:fortuneSheet,'partner-mood':partnerMoodSheet,presence:presenceSheet,hydration:hydrationSheet,challenge:challengeSheet,music:()=>openSheet(window.PufferMusicView?.renderDetailMarkup?.()||'<h2>今日音乐</h2>')};return map[open.dataset.lifeOpen]?.();} if(e.target.closest('[data-life-music]')) return document.querySelector('#musicFloatToggle')?.click(); if(e.target.closest('[data-life-settings]')) return document.querySelector('#settingsBtn')?.click(); const toggle=e.target.closest('[data-life-todo-toggle],[data-life-toggle-todo]');if(toggle){markRemoteUpdateRead('todo');return toggleLifeTodo(toggle.dataset.lifeTodoToggle||toggle.dataset.lifeToggleTodo);} const add=e.target.closest('[data-life-add-todo]');if(add)return todoSheet();const edit=e.target.closest('[data-life-edit-todo]');if(edit){markRemoteUpdateRead('todo');return todoSheet(live(state().todos).find(t=>t.id===edit.dataset.lifeEditTodo));}const part=e.target.closest('[data-life-participation]');if(part){const me=state().settings?.me||'a';if(part.dataset.lifePerson!==me)return;return ({fortune:fortuneSheet,mood:moodSheet,message:messageSheet,todo:calendarSheet})[part.dataset.lifeParticipation]?.();} });
  mask.addEventListener('click', e => {const toggle=e.target.closest('[data-life-toggle-todo]');if(toggle){e.preventDefault();e.stopImmediatePropagation();if(toggleLifeTodo(toggle.dataset.lifeToggleTodo))calendarSheet();return;}const edit=e.target.closest('[data-life-edit-todo]');if(edit){e.preventDefault();e.stopImmediatePropagation();return todoSheet(live(state().todos).find(t=>t.id===edit.dataset.lifeEditTodo));}}, true);
  mask.addEventListener('click', async e => { const submit=e.target.closest(lifeSubmitSelector);if(submit){e.preventDefault();return handleLifeSubmission(submit);}if(e.target===mask||e.target.closest('[data-sheet-close]')) return closeSheet();if(e.target.closest('[data-travel-open-add]'))return travelSheet('add');if(e.target.closest('[data-travel-back-timeline]'))return travelSheet();const travelView=e.target.closest('[data-travel-view]');if(travelView)return travelSheet(travelView.dataset.travelView);if(e.target.closest('[data-travel-close-panel]'))return travelSheet();if(e.target.closest('[data-travel-detail]'))return travelSheet('footprints');const travelDelete=e.target.closest('[data-delete-travel]');if(travelDelete){if(window.PufferLife?.deleteTravel?.(travelDelete.dataset.deleteTravel))travelSheet();return;}if(e.target.closest('[data-travel-locate]')){const label=mask.querySelector('#lifeTravelLocationText');if(!navigator.geolocation){if(label)label.textContent='当前浏览器不支持定位';return;}if(label)label.textContent='正在获取当前位置…';navigator.geolocation.getCurrentPosition(position=>{const lat=mask.querySelector('#lifeTravelLat'),lng=mask.querySelector('#lifeTravelLng');if(lat)lat.value=position.coords.latitude;if(lng)lng.value=position.coords.longitude;if(label)label.textContent='已选择当前位置';},()=>{if(label)label.textContent='没有获得位置权限，可只填写地点';},{enableHighAccuracy:false,timeout:8000,maximumAge:300000});return;}const hydrationKind=e.target.closest('[data-hydration-select]');if(hydrationKind)return hydrationSheet(hydrationKind.dataset.hydrationSelect);const hydrationPreset=e.target.closest('[data-hydration-ml]');if(hydrationPreset){const input=mask.querySelector('#lifeHydrationMl');if(input)input.value=hydrationPreset.dataset.hydrationMl;mask.querySelectorAll('[data-hydration-ml]').forEach(button=>button.classList.toggle('active',button===hydrationPreset));return;}const hydrationDelete=e.target.closest('[data-delete-hydration]');if(hydrationDelete){if(window.PufferLife?.deleteHydration?.(hydrationDelete.dataset.deleteHydration))hydrationSheet();return;} const shift=e.target.closest('[data-life-calendar-shift]');if(shift){calendarCursor.setMonth(calendarCursor.getMonth()+Number(shift.dataset.lifeCalendarShift));return calendarSheet();} const day=e.target.closest('[data-life-training-day]');if(day)return trainingSheet(day.dataset.lifeTrainingDay);const addTrain=e.target.closest('[data-life-add-training]');if(addTrain)return trainingEdit();const editTrain=e.target.closest('[data-life-edit-training]');if(editTrain)return trainingEdit(live(state().trainings).find(t=>t.id===editTrain.dataset.lifeEditTraining));const mood=e.target.closest('[data-life-mood]');if(mood){mask.querySelectorAll('[data-life-mood]').forEach(x=>{x.classList.toggle('active',x===mood);const mark=x.querySelector('i');if(mark)mark.innerHTML=x===mood?icon('check-circle'):icon('circle');});const pet=statusPet(mood.dataset.lifeMood),img=mask.querySelector('[data-life-mood-pet]'),label=mask.querySelector('#lifeMoodPetLabel');if(img){img.src=`assets/${pet.asset}`;img.alt=`${pet.label}胖头鱼`;}if(label)label.textContent=pet.label;return;}const light=e.target.closest('[data-life-light-wish]');if(light){window.PufferLife.lightWish(light.dataset.lifeLightWish);return closeSheet();} });
  document.addEventListener('click', e => { if(e.target.closest('#lifeCompanionFloat')) return openCompanionOrReview(); if(e.target.closest('[data-life-open="nest"]')) return nestSheet(); });
  document.addEventListener('pointermove', () => { const pet=document.querySelector('#lifeCompanionFloat');if(pet?.classList.contains('is-dragging')) queueCompanionNudgePosition(); });
  document.addEventListener('pointerup', queueCompanionNudgePosition);
  window.addEventListener('scroll', queueRemoteUpdateUi, {passive:true});
  window.addEventListener('resize', queueCompanionNudgePosition);
  window.addEventListener('resize', queueRemoteUpdateUi);
  window.visualViewport?.addEventListener('resize', queueCompanionNudgePosition);
  mask.addEventListener('click', e => {const open=e.target.closest('[data-life-open]');if(open){if(open.dataset.lifeOpen!=='hydration')markRemoteUpdateRead(open.dataset.lifeOpen);return ({gallery:gallerySheet,travel:travelSheet,messages:messageSheet,fortune:fortuneSheet,mood:moodSheet,todo:calendarSheet,training:trainingSheet,wishes:wishSheet,horoscope:horoscopeSheet,presence:presenceSheet,nest:nestSheet,hydration:hydrationSheet,challenge:challengeSheet,music:()=>openSheet(window.PufferMusicView?.renderDetailMarkup?.()||'<h2>今日音乐</h2>')})[open.dataset.lifeOpen]?.();}const action=e.target.closest('[data-life-companion-action]');if(action){return ({challenge:challengeSheet,fortune:fortuneSheet,mood:moodSheet,message:messageSheet,todo:calendarSheet,review:()=>reviewSheet('night'),guide:()=>companionResponseSheet(companionCue(state()))})[action.dataset.lifeCompanionAction]?.();}const saved=e.target.closest('[data-life-review-save]');if(saved){localStorage.setItem(`puffer-review-seen:${saved.dataset.lifeReviewSave}:${state().settings?.me||'a'}`,'1');return closeSheet();}if(e.target.closest('[data-life-review-later]'))return closeSheet();});
  mask.addEventListener('click', e => {if(e.target.closest('[data-life-presence-start]')){window.PufferLife?.setLocationSharing?.(true);return closeSheet();}if(e.target.closest('[data-life-presence-stop]')){window.PufferLife?.setLocationSharing?.(false);return closeSheet();}if(e.target.closest('[data-life-presence-refresh]')){window.PufferLife?.refreshPresence?.();return presenceSheet();}});
  mask.addEventListener('click', e => { const answer=e.target.closest('[data-life-answer-challenge]'); if(!answer)return; if(window.PufferLife?.answerTodayChallenge?.(answer.dataset.lifeAnswerChallenge)) challengeSheet(); });
  mask.addEventListener('change', e => { const input=e.target.closest('#lifeMessageImage');if(!input)return;const preview=mask.querySelector('#lifeMessageImagePreview'),file=input.files?.[0];if(!file){preview.hidden=true;preview.innerHTML='';return;}if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);const url=URL.createObjectURL(file);preview.dataset.objectUrl=url;preview.innerHTML=`<img src="${url}" alt="待发送图片预览"><span>${esc(file.name)}</span><button type="button" data-life-remove-image>×</button>`;preview.hidden=false; });
  mask.addEventListener('change', e => {const input=e.target.closest('#lifeTravelPhoto');if(!input)return;const label=mask.querySelector('#lifeTravelPhotoText');if(label)label.textContent=input.files?.[0]?.name||'加入一张真实照片（可选）';});
  mask.addEventListener('click', e => { if(!e.target.closest('[data-life-remove-image]')) return; const input=mask.querySelector('#lifeMessageImage'),preview=mask.querySelector('#lifeMessageImagePreview');if(input)input.value='';if(preview){if(preview.dataset.objectUrl)URL.revokeObjectURL(preview.dataset.objectUrl);preview.hidden=true;preview.innerHTML='';delete preview.dataset.objectUrl;} });
  mask.addEventListener('click', e => { const del=e.target.closest('[data-life-delete-gallery]'); if(!del)return; if(window.PufferLife?.deleteGallery?.(del.dataset.lifeDeleteGallery)){ gallerySheet(); } });
  mask.addEventListener('click', e => { const mood=e.target.closest('[data-life-mood]');if(mood){applyMoodSelection(mood.dataset.lifeMood);mask.querySelector('#lifeMoodValue')?.dispatchEvent(new Event('change',{bubbles:true}));}if(e.target.closest('[data-hydration-ml]'))requestAnimationFrame(()=>activeSheetDraft?.flush()); });
  liveMessageNotice.addEventListener('click', () => { hideLiveMessageNotice(true); window.dispatchEvent(new CustomEvent('puffer-life-messages')); });
  window.addEventListener('pagehide', () => finishActiveSheetDraft(true));
  document.addEventListener('visibilitychange', () => { if(document.hidden)activeSheetDraft?.flush();else { if(syncTimeAtmosphere())render(); maybeOfferReview(); } });
  window.addEventListener('puffer-modal-open', () => beginOverlaySession('app-modal', document.querySelector('#modalClose')));
  window.addEventListener('puffer-modal-close', () => finishOverlaySession('app-modal', closingOverlayFromHistory));
  window.addEventListener('popstate', event => {
    if (mask.classList.contains('show')) return closeSheet(true);
    const appModal = document.querySelector('#modalMask.show');
    if (appModal) {
      closingOverlayFromHistory = true;
      document.querySelector('#modalClose')?.click();
      closingOverlayFromHistory = false;
      return;
    }
    if (event.state?.pufferOverlay && !overlayHistoryKind) history.back();
  });
  window.addEventListener('puffer-state-change', () => {render();refreshOpenMessageSheet();maybeOfferReview();});
  window.addEventListener('puffer-new-messages', event => showLiveMessageNotice(event.detail));
  window.addEventListener('puffer-remote-changes', event => registerRemoteUpdates(event.detail?.changes));
  window.addEventListener('puffer-sync-status', event => {refreshSyncUi();resolvePendingCompanionReaction(event.detail);});
  window.addEventListener('puffer-presence-change', render);
  window.addEventListener('puffer-life-home', () => { selectTab('today'); render(); });
  window.addEventListener('puffer-life-messages', () => { selectTab('things'); render(); requestAnimationFrame(() => messageSheet()); });
  window.addEventListener('puffer-life-todo', () => { selectTab('days'); render(); requestAnimationFrame(() => calendarSheet()); });
  window.addEventListener('puffer-life-gallery', () => { selectTab('things'); render(); requestAnimationFrame(() => gallerySheet()); });
  window.addEventListener('puffer-life-hydration', () => { hydrationAudience='me'; }, true);
  window.addEventListener('puffer-life-hydration', () => { selectTab('today'); render(); requestAnimationFrame(() => hydrationSheet()); });
  function openNotificationTarget(kind) { if(kind==='messages')window.dispatchEvent(new CustomEvent('puffer-life-messages'));else if(kind==='todos'||kind==='todo')window.dispatchEvent(new CustomEvent('puffer-life-todo'));else if(kind==='gallery')window.dispatchEvent(new CustomEvent('puffer-life-gallery'));else if(kind==='hydration')window.dispatchEvent(new CustomEvent('puffer-life-hydration')); }
  setInterval(() => { if(!document.hidden&&syncTimeAtmosphere())render(); }, 60000);
  document.addEventListener('DOMContentLoaded', () => { document.body.classList.add('life-mode'); syncTimeAtmosphere(); document.querySelectorAll('.bg-bubbles,.bg-motes').forEach(node=>node.remove()); try { render(); lifeRenderReady = true; } finally { document.documentElement.classList.remove('life-boot'); } const url=new URL(location.href),target=url.searchParams.get('open');if(target){url.searchParams.delete('open');history.replaceState(null,'',url.pathname+url.search+url.hash);requestAnimationFrame(()=>openNotificationTarget(target));}else maybeOfferReview(); });
})();
