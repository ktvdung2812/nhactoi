import {openDatabase} from '../../server/db.mjs';
import {createApp} from '../../server/index.mjs';
const[schema,applicationName,barrier]=process.argv.slice(2),url=new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('application_name',applicationName);
const db=openDatabase(url.toString(),{schema,migrate:false});
const app=createApp({db,clock:()=>new Date('2026-10-16T09:00:00.000Z'),env:{NODE_ENV:'test',FRONTEND_ORIGIN:'http://localhost:5173'}});
process.on('message',message=>{
 if(message==='close'){app.locals.close();db.close();process.exit(0);}
 if(message==='run'){
  db.exec('BEGIN');db.prepare('SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext(?))').get(barrier);db.exec('COMMIT');
  process.send({type:'done',result:app.locals.processAutomations()});
 }
});
process.send({type:'ready'});
