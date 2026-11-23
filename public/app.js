const $=s=>document.querySelector(s);
let token=localStorage.getItem('laundry-token'),owned=[],machines=[],lostItems=[],busy=false,offset=0,washSeconds=10;
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function renderLost(){
 const section=$('#lost-section'),list=$('#lost-items');section.hidden=lostItems.length===0;
 list.replaceChildren(...lostItems.map(item=>{
  const row=document.createElement('article');row.className='lost-item';
  const label=document.createElement('span');label.textContent=`${item.machineName} · ${new Date(item.movedAt).toLocaleString('ko-KR')}`;
  const button=document.createElement('button');button.textContent='회수';button.disabled=busy;button.onclick=()=>runAction(()=>api('lost/'+item.id+'/collect',{}));
  row.append(label,button);return row;
 }));
}
function render(){
 $('#machines').replaceChildren(...machines.map(m=>{
  const mine=owned.includes(m.id),available=m.status==='available',washing=m.status==='washing';
  const device=m.type==='dryer'?'건조기':'세탁기',number=m.type==='dryer'?m.id-4:m.id;
  const card=document.createElement('article');card.className='card '+m.status;
  card.innerHTML='<div class="card-top"><h3></h3><span class="badge"></span></div><div class="washer"><div class="door"></div></div><div class="detail"><strong></strong><p></p></div><button></button>';
  card.querySelector('h3').textContent=`${device} ${number}`;
  card.querySelector('.badge').textContent=available?'사용 가능':washing?'작동 중':'회수 대기';
  card.querySelector('.door').textContent=m.type==='dryer'?'건조':'세탁';
  card.querySelector('strong').textContent=available?'사용 가능':`${m.name||'사용자'}${mine?' (내 기기)':''}`;
  const left=Math.max(0,Math.ceil((m.end-Date.now()-offset)/1000));
  card.querySelector('.detail p').textContent=available?`작동 시간 ${washSeconds}초`:washing?`남은 시간 ${left}초`:mine?'세탁물을 회수해 주세요':'사용자 회수 대기 중';
  const button=card.querySelector('button');button.textContent=available?'사용하기':washing?'작동 중':mine?'세탁물 회수 완료':'회수 대기';button.disabled=busy||(!available&&(washing||!mine));
  button.onclick=()=>runAction(()=>api('machines/'+m.id+'/'+(available?'start':'collect'),{}));
  return card;
 }));renderLost();
}
async function refresh(){try{const [state,me]=await Promise.all([api('machines'),api('me',{})]);machines=state.machines;washSeconds=state.washSeconds;offset=state.now-Date.now();owned=me.owned;lostItems=me.lostItems||[];$('#user').textContent=me.name;$('#login').hidden=true;$('#dashboard').hidden=false;$('#connection').textContent='';render();}catch(e){$('#connection').textContent='연결 오류';$('#message').textContent=e.message;}}
async function runAction(action){if(busy)return;busy=true;render();try{await action();$('#message').textContent='';await refresh();}catch(e){$('#message').textContent=e.message;}finally{busy=false;render();}}
$('#name-form').onsubmit=async e=>{e.preventDefault();try{const user=await api('login',{name:$('#name').value});token=user.token;localStorage.setItem('laundry-token',token);$('#message').textContent='';await refresh();}catch(e){$('#message').textContent=e.message;}};
if(token)await refresh();setInterval(()=>{if(token&&!busy)refresh();},1000);
