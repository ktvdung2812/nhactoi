import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {zaloOaTransport} from '../server/zalo-oa-transport.mjs';
const clock=()=>new Date('2026-10-16T03:00:00Z');
function fixture({sendEnabled=true}={}){
 const calls=[],credentials={token:'FAKE_TOKEN',appId:'APP_1',oaSecretKey:'FAKE_SECRET',internalTemplates:{}};
 const detail={templateId:'123',templateName:'Thông báo',status:'ENABLE',listParams:[{name:'content',require:true,type:'STRING',minLength:1,maxLength:100}],listButtons:[{type:1,title:'Xem',content:'https://example.test/task'}],templateTag:'CUSTOMER_CARE',previewUrl:'https://account.zalo.solutions/template'};
 let override=null;
 const fetchImpl=async(url,init)=>{calls.push({url,init});if(override)return override(url,init);let body;if(url.endsWith('/getoa'))body={data:{oaid:'OA_1',oa_type:2,is_verified:true}};else if(url.includes('/template/all'))body={data:[{templateId:'123'}],metadata:{total:1}};else if(url.includes('/template/info/v2'))body={data:detail};else if(url.includes('/message/status'))body={data:{status:1}};else if(url.includes('/v3.0/'))body={data:{message_id:'uid_message'}};else body={data:{msg_id:'phone_message'}};return new Response(JSON.stringify({error:0,...body}),{status:200});};
 const transport=zaloOaTransport({clock,fetchImpl,sendEnabled,credentialsForOa:id=>id==='OA_1'?credentials:null});return {transport,credentials,calls,detail,setResponse:fn=>override=fn};
}
test('W8 live adapter emits verified ZBS phone and OA UID contracts, no invented idempotency guarantee',async()=>{
 const {transport:p,credentials:c,calls}=fixture();assert.equal((await p.authorize({oaId:'OA_1',token:c.token})).oaId,'OA_1');
 const [t]=await p.templates(c,'OA_1');assert.equal(t.status,'approved');assert.equal(t.purpose,'customer_care');
 const payload={oaId:'OA_1',recipient:'phone:84912345678',templateId:t.id,version:t.version,purpose:t.purpose,parameters:{content:'Upcoming renewal'},cta:t.cta};
 await p.validateDelivery(c,payload);assert.deepEqual(await p.send(c,payload,{requestId:'delivery_1'}),{messageId:'phone_message'});
 const phone=calls.at(-1);assert.equal(phone.url,'https://business.openapi.zalo.me/message/template');assert.equal(phone.init.headers.access_token,'FAKE_TOKEN');assert.equal(phone.init.redirect,'error');assert.deepEqual(JSON.parse(phone.init.body),{phone:'84912345678',template_id:'123',template_data:payload.parameters,tracking_id:'delivery_1',sending_mode:'1'});
 assert.deepEqual(await p.send(c,{...payload,recipient:'uid:123456789'},{requestId:'delivery_2'}),{messageId:'uid_message'});assert.equal(calls.at(-1).url,'https://openapi.zalo.me/v3.0/oa/message/template');assert.equal(JSON.parse(calls.at(-1).init.body).tracking_id,undefined);
 const count=calls.length;assert.deepEqual(await p.lookup(c,{oaId:'OA_1',recipient:payload.recipient,messageId:null}),{unknown:true});assert.equal(calls.length,count+1);assert.equal(p.reliableNegativeLookup,false);
 assert.deepEqual(await p.lookup(c,{oaId:'OA_1',recipient:payload.recipient,messageId:'phone_message'}),{status:'delivered',messageId:'phone_message'});
});
test('W8 live adapter requires business evidence and blocks changed/unsupported template definitions and live gate',async()=>{
 const {transport:p,credentials:c,detail,calls}=fixture({sendEnabled:false});assert.equal(p.canSend,false);
 await assert.rejects(()=>p.recipient(c,{oaId:'OA_1',recipient:'84912345678'}));
 await assert.rejects(()=>p.recipient(c,{oaId:'OA_1',recipient:'phone:84912345678'}));
 const proof=await p.recipient(c,{oaId:'OA_1',recipient:'phone:84912345678',evidence:{purposes:['customer_care'],evidenceId:'relation-record',expiresAt:'2026-11-01T00:00:00Z',relationship:'Current subscriber',consent:true}});assert.equal(proof.providerCheck,'send-time');
 const [t]=await p.templates(c,'OA_1');c.internalTemplates[t.id]={version:t.version,evidenceId:'reviewed-provider-preview',internalLabelPresent:true};assert.equal((await p.templates(c,'OA_1'))[0].purpose,'internal');
 detail.listParams[0].maxLength=200;assert.equal((await p.templates(c,'OA_1'))[0].purpose,'customer_care');
 detail.listButtons.push({type:2,title:'Call',content:'0123456789'});assert.equal((await p.templates(c,'OA_1'))[0].status,'inactive');
 const count=calls.length;await assert.rejects(()=>p.send(c,{},{requestId:'x'}),e=>e.status===403);assert.equal(calls.length,count);
});
test('W8 verified phone callback authenticates exact raw bytes, OA/app/recipient/time and never claims read',async()=>{
 const {transport:p,credentials:c}=fixture();const b={sender:{id:'OA_1'},recipient:{id:'84912345678'},event_name:'user_received_message',message:{delivery_time:String(+clock()-1000),msg_id:'message',tracking_id:'delivery'},app_id:'APP_1',timestamp:String(+clock())};
 const rawBody=Buffer.from(JSON.stringify(b)),signature=createHash('sha256').update(c.appId+rawBody.toString()+b.timestamp+c.oaSecretKey).digest('hex'),headers={'x-zevent-server':'ZNS','x-zevent-signature':'mac='+signature};
 const event=await p.verifyCallback({headers,rawBody});assert.equal(event.status,'delivered');assert.equal(event.requestId,'delivery');assert.equal(event.recipient,'phone:84912345678');
 assert.equal(await p.verifyCallback({headers,rawBody:Buffer.from(rawBody.toString()+' ')}),null);
 assert.equal(await p.verifyCallback({headers:{...headers,'x-zevent-server':'OA'},rawBody}),null);
 b.app_id='OTHER_APP';assert.equal(await p.verifyCallback({headers,rawBody:Buffer.from(JSON.stringify(b))}),null);
});
test('W8 HTTP timeout and 5xx keep ambiguity while explicit quota rejection has safe retry information',async()=>{
 const {transport:p,credentials:c,setResponse}=fixture();const payload={recipient:'phone:84912345678',templateId:'123',parameters:{content:'x'}};
 setResponse(async()=>{throw new Error('FAKE_TOKEN secret details');});await assert.rejects(()=>p.send(c,payload,{requestId:'x'}),e=>e.ambiguous===true&&!e.message.includes('FAKE_TOKEN'));
 setResponse(async()=>new Response('{}',{status:503}));await assert.rejects(()=>p.send(c,payload,{requestId:'x'}),e=>e.ambiguous===true);
 setResponse(async()=>new Response(JSON.stringify({error:-144,message:'quota'}),{status:200,headers:{'retry-after':'60'}}));await assert.rejects(()=>p.send(c,payload,{requestId:'x'}),e=>e.status===429&&e.definitivelyNotAccepted===true&&e.retryAfterSeconds===60);
});
test('W8 documented UID received/read callbacks support multiple message IDs with recipient binding',async()=>{
 const {transport:p,credentials:c}=fixture();const b={sender:{id:'OA_1'},recipient:{id:'123456789'},app_id:'APP_1',event_name:'user_seen_message',message:{msg_ids:['one','two']},timestamp:String(+clock())};
 const rawBody=Buffer.from(JSON.stringify(b)),headers={'x-zevent-signature':createHash('sha256').update(c.appId+rawBody.toString()+b.timestamp+c.oaSecretKey).digest('hex')};
 const events=await p.verifyCallback({headers,rawBody});assert.equal(events.length,2);assert.deepEqual(events.map(e=>[e.messageId,e.status,e.recipient]),[['one','read','uid:123456789'],['two','read','uid:123456789']]);
 assert.equal(await p.verifyCallback({headers:{...headers,'x-zevent-server':'ZNS'},rawBody}),null);
});
