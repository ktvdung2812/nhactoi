import { BlockList, isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import https from 'node:https';
import { createHmac, timingSafeEqual } from 'node:crypto';

const denied4=new BlockList();
for(const [address,prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]])denied4.addSubnet(address,prefix,'ipv4');
const public6=new BlockList();public6.addSubnet('2000::',3,'ipv6');
const denied6=new BlockList();for(const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]])denied6.addSubnet(address,prefix,'ipv6');
export function isPublicWebhookAddress(address){const family=isIP(address);return family===4?!denied4.check(address,'ipv4'):family===6&&public6.check(address,'ipv6')&&!denied6.check(address,'ipv6');}
export async function resolveWebhookDestination(value,lookupImpl=lookup){
  let url;try{url=new URL(value);}catch{throw new Error('Webhook cần URL HTTPS công khai.');}
  if(url.protocol!=='https:'||url.username||url.password||url.hash||url.href.length>2048||(url.port&&url.port!=='443'))throw new Error('Webhook cần HTTPS cổng 443, không có thông tin đăng nhập hoặc fragment.');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(hostname==='localhost'||hostname.endsWith('.localhost')||hostname.endsWith('.local'))throw new Error('Webhook không được trỏ vào mạng nội bộ.');
  const records=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookupImpl(hostname,{all:true,verbatim:true});
  if(!records.length||records.length>16||records.some(r=>!isPublicWebhookAddress(r.address)))throw new Error('Đích webhook không phải địa chỉ public hợp lệ.');
  return {url,records};
}
export function signWebhook(secret,keyId,timestamp,body){return `t=${timestamp},kid=${keyId},v1=${createHmac('sha256',secret).update(String(timestamp)+'.').update(body).digest('hex')}`;}
export function verifyWebhook(body,header,secrets,{now=Date.now(),toleranceSeconds=300}={}){
  if(!Buffer.isBuffer(body)||typeof header!=='string')return false;
  const match=/^t=(\d{1,12}),kid=(\d{1,8}),v1=([a-f0-9]{64})$/.exec(header);if(!match)return false;
  const [,timestamp,keyId,signature]=match,secret=secrets[keyId];
  if(!secret||Math.abs(Math.floor(now/1000)-Number(timestamp))>toleranceSeconds)return false;
  const expected=createHmac('sha256',secret).update(timestamp+'.').update(body).digest();
  return timingSafeEqual(expected,Buffer.from(signature,'hex'));
}
export async function sendWebhook({url,records},body,headers){
  const selected=records[0];
  return new Promise((resolve,reject)=>{
    // Pin the validated result to this socket. Never perform a second DNS
    // lookup or follow redirects after sending the signed payload.
    const req=https.request(url,{method:'POST',headers:{...headers,'content-type':'application/json','content-length':body.length},agent:false,
      lookup:(_host,options,callback)=>options.all?callback(null,[selected]):callback(null,selected.address,selected.family),timeout:8000},res=>{
      let size=0;res.on('data',chunk=>{size+=chunk.length;if(size>65536)res.destroy();});
      res.on('error',()=>{});res.resume();
      resolve({status:res.statusCode,retryAfter:res.headers['retry-after']||null});
    });
    req.on('timeout',()=>req.destroy(new Error('Webhook request timed out')));req.on('error',reject);req.end(body);
  });
}
