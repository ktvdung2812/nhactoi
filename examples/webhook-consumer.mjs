import {verifyWebhook} from '../server/webhook-transport.mjs';

// Call with the original bytes, before JSON parsing. Persist processed event IDs
// and your business mutation in the same transaction. The callback must return
// false for an already processed ID and true only after a new commit.
export async function consumeWebhook({rawBody,signature,secrets,now=Date.now(),commitOnce}){
 if(!verifyWebhook(rawBody,signature,secrets,{now}))return {status:401};
 let event;try{event=JSON.parse(rawBody);}catch{return {status:400};}
 if(event.schemaVersion!==1||typeof event.eventId!=='string'||typeof event.eventType!=='string'||event.resource?.type!=='task')return {status:400};
 await commitOnce(event.eventId,event);return {status:204};
}
