import {createApp} from '../../server/index.mjs';
import {openDatabase} from '../../server/db.mjs';
const [schema,dbPath,applicationName]=process.argv.slice(2),url=new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('application_name',applicationName);
const db=openDatabase(url.toString(),{schema,migrate:false}),app=createApp({db,dbPath,clock:()=>new Date('2026-10-16T03:00:00Z'),env:{NODE_ENV:'test'},zaloOaTransport:{mode:'simulation',validateDelivery:async()=>{},send:async(_,payload,{requestId})=>{process.send({sent:requestId});return {messageId:'provider_'+requestId};}}});
const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('message',message=>{if(message==='close')server.close(()=>{app.locals.close();process.exit(0);});});
