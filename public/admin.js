const $=s=>document.querySelector(s);
let authenticated=false,busy=false;
async function api(path,body){const response=await fetch('/api/admin/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok){if(response.status===401&&path!=='login')showLogin();throw Error(data.error);}return data;}
function showLogin(){authenticated=false;$('#panel').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;}
async function refresh(){
 const data=await api('state');authenticated=true;$('#panel').hidden=false;$('#logout').hidden=false;$('#login').hidden=true;
 $('#machines').replaceChildren(...data.machines.map(m=>{
  const card=document.createElement('article');card.className='card '+m.status;
  const type=m.type==='dryer'?'건조기':'세탁기',number=m.type==='dryer'?m.id-4:m.id;
  const title=document.createElement('h3');title.textContent=`${type} ${number}`;
  const status=document.createElement('p');status.textContent=({available:'사용 가능',assigned:'배정됨',washing:'작동 중',collection:'회수 대기'})[m.status];
  const owner=document.createElement('p');owner.textContent=m.name?`${m.studentId?m.studentId+' · ':''}${m.name}${m.status==='assigned'?' 배정 대기':' 사용 중'}`:'사용자 없음';
  const remaining=document.createElement('p');remaining.textContent=m.status==='washing'?`남은 시간 ${Math.max(0,Math.ceil((m.end-data.now)/1000))}초`:m.status==='assigned'?`배정 만료까지 ${Math.max(0,Math.ceil((m.assignmentExpiresAt-data.now)/1000))}초`:'';
  const button=document.createElement('button');button.textContent=m.status==='assigned'?'배정 해제':'사용 해제';button.disabled=busy||m.status==='available';
  button.onclick=()=>{if(confirm(`${type} ${number} ${m.status==='assigned'?'배정을':'사용을'} 해제할까요?`))run(()=>api('machines/'+m.id+'/evict',{}),m.status==='assigned'?'배정을 해제했습니다.':'사용을 해제했습니다.');};
  card.append(title,status,owner,remaining,button);return card;
 }));
}
async function run(action,message){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();await refresh();$('#message').textContent=message;}catch(e){$('#message').textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(authenticated)refresh().catch(e=>$('#message').textContent=e.message);}}
$('#login-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('login',{password:$('#password').value});$('#password').value='';},'로그인했습니다.');};
$('#logout').onclick=async()=>{try{await api('logout',{});showLogin();$('#message').textContent='로그아웃했습니다.';}catch(e){$('#message').textContent=e.message;}};
refresh().catch(()=>{});setInterval(()=>{if(authenticated&&!busy)refresh().catch(()=>{});},1000);
