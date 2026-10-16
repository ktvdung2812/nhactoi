// Supply the URL/token through your secret manager. Never log authorization.
export async function createTask({baseUrl,token,projectId,title,operationId}){
 const response=await fetch(new URL('/api/v1/tasks',baseUrl),{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json','Idempotency-Key':operationId},body:JSON.stringify({projectId,title})});
 const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error?.message||'API request failed'),{status:response.status,code:result.error?.code});return result;
}
export async function* tasks({baseUrl,token,projectId}){
 let cursor=null;do{const url=new URL('/api/v1/tasks',baseUrl);url.searchParams.set('limit','50');if(projectId)url.searchParams.set('projectId',projectId);if(cursor)url.searchParams.set('cursor',cursor);
  const response=await fetch(url,{headers:{authorization:'Bearer '+token}}),result=await response.json();if(!response.ok)throw new Error(result.error?.message||'API request failed');yield*result.data;cursor=result.nextCursor;
 }while(cursor);
}
