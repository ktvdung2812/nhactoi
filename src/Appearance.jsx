import React, { useEffect } from 'react';
import { ArrowDown, ArrowUp, LockKeyhole, Palette, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { APPEARANCE_FIELDS } from '../shared/appearance.mjs';
import './appearance.css';

const LABELS = {
  mode: 'Chế độ sáng / tối', accent: 'Màu nhấn', background: 'Nền không gian', font: 'Phông chữ',
  fontSize: 'Cỡ chữ', density: 'Độ giãn giao diện', corners: 'Bo góc', sidebarWidth: 'Chiều rộng thanh bên',
  contentWidth: 'Chiều rộng nội dung', hiddenNav: 'Ẩn / hiện menu', navOrder: 'Thứ tự menu',
};
const NAV_LABELS = {
  dashboard: 'Tổng quan',
  tasks: 'Công việc',
  today: 'Hôm nay',
  upcoming: 'Sắp tới',
  week: 'Lịch tuần',
  inbox: 'Inbox',
  teams: 'Teams',
  customers: 'Khách hàng',
  services: 'Quản lý gia hạn',
  finance: 'Thu & chi',
  transfer: 'Nhập / xuất bảng',
  tickets: 'Hỗ trợ',
  trash: 'Thùng rác',
};
const OPTIONS = {
  mode: [['system', 'Theo thiết bị'], ['light', 'Sáng'], ['dark', 'Tối']],
  background: [['default', 'Trung tính'], ['warm', 'Ấm áp'], ['cool', 'Mát dịu']],
  font: [['vietnam', 'Be Vietnam Pro'], ['system', 'Phông hệ thống']],
  fontSize: [['small', 'Nhỏ'], ['medium', 'Vừa'], ['large', 'Lớn']],
  density: [['comfortable', 'Thoáng'], ['compact', 'Gọn']],
  corners: [['rounded', 'Mềm mại'], ['square', 'Vuông']],
  sidebarWidth: [['narrow', 'Hẹp'], ['standard', 'Tiêu chuẩn'], ['wide', 'Rộng']],
  contentWidth: [['full', 'Toàn chiều rộng'], ['centered', 'Tập trung ở giữa']],
};
const SWATCHES = ['#176b59', '#245bc0', '#7747b8', '#b54d2a', '#a63266', '#475569'];

export default function Appearance({ appearance: a, teams, teamId, go, canManage }) {
  useEffect(() => () => a.leave(), []);
  useEffect(() => {
    if (!a.dirty) return;
    const warn = event => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [a.dirty]);
  const allowed = key => a.editableFields.includes(key);
  const scopeName = teams.find(team => team.id === teamId)?.name || 'Team';
  function switchScope(value) {
    if (a.dirty && !window.confirm('Bỏ các thay đổi giao diện chưa lưu?')) return;
    go(`appearance${value ? `?team=${encodeURIComponent(value)}` : ''}`);
  }
  function move(id, offset) {
    const next = [...a.preferences.navOrder];
    const visible = next.filter(item => item !== 'finance' || canManage);
    const targetId = visible[visible.indexOf(id) + offset];
    if (!targetId) return;
    const index = next.indexOf(id), target = next.indexOf(targetId);
    [next[index], next[target]] = [next[target], next[index]];
    a.change('navOrder', next);
  }
  return <section className="appearance-page">
    <header className="page-heading"><div><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Cá nhân hóa giao diện</h1><p>Điều chỉnh không gian làm việc để bạn thấy thoải mái nhất.</p></div><Palette size={28} /></header>
    <div className="settings-card appearance-scope">
      <label className="field"><span>Không gian áp dụng</span><select value={teamId || ''} onChange={e => switchScope(e.target.value)} disabled={a.busy}>
        <option value="">Không gian cá nhân</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label>
      <p>{teamId ? `Giao diện khi làm việc trong ${scopeName}. Quản trị team quyết định các tùy chọn thành viên được thay đổi.` : 'Bạn được tùy chỉnh toàn bộ giao diện cá nhân trong không gian hiện tại. Cấu hình được lưu theo tài khoản và đồng bộ khi đăng nhập trên thiết bị khác.'}</p>
    </div>
    {a.error ? <div className="settings-card appearance-message" role="alert"><p>{a.error}</p><button className="button" onClick={a.retry}>Thử lại</button></div> : !a.ready ? <p role="status">Đang tải giao diện…</p> : <>
      {a.team?.canManage && <div className="appearance-tabs" role="group" aria-label="Phạm vi chỉnh sửa">
        <button className={`button ${!a.editingTeam ? 'primary' : ''}`} disabled={a.busy} aria-pressed={!a.editingTeam} onClick={() => { if (!a.dirty || window.confirm('Bỏ các thay đổi chưa lưu?')) a.setEditingTeam(false); }}>Giao diện của tôi</button>
        <button className={`button ${a.editingTeam ? 'primary' : ''}`} disabled={a.busy} aria-pressed={a.editingTeam} onClick={() => { if (!a.dirty || window.confirm('Bỏ các thay đổi chưa lưu?')) a.setEditingTeam(true); }}><ShieldCheck size={16} /> Giao diện & quyền của team</button>
      </div>}
      <p className="appearance-message" role="status">{a.editingTeam ? 'Bạn đang xem trước giao diện chung. Lưu để áp dụng cho cả team.' : a.team ? 'Các mục có khóa do quản trị team quản lý. Thay đổi của bạn chỉ áp dụng cho tài khoản của bạn.' : 'Thay đổi được xem trước ngay. Bấm Lưu giao diện để giữ lại.'}</p>
      <fieldset disabled={a.busy} className="appearance-fieldset">
        <div className="appearance-grid">
          <section className="settings-card appearance-card"><h2>Màu sắc & hiển thị</h2>
            {['mode', 'background'].map(key => <Choice key={key} name={key} a={a} />)}
            <label className="field"><span>{LABELS.accent}{!allowed('accent') && <LockKeyhole size={14} aria-label="Do quản trị team quản lý" />}</span>
              <div className="appearance-colors"><input type="color" aria-label="Màu nhấn tùy chọn" value={a.preferences.accent} disabled={!allowed('accent')} onChange={e => a.change('accent', e.target.value)} /><code>{a.preferences.accent}</code></div>
            </label>
            <div className="appearance-swatches" role="group" aria-label="Màu nhấn có sẵn">{SWATCHES.map(color => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Màu ${color}`} aria-pressed={a.preferences.accent === color} disabled={!allowed('accent')} onClick={() => a.change('accent', color)} />)}</div>
          </section>
          <section className="settings-card appearance-card"><h2>Chữ & bố cục</h2>{['font', 'fontSize', 'density', 'corners', 'sidebarWidth', 'contentWidth'].map(key => <Choice key={key} name={key} a={a} />)}</section>
          <section className="settings-card appearance-card"><h2>Thanh điều hướng</h2><p>Ẩn các mục ít dùng và sắp xếp theo cách bạn làm việc. Nút cá nhân hóa luôn có trên thanh trên cùng.</p>
            <ul className="appearance-nav-list">{a.preferences.navOrder.filter(id => id !== 'finance' || canManage).map((id, index, visible) => <li key={id}>
              <label><input type="checkbox" checked={!a.preferences.hiddenNav.includes(id)} disabled={!allowed('hiddenNav')} onChange={e => a.change('hiddenNav', e.target.checked ? a.preferences.hiddenNav.filter(item => item !== id) : [...a.preferences.hiddenNav, id])} />{NAV_LABELS[id]}</label>
              <div><button type="button" className="icon-button" aria-label={`Đưa ${NAV_LABELS[id]} lên`} disabled={!allowed('navOrder') || index === 0} onClick={() => move(id, -1)}><ArrowUp size={16} /></button><button type="button" className="icon-button" aria-label={`Đưa ${NAV_LABELS[id]} xuống`} disabled={!allowed('navOrder') || index === visible.length - 1} onClick={() => move(id, 1)}><ArrowDown size={16} /></button></div>
            </li>)}</ul>
          </section>
          {a.editingTeam && <section className="settings-card appearance-card"><h2>Thành viên được tùy chỉnh</h2><p>Bỏ chọn để khóa mục đó theo giao diện chung. Các tùy chỉnh cá nhân đã lưu ở mục bị khóa sẽ không còn được áp dụng.</p>
            <div className="appearance-policy-actions"><button type="button" className="button" onClick={() => a.setPolicyFields([...APPEARANCE_FIELDS])}>Cho phép tất cả</button><button type="button" className="button" onClick={() => a.setPolicyFields([])}>Khóa tất cả</button></div>
            {APPEARANCE_FIELDS.map(key => <label key={key} className="appearance-permission"><input type="checkbox" checked={a.policyFields.includes(key)} onChange={e => a.setPolicyFields(e.target.checked ? [...a.policyFields, key] : a.policyFields.filter(field => field !== key))} />{LABELS[key]}</label>)}
          </section>}
        </div>
      </fieldset>
      <footer className="appearance-actions">
        <span aria-live="polite">{a.dirty ? 'Có thay đổi chưa lưu' : 'Đang dùng giao diện đã lưu'}</span>
        {!a.editingTeam && <button className="button" disabled={a.busy || (!a.hasOverride && !a.dirty)} onClick={a.reset}><RotateCcw size={16} />{a.team ? 'Dùng giao diện team' : 'Khôi phục mặc định'}</button>}
        <button className="button" disabled={a.busy || !a.dirty} onClick={a.cancel}>Hủy thay đổi</button>
        <button className="button primary" disabled={a.busy || !a.dirty} onClick={a.save}><Save size={16} />{a.busy ? 'Đang lưu…' : a.editingTeam ? 'Lưu cho cả team' : 'Lưu giao diện'}</button>
      </footer>
    </>}\n  </section>;
}
function Choice({ name, a }) {
  const locked = !a.editableFields.includes(name);
  return <label className="field"><span>{LABELS[name]}{locked && <LockKeyhole size={14} aria-label="Do quản trị team quản lý" />}</span><select value={a.preferences[name]} disabled={locked} onChange={e => a.change(name, e.target.value)}>{OPTIONS[name].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}
