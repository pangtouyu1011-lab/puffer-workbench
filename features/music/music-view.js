// Music presentation layer. It only renders personal recommendations and
// delegates persistence/recommendation decisions to the existing music modules.
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

  function current() {
    return window.PufferMusicRecommend?.getCurrentMusic?.() || null;
  }

  function songTitle(record) {
    return record?.song?.title || record?.title || '今天的歌';
  }

  function songArtist(record) {
    return record?.song?.artist || record?.artist || '正在准备';
  }

  function slotLabel(id) {
    return SLOTS.find(slot => slot.id === id)?.label || id || '时段';
  }

  function reasonSummary(record) {
    return record?.reason?.summary || '给今天留一段合适的陪伴。';
  }

  function getHistory(date) {
    return window.PufferMusicState?.getDayMusicHistory?.(date) || [];
  }

  function renderHomeMarkup() {
    const record = current();
    const title = songTitle(record), artist = songArtist(record);
    return `<section class="life-section life-home-music">
      <div class="life-section-head">
        <h2 class="life-section-title">今日音乐</h2>
        <button type="button" class="life-pill" data-life-open="music">查看详情</button>
      </div>
      <button type="button" class="life-music-now" data-life-open="music" aria-label="查看此刻推荐的音乐">
        <span class="life-music-now-icon" aria-hidden="true">♪</span>
        <span class="life-music-now-copy">
          <small>此刻推荐</small>
          <b>${esc(title)}</b>
          <span>${esc(artist)}</span>
          <em>${esc(reasonSummary(record))}</em>
        </span>
        <span class="life-music-now-arrow" aria-hidden="true">›</span>
      </button>
    </section>`;
  }

  function historyMarkup(record) {
    const date = record?.date || new Date().toISOString().slice(0, 10);
    const currentSlot = record?.slot || window.PufferMusicRecommend?.currentMusicSlot?.();
    const history = getHistory(date);
    const bySlot = new Map(history.map(item => [item.slot, item]));
    return SLOTS.map(slot => {
      const item = bySlot.get(slot.id);
      const isPast = SLOTS.findIndex(x => x.id === currentSlot) >= SLOTS.findIndex(x => x.id === slot.id);
      if (item) {
        return `<li class="life-music-history-item is-done"><span class="life-music-history-mark">✓</span><div><small>${slot.label}</small><b>${esc(songTitle(item))}</b><em>${esc(songArtist(item))}</em></div></li>`;
      }
      return `<li class="life-music-history-item ${isPast ? 'is-empty' : 'is-locked'}"><span class="life-music-history-mark">${isPast ? '·' : '⌁'}</span><div><small>${slot.label}</small><b>${isPast ? '还没有推荐' : `${slot.unlock} 后解锁`}</b><em>${isPast ? '打开时会为你重新准备' : '到时间再来看看'}</em></div></li>`;
    }).join('');
  }

  function reasonMarkup(reason) {
    const parts = [reason?.weather, reason?.scene, reason?.preference, reason?.mood]
      .filter(item => item?.text);
    return parts.length ? `<div class="life-music-reasons">${parts.map(item => `<span>${esc(item.text)}</span>`).join('')}</div>` : '';
  }

  function renderDetailMarkup() {
    const record = current();
    if (!record) return '<section class="life-music-detail"><h2>今日音乐</h2><p class="life-data-empty">今天的推荐还在准备中。</p></section>';
    return `<section class="life-music-detail">
      <div class="life-music-detail-eyebrow">此刻推荐 · ${esc(slotLabel(record.slot))}</div>
      <div class="life-music-detail-hero">
        <span class="life-music-detail-note" aria-hidden="true">♪</span>
        <div><h2>${esc(songTitle(record))}</h2><p>${esc(songArtist(record))}</p></div>
      </div>
      <div class="life-music-detail-reason"><small>为什么推荐</small><b>${esc(reasonSummary(record))}</b>${reasonMarkup(record.reason)}</div>
      <div class="life-music-history-head"><h3>今天的音乐记录</h3><span>只记录在本机</span></div>
      <ul class="life-music-history">${historyMarkup(record)}</ul>
    </section>`;
  }

  window.PufferMusicView = { current, renderHomeMarkup, renderDetailMarkup };
})();
