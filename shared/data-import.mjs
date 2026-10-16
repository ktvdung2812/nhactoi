export const IMPORT_DEFAULT_LIMITS = Object.freeze({ maxBytes: 512 * 1024, maxRows: 500, maxLists: 40, maxColumns: 100 });

// RFC 4180 fields, with explicitly selected comma/semicolon/tab delimiters.
// Row numbers refer to physical file lines, including newlines inside quotes.
export function parseCsv(source, { delimiter = ',', maxRows = 500, maxColumns = 100 } = {}) {
  if (typeof source !== 'string' || ![',',';','\t'].includes(delimiter)) throw new Error('Dữ liệu hoặc dấu phân cách CSV không hợp lệ');
  source = source.replace(/^\uFEFF/, '');
  const rows = []; let row = [], value = '', quoted = false, closed = false, line = 1, startLine = 1;
  const error = message => { const e = new Error(message); e.row = line; e.column = row.length + 1; throw e; };
  const cell = () => { row.push(value); value = ''; closed = false; if (row.length > maxColumns) error(`Tối đa ${maxColumns} cột`); };
  const finish = () => { cell(); rows.push({ line: startLine, cells: row }); row = []; startLine = line + 1; if (rows.length > maxRows + 1) error(`Tối đa ${maxRows} dòng dữ liệu`); };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"') { if (source[i+1] === '"') { value += '"'; i++; } else { quoted = false; closed = true; } }
      else { value += c; if (c === '\n' || c === '\r' && source[i+1] !== '\n') line++; }
    } else if (c === delimiter) cell();
    else if (c === '\r' || c === '\n') { finish(); if (c === '\r' && source[i+1] === '\n') i++; line++; }
    else if (c === '"') { if (value || closed) error('Dấu quote CSV không hợp lệ'); quoted = true; }
    else { if (closed) error('Ký tự sau quote đóng không hợp lệ'); value += c; }
  }
  if (quoted) error('Ô CSV thiếu quote đóng');
  if (value || row.length || closed) finish();
  if (!rows.length) error('CSV cần có header');
  const headers = rows.shift().cells.map(value => value.trim());
  if (headers.some(value => !value) || new Set(headers.map(h => h.toLocaleLowerCase('vi'))).size !== headers.length) {
    line = 1; error('Header CSV rỗng hoặc trùng');
  }
  return { headers, rows };
}

export function importDate(value, format = 'iso') {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') throw new Error('Ngày phải là chuỗi');
  let text = value.trim();
  if (format === 'dmy' || format === 'mdy') {
    const match = /^(\d{2})\/(\d{2})\/(\d{4})(.*)$/.exec(text);
    if (match) text = `${match[3]}-${format === 'dmy' ? match[2] : match[1]}-${format === 'dmy' ? match[1] : match[2]}${match[4]}`;
  }
  const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/.exec(text);
  if (!match) throw new Error('Cần chọn định dạng và ghi đủ ngày, giờ, timezone (ví dụ 2028-02-29T09:00+07:00); không tự chọn giờ cho ngày');
  const date = new Date(match[1]);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== match[1] || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] || 0) > 59 || !Number.isFinite(Date.parse(text))) throw new Error('Ngày hoặc giờ không tồn tại');
  return new Date(text).toISOString();
}

export function csvCell(value) {
  const text = String(value ?? '');
  return '"' + (/^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text).replaceAll('"', '""') + '"';
}
export const encodeCsv = rows => '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
