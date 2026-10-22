import {createId} from './auth.mjs';
import {recordRevision,assertRevision} from './record-revision.mjs';
import {canAccessTeamTask} from './teams.mjs';
import {canAccessTask} from './task-access.mjs';
import {resolveTaskProject} from './projects.mjs';
import {resolveTaskColumn} from './boards.mjs';
import {recordTaskActivity} from './task-details.mjs';
import {mutationFingerprint,withMutationContext} from './task-mutation-pipeline.mjs';
import {licenseTypes,invoiceTypes,serviceStatus,vietnamDate,isValidCalendarDate,nextFutureServiceDate,serviceReminderSchedule} from '../shared/service-renewal.mjs';
const iso = clock => new Date(clock()).toISOString();
export { nextServiceDate } from '../shared/service-renewal.mjs';

function serviceJson(r, today, canEdit = true) {
  return {
    id:r.id, revision:recordRevision(r,'service'), name:r.name, provider:r.provider, contractNumber:r.contract_number,
    amount:r.amount, nextDate:r.next_date, cycle:r.cycle, intervalCount:r.interval_count,
    remindDays:r.remind_days, teamId:r.team_id, customerId:r.customer_id, assigneeId:r.assignee_id,
    note:r.note, archivedAt:r.archived_at, customerName:r.customer_name, assigneeName:r.assignee_name,
    licenseType:r.license_type, quantity:r.quantity, unitPrice:r.unit_price, actualPaid:r.actual_paid,
    purchaseDate:r.purchase_date, accountHint:r.account_hint||'', paymentAccount:r.payment_account||'',
    paymentMethod:r.payment_method||'', portalUrl:r.portal_url||'', providerContact:r.provider_contact||'',
    invoiceType:r.invoice_type, enabled:Boolean(r.enabled), syncCalendar:Boolean(r.sync_calendar),
    lastRenewedAt:r.last_renewed_at, status:serviceStatus(r,today), canEdit,
    reminderTime:r.reminder_time??null, reminderMode:r.reminder_mode||'daily', renewalAnchor:r.renewal_anchor||r.next_date,
  };
}

export function processServiceReminders({db,clock=()=>new Date(),sendEmail}) {
  const at=iso(clock), today=vietnamDate(new Date(at)); let sent=0;
  const services=db.prepare(`SELECT s.* FROM service_contracts s JOIN workspaces w ON w.id=s.workspace_id
    JOIN subscriptions b ON b.workspace_id=w.id WHERE s.archived_at IS NULL AND s.enabled=1
    AND w.suspended_at IS NULL AND b.status NOT IN ('canceled','expired') AND b.current_period_end>?`).all(at);
  for(const service of services) {
    const status=serviceStatus(service,today), schedule=serviceReminderSchedule(service,new Date(at));
    if(!schedule) continue;
    if(db.dialect==='postgres'&&db.prepare(`SELECT 1 FROM service_cycle_tasks c JOIN tasks t ON t.id=c.task_id
      WHERE c.service_id=? AND c.period_date=? AND t.status='done' AND t.deleted_at IS NULL`).get(service.id,service.next_date)) continue;
    const recipients=service.assignee_id?[service.assignee_id]:db.prepare("SELECT user_id FROM workspace_members WHERE workspace_id=? AND role IN ('owner','admin')").all(service.workspace_id).map(r=>r.user_id);
    for(const userId of recipients) {
      if(db.dialect==='postgres'&&!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND member_type='member'").get(service.workspace_id,userId))continue;
      if(!canAccessTeamTask(db,service.workspace_id,userId,service.team_id,{write:true})) continue;
      const recipient=db.prepare('SELECT id,name,email FROM users WHERE id=? AND disabled_at IS NULL').get(userId);
      if(!recipient) continue;
      const key=schedule.key;
      const message=`${schedule.scheduledDate<today?`Nhắc bù mốc ${schedule.scheduledDate}: `:''}${status==='expired'?'Đã quá hạn':'Sắp đến hạn'} gia hạn ${service.name} ngày ${service.next_date}.`;
      let inserted=false;
      db.exec('BEGIN');
      try {
        const current=db.prepare(`SELECT * FROM service_contracts WHERE id=? AND workspace_id=?${db.dialect==='postgres'?' FOR SHARE':''}`).get(service.id,service.workspace_id);
        if(!current||serviceReminderSchedule(current,new Date(at))?.key!==key||current.assignee_id!==service.assignee_id||current.team_id!==service.team_id){db.exec('COMMIT');continue;}
        const claim=db.prepare('INSERT INTO service_reminders(service_id,user_id,schedule_key) VALUES (?,?,?) ON CONFLICT DO NOTHING').run(service.id,userId,key);
        if(claim.changes) {
          const notificationId=createId('notice_');
          db.prepare(`INSERT INTO notifications(id,workspace_id,user_id,service_id,type,title,message,entity_type,entity_id,created_at)
            VALUES (?,?,?,?,'service_renewal',?,?,'service',?,?)`).run(notificationId,service.workspace_id,userId,service.id,service.name,message,service.id,at);
          if(db.dialect==='postgres')db.prepare('UPDATE reminder_notice_context SET schedule_key=? WHERE notification_id=?').run(`service:${mutationFingerprint([current.reminder_time,current.reminder_mode,current.remind_days,current.assignee_id,current.team_id])}:${key}`,notificationId);
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
    if(db.dialect==='postgres'&&!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND member_type='member'").get(req.auth.workspaceId,req.auth.userId))fail('Không có quyền với dịch vụ',403);
    const r=db.prepare(`SELECT * FROM service_contracts WHERE id=? AND workspace_id=?${write&&db.dialect==='postgres'?' FOR UPDATE':''}`).get(id,req.auth.workspaceId);
    if(!r||!can(req,r.team_id))fail('Không tìm thấy dịch vụ',404);
    if(write&&!can(req,r.team_id,true))fail('Team đã lưu trữ, chỉ được xem',409);
    return r;
  }
  const canFinance=req=>!!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND role IN ('owner','admin')").get(req.auth.workspaceId,req.auth.userId);
  const defaults={name:'',provider:'',contractNumber:'',amount:0,nextDate:'',cycle:'year',intervalCount:1,remindDays:14,teamId:null,customerId:null,assigneeId:null,note:'',licenseType:'subscription',quantity:1,unitPrice:0,actualPaid:null,purchaseDate:null,accountHint:'',paymentAccount:'',paymentMethod:'',portalUrl:'',providerContact:'',invoiceType:null,enabled:true,syncCalendar:true};
  const columns={teamId:'team_id',customerId:'customer_id',name:'name',provider:'provider',contractNumber:'contract_number',amount:'amount',nextDate:'next_date',cycle:'cycle',intervalCount:'interval_count',remindDays:'remind_days',assigneeId:'assignee_id',note:'note',licenseType:'license_type',quantity:'quantity',unitPrice:'unit_price',actualPaid:'actual_paid',purchaseDate:'purchase_date',accountHint:'account_hint',paymentAccount:'payment_account',paymentMethod:'payment_method',portalUrl:'portal_url',providerContact:'provider_contact',invoiceType:'invoice_type',enabled:'enabled',syncCalendar:'sync_calendar'};
  if(db.dialect==='postgres') {
    Object.assign(defaults,{reminderTime:'09:00',reminderMode:'daily'});
    Object.assign(columns,{reminderTime:'reminder_time',reminderMode:'reminder_mode'});
  }
  function values(req,existing,body=req.body||{}) {
    keys(body,[...Object.keys(defaults),...(existing?['expectedRevision']:[])]);
    if(existing)assertRevision(body,existing,'service',HttpError);
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
    if(db.dialect==='postgres'&&(!['daily','milestone'].includes(v.reminderMode)||(v.reminderTime!==null&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.reminderTime))))fail('Giờ hoặc chế độ nhắc không hợp lệ');
    if(db.dialect==='postgres'&&v.reminderTime===null&&existing?.reminder_time!==null)fail('Dịch vụ mới cần giờ nhắc rõ ràng');
    if(v.portalUrl){try{if(!['https:','http:'].includes(new URL(v.portalUrl).protocol))fail('Cổng quản lý phải dùng HTTP hoặc HTTPS');}catch{fail('Cổng quản lý phải dùng HTTP hoặc HTTPS');}}
    for(const key of ['teamId','customerId','assigneeId'])if(v[key]!==null&&(typeof v[key]!=='string'||!v[key]))fail('Phạm vi dịch vụ không hợp lệ');
    if(!can(req,v.teamId,true))fail('Không có quyền với team đã chọn',403);
    if(v.customerId&&!db.prepare('SELECT 1 FROM customers WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(v.customerId,req.auth.workspaceId))fail('Khách hàng không hợp lệ');
    if(v.assigneeId&&(!canAccessTeamTask(db,req.auth.workspaceId,v.assigneeId,v.teamId)||!db.prepare('SELECT 1 FROM users WHERE id=? AND disabled_at IS NULL').get(v.assigneeId)))fail('Người phụ trách không thuộc phạm vi dịch vụ');
    if(v.assigneeId&&db.dialect==='postgres'&&!db.prepare("SELECT 1 FROM workspace_members WHERE workspace_id=? AND user_id=? AND member_type='member'").get(req.auth.workspaceId,v.assigneeId))fail('Khách không được nhận dữ liệu dịch vụ');
    return v;
  }
  const sqlValues=v=>Object.keys(columns).map(key=>typeof v[key]==='boolean'?Number(v[key]):v[key]);
  function insert(req,v){
    const id=createId('service_'),at=iso(clock);
    db.prepare(`INSERT INTO service_contracts(id,workspace_id,${Object.values(columns).join(',')},created_by,created_at,updated_at) VALUES (${Array(Object.keys(columns).length+5).fill('?').join(',')})`).run(id,req.auth.workspaceId,...sqlValues(v),req.auth.userId,at,at);
    if(db.dialect==='postgres')db.prepare('UPDATE service_contracts SET renewal_anchor=? WHERE id=?').run(v.nextDate,id);
    return json(req,row(req,false,id));
  }
  function cycleTask(req,service,projectId) {
    if(db.dialect!=='postgres')fail('Máy chủ cần PostgreSQL để liên kết công việc',409);
    if(projectId!==undefined&&(typeof projectId!=='string'||!projectId))fail('Dự án không hợp lệ');
    const linked=db.prepare(`SELECT t.* FROM service_cycle_tasks c JOIN tasks t ON t.id=c.task_id
      WHERE c.service_id=? AND c.period_date=? AND c.workspace_id=?`).get(service.id,service.next_date,req.auth.workspaceId);
    if(linked){
      if(!canAccessTask(db,req.auth.workspaceId,req.auth.userId,linked,{write:true}))fail('Không có quyền với công việc gia hạn',403);
      if(linked.deleted_at)fail('Khôi phục công việc gia hạn đã xóa trước khi tiếp tục',409);
      return linked.id;
    }
    const project=resolveTaskProject(db,req.auth.workspaceId,req.auth.userId,{projectId,teamId:service.team_id,config:db.projectConfig,clock});
    if(!project)fail('Không có quyền tạo công việc tại dự án đã chọn',403);
    if(service.assignee_id&&!canAccessTask(db,req.auth.workspaceId,service.assignee_id,{workspace_id:req.auth.workspaceId,project_id:project.id}))fail('Người phụ trách không thuộc dự án',400);
    const column=resolveTaskColumn(db,{workspaceId:req.auth.workspaceId,teamId:project.team_id,projectId:project.id,status:'todo',clock,HttpError});
    const id=createId('task_'),at=iso(clock),due=new Date(`${service.next_date}T${service.reminder_time||'09:00'}:00+07:00`).toISOString();
    // Only a public-safe title is projected; credentials, notes and money stay
    // in the service record, which guest accounts cannot read.
    db.prepare(`INSERT INTO tasks(id,workspace_id,project_id,team_id,title,description,status,priority,due_at,assignee_id,created_by,created_at,updated_at,column_id,recurrence)
      VALUES(?,?,?,?,?,'','todo','medium',?,?,?,?,?,?,'none')`).run(id,req.auth.workspaceId,project.id,project.team_id,`Gia hạn: ${service.name}`.slice(0,240),due,service.assignee_id,req.auth.userId,at,at,column.id);
    db.prepare('INSERT INTO service_cycle_tasks(service_id,period_date,workspace_id,task_id) VALUES(?,?,?,?)').run(service.id,service.next_date,req.auth.workspaceId,id);
    recordTaskActivity(db,{taskId:id,actorUserId:req.auth.userId,action:'task_created',summary:'đã tạo công việc gia hạn',createdAt:at});
    return id;
  }
  function serviceMutation(req,action,authorize,callback) {
    return withTransaction(db,()=>{
      ensureWritable(req);
      const b=req.body||{},operationId=req.headers['idempotency-key']??b.operationId;
      if(operationId!==undefined&&(typeof operationId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,159}$/.test(operationId)))fail('operationId không hợp lệ');
      if(req.headers['idempotency-key']&&b.operationId&&req.headers['idempotency-key']!==b.operationId)fail('operationId không khớp Idempotency-Key');
      const payload={...b};delete payload.operationId;
      const fingerprint=mutationFingerprint({action,payload});
      if(operationId&&db.dialect==='postgres')db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(?))').get(JSON.stringify([req.auth.workspaceId,req.auth.userId,operationId]));
      const current=authorize(); // Recheck current rights even when replaying.
      const receipt=operationId&&db.dialect==='postgres'?db.prepare('SELECT * FROM mutation_receipts WHERE workspace_id=? AND principal_id=? AND operation_id=?').get(req.auth.workspaceId,req.auth.userId,operationId):null;
      if(receipt){
        if(receipt.action!==action||receipt.payload_hash!==fingerprint)fail('operationId đã dùng với nội dung khác',409);
        const result=JSON.parse(receipt.response_json);
        if(result.expenseId&&!canFinance(req))fail('Không còn quyền xem khoản chi',403);
        if(result.taskId&&!canAccessTask(db,req.auth.workspaceId,req.auth.userId,db.prepare('SELECT * FROM tasks WHERE id=? AND workspace_id=?').get(result.taskId,req.auth.workspaceId),{write:true}))fail('Không còn quyền với công việc gia hạn',403);
        return result;
      }
      const result=withMutationContext(db,{actorUserId:req.auth.userId,source:req.mobileToken?'android':'web',operationId:operationId||null,occurredAt:iso(clock)},()=>callback(current,payload));
      if(operationId&&db.dialect==='postgres')db.prepare(`INSERT INTO mutation_receipts(workspace_id,principal_id,operation_id,action,resource_id,payload_hash,response_status,response_json,committed_at)
        VALUES(?,?,?,?,?,?,200,?,?)`).run(req.auth.workspaceId,req.auth.userId,operationId,action,req.params.id||null,fingerprint,JSON.stringify(result),iso(clock));
      return result;
    });
  }
  function renew(req,old,b){
    keys(b,['expectedDate','expectedRevision','nextDate','amount','note','recordExpense','createTask','projectId']);
    if(old.archived_at)fail('Dịch vụ đã lưu trữ',409);
    assertRevision(b,old,'service',HttpError);
    if(b.expectedDate!==old.next_date)fail('Ngày gia hạn đã thay đổi. Hãy làm mới trước khi ghi nhận',409);
    const nextDate=b.nextDate?date(b.nextDate):nextFutureServiceDate(old.next_date,old.cycle,old.interval_count,today(),old.renewal_anchor||old.next_date);
    if(!nextDate||nextDate<=old.next_date||nextDate<=today())fail('Ngày gia hạn mới phải sau kỳ hiện tại và hôm nay');
    const amount=money(b.amount??old.amount),note=text(b.note??'',1000),at=iso(clock);
    for(const flag of ['recordExpense','createTask'])if(b[flag]!==undefined&&typeof b[flag]!=='boolean')fail('Tùy chọn gia hạn không hợp lệ');
    if(b.projectId!==undefined&&(typeof b.projectId!=='string'||!b.projectId||!b.createTask))fail('Dự án công việc không hợp lệ');
    let expenseId=null;
    if(b.recordExpense){
      if(!canFinance(req))fail('Chỉ quản trị có quyền ghi khoản chi',403);
      if(amount<=0)fail('Khoản chi phải lớn hơn 0');
      expenseId=createId('transaction_');
      db.prepare(`INSERT INTO transactions(id,workspace_id,type,amount,title,category,date,customer_id,created_by,created_at)
        VALUES(?,?,'expense',?,?,'service-renewal',?,?,?,?)`).run(expenseId,req.auth.workspaceId,amount,`Gia hạn ${old.name}`.slice(0,240),today(),old.customer_id,req.auth.userId,at);
    }
    const taskId=b.createTask?cycleTask(req,{...old,next_date:nextDate},b.projectId):null;
    const renewalId=createId('renewal_');
    db.prepare(`INSERT INTO service_renewals(id,service_id,previous_date,next_date,amount,note,actor_id,created_at${db.dialect==='postgres'?',expense_id,task_id':''}) VALUES (?,?,?,?,?,?,?,?${db.dialect==='postgres'?',?,?':''})`).run(renewalId,old.id,old.next_date,nextDate,amount,note,req.auth.userId,at,...(db.dialect==='postgres'?[expenseId,taskId]:[]));
    // A renewal records a new period, not proof of payment. Actual paid is only
    // set when the caller explicitly creates the financial transaction.
    db.prepare(`UPDATE service_contracts SET next_date=?,actual_paid=?,last_renewed_at=?,enabled=1,updated_at=?${db.dialect==='postgres'?',renewal_anchor=?':''} WHERE id=? AND workspace_id=?`).run(nextDate,expenseId?amount:null,at,at,...(db.dialect==='postgres'?[b.nextDate?nextDate:(old.renewal_anchor||old.next_date)]:[]),old.id,req.auth.workspaceId);
    return {ok:true,nextDate,renewalId,expenseId,taskId};
  }
  const route=fn=>(req,res,next)=>{try{fn(req,res);}catch(error){next(error);}};
  app.get('/api/services',requireAuth,route((req,res)=>{
    const rows=db.prepare('SELECT s.*,c.name customer_name,u.name assignee_name FROM service_contracts s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.assignee_id WHERE s.workspace_id=? ORDER BY s.next_date,s.name').all(req.auth.workspaceId).filter(r=>can(req,r.team_id));
    res.json({services:rows.map(r=>json(req,r))});
  }));
  app.post('/api/services',requireAuth,route((req,res)=>{ensureWritable(req);const v=values(req);const service=withTransaction(db,()=>insert(req,v));res.status(201).json({service});}));
  app.patch('/api/services/:id',requireAuth,route((req,res)=>{const service=withTransaction(db,()=>{const old=row(req,true);if(old.archived_at)fail('Khôi phục dịch vụ trước khi chỉnh sửa',409);const v=values(req,old);db.prepare(`UPDATE service_contracts SET ${Object.values(columns).map(c=>c+'=?').join(',')},updated_at=? WHERE id=? AND workspace_id=?`).run(...sqlValues(v),iso(clock),old.id,req.auth.workspaceId);if(db.dialect==='postgres'&&v.nextDate!==old.next_date)db.prepare('UPDATE service_contracts SET renewal_anchor=? WHERE id=?').run(v.nextDate,old.id);return json(req,row(req));});res.json({ok:true,service});}));
  app.get('/api/services/:id',requireAuth,route((req,res)=>{res.json({service:json(req,row(req))});}));
  app.get('/api/services/:id/history',requireAuth,route((req,res)=>{row(req);res.json({history:db.prepare('SELECT r.*,u.name actor_name FROM service_renewals r LEFT JOIN users u ON u.id=r.actor_id WHERE r.service_id=? ORDER BY r.created_at DESC,r.id DESC').all(req.params.id)});}));
  app.post('/api/services/:id/renew',requireAuth,route((req,res)=>{
    res.json(serviceMutation(req,`service.renew:${req.params.id}`,()=>row(req,true),(old,body)=>renew(req,old,body)));
  }));
  app.post('/api/services/:id/renewal-task',requireAuth,route((req,res)=>{
    res.json(serviceMutation(req,`service.task:${req.params.id}`,()=>row(req,true),(old,body)=>{
      keys(body,['expectedDate','expectedRevision','projectId']);
      if(old.archived_at)fail('Dịch vụ đã lưu trữ',409);
      assertRevision(body,old,'service',HttpError);
      if(body.expectedDate!==old.next_date)fail('Kỳ dịch vụ đã thay đổi',409);
      return {ok:true,taskId:cycleTask(req,old,body.projectId)};
    }));
  }));
  app.put('/api/services/:id/archive',requireAuth,route((req,res)=>{withTransaction(db,()=>{const old=row(req,true);keys(req.body,['archived']);if(typeof req.body.archived!=='boolean')fail('Trạng thái lưu trữ không hợp lệ');if(!req.body.archived)values(req,old,{});db.prepare('UPDATE service_contracts SET archived_at=?,updated_at=? WHERE id=? AND workspace_id=?').run(req.body.archived?iso(clock):null,iso(clock),old.id,req.auth.workspaceId);});res.json({ok:true});}));
  app.post('/api/services/:id/duplicate',requireAuth,route((req,res)=>{const old=row(req,true);if(old.archived_at)fail('Khôi phục dịch vụ trước khi sao chép',409);keys(req.body||{},[]);const copy=Object.fromEntries(Object.keys(defaults).map(k=>[k,serviceJson(old,today())[k]]));copy.name=`${old.name.slice(0,190)} (bản sao)`;copy.actualPaid=null;if(db.dialect==='postgres')copy.reminderTime??='09:00';const v=values(req,null,copy);res.status(201).json({service:withTransaction(db,()=>insert(req,v))});}));
  app.post('/api/services/bulk',requireAuth,route((req,res)=>{
    ensureWritable(req);const b=req.body;keys(b,['action','items','operationId']);
    if(!['renew','archive','restore'].includes(b.action)||!Array.isArray(b.items)||!b.items.length||b.items.length>100)fail('Chọn từ 1 đến 100 dịch vụ và thao tác hợp lệ');
    const seen=new Set();for(const item of b.items){keys(item,['id','expectedDate']);if(typeof item.id!=='string'||!item.id||seen.has(item.id))fail('Danh sách dịch vụ không hợp lệ hoặc bị trùng');seen.add(item.id);}
    res.json(serviceMutation(req,'service.bulk',()=>[...b.items].sort((a,b)=>a.id.localeCompare(b.id)).map(item=>({item,old:row(req,true,item.id)})),rows=>{
      for(const {old,item} of rows){if(b.action==='renew')renew(req,old,{expectedDate:item.expectedDate});else {if(b.action==='restore')values(req,old,{});db.prepare('UPDATE service_contracts SET archived_at=?,updated_at=? WHERE id=? AND workspace_id=?').run(b.action==='archive'?iso(clock):null,iso(clock),old.id,req.auth.workspaceId);}}
      return {ok:true,count:b.items.length};
    }));
  }));
  app.delete('/api/services/:id',requireAuth,route((req,res)=>{withTransaction(db,()=>{const old=row(req,true);keys(req.body,['confirmName']);if(!old.archived_at)fail('Lưu trữ dịch vụ trước khi xóa vĩnh viễn',409);if(req.body.confirmName!==old.name)fail('Nhập đúng tên dịch vụ để xác nhận');db.prepare('DELETE FROM notifications WHERE service_id=? AND workspace_id=?').run(old.id,req.auth.workspaceId);db.prepare('DELETE FROM service_contracts WHERE id=? AND workspace_id=?').run(old.id,req.auth.workspaceId);});res.json({ok:true});}));
 function customer(req){const r=db.prepare('SELECT id FROM customers WHERE id=? AND workspace_id=? AND deleted_at IS NULL').get(req.params.customerId,req.auth.workspaceId);if(!r)fail('Không tìm thấy khách hàng',404);return r}
 app.get('/api/customers/:customerId/interactions',requireAuth,(req,res,next)=>{try{customer(req);res.json({interactions:db.prepare('SELECT i.*,u.name actor_name FROM customer_interactions i LEFT JOIN users u ON u.id=i.created_by WHERE i.customer_id=? AND i.workspace_id=? ORDER BY happened_at DESC').all(req.params.customerId,req.auth.workspaceId)})}catch(e){next(e)}});
 app.post('/api/customers/:customerId/interactions',requireAuth,(req,res,next)=>{try{ensureWritable(req);customer(req);const b=req.body||{};if(!['call','email','meeting','message','other'].includes(b.type))fail('Loại tương tác không hợp lệ');const note=text(b.note,5000);if(!note)fail('Cần nhập nội dung tương tác');const at=b.happenedAt?new Date(b.happenedAt):new Date(clock());if(!Number.isFinite(at.getTime()))fail('Thời gian không hợp lệ');db.prepare('INSERT INTO customer_interactions(id,customer_id,workspace_id,type,note,happened_at,created_by) VALUES (?,?,?,?,?,?,?)').run(createId('interaction_'),req.params.customerId,req.auth.workspaceId,b.type,note,at.toISOString(),req.auth.userId);res.status(201).json({ok:true})}catch(e){next(e)}});
}
