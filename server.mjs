import http from 'node:http';
import {readFileSync,writeFileSync,existsSync,mkdirSync,renameSync} from 'node:fs';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('.',import.meta.url));
const data=process.env.DATA_DIR||root+'data';
mkdirSync(data,{recursive:true});
const file=data+'/state.json';
const makeMachines=()=>[
 ...Array.from({length:4},(_,i)=>({id:i+1,type:'washer',owner:null,end:0})),
 ...Array.from({length:4},(_,i)=>({id:i+5,type:'dryer',owner:null,end:0}))
];
let state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{users:{},machines:makeMachines(),lostItems:[]};
state.users??={};
state.machines??=makeMachines();
state.machines=state.machines.map((m,i)=>({...m,id:i+1,type:m.type||(i<4?'washer':'dryer')}));
for(const machine of makeMachines())if(!state.machines.some(m=>m.id===machine.id))state.machines.push(machine);
state.machines.sort((a,b)=>a.id-b.id);
state.lostItems??=[];
const WASH_SECONDS=10, COLLECTION_GRACE_MS=30*60*1000;
const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(state));renameSync(file+'.tmp',file);};
delete state.settings;save();
const adminPassword=process.env.ADMIN_PASSWORD;
const adminSessions=new Map();
let failedLogins=0,blockedUntil=0;
const hash=value=>createHash('sha256').update(value).digest();
const adminToken=req=>req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('laundry_admin='))?.slice(14);
const isAdmin=req=>{const token=adminToken(req),expires=adminSessions.get(token);if(expires>Date.now())return true;adminSessions.delete(token);return false;};
const cookie=(token,age)=>`laundry_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${age}${process.env.RENDER?'; Secure':''}`;
const moveExpiredItems=()=>{
 const now=Date.now();let changed=false;
 for(const machine of state.machines){
  if(machine.owner&&now>=machine.end+COLLECTION_GRACE_MS){
   state.lostItems.push({id:randomUUID(),owner:machine.owner,name:state.users[machine.owner]||'사용자',machineName:`${machine.type==='dryer'?'건조기':'세탁기'} ${machine.type==='dryer'?machine.id-4:machine.id}`,movedAt:now});
   machine.owner=null;machine.end=0;changed=true;
  }
 }
 if(changed)save();
};
const snapshot=()=>{moveExpiredItems();return state.machines.map(m=>({id:m.id,type:m.type,name:m.owner?state.users[m.owner]:null,status:!m.owner?'available':Date.now()<m.end?'washing':'collection',end:m.end}));};
const server=http.createServer(async(req,res)=>{
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
 try{
  if(req.method==='GET'&&req.url==='/api/machines')return send(200,{machines:snapshot(),now:Date.now(),washSeconds:WASH_SECONDS});
  if(req.method==='GET'&&req.url==='/api/admin/state'){
   if(!isAdmin(req))return send(401,{error:'관리자 로그인이 필요합니다.'});
   return send(200,{machines:snapshot(),lostCount:state.lostItems.length,now:Date.now()});
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
     failedLogins=0;for(const [key,expiry] of adminSessions)if(expiry<=Date.now())adminSessions.delete(key);
     const old=adminToken(req);adminSessions.delete(old);
     const session=randomUUID();adminSessions.set(session,Date.now()+8*60*60*1000);
     res.setHeader('Set-Cookie',cookie(session,8*60*60));return send(200,{ok:true});
    }
    if(!isAdmin(req))return send(401,{error:'관리자 로그인이 필요합니다.'});
    if(req.url==='/api/admin/logout'){adminSessions.delete(adminToken(req));res.setHeader('Set-Cookie',cookie('',0));return send(200,{ok:true});}
    const evict=req.url.match(/^\/api\/admin\/machines\/([1-8])\/evict$/);
    if(evict){const m=state.machines[Number(evict[1])-1];m.owner=null;m.end=0;save();return send(200,{ok:true});}
    return send(404,{error:'찾을 수 없습니다.'});
   }
   if(req.url==='/api/login'){
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!name||name.length>20)return send(400,{error:'이름을 1~20자로 입력해 주세요.'});
    const token=randomUUID();state.users[token]=name;save();return send(200,{token,name});
   }
   const token=req.headers.authorization?.replace('Bearer ','');
   if(!state.users[token])return send(401,{error:'이름을 다시 입력해 주세요.'});
   if(req.url==='/api/me')return send(200,{name:state.users[token],owned:state.machines.filter(m=>m.owner===token).map(m=>m.id),lostItems:state.lostItems.filter(item=>item.owner===token)});
   const lostMatch=req.url.match(/^\/api\/lost\/([\w-]+)\/collect$/);
   if(lostMatch){const item=state.lostItems.find(item=>item.id===lostMatch[1]);if(!item)return send(404,{error:'바구니에서 세탁물을 찾을 수 없습니다.'});if(item.owner!==token)return send(403,{error:'본인 세탁물만 회수할 수 있습니다.'});state.lostItems=state.lostItems.filter(entry=>entry.id!==item.id);save();return send(200,{ok:true});}
   const match=req.url.match(/^\/api\/machines\/([1-8])\/(start|collect)$/);
   if(!match)return send(404,{error:'찾을 수 없습니다.'});
   const m=state.machines[Number(match[1])-1];moveExpiredItems();
   if(match[2]==='start'){
    if(m.owner)return send(409,{error:'이미 사용 중인 기기입니다.'});
    m.owner=token;m.end=Date.now()+WASH_SECONDS*1000;
   }else{
    if(m.owner!==token)return send(403,{error:'사용자 본인만 세탁물을 회수할 수 있습니다.'});
    if(Date.now()<m.end)return send(409,{error:'기기가 작동 중입니다.'});
    m.owner=null;m.end=0;
   }
   save();return send(200,{ok:true});
  }
  const paths={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/admin':'admin.html','/admin/':'admin.html','/admin.js':'admin.js'};
  if(req.method!=='GET'||!paths[req.url])return send(404,{error:'찾을 수 없습니다.'});
  res.writeHead(200,{'Content-Type':req.url.endsWith('.js')?'text/javascript; charset=utf-8':req.url.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8'});res.end(readFileSync(root+'public/'+paths[req.url]));
 }catch(e){console.error(e);send(500,{error:'서버 오류가 발생했습니다.'});}
});
setInterval(moveExpiredItems,1000).unref();
const port=Number(process.env.PORT||3000);
server.on('error',error=>{if(error.code==='EADDRINUSE')console.error(`${port}번 포트가 이미 사용 중입니다.`);else console.error('서버를 시작하지 못했습니다:',error.message);process.exitCode=1;});
server.listen(port,'0.0.0.0',()=>console.log('세탁실: http://localhost:'+port));
