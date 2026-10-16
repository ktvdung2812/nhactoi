// Separate network client; credentials arrive only over IPC and are never logged.
import {performance} from 'node:perf_hooks';
import {appendFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
let settings,running=false,journal,pending=[],inFlight=null,controller;
const send=message=>{if(process.connected)process.send(message,()=>{});};
const flush=()=>{if(journal&&pending.length){appendFileSync(journal,pending.map(row=>JSON.stringify(row)+'\n').join(''));pending=[];}};
const safeError=error=>({name:error?.name||'Error',code:error?.code||null,causeName:error?.cause?.name||null,causeCode:error?.cause?.code||null,
 message:String(error?.message||'').replaceAll(settings?.cookie||'never-a-cookie','[redacted]').slice(0,300),
 causeMessage:String(error?.cause?.message||'').replaceAll(settings?.cookie||'never-a-cookie','[redacted]').slice(0,300)});
function stop(reason){pending.push({kind:'stopped',reason,at:new Date().toISOString(),inFlight});flush();controller?.abort();process.exit(0);}
process.on('message',async message=>{
 if(message.kind==='configure'){settings=message;send({kind:'ready'});return;}
 if(message.kind!=='run')return;
 if(running){send({kind:'protocol-error',phase:message.phase,error:'Overlapping phases'});return;}
 running=true;
 const {base,cookie,index,requests,runId,journalDir}=settings;
 journal=join(journalDir,`${message.phase}-${index}.jsonl`);
 const startedAt=new Date().toISOString(),start=performance.now();let iteration=0,errors=0;
 writeFileSync(journal,JSON.stringify({kind:'start',runId,phase:message.phase,index,startedAt,durationMs:message.durationMs,transport:settings.transport||'default-keepalive'})+'\n');
 const progress=()=>{flush();send({kind:'progress',phase:message.phase,index,completed:iteration-(inFlight?1:0),errors,elapsedMs:performance.now()-start,inFlight});};
 const heartbeat=setInterval(()=>{pending.push({kind:'progress',at:new Date().toISOString(),elapsedMs:performance.now()-start,inFlight});progress();},1000);
 try{
  while(performance.now()-start<message.durationMs){
   const scenario=requests[iteration++%requests.length],at=performance.now();let status=0,bytes=0,error=null,headersMs=null,stage='headers';
   inFlight={name:scenario.name||scenario.path,iteration,startedAt:new Date().toISOString(),stage};controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(new DOMException('Request deadline exceeded','TimeoutError')),settings.requestTimeoutMs||30000);
   try{
    const response=await fetch(base+'/api'+scenario.path,{method:scenario.method||'GET',headers:{cookie,'content-type':'application/json',...(settings.transport==='connection-close'?{connection:'close'}:{})},
     ...(scenario.method==='PATCH'?{body:JSON.stringify({title:`Load client ${index} iteration ${iteration}`,operationId:`perf-${message.phase}-${index}-${iteration}`})}:{}),signal:controller.signal});
    headersMs=performance.now()-at;stage='body';inFlight.stage=stage;status=response.status;
    const text=await response.text();bytes=Buffer.byteLength(text);
    if(status!==200)error={name:'HttpError',message:`HTTP ${status}`};
    else {const body=JSON.parse(text);if(scenario.total!==undefined&&body.total!==scenario.total)error={name:'InvariantError',message:'unexpected total'};if(scenario.maxRecords!==undefined&&(!Array.isArray(body.tasks)||body.tasks.length>scenario.maxRecords))error={name:'InvariantError',message:'unbounded page'};if(scenario.absent&&text.includes(scenario.absent))error={name:'AclError',message:'ACL canary exposed'};}
   }catch(e){error={...safeError(e),stage};}
   finally{clearTimeout(timeout);controller=null;}
   if(error)errors++;
   pending.push({kind:'sample',name:scenario.name||scenario.path,ms:performance.now()-at,headersMs,status,bytes,error,write:scenario.method==='PATCH',iteration});inFlight=null;
   if(pending.length>=10)progress();
  }
  const result={kind:'result',phase:message.phase,index,elapsedMs:performance.now()-start,memory:process.memoryUsage(),sampleCount:iteration,errorCount:errors};
  pending.push({...result,kind:'complete',at:new Date().toISOString()});flush();send(result);
 }catch(error){pending.push({kind:'fatal',error:safeError(error),inFlight});flush();send({kind:'fatal',phase:message.phase,index,error:safeError(error)});}
 finally{clearInterval(heartbeat);running=false;inFlight=null;}
});
process.on('disconnect',()=>stop('IPC disconnected'));
process.on('SIGTERM',()=>stop('SIGTERM'));
