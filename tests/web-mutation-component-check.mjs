// Opt-in component check: uses the repository's existing mobile jsdom install.
// This renders real Web components, but is not browser/device E2E evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),swc=require('next/dist/build/swc');
await swc.loadBindings();
require.extensions['.jsx']=(module,file)=>module._compile(swc.transformSync(readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true},transform:{react:{runtime:'automatic'}}},module:{type:'commonjs'}}).code,file);
require.extensions['.css']=()=>{};
const React=require('react'),{act}=React,{JSDOM}=require('../mobile/node_modules/jsdom');
const PersonalTasks=require('../src/PersonalTasks.jsx').default,WeekCalendar=require('../src/WeekCalendar.jsx').default;
const TaskExtras=require('../src/TaskExtras.jsx').default,TaskDetail=require('../src/TaskDetail.jsx').default;
const WorkflowBoard=require('../src/WorkflowBoard.jsx').default,ProjectAdvanced=require('../src/ProjectAdvanced.jsx').default;
const me={user:{id:'u',role:'owner',name:'Test'},workspace:{id:'w'},subscription:{status:'active',currentPeriodEnd:'2099-01-01',capabilities:['public_api']}};
const card={id:'task-private',title:'CANARY_TASK',status:'todo',dueAt:null,plannedDate:null,planRevision:'p1'};
const error=status=>Object.assign(new Error(`Denied ${status}`),{status});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
async function mount(t,Component,props){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.local',pretendToBeVisual:true});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,FormData:dom.window.FormData,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const root=require('react-dom/client').createRoot(document.getElementById('root'));
 const render=async(C=Component,p=props)=>act(async()=>root.render(React.createElement(C,p)));
 await render();t.after(async()=>{await act(async()=>root.unmount());dom.window.close();});
 return {render,dom,text:()=>document.body.textContent,click:async label=>act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);assert.ok(button,`missing button ${label}`);button.click();}),typeInput:async(selector,value)=>act(async()=>{const field=document.querySelector(selector);assert.ok(field,selector);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));field.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}),submit:async form=>act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))};
}

const task={...card,revision:'r1',priority:'medium',teamId:'team',assigneeId:'u'};
function receipts(){const seen=new Map(),calls=[];let effects=0,lose=true;return {calls,get effects(){return effects;},send:async(path,options)=>{const body=JSON.parse(options.body);calls.push(body);if(!seen.has(body.operationId)||!body.operationId){effects++;if(body.operationId)seen.set(body.operationId,options.body);}else assert.equal(options.body,seen.get(body.operationId));if(lose){lose=false;throw new Error('Response lost after commit');}return {task:{...task,id:'created',title:body.title||'Copied'},taskRevision:'r2'};}};}
test('quick task retries an immutable operation after commit response loss',async t=>{
 const server=receipts();const api=async(path,options)=>options?server.send(path,options):{tasks:[],total:0,page:1,hasMore:false};
 const ui=await mount(t,PersonalTasks,{api,me,view:'inbox',refreshToken:0,onChanged:async()=>{},onOpen:()=>{}});
 await ui.typeInput('input[aria-label="Nội dung việc nhanh"]','Retry-safe task');await ui.submit(document.querySelector('form'));
 assert.ok(ui.text().includes('Response lost'));assert.equal(document.querySelector('input[aria-label="Nội dung việc nhanh"]').value,'Retry-safe task');
 await ui.submit(document.querySelector('form'));assert.equal(server.effects,1);assert.ok(server.calls[0].operationId);assert.deepEqual(server.calls[0],server.calls[1]);
 await ui.typeInput('input[aria-label="Nội dung việc nhanh"]','Retry-safe task');await ui.submit(document.querySelector('form'));assert.equal(server.effects,2);assert.notEqual(server.calls[2].operationId,server.calls[0].operationId);
});
test('copy task reuses operation and captured revision after lost response',async t=>{
 const server=receipts();const api=async(path,options)=>options?server.send(path,options):path.startsWith('/task-labels')?{labels:[]}:{assigneeIds:[],labelIds:[],members:[],checklists:[]};
 const props={api,task:{...task,dueAt:'2031-04-05T02:00:00Z'},onChanged:async()=>{}};const ui=await mount(t,TaskExtras,props);
 await ui.click('Sao chép công việc');await ui.render(TaskExtras,{...props,task:{...task,revision:'r2',dueAt:'2031-04-06T02:00:00Z'},refreshToken:1});await ui.click('Sao chép công việc');
 assert.equal(server.effects,1);assert.equal(server.calls[0].expectedRevision,'r1');assert.deepEqual(server.calls[1],server.calls[0]);
});
test('label draft keeps captured revision despite refresh and preserves draft on conflict',async t=>{
 const writes=[];let winning=['remote'];const api=async(path,options)=>{if(options){const body=JSON.parse(options.body);writes.push(body);if(body.expectedRevision==='r1')throw error(409);winning=body.labelIds;return {};}
 return path.startsWith('/task-labels')?{labels:[{id:'local',name:'Local',color:'green'},{id:'remote',name:'Remote',color:'green'}]}:{assigneeIds:[],labelIds:[],members:[],checklists:[]};};
 const props={api,task,onChanged:async()=>{}};const ui=await mount(t,TaskExtras,props);
 await act(async()=>document.querySelector('input[type="checkbox"]').click());
 await ui.render(TaskExtras,{...props,task:{...task,revision:'r2'},refreshToken:1});await ui.click('Lưu nhãn');
 assert.equal(writes[0].expectedRevision,'r1');assert.deepEqual(winning,['remote']);assert.ok(ui.text().includes('Denied 409'));assert.equal(document.querySelector('input[type="checkbox"]').checked,true);
});
function detailApi(write){return async(path,options)=>{if(options)return write(path,options);if(path.endsWith('/detail'))return {task,canWrite:true,checklists:[],comments:[],attachments:[],files:[],checklistMembers:[]};if(path.endsWith('/reminders'))return {effectivePolicy:{enabled:false,steps:[]},recipients:[],history:[]};if(path.endsWith('/time'))return {entries:[],timer:null};if(path.endsWith('/estimates'))return {estimates:[]};if(path.startsWith('/task-labels'))return {labels:[]};return {};};}
test('actual checklist create retries one aggregate operation after commit loss',async t=>{
 const server=receipts(),api=detailApi(server.send);const ui=await mount(t,TaskDetail,{api,taskId:task.id,me,onChanged:async()=>{},onBack:()=>{}});
 await ui.typeInput('input[aria-label="Tên checklist mới"]','One checklist');await ui.submit(document.querySelector('.td-tasklist-new'));
 assert.ok(ui.text().includes('Response lost'));await ui.submit(document.querySelector('.td-tasklist-new'));
 assert.equal(server.effects,1);assert.equal(server.calls[0].expectedRevision,'r1');assert.deepEqual(server.calls[0],server.calls[1]);
});
test('actual task status and priority submit the displayed aggregate revision',async t=>{
 const calls=[];const ui=await mount(t,TaskDetail,{api:detailApi(async(path,o)=>{calls.push(JSON.parse(o.body));throw error(409);}),taskId:task.id,me,onBack:()=>{}});
 for(const [label,value] of [['Trạng thái công việc','done'],['Độ ưu tiên công việc','high']]) await act(async()=>{const field=document.querySelector(`select[aria-label="${label}"]`);field.value=value;field.dispatchEvent(new ui.dom.window.Event('change',{bubbles:true}));});
 assert.equal(calls.length,2);assert.ok(calls.every(c=>c.expectedRevision==='r1'&&c.operationId));assert.ok(ui.text().includes('Denied 409'));
});

test('week editor retries lost response with original plan revision after remote refresh',async t=>{
 const server=receipts();let latest='p1';const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const api=async(path,options)=>options?server.send(path,options):path.startsWith('/personal-tasks')?{tasks:[{...task,plannedDate:today,planRevision:latest}],page:1,total:1,hasMore:false}:{events:[],total:0};
 const props={api,me,refreshToken:0,onOpenTask:()=>{},onOpenEvent:()=>{},onChanged:async()=>{}};const ui=await mount(t,WeekCalendar,props);
 await ui.click('Sắp lịch');await ui.typeInput('input[type="time"]','09:45');await ui.click('Lưu lịch');
 latest='p2';await ui.render(WeekCalendar,{...props,refreshToken:1});await ui.click('Lưu lịch');
 assert.equal(server.effects,1);assert.equal(server.calls[0].expectedRevision,'p1');assert.deepEqual(server.calls[0],server.calls[1]);
 assert.equal(document.querySelector('.week-calendar-editor'),null);
});
test('week stale conflict retains date/time draft and never adopts refreshed plan revision',async t=>{
 let latest='p1';const calls=[];const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const api=async(path,options)=>{if(options){calls.push(JSON.parse(options.body));throw error(409);}return path.startsWith('/personal-tasks')?{tasks:[{...task,plannedDate:today,planRevision:latest}],page:1,total:1,hasMore:false}:{events:[],total:0};};
 const props={api,me,refreshToken:0,onOpenTask:()=>{},onOpenEvent:()=>{}};const ui=await mount(t,WeekCalendar,props);
 await ui.click('Sắp lịch');await ui.typeInput('input[type="time"]','09:45');latest='p2';await ui.render(WeekCalendar,{...props,refreshToken:1});await ui.click('Lưu lịch');
 assert.equal(calls[0].expectedRevision,'p1');assert.equal(document.querySelector('input[type="time"]').value,'09:45');assert.ok(ui.text().includes('Denied 409'));
});
test('checklist draft captured before a detail refresh conflicts and stays editable',async t=>{
 let latest='r1';const writes=[];const baseApi=detailApi(async(path,options)=>{writes.push(JSON.parse(options.body));throw error(409);});
 const api=async(path,options)=>{const result=await baseApi(path,options);return path.endsWith('/detail')?{...result,task:{...task,revision:latest}}:result;};
 const props={api,taskId:task.id,me,onBack:()=>{}};const ui=await mount(t,TaskDetail,props);
 await ui.typeInput('input[aria-label="Tên checklist mới"]','Local checklist');latest='r2';await ui.render(TaskDetail,{...props,revision:1});await ui.submit(document.querySelector('.td-tasklist-new'));
 assert.equal(writes[0].expectedRevision,'r1');assert.equal(document.querySelector('input[aria-label="Tên checklist mới"]').value,'Local checklist');assert.ok(ui.text().includes('Denied 409'));
});
test('confirmed quick create is cleared even when follow-up refresh fails',async t=>{
 let writes=0;const api=async(path,options)=>{if(options){writes++;return {task};}return {tasks:[],page:1,total:0,hasMore:false};};
 const ui=await mount(t,PersonalTasks,{api,me,view:'inbox',refreshToken:0,onChanged:async()=>{throw new Error('Read offline');}});
 await ui.typeInput('input[aria-label="Nội dung việc nhanh"]','Confirmed');await ui.submit(document.querySelector('form'));
 assert.equal(writes,1);assert.equal(document.querySelector('input[aria-label="Nội dung việc nhanh"]').value,'');assert.ok(ui.text().includes('Chưa làm mới được danh sách: Read offline'));
 await ui.submit(document.querySelector('form'));assert.equal(writes,1);
});
test('operation lifetime survives API callback rerenders but never crosses scope',async t=>{
 const {useTaskMutation}=require('../src/useTaskMutation.js');const writes=[];let run;
 function Probe({api,scope}){const request=useTaskMutation(api,scope);run=()=>request('/tasks',{method:'POST',body:JSON.stringify({title:'Draft'})});return React.createElement('div');}
 const send=async(path,options)=>{writes.push(JSON.parse(options.body));throw new Error('Lost response');};
 const ui=await mount(t,Probe,{api:send,scope:'workspace-a'});await assert.rejects(run());await ui.render(Probe,{api:(...args)=>send(...args),scope:'workspace-a'});await assert.rejects(run());
 assert.equal(writes[1].operationId,writes[0].operationId);await ui.render(Probe,{api:send,scope:'workspace-b'});await assert.rejects(run());assert.notEqual(writes[2].operationId,writes[0].operationId);
});
test('retry helper freezes sent payload and serializes duplicate concurrent submissions',async()=>{
 const {taskMutationRequest}=require('../src/useTaskMutation.js');const reply=deferred(),calls=[];const request=taskMutationRequest(async(path,options)=>{calls.push(JSON.parse(options.body));return reply.promise;});
 const first=request('/tasks/task',{method:'PATCH',body:JSON.stringify({status:'done',expectedRevision:'r1'})});
 const duplicate=request('/tasks/task',{method:'PATCH',body:JSON.stringify({status:'done',expectedRevision:'r2'})});
 await assert.rejects(request('/tasks/task',{method:'PATCH',body:JSON.stringify({status:'doing',expectedRevision:'r2'})}),/vẫn đang gửi/);
 reply.resolve({taskRevision:'r2'});await Promise.all([first,duplicate]);assert.equal(calls.length,1);assert.equal(calls[0].expectedRevision,'r1');
 await request('/tasks/task',{method:'PATCH',body:JSON.stringify({status:'doing',expectedRevision:'r2'})});assert.notEqual(calls[1].operationId,calls[0].operationId);
});

test('custom board move uses aggregate revision and retries the original operation',async t=>{
 const server=receipts(),columns=[{id:'todo-col',name:'Todo',status:'todo',position:0},{id:'done-col',name:'Done',status:'done',position:1}];
 const api=async(path,options)=>options?server.send(path,options):{columns,canWrite:true};
 const ui=await mount(t,WorkflowBoard,{api,teamId:'team',tasks:[{...task,columnId:'todo-col'}],onOpen:()=>{},onChanged:async()=>{}});
 await ui.click('Thao tác công việc CANARY_TASK');await ui.click('Chuyển sang Done');assert.ok(ui.text().includes('Response lost'));
 await ui.click('Thao tác công việc CANARY_TASK');await ui.click('Chuyển sang Done');
 assert.equal(server.effects,1);assert.equal(server.calls[0].expectedRevision,'r1');assert.deepEqual(server.calls[0],server.calls[1]);
});
test('project field draft survives unrelated successful view refresh and conflicts on its original revision',async t=>{
 let latest='r1';const writes=[];const api=async(path,options)=>{if(options){if(path.endsWith('/views')){latest='r2';return {};}writes.push(JSON.parse(options.body));throw error(409);}
 if(path.includes('/tasks?'))return {tasks:[{...task,revision:latest,customValues:{f:'server'}}],fields:[{id:'f',name:'Field',type:'text',options:[]}],total:1,pageSize:25,config:{layout:'list'}};
 if(path.endsWith('/views'))return {views:[]};if(path.endsWith('/dependencies'))return {dependencies:[]};return {templates:[]};};
 const ui=await mount(t,ProjectAdvanced,{api,project:{id:'p',canManage:true,canEdit:true},onOpenTask:()=>{}});
 await ui.typeInput('article input[type="text"]','Local draft');await ui.click('Lưu view');await ui.click('Lưu giá trị trường');
 assert.equal(writes[0].expectedRevision,'r1');assert.deepEqual(writes[0].values,{f:'Local draft'});assert.equal(document.querySelector('article input[type="text"]').value,'Local draft');assert.ok(ui.text().includes('Denied 409'));
});
for(const Component of [PersonalTasks,WeekCalendar])test(`${Component.name} workspace switch clears old reads and starts a separate mutation scope`,async t=>{
 let writes=0;const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);const calls=[];
 const first=async(path,options)=>{if(options){writes++;calls.push(JSON.parse(options.body));throw new Error('Response lost');}return path.startsWith('/personal-tasks')?{tasks:[{...task,plannedDate:today}],total:1,page:1,hasMore:false}:{events:[],total:0};};
 const props={api:first,me,view:'today',refreshToken:0,onChanged:async()=>{},onOpen:()=>{},onOpenTask:()=>{},onOpenEvent:()=>{}};
 const ui=await mount(t,Component,props);assert.ok(ui.text().includes('CANARY_TASK'));
 if(Component===PersonalTasks){await ui.typeInput('input[aria-label="Nội dung việc nhanh"]','Same text');await ui.submit(document.querySelector('form'));}else{await ui.click('Sắp lịch');await ui.click('Lưu lịch');}
 const next=async(path,options)=>{if(options){writes++;calls.push(JSON.parse(options.body));return {task};}return path.startsWith('/personal-tasks')?{tasks:[{...task,id:'other',title:'NEW_SCOPE',plannedDate:today}],total:1,page:1,hasMore:false}:{events:[],total:0};};
 await ui.render(Component,{...props,api:next,me:{...me,workspace:{id:'other-workspace'}}});assert.ok(!ui.text().includes('CANARY_TASK'));assert.ok(ui.text().includes('NEW_SCOPE'));
 if(Component===PersonalTasks)await ui.submit(document.querySelector('form'));else{assert.equal(document.querySelector('.week-calendar-editor'),null);await ui.click('Sắp lịch');await ui.click('Lưu lịch');}
 assert.equal(writes,2);assert.notEqual(calls[0].operationId,calls[1].operationId);
});

test('quick-task relative deadline remains frozen when midnight arrives after a lost response',async t=>{
 t.mock.timers.enable({apis:['Date'],now:Date.parse('2031-04-05T16:59:00Z')});
 const server=receipts(),api=async(path,options)=>options?server.send(path,options):{tasks:[],total:0,page:1,hasMore:false};
 const ui=await mount(t,PersonalTasks,{api,me,view:'inbox',refreshToken:0,onChanged:async()=>{}});
 await ui.typeInput('input[aria-label="Nội dung việc nhanh"]','Gửi báo cáo mai 9h');await ui.submit(document.querySelector('form'));
 t.mock.timers.setTime(Date.parse('2031-04-05T17:01:00Z'));await act(async()=>window.dispatchEvent(new ui.dom.window.Event('focus')));await ui.submit(document.querySelector('form'));
 assert.equal(server.effects,1);assert.equal(server.calls[0].dueAt,'2031-04-06T02:00:00.000Z');assert.deepEqual(server.calls[0],server.calls[1]);
});

for(const kind of ['task','checklist'])test(`legacy ${kind} template uses one operation across lost-response retry`,async t=>{
 const TaskTemplates=require('../src/TaskTemplates.jsx').default;const server=receipts();
 const api=async(path,options)=>options?server.send(path,options):path==='/task-templates'?{templates:[{id:'tpl',name:'Template',kind}]}:{task};
 const props={api,task,onChanged:async()=>{}};const ui=await mount(t,TaskTemplates,props);await ui.click(kind==='task'?'Tạo công việc':'Áp dụng vào công việc');
 await ui.submit(document.querySelector('[role="dialog"] form'));await ui.render(TaskTemplates,{...props,task:{...task,revision:'r2'}});await ui.submit(document.querySelector('[role="dialog"] form'));
 assert.equal(server.effects,1);assert.ok(server.calls[0].operationId);assert.deepEqual(server.calls[0],server.calls[1]);if(kind==='checklist')assert.equal(server.calls[0].expectedRevision,'r1');assert.equal(document.querySelector('[role="dialog"]'),null);
});
test('checklist template captures target revision at dialog open and preserves conflict state',async t=>{
 const TaskTemplates=require('../src/TaskTemplates.jsx').default;const calls=[];let readRevision='r1';const api=async(path,options)=>{if(options){calls.push(JSON.parse(options.body));throw error(409);}return path==='/task-templates'?{templates:[{id:'tpl',name:'Template',kind:'checklist'}]}:{task:{...task,revision:readRevision}};};
 const props={api,taskId:task.id};const ui=await mount(t,TaskTemplates,props);await ui.click('Áp dụng vào công việc');readRevision='r2';await ui.render(TaskTemplates,{...props,task:{...task,revision:'r2'}});await ui.submit(document.querySelector('[role="dialog"] form'));
 assert.equal(calls[0].expectedRevision,'r1');assert.ok(ui.text().includes('Denied 409'));assert.ok(document.querySelector('[role="dialog"]'));
});
