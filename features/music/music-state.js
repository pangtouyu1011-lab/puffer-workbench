// Personal music state adapter. Keeps the existing local settings schema intact.
(function () {
  'use strict';

  let context = null;

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
    state.settings._musicRejectedForSlot = Array.isArray(state.settings._musicRejectedForSlot)
      ? state.settings._musicRejectedForSlot
      : [];
    state.settings._musicBlocked = state.settings._musicBlocked || {};
    state.settings._musicSlotSongKeys = state.settings._musicSlotSongKeys || {};
    return state.settings;
  }

  function getHistory() {
    return getSettings()._musicHistory;
  }

  function getLikes() {
    return getSettings()._musicLikes;
  }

  function getRejectedForSlot() {
    return getSettings()._musicRejectedForSlot;
  }

  function getBlocked() {
    return getSettings()._musicBlocked;
  }

  function getSlotSongKeys() {
    return getSettings()._musicSlotSongKeys;
  }

  function getCurrentMusic() {
    return getSettings()._musicCurrentMusic || null;
  }

  function saveHistoryRecord(record) {
    if (!record || !record.date || !record.slot || !record.songKey) return false;
    const settings = getSettings();
    const persisted = { ...record };
    delete persisted.song;
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
    if (!record || !record.date || !record.slot || !record.songKey) return false;
    const settings = getSettings();
    const persisted = { ...record };
    delete persisted.song;
    settings._musicCurrentMusic = persisted;
    return saveHistoryRecord(record);
  }

  function getDayMusicHistory(date) {
    const history = getSettings()._musicDayHistory;
    return history.filter(item => !date || item.date === date);
  }

  function save(options) {
    if (!context) throw new Error('Puffer music state is not configured');
    return context.save(options);
  }

  function recordFeedback(key, action) {
    if (!key) return false;
    const settings = getSettings();
    if (action === 'like') {
      if (settings._musicLikes[key] === 1) delete settings._musicLikes[key];
      else settings._musicLikes[key] = 1;
    } else if (action === 'dislike') {
      settings._musicLikes[key] = -1;
      settings._musicRejectedForSlot = Array.from(new Set([
        ...settings._musicRejectedForSlot,
        key
      ]));
    } else if (action === 'block') {
      settings._musicBlocked[key] = true;
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
    getCurrentMusic,
    saveHistoryRecord,
    saveCurrentMusic,
    getDayMusicHistory,
    recordFeedback,
    markNotified,
    getNotifiedSlot,
    save
  };
})();
