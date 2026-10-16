import { randomUUID } from 'node:crypto';
import { withTransaction } from './db.mjs';

export const DELIVERY_LEASE_COLUMNS = ['channel','notification_id','target_id','workspace_id','status','lease_token','lease_until','attempts','provider_reference','last_error','updated_at'];
const leaseMs = 60_000;
const identity = claim => [claim.channel, claim.notificationId, claim.targetId];

// Claimed work is safe to retry after a crash. Once the transport may have
// received a request, an expired lease is ambiguous and must not resend blindly.
export function claimDelivery(db, channel, notificationId, targetId, now) {
 const claim = {channel,notificationId,targetId,token:randomUUID()};
 if(db.dialect!=='postgres')return claim; // SQLite is an import/legacy-test path only.
 return withTransaction(db,()=>{
  const expired=db.prepare(`UPDATE delivery_leases SET status='unknown',last_error='delivery outcome unknown',updated_at=?
   WHERE channel=? AND notification_id=? AND target_id=? AND status='sending' AND lease_until<=? RETURNING lease_token`).get(now,...identity(claim),now);
  if(expired)return {...claim,unknown:true};
  const eligible={
   email:()=>db.prepare("SELECT 1 FROM reminder_email_outbox e JOIN notifications n ON n.id=e.notification_id WHERE e.notification_id=? AND n.user_id=? AND e.status='pending' AND e.next_attempt_at<=?").get(notificationId,targetId,now),
   web_push:()=>db.prepare("SELECT 1 FROM web_push_deliveries WHERE notification_id=? AND subscription_id=? AND status='pending' AND next_attempt_at<=?").get(notificationId,targetId,now),
   fcm:()=>db.prepare("SELECT 1 FROM notification_outbox_deliveries d JOIN notification_outbox o ON o.id=d.outbox_id WHERE o.notification_id=? AND d.installation_id=? AND o.status='pending' AND d.status='pending' AND d.next_attempt_at<=?").get(notificationId,targetId,now),
  };
  if(!eligible[channel]?.())return null;
  const row=db.prepare(`INSERT INTO delivery_leases(channel,notification_id,target_id,workspace_id,status,lease_token,lease_until,updated_at)
   SELECT ?,n.id,?,n.workspace_id,'claimed',?,?,? FROM notifications n WHERE n.id=?
   ON CONFLICT(channel,notification_id,target_id) DO UPDATE SET status='claimed',lease_token=excluded.lease_token,
    lease_until=excluded.lease_until,updated_at=excluded.updated_at
   WHERE (delivery_leases.status='retry' AND delivery_leases.lease_until<=?) OR (delivery_leases.status='claimed' AND delivery_leases.lease_until<=?)
   RETURNING lease_token`).get(channel,targetId,claim.token,new Date(Date.parse(now)+leaseMs).toISOString(),now,notificationId,now,now);
  if(row)return claim;
  if(db.prepare('SELECT status FROM delivery_leases WHERE channel=? AND notification_id=? AND target_id=?').get(...identity(claim))?.status==='unknown')return {...claim,unknown:true};
  return null;
 });
}

export function beginDelivery(db,claim,now) {
 if(db.dialect!=='postgres')return true;
 return !!db.prepare(`UPDATE delivery_leases SET status='sending',attempts=attempts+1,updated_at=?
  WHERE channel=? AND notification_id=? AND target_id=? AND lease_token=? AND status='claimed' AND lease_until>?`)
  .run(now,...identity(claim),claim.token,now).changes;
}

export function settleDelivery(db,claim,status,now,write,{error=null,reference=null,nextAttemptAt=now}={}) {
 if(db.dialect!=='postgres'){write();return true;}
 return withTransaction(db,()=>{
  const changed=db.prepare(`UPDATE delivery_leases SET status=?,last_error=?,provider_reference=?,updated_at=?,lease_until=?
   WHERE channel=? AND notification_id=? AND target_id=? AND lease_token=? AND status IN ('claimed','sending','unknown')`)
   .run(status,error,typeof reference==='string'&&/^[\w@./:<>-]{1,250}$/.test(reference)?reference:null,now,nextAttemptAt,...identity(claim),claim.token).changes;
  if(changed)write();
  return !!changed;
 });
}

// Never persist provider error.message/body: either can contain tokens, recipient
// data or a full request. Transport adapters supply structured facts instead.
export function deliveryFailure(error,attempt,{now,maxAttempts=5,baseDelay=60_000}={}) {
 const http=Number(error?.statusCode||error?.status||0);
 const smtp=Number(error?.responseCode||0);
 const code=String(error?.code||error?.cause?.code||'');
 const ambiguous=error?.deliveryUnknown===true || (!http&&!smtp&&error?.requestNotSent!==true&&
  (['AbortError','TimeoutError'].includes(error?.name)||/TIMEOUT|TIMEDOUT|ECONNRESET|EPIPE|UND_ERR_SOCKET/.test(code)));
 const permanent=error?.permanent===true||(http>=400&&http<500&&![408,425,429].includes(http))||smtp>=500;
 const status=ambiguous?'unknown':permanent||attempt>=maxAttempts?'failed':'pending';
 const retryAfter=error?.retryAfterSeconds==null||error.retryAfterSeconds===''?NaN:Number(error.retryAfterSeconds);
 const delay=Number.isFinite(retryAfter)&&retryAfter>=0?Math.min(86400_000,retryAfter*1000):Math.min(3600_000,baseDelay*2**Math.min(attempt-1,10));
 return {status,error:ambiguous?'delivery outcome unknown':http?`HTTP ${http}`:smtp?`SMTP ${smtp}`:permanent?'delivery rejected':'transport failure',
  nextAttemptAt:new Date(Date.parse(now)+delay).toISOString()};
}
