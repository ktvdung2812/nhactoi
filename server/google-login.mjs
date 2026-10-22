import {OAuth2Client} from 'google-auth-library';
import {createHash,randomBytes} from 'node:crypto';
import {createId,hashPassword} from './auth.mjs';
import {createPersonalWorkspace} from './personal-workspace.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
export function registerGoogleRoutes(app,{db,config,clock,requirePlatformAdmin,requireAuth,HttpError,withTransaction,writeStoredSetting,loadStoredSettings,settingsKey,writeAdminAudit,createSession,setSessionCookie}){
 const settings=()=>{const s=loadStoredSettings(db,settingsKey).get('googleLogin');return s?JSON.parse(s):{enabled:false,clientId:'',clientSecret:''}};
 const callback=()=>new URL('/api/auth/google/callback',config.publicAppUrl).href;
 app.get('/api/auth/google/config',(req,res)=>{const s=settings();res.json({enabled:!!(s.enabled&&s.clientId&&s.clientSecret),linked:!!(req.auth&&db.prepare('SELECT 1 FROM google_identities WHERE user_id=?').get(req.auth.userId))})});
 app.get('/api/admin/google-login',requirePlatformAdmin,(req,res)=>{const s=settings();res.json({enabled:!!s.enabled,clientId:s.clientId||'',hasSecret:!!s.clientSecret,redirectUri:callback()})});
 app.put('/api/admin/google-login',requirePlatformAdmin,(req,res,next)=>{try{const b=req.body||{},old=settings();if(typeof b.enabled!=='boolean'||typeof b.clientId!=='string'||b.clientId.length>300||typeof b.reason!=='string'||b.reason.trim().length<3||b.reason.length>500||b.clientSecret!==undefined&&(typeof b.clientSecret!=='string'||b.clientSecret.length>1000))throw new HttpError(400,'Cấu hình Google hoặc lý do không hợp lệ');const value={enabled:b.enabled,clientId:b.clientId.trim(),clientSecret:b.clientSecret||old.clientSecret||''};if(value.enabled&&(!value.clientId||!value.clientSecret))throw new HttpError(400,'Cần Client ID và Client Secret trước khi bật');const at=new Date(clock()).toISOString();withTransaction(db,()=>{writeStoredSetting(db,'googleLogin',value,{encrypted:true,keyBytes:settingsKey,updatedAt:at});writeAdminAudit(db,{actorUserId:req.auth.userId,action:'google.configure',targetType:'settings',targetId:'googleLogin',reason:b.reason.trim(),before:{enabled:!!old.enabled},after:{enabled:value.enabled,clientId:value.clientId,secretChanged:!!b.clientSecret},createdAt:at})});res.json({ok:true})}catch(e){next(e)}});
 app.get('/api/auth/google/start',(req,res,next)=>{try{const s=settings();if(!s.enabled||!s.clientId||!s.clientSecret)throw new HttpError(503,'Đăng nhập Google chưa được cấu hình');const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(48).toString('base64url');db.prepare('DELETE FROM google_oauth_states WHERE expires_at<?').run(new Date(clock()).toISOString());db.prepare('INSERT INTO google_oauth_states(state_hash,nonce,verifier,user_id,expires_at) VALUES (?,?,?,?,?)').run(hash(state),nonce,verifier,req.auth?.userId||null,new Date(new Date(clock()).getTime()+600000).toISOString());res.setHeader('Set-Cookie',`nhactoi_google_state=${state}; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=600${config.cookieSecure?'; Secure':''}`);const client=new OAuth2Client(s.clientId,s.clientSecret,callback());res.redirect(client.generateAuthUrl({scope:['openid','email','profile'],state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',prompt:'select_account'}))}catch(e){next(e)}});
 app.get('/api/auth/google/callback', async (req, res, next) => {
  try {
   const state = String(req.query.state || '');
   const cookie = String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith('nhactoi_google_state='))?.slice(21);
   if (!state || state.length > 200 || cookie !== state) throw new HttpError(400, 'Phiên đăng nhập Google không hợp lệ');
   const row = db.prepare('SELECT * FROM google_oauth_states WHERE state_hash=? AND expires_at>?').get(hash(state), new Date(clock()).toISOString());
   db.prepare('DELETE FROM google_oauth_states WHERE state_hash=?').run(hash(state));
   if (!row || req.query.error || typeof req.query.code !== 'string') throw new HttpError(400, 'Đăng nhập bị hủy hoặc hết hạn');
   if (row.user_id && req.auth?.userId !== row.user_id) throw new HttpError(401, 'Hãy đăng nhập lại trước khi liên kết Google');
   const s = settings();
   if (!s.enabled) throw new HttpError(503, 'Đăng nhập Google đang tắt');
   const client = new OAuth2Client(s.clientId, s.clientSecret, callback());
   const { tokens } = await client.getToken({ code: req.query.code, codeVerifier: row.verifier, redirect_uri: callback() });
   const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: s.clientId });
   const p = ticket.getPayload();
   if (!p?.sub || !p.email_verified || p.nonce !== row.nonce) throw new HttpError(401, 'Không xác minh được tài khoản Google');
   const at = new Date(clock()).toISOString();
   const session = withTransaction(db, () => {
    let identity = db.prepare('SELECT user_id FROM google_identities WHERE sub=?').get(p.sub);
    let userId = row.user_id || identity?.user_id;
    if (userId) {
     // Serialize with password recovery, including session creation. A reset
     // during Google's network calls must invalidate the original authority.
     const account = db.prepare('SELECT disabled_at FROM users WHERE id=?' + (db.dialect === 'postgres' ? ' FOR UPDATE' : '')).get(userId);
     if (!account || account.disabled_at) throw new HttpError(403, 'Tài khoản đã bị khóa');
     identity = db.prepare('SELECT user_id FROM google_identities WHERE sub=?').get(p.sub);
     if (row.user_id) {
      if (!db.prepare('SELECT 1 FROM sessions WHERE id=? AND user_id=? AND expires_at>?').get(req.auth.sessionId, row.user_id, at))
       throw new HttpError(401, 'Hãy đăng nhập lại trước khi liên kết Google');
      if (identity && identity.user_id !== row.user_id) throw new HttpError(409, 'Google này đã liên kết với tài khoản khác');
      if (db.prepare('SELECT sub FROM google_identities WHERE user_id=? AND sub<>?').get(row.user_id, p.sub)) throw new HttpError(409, 'Tài khoản đã liên kết với Google khác');
     } else if (!identity || identity.user_id !== userId) {
      throw new HttpError(401, 'Liên kết Google đã bị thu hồi. Hãy đăng nhập bằng mật khẩu');
     }
    } else {
     const email = String(p.email).toLowerCase();
     if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) throw new HttpError(409, 'Email đã có tài khoản. Đăng nhập bằng mật khẩu rồi liên kết Google trong mục Tài khoản');
     userId = createId('user_');
     db.prepare('INSERT INTO users(id,name,email,password_hash,created_at) VALUES (?,?,?,?,?)').run(userId, String(p.name || email).slice(0,120), email, hashPassword(randomBytes(48).toString('hex')), at);
     // First-time Google sign-ups are personal accounts.
     createPersonalWorkspace(db, { userId, now: at, createId });
    }
    if (!identity) db.prepare('INSERT INTO google_identities(sub,user_id,created_at) VALUES (?,?,?)').run(p.sub, userId, at);
    const membership = db.prepare("SELECT workspace_id FROM workspace_members WHERE user_id=? ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END LIMIT 1").get(userId);
    if (!membership) throw new HttpError(403, 'Tài khoản không thuộc doanh nghiệp nào');
    return createSession(db, userId, membership.workspace_id, config, clock);
   });
   setSessionCookie(res, session.token, config);
   res.append('Set-Cookie', `nhactoi_google_state=; HttpOnly; SameSite=Lax; Path=/api/auth/google; Max-Age=0${config.cookieSecure?'; Secure':''}`);
   res.redirect(new URL('/dashboard', config.publicAppUrl).href);
  } catch (e) {
   if (e instanceof HttpError) return res.status(e.status).type('text/plain').send(e.message + ' · Quay lại Nhắc tôi để thử lại.');
   next(new HttpError(502, 'Không thể kết nối Google. Hãy thử lại sau.'));
  }
 });
}
