import React, { useState } from 'react';
import { recurrenceLabel } from '../shared/task-recurrence.mjs';

const weekdays = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
export default function RecurrenceFields({ task }) {
  const [frequency, setFrequency] = useState(task?.recurrence || 'none');
  const [interval, setInterval] = useState(task?.recurrenceOptions?.interval || 1);
  const [basis, setBasis] = useState(task?.recurrenceOptions?.basis || 'due');
  const [days, setDays] = useState(task?.recurrenceOptions?.weekdays || []);
  const options = frequency === 'none' ? {} : { interval: Number(interval), basis, weekdays: frequency === 'weekly' ? days : [] };
  let summary = '';
  try { summary = recurrenceLabel(frequency, options); } catch { /* Native input validity handles unfinished edits. */ }
  return <div className="recurrence-fields" style={{ gridColumn: '1 / -1' }}>
    <label className="field"><span>Lặp lại sau khi hoàn thành</span><select name="recurrence" value={frequency} onChange={e => setFrequency(e.target.value)}>
      <option value="none">Không lặp lại</option><option value="daily">Theo ngày</option><option value="weekly">Theo tuần</option><option value="monthly">Theo tháng</option><option value="yearly">Theo năm</option>
    </select></label>
    <input type="hidden" name="recurrenceOptions" value={JSON.stringify(options)} />
    {frequency !== 'none' && <>
      <div className="form-grid">
        <label className="field"><span>Mỗi bao nhiêu {({ daily: 'ngày', weekly: 'tuần', monthly: 'tháng', yearly: 'năm' })[frequency]}?</span><input type="number" min="1" max="365" step="1" required value={interval} onChange={e => setInterval(e.target.value)} /></label>
        <label className="field"><span>Tính kỳ tiếp theo từ</span><select value={basis} onChange={e => setBasis(e.target.value)}><option value="due">Hạn kỳ trước</option><option value="completion">Lúc hoàn thành</option></select></label>
      </div>
      {frequency === 'weekly' && <fieldset className="recurrence-weekdays"><legend>Các thứ trong tuần</legend><div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>{weekdays.map((label, i) => <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}><input type="checkbox" checked={days.includes(i + 1)} onChange={e => setDays(current => e.target.checked ? [...current, i + 1].sort((a, b) => a - b) : current.filter(day => day !== i + 1))} />{label}</label>)}</div><button type="button" className="button secondary" style={{ marginTop: 12 }} onClick={() => { setDays([1, 2, 3, 4, 5]); setInterval(1); }}>Thứ 2–Thứ 6</button><p className="hint">Không chọn thứ: lặp cùng thứ với mốc tính kỳ. Ngày làm việc ở đây chưa loại trừ ngày lễ.</p></fieldset>}
      <p className="hint">{summary}. Kỳ mới chỉ được tạo khi hoàn thành kỳ hiện tại. “Hạn kỳ trước” có thể tạo kỳ còn quá hạn nếu hoàn thành muộn.</p>
    </>}
  </div>;
}
