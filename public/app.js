const $=s=>document.querySelector(s);
let token=localStorage.getItem('laundry-token'),owned=[],machines=[],lostItems=[],busy=false,offset=0,washSeconds=10;
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function renderLost(){
 const list=$('#lost-items');$('#lost-count').textContent=lostItems.length;$('#lost-empty').hidden=lostItems.length>0;
 list.replaceChildren(...lostItems.map(item=>{
  const row=document.createElement('article');row.className='lost-item';
  const label=document.createElement('span');label.textContent=`${item.machineName} · ${item.canCollect?'내 세탁물':'다른 사용자 세탁물'} · ${new Date(item.movedAt).toLocaleString('ko-KR')}`;
  const button=document.createElement('button');button.textContent=item.canCollect?'회수':'본인만 회수';button.disabled=busy||!item.canCollect;if(item.canCollect)button.onclick=()=>runAction(()=>api('lost/'+item.id+'/collect',{}));
  row.append(label,button);return row;
 }));
}
function animateTransfer(origin){
 if(!origin||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const target=$('#basket-target')?.getBoundingClientRect();if(!target)return;
 const cloth=document.createElement('div');cloth.className='transfer-cloth';cloth.setAttribute('aria-hidden','true');
 cloth.style.left=`${origin.x+origin.width/2}px`;cloth.style.top=`${origin.y+origin.height/2}px`;document.body.append(cloth);
 const animation=cloth.animate([
  {left:`${origin.x+origin.width/2}px`,top:`${origin.y+origin.height/2}px`,transform:'translate(-50%,-50%) rotate(0deg) scale(1)',opacity:1},
  {left:`${target.x+target.width/2}px`,top:`${target.y+target.height/2}px`,transform:'translate(-50%,-50%) rotate(540deg) scale(.25)',opacity:.25}
 ],{duration:900,easing:'cubic-bezier(.2,.75,.25,1)'});
 animation.finished.then(()=>cloth.remove()).catch(()=>cloth.remove());
}
function render(){
 $('#machines').replaceChildren(...machines.map(m=>{
  const mine=owned.includes(m.id),available=m.status==='available',washing=m.status==='washing';
  const device=m.type==='dryer'?'건조기':'세탁기',number=m.type==='dryer'?m.id-4:m.id;
  const card=document.createElement('article');card.className='card '+m.status;card.dataset.machineId=m.id;
  card.innerHTML='<div class="card-top"><h3></h3><span class="badge"></span></div><div class="washer"><div class="door"></div></div><div class="detail"><strong></strong><p></p></div><button></button>';
  card.querySelector('h3').textContent=`${device} ${number}`;
  card.querySelector('.badge').textContent=available?'사용 가능':washing?'작동 중':'회수 대기';
  const door=card.querySelector('.door');
  door.setAttribute('aria-label',washing?'작동 중':m.type==='dryer'?'건조기':'세탁기');
  if(washing)door.innerHTML='<span class="drum-turn"><i class="fabric fabric-a"></i><i class="fabric fabric-b"></i><i class="fabric fabric-c"></i></span>';
  else door.textContent=m.status==='collection'?'회수':m.type==='dryer'?'건조':'세탁';
  card.querySelector('strong').textContent=available?'사용 가능':`${m.name||'사용자'}${mine?' (내 기기)':''}`;
  const left=Math.max(0,Math.ceil((m.end-Date.now()-offset)/1000));
  const evictWait=Math.max(0,Math.ceil((m.end+10000-Date.now()-offset)/1000));
  card.querySelector('.detail p').textContent=available?`작동 시간 ${washSeconds}초`:washing?`남은 시간 ${left}초`:mine?'세탁물을 회수해 주세요':m.evictable?'다른 사용자가 강제 회수할 수 있습니다':`강제 회수 가능까지 ${evictWait}초`;
  const button=card.querySelector('button');button.textContent=available?'사용하기':washing?'작동 중':mine?'세탁물 회수 완료':m.evictable?'강제 회수':'회수 대기';button.disabled=busy||washing||(!available&&!mine&&!m.evictable);if(m.evictable&&!mine)button.classList.add('force-collect');
  button.onclick=()=>{const action=available?'start':mine?'collect':'evict';runAction(()=>api('machines/'+m.id+'/'+action,{}),action==='evict'?m.id:null);};
  return card;
 }));renderLost();
}
async function refresh(animateNew=true){try{
 const origins=new Map(machines.map(m=>{const rect=document.querySelector(`[data-machine-id="${m.id}"] .door`)?.getBoundingClientRect();return[m.id,rect&&{x:rect.x,y:rect.y,width:rect.width,height:rect.height}];}));
 const oldLostIds=new Set(lostItems.map(item=>item.id));
 const [state,me]=await Promise.all([api('machines'),api('me',{})]);
 machines=state.machines;washSeconds=state.washSeconds;offset=state.now-Date.now();owned=me.owned;lostItems=me.lostItems||[];$('#user').textContent=me.name;$('#login').hidden=true;$('#dashboard').hidden=false;$('#connection').textContent='';render();
 if(animateNew)for(const item of lostItems)if(!oldLostIds.has(item.id)&&origins.has(item.machineId))animateTransfer(origins.get(item.machineId));
 }catch(e){$('#connection').textContent='연결 오류';$('#message').textContent=e.message;}}
async function runAction(action,machineId=null){if(busy)return;const rect=machineId?document.querySelector(`[data-machine-id="${machineId}"] .door`)?.getBoundingClientRect():null;const origin=rect&&{x:rect.x,y:rect.y,width:rect.width,height:rect.height};busy=true;render();try{const result=await action();$('#message').textContent='';await refresh(!result?.evicted);if(result?.evicted)animateTransfer(origin);}catch(e){$('#message').textContent=e.message;}finally{busy=false;render();}}
$('#name-form').onsubmit=async e=>{e.preventDefault();try{const user=await api('login',{name:$('#name').value});token=user.token;localStorage.setItem('laundry-token',token);$('#message').textContent='';await refresh();}catch(e){$('#message').textContent=e.message;}};
if(token)await refresh();setInterval(()=>{if(token&&!busy)refresh();},1000);
