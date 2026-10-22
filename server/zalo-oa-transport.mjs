import {createHash,timingSafeEqual} from 'node:crypto';
const digest=value=>createHash('sha256').update(value).digest('hex');
const problem=(status,message,extra={})=>Object.assign(new Error(message),{status,...extra});
const tags={TRANSACTION:'transactional',IN_TRANSACTION:'transactional',CUSTOMER_CARE:'customer_care',PROMOTION:'promotional'};
const statuses={ENABLE:'approved',PENDING_REVIEW:'pending',REJECT:'rejected',DISABLE:'inactive',DELETE:'inactive'};
const recipient=value=>{const match=/^(phone|uid):(\d{5,22})$/.exec(value||'');if(!match||match[1]==='phone'&&!/^84\d{8,10}$/.test(match[2]))throw problem(400,'Recipient must use phone:84… or uid:…');return {kind:match[1],id:match[2]};};
// Verified 2026-10-16 against the official current ZBS/OA docs, captured in
// docs/product-spec/12-zalo-provider-contract.md. No custom API base URLs/redirects.
export function zaloOaTransport({fetchImpl=fetch,clock=()=>new Date(),credentialsForOa,sendEnabled=false}={}) {
 async function request(credentials,url,{body,send=false}={}) {
  let response;try{response=await fetchImpl(url,{method:body?'POST':'GET',headers:{access_token:credentials.token,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw problem(0,'Provider request outcome unknown',{ambiguous:send});}
  const retry=response.headers.get('retry-after');const retryAfterSeconds=retry?(Number.isFinite(Number(retry))?Number(retry):Math.max(0,(Date.parse(retry)-+new Date(clock()))/1000)):undefined;
  if(!response.ok)throw problem(response.status,'Provider HTTP error',{ambiguous:send&&response.status>=500,retryAfterSeconds});
  let result;try{const raw=await response.text();if(Buffer.byteLength(raw)>1024*1024)throw new Error();result=JSON.parse(raw);}catch{throw problem(0,'Invalid provider response',{ambiguous:send});}
  if(result.error!==0){const code=Number(result.error);if(code===-100)throw problem(503,'Provider outcome unknown',{ambiguous:send});throw problem([-103,-124].includes(code)?401:[-144,-147,-1471,-1472,-1441].includes(code)?429:400,'Provider rejected request',{providerCode:code,definitivelyNotAccepted:true,retryAfterSeconds});}
  return result;
 }
 async function identity(credentials,oaId) {
  const result=await request(credentials,'https://openapi.zalo.me/v2.0/oa/getoa');
  if(String(result.data?.oaid)!==String(oaId)||result.data?.oa_type!==2||result.data?.is_verified!==true)throw problem(403,'OA ownership/type/verification mismatch');return result.data;
 }
 async function template(credentials,id) {
  const result=await request(credentials,'https://business.openapi.zalo.me/template/info/v2?template_id='+encodeURIComponent(id)),t=result.data;
  if(!t||String(t.templateId)!==String(id)||!Array.isArray(t.listParams)||!Array.isArray(t.listButtons)||!tags[t.templateTag]||!statuses[t.status])throw problem(502,'Unrecognized template contract');
  const version=digest(JSON.stringify({id:String(t.templateId),params:t.listParams,buttons:t.listButtons,tag:t.templateTag}));
  const approvedInternal=credentials.internalTemplates?.[id];
  const purpose=approvedInternal?.version===version&&approvedInternal?.evidenceId&&approvedInternal?.internalLabelPresent===true?'internal':tags[t.templateTag];
  // Dynamic/multiple/non-URL CTA remains visible but cannot be sent until explicitly
  // supported in preview. Never silently drop provider-approved components.
  const buttons=t.listButtons,unsupported=buttons.length>1||buttons.some(b=>b.type!==1||typeof b.content!=='string'||!b.content.startsWith('https://')||/[<>]/.test(b.content))||t.listParams.some(p=>typeof p.name!=='string'||p.type!=='STRING');
  return {id:String(t.templateId),version,status:unsupported?'inactive':statuses[t.status],purpose,parameters:t.listParams.map(p=>p.name),parameterRules:t.listParams,cta:buttons[0]?.type===1&&buttons[0]?.content?.startsWith('https://')?buttons[0].content:null,label:t.templateName||String(id),providerTag:t.templateTag,providerPreviewUrl:t.previewUrl||null,unsupportedReason:unsupported?'Chưa hỗ trợ đầy đủ kiểu tham số/CTA của mẫu; chặn gửi để giữ đúng preview.':null};
 }
 const p={mode:'live',canSend:sendEnabled,reliableNegativeLookup:false,
  async authorize({oaId,token}){await identity({token},oaId);return {oaId,apiVersion:'ZBS Template Message / OA v2-v3 / template-info-v2',policyVersion:'official-docs-2026-10-16'};},
  async templates(credentials,oaId){await identity(credentials,oaId);const templates=[];for(let offset=0;offset<1000;offset+=100){const result=await request(credentials,`https://business.openapi.zalo.me/template/all?offset=${offset}&limit=100&filterPreset=1`);if(!Array.isArray(result.data))throw problem(502,'Invalid template list');for(const t of result.data)templates.push(await template(credentials,String(t.templateId)));if(result.data.length<100||offset+result.data.length>=result.metadata?.total)return templates;}throw problem(409,'Template catalog exceeds reviewed limit');},
  async recipient(credentials,{oaId,recipient:key,evidence}){
   recipient(key);await identity(credentials,oaId);
   if(!evidence||evidence.consent!==true||!Array.isArray(evidence.purposes)||!evidence.purposes.length||evidence.purposes.some(p=>!['internal','transactional','customer_care','promotional'].includes(p))||typeof evidence.evidenceId!=='string'||!evidence.evidenceId.trim()||evidence.evidenceId.length>500||!Number.isFinite(Date.parse(evidence.expiresAt))||Date.parse(evidence.expiresAt)<=+new Date(clock())||typeof evidence.relationship!=='string'||!evidence.relationship.trim())throw problem(400,'Business recipient eligibility evidence required');
   return {...evidence,providerCheck:'send-time',expiresAt:new Date(evidence.expiresAt).toISOString()};
  },
  async validateDelivery(credentials,payload){
   await identity(credentials,payload.oaId);recipient(payload.recipient);const t=await template(credentials,payload.templateId);
   if(t.status!=='approved'||t.version!==payload.version||t.purpose!==payload.purpose||t.cta!==payload.cta)throw problem(400,'Template changed or is no longer approved');
   for(const rule of t.parameterRules){const value=payload.parameters[rule.name];if(typeof value!=='string'||rule.require&&!value||Number.isInteger(rule.minLength)&&value.length<rule.minLength||Number.isInteger(rule.maxLength)&&value.length>rule.maxLength)throw problem(400,'Template parameter violates approved contract');}
  },
  async send(credentials,payload,{requestId}){
   if(!sendEnabled)throw problem(403,'Live sender release gate is disabled');
   const target=recipient(payload.recipient),phone=target.kind==='phone';
   const body={...(phone?{phone:target.id}:{user_id:target.id}),template_id:payload.templateId,template_data:payload.parameters,...(phone?{tracking_id:requestId,sending_mode:'1'}:{})};
   const result=await request(credentials,phone?'https://business.openapi.zalo.me/message/template':'https://openapi.zalo.me/v3.0/oa/message/template',{body,send:true});
   const messageId=phone?result.data?.msg_id:result.data?.message_id;if(typeof messageId!=='string'||!messageId)throw problem(0,'Missing provider message identity',{ambiguous:true});return {messageId};
  },
  async lookup(credentials,{oaId,messageId,recipient:key}){
   await identity(credentials,oaId);const target=recipient(key);if(!messageId||target.kind!=='phone')return {unknown:true};
   const result=await request(credentials,'https://business.openapi.zalo.me/message/status?message_id='+encodeURIComponent(messageId)+'&phone='+encodeURIComponent(target.id));
   if(result.data?.status===1)return {status:'delivered',messageId};if(result.data?.status===0)return {status:'accepted',messageId};return {unknown:true};
  },
  async verifyCallback({headers,rawBody}){
   if(!Buffer.isBuffer(rawBody)||rawBody.length>1024*1024)return null;
   let b;try{b=JSON.parse(rawBody.toString('utf8'));}catch{return null;}
   const phone=headers['x-zevent-server']==='ZNS',seen=b.event_name==='user_seen_message';
   if(!['user_received_message','user_seen_message'].includes(b.event_name)||typeof b.sender?.id!=='string'||typeof b.recipient?.id!=='string'||!/^\d{10,16}$/.test(String(b.timestamp))||phone&&seen||!phone&&(b.message?.tracking_id!==undefined||b.message?.delivery_time!==undefined))return null;
   const ids=seen?b.message?.msg_ids:[b.message?.msg_id];if(!Array.isArray(ids)||!ids.length||ids.length>100||ids.some(id=>typeof id!=='string'||!id||id.length>200))return null;
   const credentials=credentialsForOa?.(b.sender.id);if(!credentials||String(b.app_id)!==credentials.appId||!credentials.oaSecretKey)return null;
   const timestamp=Number(b.timestamp),at=+new Date(clock());if(timestamp>at+300000||timestamp<at-7*86400000)return null;
   const expected=digest(credentials.appId+rawBody.toString('utf8')+String(b.timestamp)+credentials.oaSecretKey),received=String(headers['x-zevent-signature']||'').replace(/^mac=/,'');
   if(!/^[a-f0-9]{64}$/i.test(received)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(received,'hex')))return null;
   const events=ids.map(messageId=>({oaId:b.sender.id,eventId:digest(JSON.stringify([b.sender.id,messageId,b.event_name,b.message.delivery_time||b.timestamp])),messageId,requestId:phone?b.message.tracking_id:undefined,status:seen?'read':'delivered',recipient:(phone?'phone:':'uid:')+b.recipient.id}));
   return events.length===1?events[0]:events;
  },
 };return p;
}
