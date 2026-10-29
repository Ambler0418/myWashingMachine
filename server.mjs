import http from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('.',import.meta.url));
const data=process.env.DATA_DIR||root+'data';
mkdirSync(data,{recursive:true});
const file=data+'/state.json';
let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{users:{},machines:Array.from({length:4},(_,i)=>({id:i+1,owner:null,end:0}))};
state.settings??={washSeconds:Number(process.env.WASH_SECONDS||60)};
if(!Number.isInteger(state.settings.washSeconds)||state.settings.washSeconds<1||state.settings.washSeconds>86400)state.settings.washSeconds=60;
const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(state));renameSync(file+'.tmp',file);};
const adminPassword=process.env.ADMIN_PASSWORD;
const adminSessions=new Map();
let failedLogins=0,blockedUntil=0;
const hash=value=>createHash('sha256').update(value).digest();
const adminToken=req=>req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('laundry_admin='))?.slice(14);
const isAdmin=req=>{const token=adminToken(req),expires=adminSessions.get(token);if(expires>Date.now())return true;adminSessions.delete(token);return false;};
const cookie=(token,age)=>`laundry_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${age}${process.env.RENDER?'; Secure':''}`;
const snapshot=()=>state.machines.map(m=>({id:m.id,name:m.owner?state.users[m.owner]:null,status:!m.owner?'available':Date.now()<m.end?'washing':'collection',end:m.end}));
const server=http.createServer(async(req,res)=>{
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
 try{
  if(req.method==='GET'&&req.url==='/api/machines')return send(200,{machines:snapshot(),now:Date.now(),washSeconds:state.settings.washSeconds});
  if(req.method==='GET'&&req.url==='/api/admin/state'){
   if(!isAdmin(req))return send(401,{error:'관리자 로그인이 필요합니다.'});
   return send(200,{machines:snapshot(),settings:state.settings,now:Date.now()});
  }
  if(req.method==='POST'){
   let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{error:'요청이 너무 큽니다.'});}
   let body;try{body=JSON.parse(raw);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return send(400,{error:'잘못된 요청입니다.'});}
   if(req.url.startsWith('/api/admin/')){
    if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON 요청이 필요합니다.'});
    if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return send(403,{error:'잘못된 요청 출처입니다.'});}if(origin.host!==req.headers.host)return send(403,{error:'잘못된 요청 출처입니다.'});}
    if(req.url==='/api/admin/login'){
     if(!adminPassword)return send(503,{error:'서버에 ADMIN_PASSWORD를 설정해 주세요.'});
     if(Date.now()<blockedUntil)return send(429,{error:'잠시 후 다시 시도해 주세요. (최대 1분)'});
     if(typeof body.password!=='string'||!timingSafeEqual(hash(body.password),hash(adminPassword))){if(++failedLogins>=5){blockedUntil=Date.now()+60000;failedLogins=0;}return send(401,{error:'비밀번호가 올바르지 않습니다.'});}
     failedLogins=0;
     for(const [key,expiry] of adminSessions)if(expiry<=Date.now())adminSessions.delete(key);
     const old=adminToken(req);adminSessions.delete(old);
     const session=randomUUID();adminSessions.set(session,Date.now()+8*60*60*1000);
     res.setHeader('Set-Cookie',cookie(session,8*60*60));return send(200,{ok:true});
    }
    if(!isAdmin(req))return send(401,{error:'관리자 로그인이 필요합니다.'});
    if(req.url==='/api/admin/logout'){adminSessions.delete(adminToken(req));res.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});}
    if(req.url==='/api/admin/settings'){
     if(!Number.isInteger(body.washSeconds)||body.washSeconds<1||body.washSeconds>86400)return send(400,{error:'세탁 시간은 1~86400초의 정수로 입력해 주세요.'});
     state.settings.washSeconds=body.washSeconds;save();return send(200,{ok:true});
    }
    const evict=req.url.match(/^\/api\/admin\/machines\/([1-4])\/evict$/);
    if(evict){const m=state.machines[Number(evict[1])-1];m.owner=null;m.end=0;save();return send(200,{ok:true});}
    return send(404,{error:'찾을 수 없습니다.'});
   }
   if(req.url==='/api/login'){
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!name||name.length>20)return send(400,{error:'이름은 1~20자로 입력해 주세요.'});
    const token=randomUUID();state.users[token]=name;save();return send(200,{token,name});
   }
   const token=req.headers.authorization?.replace('Bearer ','');
   if(!state.users[token])return send(401,{error:'이름을 다시 입력해 주세요.'});
   if(req.url==='/api/me')return send(200,{name:state.users[token],owned:state.machines.filter(m=>m.owner===token).map(m=>m.id)});
   const match=req.url.match(/^\/api\/machines\/([1-4])\/(start|collect)$/);
   if(!match)return send(404,{error:'찾을 수 없습니다.'});
   const m=state.machines[Number(match[1])-1];
   if(match[2]==='start'){
    if(m.owner)return send(409,{error:'이미 사용 중인 세탁기입니다.'});
    m.owner=token;m.end=Date.now()+state.settings.washSeconds*1000;
   }else{
    if(m.owner!==token)return send(403,{error:'사용을 시작한 사람만 회수할 수 있습니다.'});
    if(Date.now()<m.end)return send(409,{error:'아직 세탁 중입니다.'});
    m.owner=null;m.end=0;
   }
   save();return send(200,{ok:true});
  }
  const paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/admin':'admin.html','/admin/':'admin.html','/admin.js':'admin.js'};
  if(req.method!=='GET'||!paths[req.url])return send(404,{error:'찾을 수 없습니다.'});
  res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript':req.url.endsWith('.css')?'text/css':'text/html; charset=utf-8'});res.end(readFileSync(root+'public/'+paths[req.url]));
 }catch(e){console.error(e);send(500,{error:'서버 오류가 발생했습니다.'});}
});
const port=Number(process.env.PORT||3000);
server.on('error',error=>{
 if(error.code==='EADDRINUSE'){
  console.error(`${port}번 포트를 이미 사용 중입니다. 실행 중인 세탁실이라면 http://localhost:${port} 에 접속하세요. 다시 시작하려면 기존 서버의 터미널에서 Ctrl+C를 누른 후 npm start를 실행하세요.`);
 }else console.error('서버를 시작하지 못했습니다:',error.message);
 process.exitCode=1;
});
server.listen(port,'0.0.0.0',()=>console.log('세탁실: http://localhost:'+port));
