import React, { useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, LockKeyhole, Palette, RotateCcw, Save, ShieldCheck } from 'lucide-react';
import { APPEARANCE_FIELDS } from '../shared/appearance.mjs';
import './appearance.css';

// The route keys this component by team, so changing the scope remounts it and
// the select loses focus. The flag survives that remount and restores focus.
let restoreScopeFocus = false;

const LABELS = {
  mode: 'Chế độ sáng / tối', accent: 'Màu nhấn', background: 'Nền không gian', font: 'Phông chữ',
  fontSize: 'Cỡ chữ', density: 'Độ giãn giao diện', corners: 'Bo góc', sidebarWidth: 'Chiều rộng thanh bên',
  contentWidth: 'Chiều rộng nội dung', hiddenNav: 'Ẩn / hiện menu', navOrder: 'Thứ tự menu',
  contrast: 'Độ tương phản', motion: 'Chuyển động',
};
const OPTIONS = {
  mode: [['system', 'Theo thiết bị'], ['light', 'Sáng'], ['dark', 'Tối']],
  background: [['default', 'Trung tính'], ['warm', 'Ấm áp'], ['cool', 'Mát dịu']],
  font: [['vietnam', 'Be Vietnam Pro'], ['system', 'Phông hệ thống']],
  fontSize: [['small', 'Nhỏ'], ['medium', 'Vừa'], ['large', 'Lớn'], ['xlarge', 'Rất lớn']],
  density: [['comfortable', 'Thoáng'], ['compact', 'Gọn']],
  corners: [['rounded', 'Mềm mại'], ['square', 'Gần vuông']],
  sidebarWidth: [['narrow', 'Hẹp'], ['standard', 'Tiêu chuẩn'], ['wide', 'Rộng']],
  contentWidth: [['full', 'Toàn chiều rộng'], ['centered', 'Tập trung ở giữa']],
  contrast: [['standard', 'Tiêu chuẩn'], ['high', 'Cao']],
  motion: [['system', 'Theo thiết bị'], ['reduced', 'Giảm tối đa']],
};
const SWATCHES = ['#245bc0', '#176b59', '#7747b8', '#b54d2a', '#a63266', '#475569'];

export default function Appearance({ appearance: a, teams, teamId, go, navGroups }) {
  const scope = useRef(null);
  const page = useRef(null);
  const bar = useRef(null);
  useEffect(() => () => a.leave(), []);
  useEffect(() => {
    // Focus follows the scope select across the remount this component gets when
    // the route (and therefore `teamId`) changes.
    if (!restoreScopeFocus) return;
    restoreScopeFocus = false;
    scope.current?.focus();
  }, []);
  useEffect(() => {
    const node = bar.current, container = page.current;
    if (!container) return;
    if (!a.dirty || !node) { container.style.removeProperty('--appearance-save-bar-space'); return; }
    // Reserve exactly the floating bar's height so no control hides under it.
    const measure = () => container.style.setProperty('--appearance-save-bar-space', `${node.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => { observer.disconnect(); container.style.removeProperty('--appearance-save-bar-space'); };
  }, [a.dirty]);
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
    if (value !== teamId) restoreScopeFocus = true;
    go(`appearance${value ? `?team=${encodeURIComponent(value)}` : ''}`);
  }
  const ordered = items => [...items].sort((left, right) => a.preferences.navOrder.indexOf(left.id) - a.preferences.navOrder.indexOf(right.id));
  // The sidebar sorts inside each section, so moves stay within a group.
  function move(group, id, offset) {
    const next = [...a.preferences.navOrder];
    const visible = ordered(group.items).map(item => item.id);
    const targetId = visible[visible.indexOf(id) + offset];
    if (!targetId) return;
    const index = next.indexOf(id), target = next.indexOf(targetId);
    [next[index], next[target]] = [next[target], next[index]];
    a.change('navOrder', next);
  }
  return <section className={`appearance-page ${a.dirty ? 'is-dirty' : ''}`} ref={page}>
    <header className="page-heading"><div><span className="eyebrow">KHÔNG GIAN CỦA BẠN</span><h1>Cá nhân hóa giao diện</h1><p>Điều chỉnh không gian làm việc để bạn thấy thoải mái nhất.</p></div><Palette size={28} /></header>
    {a.ready && a.sync && <section className="settings-card appearance-platform">
      <h2>Phạm vi áp dụng</h2>
      <p>Áp dụng cho giao diện cá nhân trong mọi không gian. Giao diện chung của team áp dụng trên mọi nền tảng.</p>
      <fieldset className="appearance-platform-options" aria-disabled={!!a.syncDisabledReason} aria-describedby={a.syncDisabledReason ? 'appearance-sync-reason' : undefined}>
        <legend className="visually-hidden">Phạm vi giao diện cá nhân</legend>
        <label><input type="radio" name="appearance-platform" checked={!a.sync.web.separate} onChange={() => { if (!a.syncDisabledReason) a.setSeparate(false); }} />Đồng bộ web và điện thoại</label>
        <label><input type="radio" name="appearance-platform" checked={a.sync.web.separate} onChange={() => { if (!a.syncDisabledReason) a.setSeparate(true); }} />Chỉ cho web</label>
      </fieldset>
      <p id="appearance-sync-reason" role="status">{a.syncDisabledReason}</p>
      <p>Điện thoại: {a.sync.mobile.separate ? 'dùng giao diện riêng' : 'đang đồng bộ'}</p>
      {a.sync.web.separate ? <div className="appearance-policy-actions">
        <button type="button" className="button" aria-disabled={!!a.syncDisabledReason} title={a.syncDisabledReason || undefined} onClick={() => { if (a.syncDisabledReason) return; if (window.confirm('Ghi đè giao diện riêng của web trong mọi không gian bằng giao diện chung?')) a.copyFrom('all'); }}>Sao chép từ giao diện chung</button>
        {a.sync.mobile.separate && <button type="button" className="button" aria-disabled={!!a.syncDisabledReason} title={a.syncDisabledReason || undefined} onClick={() => { if (a.syncDisabledReason) return; if (window.confirm('Ghi đè giao diện riêng của web trong mọi không gian bằng giao diện điện thoại?')) a.copyFrom('mobile'); }}>Sao chép từ điện thoại</button>}
      </div> : <p>Chế độ sáng / tối, màu nhấn, nền, phông chữ, cỡ chữ, độ giãn và bo góc cũng áp dụng trên điện thoại khi điện thoại đang đồng bộ. Độ tương phản và chuyển động luôn áp dụng trên mọi thiết bị.</p>}
    </section>}
    <div className="settings-card appearance-scope">
      <label className="field"><span>Không gian áp dụng</span><select ref={scope} value={teamId || ''} onChange={e => switchScope(e.target.value)} disabled={a.busy}>
        <option value="">Không gian cá nhân</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}
      </select></label>
      <p>{teamId ? `Giao diện khi làm việc trong ${scopeName}. Quản trị team quyết định các tùy chọn thành viên được thay đổi.` : 'Bạn được tùy chỉnh toàn bộ giao diện cá nhân trong không gian hiện tại. Cấu hình được lưu theo tài khoản.'}</p>
    </div>
    {a.error ? <div className="settings-card appearance-message" role="alert"><p>{a.error}</p><button className="button" onClick={a.retry}>Thử lại</button></div> : !a.ready ? <p role="status">Đang tải giao diện…</p> : <>
      {(a.team?.canManage || a.teamAccessLost) && <div className="appearance-tabs" role="group" aria-label="Phạm vi chỉnh sửa">
        <button className={`button ${!a.editingTeam ? 'primary' : ''}`} disabled={a.busy} aria-pressed={!a.editingTeam} onClick={() => { if (!a.dirty || window.confirm('Bỏ các thay đổi chưa lưu?')) a.setEditingTeam(false); }}>Giao diện của tôi</button>
        <button className={`button ${a.editingTeam ? 'primary' : ''}`} disabled={a.busy || a.teamAccessLost} aria-pressed={a.editingTeam} onClick={() => { if (!a.dirty || window.confirm('Bỏ các thay đổi chưa lưu?')) a.setEditingTeam(true); }}><ShieldCheck size={16} /> Giao diện & quyền của team</button>
      </div>}
      <p className="appearance-message" role="status">{a.editingTeam ? 'Bạn đang xem trước giao diện chung. Lưu để áp dụng cho cả team.' : a.team ? 'Các mục có khóa do quản trị team quản lý. Thay đổi của bạn chỉ áp dụng cho tài khoản của bạn.' : 'Thay đổi được xem trước ngay. Bấm Lưu giao diện để giữ lại.'}</p>
      {a.dirty && <p className="appearance-message appearance-dirty-cue" role="status">Có thay đổi chưa lưu · thanh Lưu ở cuối trang</p>}
      {a.remoteChanged && <p className="appearance-message" role="status">Giao diện vừa được cập nhật từ thiết bị khác. Các thay đổi chưa lưu của bạn vẫn được giữ lại.</p>}
      {a.teamAccessLost && <p className="appearance-message" role="alert">Bạn không còn quyền chỉnh sửa giao diện chung của team. Bản nháp được giữ lại để bạn xem trước khi rời khỏi mục này.</p>}
      <fieldset disabled={a.busy || a.teamAccessLost} className="appearance-fieldset">
        <div className="appearance-grid">
          <section className="settings-card appearance-card"><h2>Màu sắc & hiển thị</h2>
            {['mode', 'background'].map(key => <Choice key={key} name={key} a={a} />)}
            <label className="field"><span>{LABELS.accent}{!allowed('accent') && <LockKeyhole size={14} aria-label="Do quản trị team quản lý" />}</span>
              <div className="appearance-colors"><input type="color" aria-label="Màu nhấn tùy chọn" value={a.preferences.accent} disabled={!allowed('accent')} onChange={e => a.change('accent', e.target.value)} /><code>{a.preferences.accent}</code></div>
            </label>
            <div className="appearance-swatches" role="group" aria-label="Màu nhấn có sẵn">{SWATCHES.map(color => <button key={color} type="button" style={{ background: color }} title={color} aria-label={`Màu ${color}`} aria-pressed={a.preferences.accent === color} disabled={!allowed('accent')} onClick={() => a.change('accent', color)} />)}</div>
          </section>
          <section className="settings-card appearance-card"><h2>Chữ & bố cục</h2>{['font', 'fontSize', 'density', 'corners', 'sidebarWidth', 'contentWidth'].map(key => <Choice key={key} name={key} a={a} />)}</section>
          <section className="settings-card appearance-card"><h2>Thanh điều hướng <span className="appearance-web-tag">Chỉ trên web</span></h2><p>Ẩn các mục ít dùng và sắp xếp theo cách bạn làm việc. Nút cá nhân hóa luôn có trên thanh trên cùng.</p>
            {navGroups.map(group => <div key={group.id} className="appearance-nav-group"><h3>{group.label || 'Chung'}</h3>
              <ul className="appearance-nav-list">{ordered(group.items).map(({ id, label }, index, visible) => <li key={id}>
                <label><input type="checkbox" checked={!a.preferences.hiddenNav.includes(id)} disabled={!allowed('hiddenNav')} onChange={e => a.change('hiddenNav', e.target.checked ? a.preferences.hiddenNav.filter(item => item !== id) : [...a.preferences.hiddenNav, id])} />{label}</label>
                <div><button type="button" className="icon-button" aria-label={`Đưa ${label} lên`} disabled={!allowed('navOrder') || index === 0} onClick={() => move(group, id, -1)}><ArrowUp size={16} /></button><button type="button" className="icon-button" aria-label={`Đưa ${label} xuống`} disabled={!allowed('navOrder') || index === visible.length - 1} onClick={() => move(group, id, 1)}><ArrowDown size={16} /></button></div>
              </li>)}</ul>
            </div>)}
          </section>
          <section className="settings-card appearance-card"><h2>Trợ năng</h2><p>Luôn áp dụng trên mọi thiết bị.</p>
            {teamId ? <>
              <p>Độ tương phản và chuyển động theo cài đặt ở Không gian cá nhân, áp dụng trên mọi trang.</p>
              <div><button type="button" className="button" onClick={() => switchScope('')}>Mở Không gian cá nhân</button></div>
            </> : <>
              <p>Áp dụng cho tài khoản của bạn trên mọi trang, kể cả trong các team.</p>
              {['contrast', 'motion'].map(key => <Choice key={key} name={key} a={a} />)}
            </>}
          </section>
          {a.editingTeam && <section className="settings-card appearance-card"><h2>Thành viên được tùy chỉnh</h2><p>Bỏ chọn để khóa mục đó theo giao diện chung. Các tùy chỉnh cá nhân đã lưu ở mục bị khóa sẽ không còn được áp dụng.</p>
            <div className="appearance-policy-actions"><button type="button" className="button" onClick={() => a.setPolicyFields([...APPEARANCE_FIELDS])}>Cho phép tất cả</button><button type="button" className="button" onClick={() => a.setPolicyFields([])}>Khóa tất cả</button></div>
            {APPEARANCE_FIELDS.map(key => <label key={key} className="appearance-permission"><input type="checkbox" checked={a.policyFields.includes(key)} onChange={e => a.setPolicyFields(e.target.checked ? [...a.policyFields, key] : a.policyFields.filter(field => field !== key))} />{LABELS[key]}</label>)}
          </section>}
        </div>
      </fieldset>
      <footer className={`appearance-actions ${a.dirty ? 'is-sticky' : ''}`} ref={bar}>
        <span aria-live="polite">{a.dirty ? 'Có thay đổi chưa lưu' : 'Đang dùng giao diện đã lưu'}</span>
        {!a.editingTeam && <button className="button" disabled={a.busy || (!a.hasOverride && !a.dirty)} onClick={a.reset}><RotateCcw size={16} />{a.team ? 'Dùng giao diện team' : 'Khôi phục mặc định'}</button>}
        <button className="button" disabled={a.busy || !a.dirty} onClick={a.cancel}>Hủy thay đổi</button>
        <button className="button primary" disabled={a.busy || !a.dirty || a.teamAccessLost} onClick={a.save}><Save size={16} />{a.busy ? 'Đang lưu…' : a.editingTeam ? 'Lưu cho cả team' : 'Lưu giao diện'}</button>
      </footer>
    </>}
  </section>;
}
function Choice({ name, a }) {
  const locked = !a.editableFields.includes(name);
  return <label className="field"><span>{LABELS[name]}{['sidebarWidth', 'contentWidth'].includes(name) && <span className="appearance-web-tag">Chỉ trên web</span>}{locked && <LockKeyhole size={14} aria-label="Do quản trị team quản lý" />}</span><select value={a.preferences[name]} disabled={locked} onChange={e => a.change(name, e.target.value)}>{OPTIONS[name].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>;
}
