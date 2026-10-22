// Durable state is stored in SQLCipher; no token or encryption key belongs here.
export type Payload = Record<string, unknown>;
export type Operation = {
  id: string; resource: string; path: string; method: string; body: Payload;
  localId?: string; predecessor?: string; createdAt: number;
  status: 'pending'|'sending'|'conflict'|'blocked';
  wire?: { path: string; body: Payload }; error?: string;
  server?: Payload; currentRevision?: string; snapshot?: Payload;
};
export type OfflineState = {
  operations: Operation[]; drafts: Record<string, Payload>;
  ids: Record<string, string>; results: Record<string, Payload>; denied?: Record<string,boolean>;
};
export const emptyOfflineState = (): OfflineState => ({ operations: [], drafts: {}, ids: {}, results: {} });
export function queueable(path: string, method: string) {
  if (method === 'POST' && path === '/tasks') return true;
  if (method === 'PATCH' && /^\/tasks\/[^/]+(?:\/plan)?$/.test(path)) return true;
  if (method === 'PUT' && /^\/tasks\/[^/]+\/extras$/.test(path)) return true;
  return ['POST','PATCH'].includes(method) && /^\/tasks\/[^/]+\/checklists(?:\/[^/]+(?:\/items(?:\/[^/]+)?)?)?$/.test(path);
}
export function enqueue(state: OfflineState, input: { id: string; path: string; method: string; body: Payload }, now = Date.now()) {
  if (!queueable(input.path,input.method)) throw new Error('Thao tác này cần kết nối mạng.');
  const body = JSON.parse(JSON.stringify(input.body));
  const taskId = input.path.split('/')[2];
  const resource = input.path === '/tasks' ? `task:local:${input.id}` : `${input.path.endsWith('/plan') ? 'plan' : 'task'}:${taskId}`;
  if (state.operations.some(op => op.id === input.id) || state.results[input.id]) throw new Error('Operation đã tồn tại.');
  const predecessor = state.operations.filter(op => op.resource === resource).at(-1)?.id;
  const creates = input.method === 'POST' && (input.path === '/tasks' || /\/(checklists|items)$/.test(input.path));
  const operation: Operation = { ...input, body, resource, predecessor, createdAt: now, status: 'pending', ...(creates ? {localId:`local:${input.id}`} : {}) };
  state.operations.push(operation);
  return operation;
}
function mapped(state: OfflineState, value: unknown): unknown {
  if (typeof value === 'string') return state.ids[value] || value;
  if (Array.isArray(value)) return value.map(v=>mapped(state,v));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,mapped(state,v)]));
  return value;
}
export function claimNext(state: OfflineState): Operation | undefined {
  for (const op of state.operations) {
    if (!['pending','sending'].includes(op.status)) continue;
    if (state.operations.some(other => other.resource===op.resource && other.createdAt<=op.createdAt && other!==op && state.operations.indexOf(other)<state.operations.indexOf(op))) continue;
    const segments = op.path.split('/');
    if (segments.some(segment=>segment.startsWith('local:') && !state.ids[segment])) continue;
    if (!op.wire) {
      op.wire = {path:segments.map(segment=>state.ids[segment]||segment).join('/'), body:{...mapped(state,op.body) as Payload,operationId:op.id}};
    }
    op.status='sending';
    return JSON.parse(JSON.stringify(op));
  }
}
export function acknowledge(state: OfflineState, id: string, result: Payload) {
  const op=state.operations.find(o=>o.id===id); if(!op)return;
  const created = (result.task || result.checklist || result.item) as Payload | undefined;
  if(op.localId && typeof created?.id==='string')state.ids[op.localId]=created.id;
  const revision = (op.resource.startsWith('plan:') ? result.planRevision : result.taskRevision || (result.task as Payload|undefined)?.revision) as string|undefined;
  for(const next of state.operations.filter(o=>o.predecessor===id && !o.wire)) {
    if (revision) next.body.expectedRevision=revision;
    else { next.status='blocked'; next.error='Máy chủ chưa trả revision để gửi chỉnh sửa tiếp theo. Nháp được giữ lại.'; }
    delete next.predecessor;
  }
  state.operations=state.operations.filter(o=>o.id!==id);
  state.results[id]=result;
  for(const old of Object.keys(state.results).slice(0,-100))delete state.results[old];
}
export function rejectOperation(state: OfflineState, id: string, error: {status:number;message:string;payload?:Payload}) {
  const op=state.operations.find(o=>o.id===id);if(!op)return;
  op.error=error.message;
  if([401,403,404,423].includes(error.status)){state.denied||={};state.denied[op.path.split('/')[2]||'*']=true;delete op.server;}
  // Transport/5xx may mean committed. Never replace wire payload or operation ID.
  if(error.status===0 || error.status>=500 || error.status===429) {op.status='pending';return;}
  const details = (error.payload?.error && typeof error.payload.error==='object' ? error.payload.error : error.payload) as Payload|undefined;
  const nested = details?.details as Payload|undefined;
  const current = nested || details;
  op.currentRevision=typeof current?.currentRevision==='string' ? current.currentRevision : undefined;
  op.status=error.status===409 && op.currentRevision ? 'conflict' : 'blocked';
}
export function resolveOperation(state: OfflineState, id: string, choice: 'server'|'local', newId: string, server: Payload, revision: string|undefined, edited?:Payload) {
  const index=state.operations.findIndex(o=>o.id===id),op=state.operations[index];if(!op)throw new Error('Không tìm thấy bản nháp.');
  if(op.status==='sending' || (op.status==='pending' && op.wire))throw new Error('Cần đối soát thao tác đang gửi trước khi sửa.');
  if(choice==='server') {
    state.operations.splice(index,1);
    for(const child of state.operations.filter(o=>o.predecessor===id)) {child.status='blocked';child.error='Cần xem lại nháp sau khi chọn bản server.';delete child.predecessor;}
    return;
  }
  // Replace a rejected operation at its original queue position. Descendant IDs
  // and drafts keep their dependency, including a temporary task being corrected.
  const replacement:Operation={...op,id:newId,path:op.wire?.path||op.path,body:{...(edited||op.body),expectedRevision:revision},status:'pending',server};
  delete replacement.wire;delete replacement.error;delete replacement.currentRevision;
  state.operations[index]=replacement;
  for(const child of state.operations.filter(o=>o.predecessor===id))child.predecessor=newId;
  return replacement;
}

// Project unconfirmed local changes on top of the disposable server cache.
export function projectOffline(state: OfflineState, path: string, value: unknown, userId: string): unknown {
  state={...state,operations:state.operations.filter(op=>op.status!=='blocked'&&!state.denied?.[op.path.split('/')[2]]&&!state.denied?.['*'])};
  const data = value ? JSON.parse(JSON.stringify(value)) : {};
  const taskId=path.split('/')[2];
  const localTask = (op: Operation) => ({id:op.localId,description:'',status:'todo',priority:'medium',dueAt:null,remindAt:null,recurrence:'none',teamId:null,assigneeId:userId,...op.body,pending:true});
  const applies = (op:Operation,id:string) => op.path.split('/')[2]===id || state.ids[op.path.split('/')[2]]===id;
  const basePath=path.split('?')[0],personal=basePath==='/personal-tasks';
  const listPath = personal || basePath==='/tasks';
  if(listPath) {
    data.tasks ||= [];
    for(const op of state.operations) if(op.path==='/tasks' && op.localId) {
      if(personal && op.body.assigneeId && op.body.assigneeId!==userId)continue;
      data.tasks.push(localTask(op));
    }
    // A queued personal plan can move across date windows without losing its
    // encrypted local task while the target page has never been cached.
    if(personal)for(const op of state.operations)if(op.resource.startsWith('plan:')&&op.snapshot&&!data.tasks.some((task:Payload)=>task.id===op.snapshot?.id))data.tasks.push({...op.snapshot});
    data.tasks=data.tasks.map((task:Payload)=>{
      for(const op of state.operations)if(applies(op,task.id as string) && (op.method==='PATCH') && /^\/tasks\/[^/]+(?:\/plan)?$/.test(op.path))task={...task,...op.body,pending:true};
      return task;
    });
  }
  if(taskId && /^\/tasks\/[^/]+(?:\/detail)?$/.test(path)) {
    const create=state.operations.find(op=>op.localId===taskId && op.path==='/tasks');
    if(create)Object.assign(data,{task:localTask(create),canWrite:true,checklists:[],comments:[],attachments:[],activity:[]});
    if(data.task)for(const op of state.operations.filter(op=>applies(op,taskId))) {
      data.task.pending=true;
      if(op.path===`/tasks/${taskId}` && op.method==='PATCH')Object.assign(data.task,op.body);
      const parts=op.path.split('/');
      if(parts[3]==='checklists') {
        data.checklists ||= [];
        if(op.method==='POST' && parts.length===4)data.checklists.push({id:op.localId,title:op.body.title,items:[]});
        const list=data.checklists.find((l:Payload)=>l.id===parts[4] || l.id===state.ids[parts[4]]);
        if(list && parts.length===5 && op.method==='PATCH')Object.assign(list,op.body);
        if(list && parts.length===6 && op.method==='POST')list.items.push({id:op.localId,completed:false,...op.body});
        if(list && parts.length===7) {const item=list.items.find((i:Payload)=>i.id===parts[6]||i.id===state.ids[parts[6]]);if(item)Object.assign(item,op.body);}
      }
    }
  }
  if(taskId && path.endsWith('/extras'))for(const op of state.operations.filter(op=>applies(op,taskId)&&op.path.endsWith('/extras')))Object.assign(data,op.body);
  return data;
}
