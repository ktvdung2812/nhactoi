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
const Teams=require('../src/Teams.jsx').default;
const Google=require('../src/GoogleCalendar.jsx').default,{GoogleCalendarSettings}=require('../src/GoogleCalendar.jsx');
const Public=require('../src/PublicIntegrations.jsx').default,Zalo=require('../src/ZaloOa.jsx').default;
const {useGuardedApi,staleRequest}=require('../src/useGuardedApi.js');
const me={user:{id:'u',role:'owner',name:'Test'},workspace:{id:'w'},subscription:{status:'active',currentPeriodEnd:'2099-01-01',capabilities:['public_api']}};
const card={id:'task-private',title:'CANARY_TASK',status:'todo',dueAt:null,plannedDate:null,planRevision:'p1'};
const error=status=>Object.assign(new Error(`Denied ${status}`),{status});
const deferred=()=>{let resolve,reject;return {promise:new Promise((a,b)=>{resolve=a;reject=b;}),resolve,reject};};
async function mount(t,Component,props){
 const dom=new JSDOM('<div id="root"></div>',{url:'https://test.local',pretendToBeVisual:true});
 Object.assign(globalThis,{window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,FormData:dom.window.FormData,IS_REACT_ACT_ENVIRONMENT:true});
 dom.window.HTMLElement.prototype.scrollIntoView=()=>{};
 const root=require('react-dom/client').createRoot(document.getElementById('root'));
 const render=async(C=Component,p=props)=>act(async()=>root.render(React.createElement(C,p)));
 await render();t.after(async()=>{await act(async()=>root.unmount());dom.window.close();});
 return {render,dom,text:()=>document.body.textContent,click:async label=>act(async()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===label||b.getAttribute('aria-label')===label);assert.ok(button,`missing button ${label}`);button.click();}),typeInput:async(selector,value)=>act(async()=>{const field=document.querySelector(selector);assert.ok(field,selector);Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(field,value);field.dispatchEvent(new dom.window.Event('input',{bubbles:true}));field.dispatchEvent(new dom.window.Event('change',{bubbles:true}));}),submit:async form=>act(async()=>form.dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})))};
}
for(const status of [401,403,404,423])test(`personal ${status} removes loaded task data and disables writes`,async t=>{
 let denied=false;const api=async()=>{if(denied)throw error(status);return {tasks:[card],total:1,page:1,hasMore:false};};
 const props={api,me,view:'inbox',refreshToken:0,onChanged:async()=>{},onOpen:()=>{}};
 const ui=await mount(t,PersonalTasks,props);assert.ok(ui.text().includes('CANARY_TASK'));
 await ui.typeInput('input[aria-label="Nội dung việc nhanh"]','Giữ nội dung chưa lưu');
 denied=true;await ui.render(PersonalTasks,{...props,refreshToken:1});assert.ok(!ui.text().includes('CANARY_TASK'));assert.ok(ui.text().includes(`Denied ${status}`));
 assert.ok(document.querySelector('fieldset').disabled);assert.equal(document.querySelector('input[aria-label="Nội dung việc nhanh"]').value,'Giữ nội dung chưa lưu');
});
test('personal failed next page cannot label the previous page as current',async t=>{
 const api=async path=>{if(path.includes('page=2'))throw new Error('Network unavailable');return {tasks:[card],total:51,page:1,hasMore:true};};
 const ui=await mount(t,PersonalTasks,{api,me,view:'inbox',refreshToken:0,onChanged:async()=>{},onOpen:()=>{}});await ui.click('Trang tiếp');
 assert.ok(!ui.text().includes('CANARY_TASK'));assert.ok(ui.text().includes('Network unavailable'));assert.ok(!ui.text().includes('Trang 2 · 51'));
});
test('week denied read clears task metadata and keeps only editable date/time draft',async t=>{
 let denied=false;const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10);
 const api=async path=>{if(denied)throw error(423);return path.startsWith('/personal-tasks')?{tasks:[{...card,plannedDate:today}],page:1,total:1,hasMore:false}:{events:[],total:0};};
 const props={api,me,refreshToken:0,onOpenTask:()=>{},onOpenEvent:()=>{},onChanged:async()=>{}};
 const ui=await mount(t,WeekCalendar,props);assert.ok(ui.text().includes('CANARY_TASK'));await ui.click('Sắp lịch');
 await ui.typeInput('input[type="date"]','2031-04-05');await ui.typeInput('input[type="time"]','09:45');
 denied=true;await ui.render(WeekCalendar,{...props,refreshToken:1});assert.ok(!ui.text().includes('CANARY_TASK'));assert.ok(ui.text().includes('Denied 423'));
 const save=[...document.querySelectorAll('button')].find(b=>b.textContent==='Lưu lịch');assert.ok(save?.disabled);assert.equal(document.querySelector('input[type="date"]').value,'2031-04-05');assert.equal(document.querySelector('input[type="time"]').value,'09:45');
});
const googleData={configured:true,connection:{status:'active',enabledKinds:['deadline']},mappings:[{id:'m',kind:'deadline',state:'conflict',conflict:{revision:'r1',server:{title:'CANARY_GOOGLE'},event:{etag:'e1',start:{},end:{}}}}]};
test('Google denial removes mappings and actions; old scope response cannot repopulate',async t=>{
 let denied=false;const api=async(path,options)=>{if(options&&denied)throw error(403);return googleData;};
 const ui=await mount(t,Google,{api});assert.ok(ui.text().includes('CANARY_GOOGLE'));denied=true;await ui.click('Đồng bộ ngay');assert.ok(!ui.text().includes('CANARY_GOOGLE'));assert.ok(!ui.text().includes('Ngắt kết nối'));
 const late=deferred();await ui.render(Google,{api:()=>late.promise});const next=async()=>({configured:false});await ui.render(Google,{api:next});
 await act(async()=>late.resolve(googleData));assert.ok(!ui.text().includes('CANARY_GOOGLE'));assert.ok(ui.text().includes('chưa được cấu hình'));
});
test('API denial clears one-time token and fetched token/history metadata',async t=>{
 let denied=false;const api=async(path,options)=>{
  if(options?.method==='DELETE'&&denied)throw error(403);
  if(path==='/api-tokens'&&options?.method==='POST')return {rawToken:'ONE_TIME_SECRET'};
  if(path==='/api-tokens')return {tokens:[{id:'tok',name:'CANARY_TOKEN',scopes:['tasks:read'],revokedAt:null}]};
  if(path==='/projects')return {projects:[]};return {subscriptions:[],eventTypes:['task.created']};
 };
 const ui=await mount(t,Public,{api,me});const form=document.querySelector('form');form.elements.name.value='Generated';await ui.submit(form);
 assert.equal(document.querySelector('input[aria-label="API token"]').value,'ONE_TIME_SECRET');denied=true;await ui.click('Thu hồi CANARY_TOKEN');
 assert.equal(document.querySelector('input[aria-label="API token"]'),null);assert.ok(!ui.text().includes('CANARY_TOKEN'));assert.ok(ui.text().includes('Denied 403'));
});
test('OA denial clears preview, provider details and credential form',async t=>{
 let denied=false;const data={configured:true,connection:{oaId:'CANARY_OA',status:'active',senderReady:false,contract:{mode:'simulation',apiVersion:'test'}},templates:[],recipients:[],deliveries:[],options:{}};
 const api=async(path,options)=>{if(denied&&options)throw error(403);if(path.endsWith('/preview'))return {payload:{oaId:'CANARY_OA',recipient:'CANARY_RECIPIENT',purpose:'internal',templateId:'tpl',version:'1',parameters:{body:'CANARY_PREVIEW'},cta:null},previewHash:'h'};return data;};
 const ui=await mount(t,Zalo,{api});await ui.click('Xem payload sẽ gửi');assert.ok(ui.text().includes('CANARY_PREVIEW'));denied=true;await ui.click('Đối soát mẫu với provider');
 assert.ok(!ui.text().includes('CANARY_'));assert.equal(document.querySelector('input[name="token"]'),null);assert.ok(ui.text().includes('Denied 403'));
});
test('admin settings denial removes client configuration and typed secret',async t=>{
 const api=async(path,options)=>{if(options)throw error(423);return {enabled:true,clientId:'CANARY_CLIENT',hasSecret:true,redirectUri:'https://test.local/callback',watchUrl:'https://test.local/watch'};};
 const ui=await mount(t,GoogleCalendarSettings,{api});const form=document.querySelector('form');form.elements.clientSecret.value='DRAFT_SECRET';form.elements.reason.value='Test denial';await ui.submit(form);
 assert.equal(document.querySelector('input[name="clientSecret"]'),null);assert.equal(document.querySelector('input[value="CANARY_CLIENT"]'),null);assert.ok(ui.text().includes('Denied 423'));
});
test('denial invalidates parallel late success',async t=>{
 const late=deferred(),failure=deferred();let run;const api=path=>path==='late'?late.promise:failure.promise;
 function Probe(){const [value,setValue]=React.useState('initial'),[guard]=useGuardedApi(api,()=>setValue('denied'));run=async path=>{try{setValue(await guard(path));}catch(e){if(!staleRequest(e))setValue('denied');}};return React.createElement('p',null,value);}
 const ui=await mount(t,Probe,{});let first,second;
 await act(async()=>{first=run('late');second=run('failure');failure.reject(error(403));await second;});assert.equal(ui.text(),'denied');
 await act(async()=>{late.resolve('CANARY_LATE');await first;});assert.equal(ui.text(),'denied');
});


test('unmount rejects late mutation response before notices or follow-up reads',async t=>{
 const reply=deferred();let reads=0;
 const api=async(path,options)=>{if(options)return reply.promise;reads++;return googleData;};
 const ui=await mount(t,Google,{api});await ui.click('Đồng bộ ngay');assert.equal(reads,1);
 await ui.render('div',{children:'New screen'});await act(async()=>reply.resolve({ok:true}));
 assert.equal(ui.text(),'New screen');assert.equal(reads,1);
});


test('team detail read denial clears member and task data, including 423',async t=>{
 let denied=false;
 const team={id:'team',name:'CANARY_TEAM',color:'green',taskCount:1,openTaskCount:1,completedTaskCount:0,memberCount:1,memberIds:['u'],myRole:'lead',canManage:true};
 const api=async path=>{
  if(path.startsWith('/teams/')){if(denied)throw error(423);return {team,members:[{id:'u',name:'CANARY_MEMBER',role:'lead'}],tasks:[card],taskPage:{page:1,total:51,hasMore:true}};}
  if(path.startsWith('/reminder-policy'))return {policy:{enabled:false,steps:[]},canManage:false};
  return {board:{id:'board',columns:[]},columns:[]};
 };
 const props={api,me,go:()=>{},teamId:'team',revision:0};const ui=await mount(t,Teams,props);
 assert.ok(ui.text().includes('CANARY_TEAM'));denied=true;await ui.render(Teams,{...props,revision:1});
 assert.ok(!ui.text().includes('CANARY_'));assert.ok(ui.text().includes('Denied 423'));
});
