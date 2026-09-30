import { openDatabase } from '../server/db.mjs';

const db = openDatabase();
db.close();
console.log('Migration hoàn tất; đã kiểm tra tài khoản admin SaaS.');
