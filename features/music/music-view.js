// Music presentation layer. Personal recommendations stay local and are
// rendered as a calm daily trail rather than a task list.
(function () {
  'use strict';

  const SLOTS = [
    { id: 'morning', label: '早晨', unlock: '07:00' },
    { id: 'afternoon', label: '下午', unlock: '12:00' },
    { id: 'night', label: '晚上', unlock: '18:00' }
  ];

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function lineIcon(slot) {
    const paths = {
      morning: '<circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.65 17.65l1.42 1.42M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.65 6.35l1.42-1.42"/>',
      afternoon: '<path d="M4 16.5h13.5a3.5 3.5 0 0 0 .4-6.98A5.5 5.5 0 0 0 7.2 8.1 4.3 4.3 0 0 0 4 16.5Z"/><path d="M4 19h9M7 22h7"/>',
      night: '<path d="M20.5 15.2A7.8 7.8 0 0 1 8.8 3.5 8 8 0 1 0 20.5 15.2Z"/><path d="m17.5 4 .4 1.1L19 5.5l-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="life-music-slot-svg" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${paths[slot] || paths.night}</svg>`;
  }

  function current() {
    try { return window.PufferMusicRecommend?.getCurrentMusic?.() || null; } catch (error) {
      console.warn('[MusicView] current recommendation unavailable', error);
      return null;
    }
  }

  function songTitle(record) { return record?.song?.title || record?.title || '今天的歌'; }
  function songArtist(record) { return record?.song?.artist || record?.artist || '正在准备'; }
  function slotLabel(id) { return SLOTS.find(slot => slot.id === id)?.label || id || '时段'; }
  function reasonSummary(record) { return record?.reason?.summary || '给今天留一段合适的陪伴。'; }
  function getHistory(date) { return window.PufferMusicState?.getDayMusicHistory?.(date) || []; }

  function renderHomeMarkup() {
    const record = current();
    return `<section class="life-section life-home-music">
      <div class="life-section-head">
        <h2 class="life-section-title">今日音乐</h2>
        <button type="button" class="life-pill" data-life-open="music">查看详情</button>
      </div>
      <button type="button" class="life-music-now" data-life-open="music" aria-label="查看此刻推荐的音乐">
        <span class="life-music-now-icon" aria-hidden="true">${lineIcon(record?.slot)}</span>
        <span class="life-music-now-copy">
          <small>此刻推荐</small>
          <b>${esc(songTitle(record))}</b>
          <span>${esc(songArtist(record))}</span>
          <em>${esc(reasonSummary(record))}</em>
        </span>
        <span class="life-music-now-arrow" aria-hidden="true">›</span>
      </button>
    </section>`;
  }

  function historyMarkup(record) {
    const date = record?.date || new Date().toISOString().slice(0, 10);
    const currentSlot = record?.slot || window.PufferMusicRecommend?.currentMusicSlot?.() || 'morning';
    const history = getHistory(date);
    const bySlot = new Map(history.map(item => [item.slot, item]));
    const currentIndex = SLOTS.findIndex(item => item.id === currentSlot);
    return SLOTS.map((slot, index) => {
      const item = bySlot.get(slot.id);
      const isPast = index < currentIndex;
      if (item) {
        const note = item.source === 'retroactive' ? '今天早些时候错过了，补上一首给你。' : '这一段时间，留给自己的陪伴。';
        return `<li class="life-music-history-item is-generated ${item.source === 'retroactive' ? 'is-retroactive' : ''}">
          <span class="life-music-history-mark">${lineIcon(slot.id)}</span>
          <div><small>${slot.label}</small><b>${esc(songTitle(item))}</b><em>${esc(songArtist(item))}</em><p>${esc(note)}</p></div>
        </li>`;
      }
      if (isPast) {
        return `<li class="life-music-history-item is-empty">
          <span class="life-music-history-mark">${lineIcon(slot.id)}</span>
          <div><small>${slot.label}</small><b>今天早些时候的歌</b><em>打开时会为你补上一首</em></div>
        </li>`;
      }
      return `<li class="life-music-history-item is-locked">
        <span class="life-music-history-mark">${lineIcon(slot.id)}</span>
        <div><small>${slot.label}</small><b>夜晚到来时，再为你准备一首</b><em>${slot.unlock} 后再来看看</em></div>
      </li>`;
    }).join('');
  }

  function reasonMarkup(reason) {
    const parts = [reason?.weather, reason?.scene, reason?.preference, reason?.mood]
      .filter(item => item?.text).slice(0, 2);
    return parts.length ? `<div class="life-music-reasons">${parts.map(item => `<span>${esc(item.text)}</span>`).join('')}</div>` : '';
  }

  function renderDetailMarkup() {
    const record = current();
    if (!record) return '<section class="life-music-detail"><h2>今日音乐</h2><p class="life-data-empty">今天的陪伴还在准备中。</p></section>';
    return `<section class="life-music-detail">
      <div class="life-music-detail-eyebrow">此刻推荐 · ${esc(slotLabel(record.slot))}</div>
      <div class="life-music-detail-hero">
        <span class="life-music-detail-note" aria-hidden="true">${lineIcon(record.slot)}</span>
        <div><h2>${esc(songTitle(record))}</h2><p>${esc(songArtist(record))}</p></div>
      </div>
      <div class="life-music-detail-reason"><small>为什么推荐</small><b>${esc(reasonSummary(record))}</b>${reasonMarkup(record.reason)}</div>
      <div class="life-music-history-head"><h3>今天的音乐轨迹</h3><span>只记录在本机</span></div>
      <ul class="life-music-history">${historyMarkup(record)}</ul>
    </section>`;
  }

  window.PufferMusicView = { current, renderHomeMarkup, renderDetailMarkup };
})();
