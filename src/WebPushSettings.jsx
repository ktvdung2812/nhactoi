import React, { useEffect, useState } from 'react';
import { Bell, Download } from 'lucide-react';

export function WebAppBootstrap() {
  useEffect(() => {
    if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
    const available = event => { event.preventDefault(); window.nhactoiInstallPrompt = event; window.dispatchEvent(new Event('nhactoi-install-ready')); };
    const installed = () => { window.nhactoiInstallPrompt = null; };
    window.addEventListener('beforeinstallprompt', available);
    window.addEventListener('appinstalled', installed);
    return () => { window.removeEventListener('beforeinstallprompt', available); window.removeEventListener('appinstalled', installed); };
  }, []);
  return null;
}
const supported = () => window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const bytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

export default function WebPushSettings({ api }) {
  const [config, setConfig] = useState(null);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [permission, setPermission] = useState('default');
  const [installable, setInstallable] = useState(false);
  const [installed, setInstalled] = useState(false);
  async function inspect() {
    const next = await api('/web-push/config'); setConfig(next);
    if (!supported()) return;
    setPermission(Notification.permission);
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    const result = subscription ? await api('/web-push/subscription/status', { method: 'POST', body: JSON.stringify({ endpoint: subscription.endpoint }) }) : { subscribed: false };
    const applicationKey = subscription?.options?.applicationServerKey;
    const expectedKey = next.publicKey ? bytes(next.publicKey) : null;
    const matches = applicationKey && expectedKey && new Uint8Array(applicationKey).length === expectedKey.length && new Uint8Array(applicationKey).every((value, i) => value === expectedKey[i]);
    setActive(result.subscribed && (!next.enabled || !!matches));
    if (result.subscribed && next.enabled && !matches) setNotice('Cấu hình thông báo đã thay đổi. Bật lại để cập nhật đăng ký.');
  }
  useEffect(() => {
    let alive = true;
    const load = () => { if (alive) inspect().catch(e => { if (alive) setError(e.message); }); };
    const checkInstall = () => { setInstallable(!!window.nhactoiInstallPrompt); setInstalled(window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true); };
    load(); checkInstall();
    window.addEventListener('focus', load);
    window.addEventListener('nhactoi-install-ready', checkInstall);
    window.addEventListener('appinstalled', checkInstall);
    return () => { alive = false; window.removeEventListener('focus', load); window.removeEventListener('nhactoi-install-ready', checkInstall); window.removeEventListener('appinstalled', checkInstall); };
  }, [api]);
  async function enable() {
    if (busy || !config?.enabled || !supported()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      // The permission dialog is requested only from this explicit button click.
      const granted = await Notification.requestPermission(); setPermission(granted);
      if (granted !== 'granted') { setNotice('Chưa được cấp quyền thông báo. Bạn có thể đổi quyền trong cài đặt trang web.'); return; }
      await navigator.serviceWorker.register('/sw.js');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api('/web-push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
        if (!await subscription.unsubscribe()) throw new Error('Chưa gỡ được đăng ký cũ. Hãy tải lại trang và thử lại.');
      }
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(config.publicKey) });
      try { await api('/web-push/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) }); }
      catch (e) { await subscription.unsubscribe().catch(() => {}); throw e; }
      setActive(true); setNotice('Đã bật thông báo cho trình duyệt này.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const registration = await navigator.serviceWorker.getRegistration('/');
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) {
        await api('/web-push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: subscription.endpoint }) });
        setActive(false);
        await subscription.unsubscribe();
      }
      setActive(false); setNotice('Đã tắt thông báo cho trình duyệt này.');
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function install() {
    const prompt = window.nhactoiInstallPrompt;
    if (!prompt) return;
    setError('');
    try { await prompt.prompt(); await prompt.userChoice; }
    catch (e) { setError(e.message); }
    finally { window.nhactoiInstallPrompt = null; setInstallable(false); }
  }
  const canPush = typeof window !== 'undefined' && supported();
  return <section className="td-panel" aria-labelledby="web-push-title">
    <div className="td-section-heading"><h2 id="web-push-title"><Bell size={19} />Thông báo & ứng dụng web</h2></div>
    <p>Nhận lời nhắc và cập nhật từ các không gian bạn tham gia, kể cả khi không mở trang. Thông báo trên màn hình khóa chỉ hiển thị nội dung chung.</p>
    <p role="status">{!canPush ? 'Trình duyệt này chưa hỗ trợ Web Push hoặc trang chưa dùng HTTPS. Trên iPhone/iPad, hãy thêm ứng dụng vào Màn hình chính rồi mở từ đó.' : permission === 'denied' ? 'Thông báo đang bị chặn. Mở cài đặt quyền của trang web để cho phép.' : active ? 'Thông báo đang bật trên trình duyệt này.' : !config ? 'Đang kiểm tra cấu hình…' : !config.enabled ? 'Máy chủ chưa bật Web Push. Vui lòng liên hệ quản trị viên.' : 'Thông báo chưa bật trên trình duyệt này.'}</p>
    {error && <p className="td-error" role="alert">{error}</p>}
    {notice && <p className="td-notice" role="status">{notice}</p>}
    <div className="modal-actions">
      {active ? <button type="button" className="button secondary" disabled={busy} onClick={disable}>Tắt thông báo</button> : <button type="button" className="button" disabled={busy || !canPush || !config?.enabled || permission === 'denied'} onClick={enable}>Bật thông báo</button>}
      {installable && !installed && <button type="button" className="button secondary" onClick={install}><Download size={16} />Cài Nhắc tôi</button>}
    </div>
    <p className="account-help">{installed ? 'Bạn đang dùng ứng dụng web đã cài.' : 'Bạn cũng có thể dùng menu trình duyệt → Cài ứng dụng / Thêm vào Màn hình chính.'} Cần mạng để xem và cập nhật dữ liệu. Đăng xuất sẽ hủy đăng ký thông báo của phiên này; đăng nhập lại rồi bật nếu muốn tiếp tục nhận.</p>
  </section>;
}
