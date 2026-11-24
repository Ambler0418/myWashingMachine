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
state.users=Object.fromEntries(Object.entries(state.users).map(([token,user])=>[token,typeof user==='string'?{studentId:'',name:user,selectedType:null,sessionStarted:false}:{...user,selectedType:user.selectedType||null,sessionStarted:Boolean(user.sessionStarted)}]));
state.machines??=makeMachines();
state.machines=state.machines.map((m,i)=>({...m,id:i+1,type:m.type||(i<4?'washer':'dryer'),assignedTo:m.assignedTo||null,assignmentExpiresAt:m.assignmentExpiresAt||0}));
for(const machine of makeMachines())if(!state.machines.some(m=>m.id===machine.id))state.machines.push(machine);
state.machines.sort((a,b)=>a.id-b.id);
state.lostItems??=[];
const WASH_SECONDS=10, COLLECTION_GRACE_MS=10*1000, ASSIGNMENT_TIMEOUT_MS=10*1000;
const save=()=>{writeFileSync(file+'.tmp',JSON.stringify(state));renameSync(file+'.tmp',file);};
const userInfo=token=>state.users[token]||null;
const userName=token=>userInfo(token)?.name||'사용자';
const clearExpiredAssignments=(now=Date.now())=>{
 let changed=false;
 for(const m of state.machines)if(m.assignedTo&&m.assignmentExpiresAt<=now){const user=state.users[m.assignedTo];if(user){user.selectedType=null;user.sessionStarted=false;}m.assignedTo=null;m.assignmentExpiresAt=0;changed=true;}
 return changed;
};
delete state.settings;clearExpiredAssignments();save();
const adminPassword=process.env.ADMIN_PASSWORD;
const adminSessions=new Map();
let failedLogins=0,blockedUntil=0;
const hash=value=>createHash('sha256').update(value).digest();
const adminToken=req=>req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('laundry_admin='))?.slice(14);
const isAdmin=req=>{const token=adminToken(req),expires=adminSessions.get(token);if(expires>Date.now())return true;adminSessions.delete(token);return false;};
const cookie=(token,age)=>`laundry_admin=${token}; HttpOnly; SameSite=Strict; Path=/api/admin; Max-Age=${age}${process.env.RENDER?'; Secure':''}`;
const snapshot=(token,hideOtherNames=true)=>state.machines.map(m=>{
 const owner=userInfo(m.owner),assignee=userInfo(m.assignedTo),now=Date.now();
 const status=m.owner?(now<m.end?'washing':'collection'):m.assignedTo?'assigned':'available';
 const person=m.owner?owner:assignee;
 return {id:m.id,type:m.type,name:!person?null:(!hideOtherNames||m.owner===token||m.assignedTo===token)?person.name:'다른 사용자',studentId:!person?null:(!hideOtherNames||m.owner===token||m.assignedTo===token)?person.studentId:'',status,end:m.end,assignedToMe:Boolean(m.assignedTo&&m.assignedTo===token),assignmentExpiresAt:m.assignmentExpiresAt||0,evictable:Boolean(m.owner&&now>=m.end+COLLECTION_GRACE_MS)};
});
const server=http.createServer(async(req,res)=>{
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(obj));};
 try{
  if(req.method==='GET'&&req.url==='/api/machines'){
   if(clearExpiredAssignments())save();
   return send(200,{machines:snapshot(req.headers.authorization?.replace('Bearer ','')),now:Date.now(),washSeconds:WASH_SECONDS,assignmentTimeoutSeconds:ASSIGNMENT_TIMEOUT_MS/1000});
  }
  if(req.method==='GET'&&req.url==='/api/admin/state'){
   if(!isAdmin(req))return send(401,{error:'관리자 로그인이 필요합니다.'});
   if(clearExpiredAssignments())save();
   return send(200,{machines:snapshot(null,false),lostCount:state.lostItems.length,now:Date.now()});
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
    if(evict){const m=state.machines[Number(evict[1])-1];const affected=state.users[m.owner||m.assignedTo];if(affected){affected.selectedType=null;affected.sessionStarted=false;}m.owner=null;m.end=0;m.assignedTo=null;m.assignmentExpiresAt=0;save();return send(200,{ok:true});}
    return send(404,{error:'찾을 수 없습니다.'});
   }
   if(req.url==='/api/login'){
    const studentId=typeof body.studentId==='string'?body.studentId.trim():'';
    const name=typeof body.name==='string'?body.name.trim():'';
    if(!studentId||studentId.length>20)return send(400,{error:'학번을 1~20자로 입력해 주세요.'});
    if(!name||name.length>20)return send(400,{error:'이름을 1~20자로 입력해 주세요.'});
    const existing=Object.entries(state.users).find(([,user])=>user.studentId===studentId&&user.name===name);
    const token=existing?.[0]||randomUUID();state.users[token]={...(existing?.[1]||{}),studentId,name,selectedType:existing?.[1].selectedType||null,sessionStarted:Boolean(existing?.[1].sessionStarted)};save();return send(200,{token,studentId,name});
   }
   const token=req.headers.authorization?.replace('Bearer ','');
   if(!state.users[token])return send(401,{error:'이름을 다시 입력해 주세요.'});
   if(clearExpiredAssignments())save();
   if(req.url==='/api/me')return send(200,{...userInfo(token),owned:state.machines.filter(m=>m.owner===token).map(m=>m.id),assignment:(()=>{const m=state.machines.find(m=>m.assignedTo===token);return m?{machineId:m.id,type:m.type,expiresAt:m.assignmentExpiresAt}:null;})(),lostItems:state.lostItems.map(item=>({id:item.id,machineId:item.machineId,machineName:item.machineName,movedAt:item.movedAt,canCollect:item.owner===token}))});
   if(req.url==='/api/logout'){
    if(!state.machines.some(m=>m.owner===token)){
     for(const m of state.machines)if(m.assignedTo===token){m.assignedTo=null;m.assignmentExpiresAt=0;}
     state.users[token].selectedType=null;state.users[token].sessionStarted=false;
    }
    save();return send(200,{ok:true});
   }
   if(req.url==='/api/new-assignment'){
    if(state.machines.some(m=>m.owner===token))return send(409,{error:'현재 기기의 세탁물을 회수한 뒤 새로 배정받을 수 있습니다.'});
    for(const m of state.machines)if(m.assignedTo===token){m.assignedTo=null;m.assignmentExpiresAt=0;}
    state.users[token].selectedType=null;state.users[token].sessionStarted=false;save();return send(200,{ok:true});
   }
   if(req.url==='/api/assign'){
    const type=body.type;
    if(type!=='washer'&&type!=='dryer')return send(400,{error:'세탁기 또는 건조기를 선택해 주세요.'});
    if(state.machines.some(m=>m.owner===token))return send(409,{error:'사용 중인 기기를 먼저 회수해 주세요.'});
    const target=state.machines.find(m=>m.type===type&&!m.owner&&(!m.assignedTo||m.assignedTo===token));
    if(!target)return send(409,{error:`배정 가능한 ${type==='washer'?'세탁기':'건조기'}가 없습니다.`});
    for(const m of state.machines)if(m.assignedTo===token&&m.id!==target.id){m.assignedTo=null;m.assignmentExpiresAt=0;}
    state.users[token].selectedType=type;state.users[token].sessionStarted=false;
    target.assignedTo=token;target.assignmentExpiresAt=Date.now()+ASSIGNMENT_TIMEOUT_MS;save();
    return send(200,{ok:true,assignment:{machineId:target.id,type:target.type,expiresAt:target.assignmentExpiresAt}});
   }
   const lostMatch=req.url.match(/^\/api\/lost\/([\w-]+)\/collect$/);
   if(lostMatch){const item=state.lostItems.find(item=>item.id===lostMatch[1]);if(!item)return send(404,{error:'바구니에서 세탁물을 찾을 수 없습니다.'});if(item.owner!==token)return send(403,{error:'본인 세탁물만 회수할 수 있습니다.'});state.lostItems=state.lostItems.filter(entry=>entry.id!==item.id);save();return send(200,{ok:true});}
   const match=req.url.match(/^\/api\/machines\/([1-8])\/(start|collect|evict)$/);
   if(!match)return send(404,{error:'찾을 수 없습니다.'});
   const m=state.machines[Number(match[1])-1];
   if(match[2]==='start'){
    if(m.owner)return send(409,{error:'이미 사용 중인 기기입니다.'});
    if(m.assignedTo&&m.assignedTo!==token)return send(409,{error:'다른 사용자에게 배정된 기기입니다.'});
    const user=state.users[token];
    if(!user.selectedType)return send(409,{error:'먼저 기기를 새로 배정받아 주세요.'});
    if(m.type!==user.selectedType)return send(409,{error:`배정한 ${user.selectedType==='washer'?'세탁기':'건조기'} 종류의 기기만 시작할 수 있습니다.`});
    if(user.sessionStarted)return send(409,{error:'이번 배정에서 이미 기기를 시작했습니다. 세탁물을 회수한 뒤 새로 배정받아 주세요.'});
    const reassigned=state.machines.some(machine=>machine.assignedTo===token&&machine.id!==m.id);
    for(const machine of state.machines)if(machine.assignedTo===token){machine.assignedTo=null;machine.assignmentExpiresAt=0;}
    m.owner=token;m.end=Date.now()+WASH_SECONDS*1000;user.sessionStarted=true;
    save();return send(200,{ok:true,reassigned});
   }else if(match[2]==='evict'){
    if(!m.owner)return send(409,{error:'기기를 사용할 수 있습니다.'});
    if(m.owner===token)return send(403,{error:'본인 세탁물은 강제 회수할 수 없습니다.'});
    if(Date.now()<m.end+COLLECTION_GRACE_MS)return send(409,{error:'작동 종료 후 10초가 지나야 강제 회수할 수 있습니다.'});
    state.lostItems.push({id:randomUUID(),owner:m.owner,name:userName(m.owner),machineId:m.id,machineName:`${m.type==='dryer'?'건조기':'세탁기'} ${m.type==='dryer'?m.id-4:m.id}`,movedAt:Date.now()});
    m.owner=null;m.end=0;save();return send(200,{ok:true,evicted:true});
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
const port=Number(process.env.PORT||3000);
server.on('error',error=>{if(error.code==='EADDRINUSE')console.error(`${port}번 포트가 이미 사용 중입니다.`);else console.error('서버를 시작하지 못했습니다:',error.message);process.exitCode=1;});
server.listen(port,'0.0.0.0',()=>console.log('세탁실: http://localhost:'+port));
