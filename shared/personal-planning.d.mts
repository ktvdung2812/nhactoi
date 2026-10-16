export function planningDay(now?:Date|string):string;
export function parseQuickTask(input:string,now?:Date|string):{title:string;dueAt:string|null;recognized:boolean;error:string};
export function personalTaskGroups<T extends {title:string;status:string;teamArchived?:boolean;dueAt:string|null;plannedDate?:string|null}>(tasks:T[],view:string,now?:Date|string):{label:string;tasks:T[]}[];
