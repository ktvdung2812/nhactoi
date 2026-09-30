import {createId} from './auth.mjs';
import {canAccessTeamTask} from './teams.mjs';
import {licenseTypes,invoiceTypes,serviceStatus,vietnamDate,isValidCalendarDate,nextFutureServiceDate} from '../shared/service-renewal.mjs';
const iso = clock => new Date(clock()).toISOString();
export { nextServiceDate } from '../shared/service-renewal.mjs';

function serviceJson(r, today, canEdit = true) {
  return {
    id:r.id, name:r.name, provider:r.provider, contractNumber:r.contract_number,
    amount:r.amount, nextDate:r.next_date, cycle:r.cycle, intervalCount:r.interval_count,
    remindDays:r.remind_days, teamId:r.team_id, customerId:r.customer_id, assigneeId:r.assignee_id,
    note:r.note, archivedAt:r.archived_at, customerName:r.customer_name, assigneeName:r.assignee_name,
    licenseType:r.license_type, quantity:r.quantity, unitPrice:r.unit_price, actualPaid:r.actual_paid,
    purchaseDate:r.purchase_date, accountHint:r.account_hint||'', paymentAccount:r.payment_account||'',
    paymentMethod:r.payment_method||'', portalUrl:r.portal_url||'', providerContact:r.provider_contact||'',
    invoiceType:r.invoice_type, enabled:Boolean(r.enabled), syncCalendar:Boolean(r.sync_calendar),
    lastRenewedAt:r.last_renewed_at, status:serviceStatus(r,today), canEdit,
  };
}

export function processServiceReminders({db,clock=()=>new Date(),sendEmail}) {
  const at=iso(clock), today=vietnamDate(new Date(at)); let sent=0;
  const services=db.prepare(`SELECT s.* FROM service_contracts s JOIN workspaces w ON w.id=s.workspace_id
    JOIN subscriptions b ON b.workspace_id=w.id WHERE s.archived_at IS NULL AND s.enabled=1
    AND w.suspended_at IS NULL AND b.status NOT IN ('canceled','expired') AND b.current_period_end>?`).all(at);
  for(const service of services) {
    const status=serviceStatus(service,today);
    if(!['due_soon','expired'].includes(status)) continue;
    const recipients=service.assignee_id?[service.assignee_id]:db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=? AND role IN ('owner','admin')").all(service.workspace_id).map(r=>r.user_id);
    for(const userId of recipients) {
      if(!canAccessTeamTask(db,service.workspace_id,userId,service.team_id,{write:true})) continue;
      const recipient=db.prepare('SELECT id,name,email FROM users WHERE id=? AND disabled_at IS NULL').get(userId);
      if(!recipient) continue;
      const key=`${service.next_date}/${today}`;
      const message=`${status==='expired'?'Đã quá hạn':'Sắp đến hạn'} gia hạn ${service.name} ngày ${service.next_date}.`;
      let inserted=false;
      db.exec('BEGIN');
      try {
        const claim=db.prepare('INSERT INTO service_reminders(service_id,user_id,schedule_key) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(service.id,userId,key);
        if(claim.changes) {
          db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,service_id,type,title,message,entity_type,entity_id,created_at)
            VALUES (?,?,?,?,'service_renewal',?,?,'service',?,?)`).run(createId('notice_'),service.workspace_id,userId,service.id,service.name,message,service.id,at);
          inserted=true;
        }
        db.exec('COMMIT');
      } catch(error) {db.exec('ROLLBACK');throw error;}
      if(inserted) {
        sent++;
        if(sendEmail) Promise.resolve().then(()=>sendEmail({recipient,service:serviceJson(service,today),message})).catch(error=>console.error('[nhactoi] service reminder email failed:',error?.message||error));
      }
    }
  }
  return sent;
}

export function registerServiceRoutes(app,{db,clock,requireAuth,ensureWritable,withTransaction,HttpError}) {
  function fail(message,status=400){throw new HttpError(status,message);}
  function text(value,max=1000){if(typeof value!=='string'||value.trim().length>max)fail('Thông tin dịch vụ không hợp lệ');return value.trim();}
  function date(value){if(typeof value!=='string'||!isValidCalendarDate(value))fail('Ngày không hợp lệ');return value;}
  function keys(body,allowed){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))fail('Trường dữ liệu không được hỗ trợ');}
  function money(value){if(!Number.isSafeInteger(value)||value<0)fail('Chi phí không hợp lệ');return value;}
  function can(req,teamId,write=false){return canAccessTeamTask(db,req.auth.workspaceId,req.auth.userId,teamId,{write});}
  const today=()=>vietnamDate(new Date(clock()));
  function json(req,r){return serviceJson(r,today(),can(req,r.team_id,true));}
  function row(req,write=false,id=req.params.id){
    if(write)ensureWritable(req);
    const r=db.prepare('SELECT * FROM service_contracts WHERE id=? AND workspace_id=?').get(id,req.auth.workspaceId);
    if(!r||!can(req,r.team_id))fail('Không tìm thấy dịch vụ',404);
    if(write&&!can(req,r.team_id,true))fail('Team đã lưu trữ, chỉ được xem',409);
    return r;
  }
  const defaults={name:'',provider:'',contractNumber:'',amount:0,nextDate:'',cycle:'year',intervalCount:1,remindDays:14,teamId:null,customerId:null,assigneeId:null,note:'',licenseType:'subscription',quantity:1,unitPrice:0,actualPaid:null,purchaseDate:null,accountHint:'',paymentAccount:'',paymentMethod:'',portalUrl:'',providerContact:'',invoiceType:null,enabled:true,syncCalendar:true};
  const columns={teamId:'team_id',customerId:'customer_id',name:'name',provider:'provider',contractNumber:'contract_number',amount:'amount',nextDate:'next_date',cycle:'cycle',intervalCount:'interval_count',remindDays:'remind_days',assigneeId:'assignee_id',note:'note',licenseType:'license_type',quantity:'quantity',unitPrice:'unit_price',actualPaid:'actual_paid',purchaseDate:'purchase_date',accountHint:'account_hint',paymentAccount:'payment_account',paymentMethod:'payment_method',portalUrl:'portal_url',providerContact:'provider_contact',invoiceType:'invoice_type',enabled:'enabled',syncCalendar:'sync_calendar'};
  function values(req,existing,body=req.body||{}) {
    keys(body,Object.keys(defaults));
    const v={...defaults,...(existing?serviceJson(existing,today()):{}),...body};
    for(const [key,max] of Object.entries({name:200,provider:200,contractNumber:120,note:5000,accountHint:320,paymentAccount:500,paymentMethod:120,portalUrl:2000,providerContact:320}))v[key]=text(v[key],max);
    if(!v.name)fail('Tên dịch vụ không được để trống');
    date(v.nextDate);
    if(v.purchaseDate!==null){date(v.purchaseDate);if(v.purchaseDate>v.nextDate)fail('Ngày mua không được sau ngày gia hạn');}
    if(!licenseTypes.includes(v.licenseType)||v.invoiceType!==null&&!invoiceTypes.includes(v.invoiceType))fail('Loại giấy phép hoặc chứng từ không hợp lệ');
    if(!['month','year'].includes(v.cycle)||!Number.isInteger(v.intervalCount)||v.intervalCount<1||v.intervalCount>24||!Number.isInteger(v.remindDays)||v.remindDays<0||v.remindDays>90)fail('Chu kỳ hoặc số ngày nhắc không hợp lệ');
    if(!Number.isInteger(v.quantity)||v.quantity<1||v.quantity>1000000)fail('Số lượng không hợp lệ');
    // A caller using the original amount-only API keeps its original semantics.
    if(Object.hasOwn(body,'amount')&&!Object.hasOwn(body,'unitPrice')&&!Object.hasOwn(body,'quantity')){v.quantity=1;v.unitPrice=money(body.amount);}
    if(v.unitPrice===null)v.unitPrice=existing?.amount??0;
    money(v.unitPrice);v.amount=money(v.quantity*v.unitPrice);
    if(Object.hasOwn(body,'amount'))money(body.amount);
    if(v.actualPaid!==null)money(v.actualPaid);
    if(typeof v.enabled!=='boolean'||typeof v.syncCalendar!=='boolean')fail('Trạng thái nhắc hoặc lịch không hợp lệ');
    if(v.portalUrl){try{if(!['https:','http:'].includes(new URL(v.portalUrl).protocol))fail('Cổng quản lý phải dùng HTTP hoặc HTTPS');}catch{fail('Cổng quản lý phải dùng HTTP hoặc HTTPS');}}
    for(const key of ['teamId','customerId','assigneeId'])if(v[key]!==null&&(typeof v[key]!=='string'||!v[key]))fail('Phạm vi dịch vụ không hợp lệ');
    if(!can(req,v.teamId,true))fail('Không có quyền với team đã chọn',403);
    if(v.customerId&&!db.prepare('SELECT 1 FROM customers WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(v.customerId,req.auth.workspaceId))fail('Khách hàng không hợp lệ');
    if(v.assigneeId&&(!canAccessTeamTask(db,req.auth.workspaceId,v.assigneeId,v.teamId)||!db.prepare('SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL').get(v.assigneeId)))fail('Người phụ trách không thuộc phạm vi dịch vụ');
    return v;
  }
  const sqlValues=v=>Object.keys(columns).map(key=>typeof v[key]==='boolean'?Number(v[key]):v[key]);
  function insert(req,v){
    const id=createId('service_'),at=iso(clock);
    db.prepare(`INSERT INTO service_contracts(id,workspace_id,${Object.values(columns).join(',')},created_by,created_at,updated_at) VALUES (${Array(Object.keys(columns).length+5).fill('?').join(',')})`).run(id,req.auth.workspaceId,...sqlValues(v),req.auth.userId,at,at);
    return json(req,row(req,false,id));
  }
  function renew(req,old,b){
    keys(b,['expectedDate','nextDate','amount','note']);
    if(old.archived_at)fail('Dịch vụ đã lưu trữ',409);
    if(b.expectedDate!==old.next_date)fail('Ngày gia hạn đã thay đổi. Hãy làm mới trước khi ghi nhận',409);
    const nextDate=b.nextDate?date(b.nextDate):nextFutureServiceDate(old.next_date,old.cycle,old.interval_count,today());
    if(!nextDate||nextDate<=old.next_date||nextDate<=today())fail('Ngày gia hạn mới phải sau kỳ hiện tại và hôm nay');
    const amount=money(b.amount??old.amount),note=text(b.note??'',1000),at=iso(clock);
    db.prepare('INSERT INTO service_renewals(id,service_id,previous_date,next_date,amount,note,actor_id,created_at) VALUES (?,?,?,?,?,?,?,?)').run(createId('renewal_'),old.id,old.next_date,nextDate,amount,note,req.auth.userId,at);
    db.prepare('UPDATE service_contracts SET next_date=?,actual_paid=?,last_renewed_at=?,enabled=1,updated_at=? WHERE id=? AND workspace_id=?').run(nextDate,amount,at,at,old.id,req.auth.workspaceId);
    return nextDate;
  }
  const route=fn=>(req,res,next)=>{try{fn(req,res);}catch(error){next(error);}};
  app.get('/api/services',requireAuth,route((req,res)=>{
    const rows=db.prepare('SELECT s.*,c.name customer_name,u.name assignee_name FROM service_contracts s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.assignee_id WHERE s.workspace_id=? ORDER BY s.next_date,s.name').all(req.auth.workspaceId).filter(r=>can(req,r.team_id));
    res.json({services:rows.map(r=>json(req,r))});
  }));
  app.post('/api/services',requireAuth,route((req,res)=>{ensureWritable(req);const v=values(req);const service=withTransaction(db,()=>insert(req,v));res.status(201).json({service});}));
  app.patch('/api/services/:id',requireAuth,route((req,res)=>{const old=row(req,true);if(old.archived_at)fail('Khôi phục dịch vụ trước khi chỉnh sửa',409);const v=values(req,old);db.prepare(`UPDATE service_contracts SET ${Object.values(columns).map(c=>c+'=?').join(',')},updated_at=? WHERE id=? AND workspace_id=?`).run(...sqlValues(v),iso(clock),old.id,req.auth.workspaceId);res.json({ok:true,service:json(req,row(req))});}));
  app.get('/api/services/:id',requireAuth,route((req,res)=>{res.json({service:json(req,row(req))});}));
  app.get('/api/services/:id/history',requireAuth,route((req,res)=>{row(req);res.json({history:db.prepare('SELECT r.*,u.name actor_name FROM service_renewals r LEFT JOIN users u ON u.id=r.actor_id WHERE r.service_id=? ORDER BY r.created_at DESC,r.id DESC').all(req.params.id)});}));
  app.post('/api/services/:id/renew',requireAuth,route((req,res)=>{ensureWritable(req);const nextDate=withTransaction(db,()=>renew(req,row(req,true),req.body||{}));res.json({ok:true,nextDate});}));
  app.put('/api/services/:id/archive',requireAuth,route((req,res)=>{const old=row(req,true);keys(req.body,['archived']);if(typeof req.body.archived!=='boolean')fail('Trạng thái lưu trữ không hợp lệ');if(!req.body.archived)values(req,old,{});db.prepare('UPDATE service_contracts SET archived_at=?,updated_at=? WHERE id=? AND workspace_id=?').run(req.body.archived?iso(clock):null,iso(clock),old.id,req.auth.workspaceId);res.json({ok:true});}));
  app.post('/api/services/:id/duplicate',requireAuth,route((req,res)=>{const old=row(req,true);if(old.archived_at)fail('Khôi phục dịch vụ trước khi sao chép',409);keys(req.body||{},[]);const copy=Object.fromEntries(Object.keys(defaults).map(k=>[k,serviceJson(old,today())[k]]));copy.name=`${old.name.slice(0,190)} (bản sao)`;copy.actualPaid=null;const v=values(req,null,copy);res.status(201).json({service:withTransaction(db,()=>insert(req,v))});}));
  app.post('/api/services/bulk',requireAuth,route((req,res)=>{
    ensureWritable(req);const b=req.body;keys(b,['action','items']);
    if(!['renew','archive','restore'].includes(b.action)||!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail('Chọn từ 1 đến 100 dịch vụ và thao tác hợp lệ');
    const seen=new Set();for(const item of b.items){keys(item,['id','expectedDate']);if(typeof item.id!=='string'||!item.id||seen.has(item.id))fail('Danh sách dịch vụ không hợp lệ hoặc bị trùng');seen.add(item.id);}
    withTransaction(db,()=>{for(const item of b.items){const old=row(req,true,item.id);if(b.action==='renew')renew(req,old,{expectedDate:item.expectedDate});else {if(b.action==='restore')values(req,old,{});db.prepare('UPDATE service_contracts SET archived_at=?,updated_at=? WHERE id=? AND workspace_id=?').run(b.action==='archive'?iso(clock):null,iso(clock),old.id,req.auth.workspaceId);}}});
    res.json({ok:true,count:b.items.length});
  }));
  app.delete('/api/services/:id',requireAuth,route((req,res)=>{withTransaction(db,()=>{const old=row(req,true);keys(req.body,['confirmName']);if(!old.archived_at)fail('Lưu trữ dịch vụ trước khi xóa vĩnh viễn',409);if(req.body.confirmName!==old.name)fail('Nhập đúng tên dịch vụ để xác nhận');db.prepare('DELETE FROM notifications WHERE service_id=? AND workspace_id=?').run(old.id,req.auth.workspaceId);db.prepare('DELETE FROM service_contracts WHERE id=? AND workspace_id=?').run(old.id,req.auth.workspaceId);});res.json({ok:true});}));
 function customer(req){const r=db.prepare('SELECT id FROM customers WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(req.params.customerId,req.auth.workspaceId);if(!r)fail('Không tìm thấy khách hàng',404);return r}
 app.get('/api/customers/:customerId/interactions',requireAuth,(req,res,next)=>{try{customer(req);res.json({interactions:db.prepare('SELECT i.*,u.name actor_name FROM customer_interactions i LEFT JOIN users u ON u.id=i.created_by WHERE i.customer_id=? AND i.workspace_id=? ORDER BY happened_at DESC').all(req.params.customerId,req.auth.workspaceId)})}catch(e){next(e)}});
 app.post('/api/customers/:customerId/interactions',requireAuth,(req,res,next)=>{try{ensureWritable(req);customer(req);const b=req.body||{};if(!['call','email','meeting','message','other'].includes(b.type))fail('Loại tương tác không hợp lệ');const note=text(b.note,5000);if(!note)fail('Cần nhập nội dung tương tác');const at=b.happenedAt?new Date(b.happenedAt):new Date(clock());if(!Number.isFinite(at.getTime()))fail('Thời gian không hợp lệ');db.prepare('INSERT INTO customer_interactions(id,customer_id,workspace_id,type,note,happened_at,created_by) VALUES (?,?,?,?,?,?,?)').run(createId('interaction_'),req.params.customerId,req.auth.workspaceId,b.type,note,at.toISOString(),req.auth.userId);res.status(201).json({ok:true})}catch(e){next(e)}});
}
