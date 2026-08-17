// Personal music state adapter. Keeps the existing local settings schema intact.
(function () {
  'use strict';

  let context = null;
  const MUSIC_CACHE_RETENTION_DAYS = 14;
  const MUSIC_REJECTIONS_PER_SLOT = 50;

  function objectRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function calendarDay(dateKey) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const value = Date.UTC(year, month - 1, day);
    const parsed = new Date(value);
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
    return Math.floor(value / 86400000);
  }

  function slotDate(slotKey) {
    const match = /^(\d{4}-\d{2}-\d{2}):/.exec(String(slotKey || ''));
    return match ? match[1] : '';
  }

  function shouldKeepSlot(slotKey, activeDate) {
    const activeDay = calendarDay(activeDate);
    const itemDay = calendarDay(slotDate(slotKey));
    if (activeDay === null || itemDay === null) return false;
    const age = activeDay - itemDay;
    return age >= 0 && age < MUSIC_CACHE_RETENTION_DAYS;
  }

  function configure(next) {
    context = next;
  }

  function getSettings() {
    if (!context) throw new Error('Puffer music state is not configured');
    const state = context.getState();
    state.settings = state.settings || {};
    state.settings._musicHistory = Array.isArray(state.settings._musicHistory)
      ? state.settings._musicHistory
      : [];
    state.settings._musicLikes = state.settings._musicLikes || {};
    state.settings._musicRejectedBySlot = objectRecord(state.settings._musicRejectedBySlot);
    state.settings._musicBlocked = objectRecord(state.settings._musicBlocked);
    state.settings._musicSlotSongKeys = objectRecord(state.settings._musicSlotSongKeys);
    return state.settings;
  }

  function getHistory() {
    return getSettings()._musicHistory;
  }

  function getLikes() {
    return getSettings()._musicLikes;
  }

  function getRejectedForSlot(slotKey) {
    const rejected = getSettings()._musicRejectedBySlot[slotKey];
    return Array.isArray(rejected) ? rejected : [];
  }

  function getBlocked() {
    return getSettings()._musicBlocked;
  }

  function getSlotSongKeys() {
    return getSettings()._musicSlotSongKeys;
  }

  function cleanupMusicCaches(activeDate) {
    const settings = getSettings();
    let changed = false;

    // Legacy versions stored every "换一首" choice in one global array. Its
    // slot cannot be recovered, so retaining it would keep excluding songs
    // forever. The existing -1 preference remains as a soft ranking signal.
    if (Object.prototype.hasOwnProperty.call(settings, '_musicRejectedForSlot')) {
      delete settings._musicRejectedForSlot;
      changed = true;
    }

    const nextRejected = {};
    Object.entries(settings._musicRejectedBySlot).forEach(([slotKey, values]) => {
      if (!shouldKeepSlot(slotKey, activeDate) || !Array.isArray(values)) {
        changed = true;
        return;
      }
      const normalized = Array.from(new Set(values.filter(value => typeof value === 'string' && value)))
        .slice(-MUSIC_REJECTIONS_PER_SLOT);
      if (normalized.length) nextRejected[slotKey] = normalized;
      if (normalized.length !== values.length || !normalized.length) changed = true;
    });
    if (Object.keys(nextRejected).length !== Object.keys(settings._musicRejectedBySlot).length) changed = true;
    settings._musicRejectedBySlot = nextRejected;

    const nextSlotSongs = {};
    Object.entries(settings._musicSlotSongKeys).forEach(([slotKey, songKey]) => {
      if (!shouldKeepSlot(slotKey, activeDate) || typeof songKey !== 'string' || !songKey) {
        changed = true;
        return;
      }
      nextSlotSongs[slotKey] = songKey;
    });
    if (Object.keys(nextSlotSongs).length !== Object.keys(settings._musicSlotSongKeys).length) changed = true;
    settings._musicSlotSongKeys = nextSlotSongs;
    return changed;
  }

  function getCurrentMusic() {
    return getSettings()._musicCurrentMusic || null;
  }

  function saveMusicTrack(record, options = {}) {
    if (!record || !record.date || !record.slot || !record.songKey) return false;
    const settings = getSettings();
    const persisted = { ...record };
    // Keep a small display snapshot alongside the stable song key so the
    // local trail can render even when the library is loaded later.
    if (!persisted.title && record.song?.title) persisted.title = record.song.title;
    if (!persisted.artist && record.song?.artist) persisted.artist = record.song.artist;
    delete persisted.song;
    if (options.current) settings._musicCurrentMusic = persisted;
    settings._musicDayHistory = Array.isArray(settings._musicDayHistory)
      ? settings._musicDayHistory
      : [];
    const historyKey = record.date + ':' + record.slot;
    if (!settings._musicDayHistory.some(item => item.date + ':' + item.slot === historyKey)) {
      settings._musicDayHistory.push({ ...persisted });
      settings._musicDayHistory = settings._musicDayHistory.slice(-90);
    }
    save({ silent: true });
    return true;
  }

  function saveCurrentMusic(record) {
    return saveMusicTrack(record, { current: true });
  }

  function saveHistoryRecord(record) {
    return saveMusicTrack(record);
  }

  function getDayMusicHistory(date) {
    const history = getSettings()._musicDayHistory;
    return history.filter(item => !date || item.date === date);
  }

  function save(options) {
    if (!context) throw new Error('Puffer music state is not configured');
    return context.save(options);
  }

  function recordFeedback(key, action, slotKey) {
    if (!key) return false;
    const settings = getSettings();
    const activeDate = slotDate(slotKey) || (context && context.todayKey ? context.todayKey() : '');
    if (activeDate) cleanupMusicCaches(activeDate);
    if (action === 'like') {
      if (settings._musicLikes[key] === 1) delete settings._musicLikes[key];
      else settings._musicLikes[key] = 1;
    } else if (action === 'dislike') {
      settings._musicLikes[key] = -1;
      if (slotKey) {
        settings._musicRejectedBySlot[slotKey] = Array.from(new Set([
          ...getRejectedForSlot(slotKey),
          key
        ])).slice(-MUSIC_REJECTIONS_PER_SLOT);
        if (settings._musicSlotSongKeys[slotKey] === key) delete settings._musicSlotSongKeys[slotKey];
        const current = settings._musicCurrentMusic;
        const currentPart = current && current.slot === 'afternoon' ? 'noon' : current && current.slot;
        const currentSlotKey = current && current.date && currentPart
          ? current.date + ':' + currentPart + ':all'
          : '';
        if (current && current.songKey === key && currentSlotKey === slotKey) delete settings._musicCurrentMusic;
      }
    } else if (action === 'block') {
      settings._musicBlocked[key] = true;
      Object.entries(settings._musicSlotSongKeys).forEach(([cachedSlot, cachedKey]) => {
        if (cachedKey === key) delete settings._musicSlotSongKeys[cachedSlot];
      });
      if (settings._musicCurrentMusic && settings._musicCurrentMusic.songKey === key) {
        delete settings._musicCurrentMusic;
      }
    } else {
      return false;
    }
    save({ silent: true });
    return true;
  }

  function markNotified(slotKey) {
    if (!slotKey) return false;
    getSettings()._musicNotifiedSlot = slotKey;
    save({ silent: true });
    return true;
  }

  function getNotifiedSlot() {
    return getSettings()._musicNotifiedSlot || '';
  }

  window.PufferMusicState = {
    configure,
    getSettings,
    getHistory,
    getLikes,
    getRejectedForSlot,
    getBlocked,
    getSlotSongKeys,
    cleanupMusicCaches,
    getCurrentMusic,
    saveMusicTrack,
    saveHistoryRecord,
    saveCurrentMusic,
    getDayMusicHistory,
    recordFeedback,
    markNotified,
    getNotifiedSlot,
    save
  };
})();
