const $=s=>document.querySelector(s);
let authenticated=false,busy=false,initialized=false;
async function api(path,body){const response=await fetch('/api/admin/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok){if(response.status===401&&path!=='login')showLogin();throw Error(data.error);}return data;}
function showLogin(){authenticated=false;initialized=false;$('#panel').hidden=true;$('#logout').hidden=true;$('#login').hidden=false;}
async function refresh(){
 const data=await api('state');authenticated=true;$('#panel').hidden=false;$('#logout').hidden=false;$('#login').hidden=true;
 if(!initialized){$('#seconds').value=data.settings.washSeconds;initialized=true;}
 $('#current-duration').textContent='현재 설정: '+data.settings.washSeconds+'초';$('#connection').textContent='● 1초마다 자동 업데이트';
 $('#machines').replaceChildren(...data.machines.map(m=>{
  const card=document.createElement('article');card.className='card '+m.status;
  const title=document.createElement('h3');title.textContent='세탁기 '+m.id;
  const status=document.createElement('p');status.textContent=({available:'사용 가능',washing:'세탁 중',collection:'회수 대기'})[m.status];
  const owner=document.createElement('p');owner.textContent=m.name?m.name+' 님':'사용자 없음';
  const remaining=document.createElement('p');remaining.textContent=m.status==='washing'?'남은 시간 '+Math.max(0,Math.ceil((m.end-data.now)/1000))+'초':'—';
  const button=document.createElement('button');button.textContent='강제 비우기';button.disabled=busy||m.status==='available';
  button.onclick=()=>{if(confirm('세탁기 '+m.id+'을 강제로 비우시겠습니까? 현재 사용자가 해제됩니다.'))run(()=>api('machines/'+m.id+'/evict',{}),'세탁기 '+m.id+'을 비웠습니다.');};
  card.append(title,status,owner,remaining,button);return card;
 }));
}
async function run(action,message){if(busy)return;busy=true;document.querySelectorAll('button').forEach(b=>b.disabled=true);try{await action();await refresh();$('#message').textContent=message;}catch(e){$('#message').textContent=e.message;}finally{busy=false;document.querySelectorAll('button').forEach(b=>b.disabled=false);if(authenticated)refresh().catch(e=>$('#message').textContent=e.message);}}
$('#login-form').onsubmit=e=>{e.preventDefault();run(async()=>{await api('login',{password:$('#password').value});$('#password').value='';},'로그인했습니다.');};
$('#settings-form').onsubmit=e=>{e.preventDefault();run(()=>api('settings',{washSeconds:Number($('#seconds').value)}),'세탁 시간을 저장했습니다. 다음 세탁부터 적용됩니다.');};
$('#logout').onclick=async()=>{try{await api('logout',{});showLogin();$('#message').textContent='로그아웃했습니다.';}catch(e){$('#message').textContent=e.message;}};
refresh().catch(()=>{});setInterval(()=>{if(authenticated&&!busy)refresh().catch(e=>{$('#connection').textContent='연결 확인 필요';$('#message').textContent=e.message;});},1000);
