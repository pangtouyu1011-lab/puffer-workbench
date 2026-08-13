(function () {
  'use strict';
  const API_PATH = '/api/v1/push/public-key';
  const toBytes = value => {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  };
  const room = () => window.PufferLife?.getState?.()?.settings?.room || null;
  const context = override => {
    const current = override || room() || {};
    return {
      backend: current.backend || 'worker',
      joined: override ? true : !!current.joined,
      url: String(current.url || ''),
      id: String(current.id || ''),
      pass: String(current.pass || ''),
      person: String(current.person || window.PufferLife?.getState?.()?.settings?.me || 'a')
    };
  };
  async function subscription() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const registration = await navigator.serviceWorker.getRegistration('/') || await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    return registration.pushManager.getSubscription();
  }
  async function endpoint() { return (await subscription())?.endpoint || ''; }
  async function status(override) {
    const current = context(override);
    const result = { supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window, permission: 'Notification' in window ? Notification.permission : 'unsupported', subscribed: false, serverSubscribed: false, lastAcceptedPush: null };
    if (!result.supported || !current?.joined || current.backend === 'supabase' || !current.url || !current.id || !current.pass) return result;
    try {
      const currentSubscription = await subscription();
      result.subscribed = !!currentSubscription;
      const response = await fetch(`${String(current.url).replace(/\/$/, '')}/api/v1/rooms/${encodeURIComponent(current.id)}/push/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pass: current.pass, person: current.person, endpoint: currentSubscription?.endpoint || '' }), cache: 'no-store' });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        result.serverSubscribed = !!body.subscribed;
        result.lastAcceptedPush = body.lastAcceptedPush || null;
      }
    } catch (_) {}
    return result;
  }
  async function enable() {
    const current = context();
    if (!current?.joined || current.backend === 'supabase' || !current.url || !current.id || !current.pass) throw new Error('请先加入共享房间');
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('当前设备不支持网页推送');
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('你没有允许通知');
    const registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    const base = String(current.url).replace(/\/$/, '');
    const keyResponse = await fetch(`${base}${API_PATH}`, { cache: 'no-store' });
    const keyBody = await keyResponse.json();
    if (!keyResponse.ok || !keyBody.publicKey) throw new Error('推送服务尚未配置');
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(keyBody.publicKey) });
    const response = await fetch(`${base}/api/v1/rooms/${encodeURIComponent(current.id)}/push/subscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass: current.pass, person: current.person, subscription: subscription.toJSON() })
    });
    if (!response.ok) throw new Error('推送订阅保存失败');
    localStorage.setItem('puffer-push-enabled', '1');
    localStorage.setItem('puffer-push-endpoint', subscription.endpoint);
    return true;
  }
  async function removeServer(override, subscriptionEndpoint) {
    const current = context(override);
    if (!current.url || !current.id || !current.pass || !subscriptionEndpoint) return true;
    const response = await fetch(`${String(current.url).replace(/\/$/, '')}/api/v1/rooms/${encodeURIComponent(current.id)}/push/unsubscribe`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
      body: JSON.stringify({ pass: current.pass, endpoint: subscriptionEndpoint })
    });
    if (!response.ok) throw new Error('服务器通知订阅删除失败');
    return true;
  }
  async function disable(override) {
    const currentSubscription = await subscription();
    const currentEndpoint = currentSubscription?.endpoint || localStorage.getItem('puffer-push-endpoint') || '';
    let serverError = null;
    if (currentEndpoint) {
      try { await removeServer(override || context(), currentEndpoint); }
      catch (error) { serverError = error; }
      // Even if the network is down, invalidate the browser endpoint now so
      // the old room cannot keep notifying this device. Server cleanup retries separately.
      if (currentSubscription) {
        try { await currentSubscription.unsubscribe(); } catch (error) { if (!serverError) serverError = error; }
      }
    }
    localStorage.removeItem('puffer-push-enabled');
    localStorage.removeItem('puffer-push-endpoint');
    if (serverError) {
      serverError.endpoint = currentEndpoint;
      throw serverError;
    }
    return { ok: true, endpoint: currentEndpoint };
  }
  window.PufferPush = { enable, disable, endpoint, removeServer, status, supported: () => 'serviceWorker' in navigator && 'PushManager' in window };
  window.dispatchEvent(new CustomEvent('puffer-push-ready'));
})();
