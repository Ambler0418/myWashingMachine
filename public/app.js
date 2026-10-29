const $=s=>document.querySelector(s);
let token=localStorage.getItem('laundry-token'),owned=[],machines=[],busy=false,offset=0,washSeconds=60;
async function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:body?JSON.stringify(body):undefined});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function render(){
 $('#machines').replaceChildren(...machines.map(m=>{
  const mine=owned.includes(m.id),available=m.status==='available',washing=m.status==='washing';
  const card=document.createElement('article');card.className='card '+m.status;
  card.innerHTML='<div class="card-top"><h3>세탁기 '+m.id+'</h3><span class="badge">'+(available?'사용 가능':washing?'세탁 중':'회수 대기')+'</span></div><div class="washer"><div class="door">'+(available?'≈':washing?'◌':'✓')+'</div></div><div class="detail"><strong></strong><p></p></div><button></button>';
  card.querySelector('strong').textContent=available?'바로 사용할 수 있어요':m.name+' 님'+(mine?' (나)':'');
  const left=Math.max(0,Math.ceil((m.end-Date.now()-offset)/1000));
  card.querySelector('.detail p').textContent=available?'세탁 시간 '+washSeconds+'초':washing?'남은 시간 '+Math.floor(left/60)+':'+String(left%60).padStart(2,'0'):'세탁 완료 · 세탁물을 가져가 주세요';
  const button=card.querySelector('button');button.textContent=available?'세탁 시작하기':washing?'세탁 중입니다':mine?'세탁물 회수 완료':'사용자가 회수할 때까지 대기';button.disabled=busy||(!available&&(washing||!mine));
  button.onclick=async()=>{busy=true;render();try{await api('machines/'+m.id+'/'+(available?'start':'collect'),{});$('#message').textContent='';await refresh();}catch(e){$('#message').textContent=e.message;}finally{busy=false;render();}};
  return card;
 }));
}
async function refresh(){try{const [state,me]=await Promise.all([api('machines'),api('me',{})]);machines=state.machines;washSeconds=state.washSeconds;offset=state.now-Date.now();owned=me.owned;$('#user').textContent=me.name+' 님';$('#login').hidden=true;$('#dashboard').hidden=false;$('#connection').textContent='● 1초마다 자동 업데이트';render();}catch(e){$('#connection').textContent='연결 확인 필요';$('#message').textContent=e.message;}}
$('#name-form').onsubmit=async e=>{e.preventDefault();try{const user=await api('login',{name:$('#name').value});token=user.token;localStorage.setItem('laundry-token',token);$('#message').textContent='';await refresh();}catch(e){$('#message').textContent=e.message;}};
if(token)await refresh();setInterval(()=>{if(token&&!busy)refresh();},1000);

