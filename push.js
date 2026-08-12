(function () {
  'use strict';
  const API_PATH = '/api/v1/push/public-key';
  const toBytes = value => {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, char => char.charCodeAt(0));
  };
  const room = () => window.PufferLife?.getState?.()?.settings?.room || null;
  async function enable() {
    const current = room();
    if (!current?.joined || current.backend === 'supabase' || !current.url || !current.id || !current.pass) return false;
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
      body: JSON.stringify({ pass: current.pass, person: window.PufferLife.getState().settings.me || 'a', subscription: subscription.toJSON() })
    });
    if (!response.ok) throw new Error('推送订阅保存失败');
    localStorage.setItem('puffer-push-enabled', '1');
    return true;
  }
  window.PufferPush = { enable, supported: () => 'serviceWorker' in navigator && 'PushManager' in window };
})();
