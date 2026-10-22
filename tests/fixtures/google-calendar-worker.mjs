import {createApp} from '../../server/index.mjs';
import {openDatabase} from '../../server/db.mjs';
const [schema,dbPath,applicationName]=process.argv.slice(2),url=new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('application_name',applicationName);
let release;
const barrier=new Promise(resolve=>{release=resolve;});
const db=openDatabase(url.toString(),{schema,migrate:false});
const app=createApp({db,dbPath,clock:()=>new Date('2026-10-16T03:00:00Z'),env:{NODE_ENV:'test'},googleCalendarTransport:{
  async listEvents(){process.send({entered:true});await barrier;return {items:[],nextSyncToken:'worker-sync'};},
  async getEvent(){throw {status:404};},
  async createEvent(_tokens,_calendar,event){process.send({created:event.id});return {...event,etag:'worker-etag'};},
  async watch(_tokens,_calendar,channel){return {id:channel.id,resourceId:'worker-resource',expiration:String(Date.parse('2030-01-01T00:00:00Z'))};},
}});
const server=app.listen(0,'127.0.0.1',()=>process.send({port:server.address().port}));
process.on('message',message=>{
  if(message==='release-provider')release();
  if(message==='close'){release();server.close(()=>{app.locals.close();process.exit(0);});}
});
