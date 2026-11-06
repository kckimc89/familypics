/* 우리 가족 사진관 MASTER V1.7.2 — IndexedDB 인증 유지 점검 */
'use strict';
const $=id=>document.getElementById(id);
const hide=(id,yes=true)=>$(id).classList.toggle('hidden',yes);
const cfg=window.FAMILY_PHOTO_CONFIG||{};
const ready=!!(cfg.supabaseUrl&&cfg.supabaseAnonKey&&!cfg.supabaseUrl.includes('YOUR_PROJECT')&&!cfg.supabaseAnonKey.includes('YOUR_')&&window.supabase);
// V1.7.2: 가족사진관 인증 키만 IndexedDB에 영구 저장합니다.
// 다른 백과사전과 브라우저의 저장 자료는 조회·삭제하지 않습니다.
// Supabase StorageAdapter는 Promise 기반 getItem/setItem/removeItem을 지원합니다.
const authStorageState={mode:'checking',warned:false};
const authMemory=new Map();
const DB_NAME='family-photo-auth-v172';
const DB_STORE='sessions';
const OWN_AUTH_PREFIX='sb-'+(new URL(cfg.supabaseUrl||'https://unconfigured.invalid').hostname.split('.')[0])+'-auth-token';
function storageRead(store,key){try{return store.getItem(key)}catch(_){return null}}
function storageWrite(store,key,val){try{store.setItem(key,val);return true}catch(_){return false}}
function storageRemove(store,key){try{store.removeItem(key)}catch(_){}}
function storageModeNotice(){
 const temporary=authStorageState.mode==='session'||authStorageState.mode==='memory';
 const message=authStorageState.mode==='session'
  ?'Safari의 영구 저장소를 사용할 수 없어 현재 탭에만 로그인 정보를 보관합니다. 탭을 닫으면 다시 로그인해야 할 수 있습니다. 다른 앱의 자료는 삭제하지 않았습니다.'
  :'Safari에서 로그인 정보를 영구 저장하지 못했습니다. 이 탭에서는 사용할 수 있지만 닫으면 재로그인이 필요할 수 있습니다. 다른 앱의 자료는 삭제하지 않았습니다.';
 for(const id of ['authStorageNotice','mainStorageWarning']){const el=$(id);if(el){el.classList.toggle('hidden',!temporary);if(temporary)el.textContent=message}}
}
function setStorageMode(mode){authStorageState.mode=mode;storageModeNotice()}
let openAuthDbPromise=null;
function openAuthDb(){
 if(openAuthDbPromise)return openAuthDbPromise;
 openAuthDbPromise=new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(new Error('IndexedDB unavailable'));return}
  let request;
  try{request=window.indexedDB.open(DB_NAME,1)}catch(err){reject(err);return}
  request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains(DB_STORE))request.result.createObjectStore(DB_STORE)};
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(request.error||new Error('IndexedDB open failed'));
  request.onblocked=()=>reject(new Error('IndexedDB blocked'));
 }).catch(err=>{openAuthDbPromise=null;throw err});
 return openAuthDbPromise;
}
async function dbOperation(mode,key,value){
 const db=await openAuthDb();
 return new Promise((resolve,reject)=>{
  let tx,request;
  try{
   tx=db.transaction(DB_STORE,mode);
   const store=tx.objectStore(DB_STORE);
   request=mode==='readonly'?store.get(key):(value===null?store.delete(key):store.put(value,key));
  }catch(err){reject(err);return}
  let result=null;
  request.onsuccess=()=>{result=request.result??null};
  tx.oncomplete=()=>resolve(result);
  tx.onerror=()=>reject(tx.error||new Error('IndexedDB transaction failed'));
  tx.onabort=()=>reject(tx.error||new Error('IndexedDB aborted'));
 });
}
// 인증 이외의 키에 이 어댑터가 쓰이지 않도록 Supabase auth 저장 용도로만 연결합니다.
const authStorage={
 async getItem(key){
  // 영구 저장된 토큰을 우선합니다. 이전 버전의 sessionStorage/localStorage는 읽기만 하며,
  // 성공적으로 새 영구 저장소로 옮긴 후 이 프로젝트 인증 키만 삭제합니다.
  try{const value=await dbOperation('readonly',key);if(value!==null){setStorageMode('indexeddb');return value}}catch(_){/* 아래 저장소로 대체 */}
  const oldLocal=storageRead(window.localStorage,key);
  const oldSession=storageRead(window.sessionStorage,key);
  // 최신 탭 로그인 값이 예전 localStorage 복사본보다 우선입니다.
  const oldValue=oldSession??oldLocal;
  if(oldValue!==null){
   try{await dbOperation('readwrite',key,oldValue);storageRemove(window.localStorage,key);storageRemove(window.sessionStorage,key);setStorageMode('indexeddb')}
   catch(_){setStorageMode(oldLocal!==null?'local':'session')}
   return oldValue;
  }
  if(authMemory.has(key))return authMemory.get(key);
  return null;
 },
 async setItem(key,value){
  authMemory.set(key,value);
  try{
   await dbOperation('readwrite',key,value);
   // 쓰기 트랜잭션 완료 후에만 예전 토큰 복사본을 지웁니다.
   storageRemove(window.localStorage,key);storageRemove(window.sessionStorage,key);
   setStorageMode('indexeddb');return;
  }catch(_){/* 영구 저장 불가: 다른 저장소를 시도합니다 */}
  if(storageWrite(window.localStorage,key,value)){setStorageMode('local');return}
  if(storageWrite(window.sessionStorage,key,value)){setStorageMode('session');return}
  setStorageMode('memory');
 },
 async removeItem(key){
  authMemory.delete(key);
  // 로그아웃 시 보조 복사본까지 제거합니다. 다른 프로젝트의 키는 절대 수정하지 않습니다.
  try{await dbOperation('readwrite',key,null)}catch(_){}
  storageRemove(window.localStorage,key);storageRemove(window.sessionStorage,key);
 }
};
const sb=ready?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
 auth:{storage:authStorage,persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
}):null;
const B='family-photos'; // Legacy read-only: new uploads NEVER fall back to Supabase Storage
const r2Enabled=!!(cfg.workerUrl&&cfg.workerUrl.startsWith('https://')&&!cfg.workerUrl.includes('YOUR_'));
const urlCache=new Map();
// Uploads need both a configured Worker and an explicitly verified private backend.
// Set this flag only AFTER authenticated access-control tests and backup tests.
const photoWritesEnabled=r2Enabled&&cfg.photoWritesVerified===true;
let latestInviteLink='';
let user=null,familyId=null,familyName='',role='member',albums=[],photos=[],links=[],favorites=new Set(),members=[],view='all',selectedAlbum='',viewerPhoto=null,viewList=[],viewerIndex=0,slideTimer=null,authMode='login',loading=false;
const signedCache=new Map();
const $all=(selector)=>Array.from(document.querySelectorAll(selector));
const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function toast(t){$('toast').textContent=t;hide('toast',false);clearTimeout(toast.t);toast.t=setTimeout(()=>hide('toast'),3800)}
function assert(data){if(data?.error)throw data.error;return data?.data}
function busy(button,yes){button.disabled=yes;button.dataset.old??=button.textContent;button.textContent=yes?'처리 중…':button.dataset.old}
function updateStorageNotice(){const el=$('storageNotice');if(!el)return;el.classList.toggle('hidden',photoWritesEnabled);$('uploadButton').textContent=photoWritesEnabled?'＋ 사진 올리기':'🔒 사진 등록 준비 중';$('uploadButton').title=photoWritesEnabled?'사진 등록':'비공개 사진 서버 확인 후 활성화됩니다';}
function showMain(){hide('setup',true);hide('authPanel',true);hide('familyPanel',true);hide('app',true);hide('headerActions',!user);if(!ready)hide('setup',false);else if(!user)hide('authPanel',false);else if(!familyId)hide('familyPanel',false);else{hide('app',false);$('identity').textContent=user.email||'';$('familyDisplay').textContent=familyName;hide('manageButton',role!=='admin');hide('trashNav',role!=='admin');updateStorageNotice()}}
async function init(){
 if(!ready){showMain();return}
 // 로그인 이벤트는 Supabase 내부 잠금 밖에서 처리합니다.
 sb.auth.onAuthStateChange((_event,session)=>{
  user=session?.user||null;
  setTimeout(()=>loadAccount().catch(err=>showAccountError(err)),0);
 });
 const {data,error}=await sb.auth.getSession();
 if(error)throw error;
 user=data.session?.user||null;
 await loadAccount();
}
function showAccountError(err){
 const message='로그인 후 가족 정보 조회에 문제가 있습니다: '+(err?.message||String(err));
 const el=$('authMessage');
 if(el)el.textContent=message;
 toast(message);
}

async function loadAccount(){if(!user){familyId=null;showMain();return}const saved=storageRead(window.sessionStorage,'family-photo-selected-'+user.id)||storageRead(window.localStorage,'family-photo-selected-'+user.id);const ms=assert(await sb.from('memberships').select('family_id,role').eq('user_id',user.id));let m=ms.find(r=>r.family_id===saved)||ms[0];if(!m){familyId=null;showMain();return}familyId=m.family_id;role=m.role;if(!storageWrite(window.localStorage,'family-photo-selected-'+user.id,familyId))storageWrite(window.sessionStorage,'family-photo-selected-'+user.id,familyId);const f=assert(await sb.from('families').select('name').eq('id',familyId).single());familyName=f.name;showMain();await loadData()}
async function loadData(){if(!familyId)return;const [a,p,l,f,m]=await Promise.all([
 sb.from('albums').select('*').eq('family_id',familyId).order('created_at'),
 sb.from('photos').select('*').eq('family_id',familyId).order('taken_on',{ascending:false,nullsFirst:false}).order('created_at',{ascending:false}).limit(1000),
 sb.from('photo_albums').select('*').eq('family_id',familyId),
 sb.from('favorites').select('photo_id').eq('family_id',familyId).eq('user_id',user.id),
 sb.from('memberships').select('user_id,role,joined_at').eq('family_id',familyId)]);
 albums=assert(a);photos=assert(p);links=assert(l);favorites=new Set(assert(f).map(x=>x.photo_id));members=assert(m);updateOptions();render()}
function opt(sel,items,placeholder){const prev=sel.value;sel.innerHTML=placeholder?'<option value="">'+esc(placeholder)+'</option>':'';items.forEach(a=>{const el=document.createElement('option');el.value=a.id;el.textContent=a.name;sel.append(el)});if([...sel.options].some(o=>o.value===prev))sel.value=prev}
function updateOptions(){opt($('albumFilter'),albums,'모든 앨범');opt($('uploadAlbums'),albums);opt($('editAlbums'),albums);const names=[...new Set(photos.flatMap(p=>p.people||[]).map(s=>s.trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ko'));opt($('personFilter'),names.map(n=>({id:n,name:n})),'모든 인물')}
function filtered(){const q=$('search').value.trim().toLowerCase(),aid=$('albumFilter').value,person=$('personFilter').value,month=$('dateFilter').value;return photos.filter(p=>{if(view==='trash'?!p.deleted_at:!!p.deleted_at)return false;if(view==='favorites'&&!favorites.has(p.id))return false;if(view==='mine'&&p.owner_id!==user?.id)return false;if((view==='child'||view==='family')&&!(p.galleries||['family']).includes(view))return false;if((view==='albums'&&selectedAlbum)&&!links.some(l=>l.photo_id===p.id&&l.album_id===selectedAlbum))return false;if(aid&&!links.some(l=>l.photo_id===p.id&&l.album_id===aid))return false;if(person&&!(p.people||[]).includes(person))return false;if(month&&!(p.taken_on||'').startsWith(month))return false;return !q||[p.title,p.caption,p.original_name,(p.people||[]).join(' ')].join(' ').toLowerCase().includes(q)})}
function render(){const labels={all:'모든 사진',child:'아이의 사진',family:'가족의 사진',albums:'앨범별로 보기',favorites:'나의 즐겨찾기',mine:'내가 등록한 사진',trash:'휴지통'};$('gridTitle').textContent=labels[view];$('childCount').textContent=photos.filter(p=>!p.deleted_at&&(p.galleries||['family']).includes('child')).length+'장';$('familyCount').textContent=photos.filter(p=>!p.deleted_at&&(p.galleries||['family']).includes('family')).length+'장';$all('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));hide('albumCards',view!=='albums');if(view==='albums'){const html=['<button class="album-card" data-album=""><span>🖼️</span><strong>모든 앨범</strong><small>전체 보기</small></button>',...albums.map(a=>`<button class="album-card" data-album="${esc(a.id)}"><span>${a.kind==='person'?'👤':'📂'}</span><strong>${esc(a.name)}</strong><small>${links.filter(l=>l.album_id===a.id).length}장</small></button>`)].join('');$('albumCards').innerHTML=html;$all('[data-album]').forEach(el=>{el.style.outline=el.dataset.album===selectedAlbum?'2px solid #8b7967':'none';el.onclick=()=>{selectedAlbum=el.dataset.album;render()}})}
viewList=filtered();$('count').textContent=`${viewList.length}장`;$('grid').replaceChildren();hide('empty',viewList.length>0);for(const [i,p] of viewList.entries()){const b=document.createElement('button');b.className='photo-card';b.innerHTML=`<img alt="" loading="lazy"><div class="meta"><strong>${esc(p.title||p.original_name||'우리 가족 사진')}</strong><small>${esc(p.taken_on||p.created_at.slice(0,10))}${favorites.has(p.id)?'　♥':''}</small></div>`;b.onclick=()=>openViewer(i);$('grid').append(b);imageUrl(p.thumb_path).then(url=>{if(b.isConnected)b.querySelector('img').src=url}).catch(()=>{b.querySelector('img').alt='사진을 표시할 수 없습니다'})}}
async function r2Request(path,method='GET',blob=null){
 const session=assert(await sb.auth.getSession()).session;
 if(!session?.access_token)throw Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
 const response=await fetch(cfg.workerUrl.replace(/\/$/,'')+'/objects/'+path.split('/').map(encodeURIComponent).join('/'),{
  method,headers:{'Authorization':'Bearer '+session.access_token,...(blob?{'Content-Type':blob.type||'application/octet-stream'}:{})},body:blob||undefined,cache:'no-store'});
 if(!response.ok)throw Error('사진 서버 오류 ('+response.status+'): '+(await response.text()).slice(0,160));
 return response;
}
async function objectUpload(path,blob){if(!photoWritesEnabled)throw Error('사진 서버 보안 검증 전에는 등록할 수 없습니다.');await r2Request(path,'PUT',blob)}
async function objectDownload(path){if(r2Enabled)return (await r2Request(path)).blob();return assert(await sb.storage.from(B).download(path))}
async function imageUrl(path){if(r2Enabled){if(urlCache.has(path))return urlCache.get(path);const blob=await objectDownload(path);const url=URL.createObjectURL(blob);urlCache.set(path,url);return url}const c=signedCache.get(path);if(c&&c.exp>Date.now())return c.url;const data=assert(await sb.storage.from(B).createSignedUrl(path,3600));signedCache.set(path,{url:data.signedUrl,exp:Date.now()+3500*1000});return data.signedUrl}
window.addEventListener('pagehide',()=>{for(const url of urlCache.values())URL.revokeObjectURL(url);urlCache.clear()});
function open(id){hide(id,false);document.body.style.overflow='hidden'}function close(id){hide(id);if($all('.overlay:not(.hidden)').length===0)document.body.style.overflow=''}
function stopSlide(){clearInterval(slideTimer);slideTimer=null;$('slideToggle').textContent='▶ 슬라이드'}
async function openViewer(i){if(!viewList.length)return;viewerIndex=(i+viewList.length)%viewList.length;viewerPhoto=viewList[viewerIndex];const p=viewerPhoto;open('viewer');$('viewerCounter').textContent=`${viewerIndex+1} / ${viewList.length}`;$('viewerTitle').textContent=p.title||p.original_name||'우리 가족 사진';$('viewerDate').textContent=p.taken_on||p.created_at.slice(0,10);$('viewerCaption').textContent=p.caption||'아직 등록된 이야기가 없습니다.';$('viewerPeople').textContent=(p.people||[]).join(' · ');$('viewerAlbumLabels').innerHTML=links.filter(l=>l.photo_id===p.id).map(l=>albums.find(a=>a.id===l.album_id)).filter(Boolean).map(a=>`<span>${esc(a.name)}</span>`).join('');$('favoriteButton').textContent=favorites.has(p.id)?'♥ 즐겨찾기 해제':'♡ 즐겨찾기';hide('trashButton',role!=='admin'||!!p.deleted_at);hide('restoreButton',role!=='admin'||!p.deleted_at);hide('editButton',!!p.deleted_at||(role!=='admin'&&p.owner_id!==user.id));const img=$('viewerImage');img.removeAttribute('src');img.alt='사진 불러오는 중';const id=p.id;try{const url=await imageUrl(p.display_path);if(viewerPhoto?.id===id){img.src=url;img.alt=p.title||'가족 사진'}}catch(e){toast('사진을 불러오지 못했습니다: '+e.message)}}
function movePhoto(delta){openViewer(viewerIndex+delta)}
async function download(path,name){const blob=await objectDownload(path);const a=document.createElement('a'),url=URL.createObjectURL(blob);a.href=url;a.download=name||'photo';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function makeVariant(file,max,q){const img=await createImageBitmap(file).catch(()=>null);if(!img)throw Error('이 사진은 브라우저에서 변환할 수 없습니다. JPEG/PNG 사진을 사용해 주세요.');const scale=Math.min(1,max/Math.max(img.width,img.height)),w=Math.max(1,Math.round(img.width*scale)),h=Math.max(1,Math.round(img.height*scale));const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(img,0,0,w,h);img.close?.();const blob=await new Promise(resolve=>c.toBlob(resolve,'image/webp',q));if(!blob||blob.type!=='image/webp')throw Error('WebP 변환을 지원하지 않는 브라우저입니다.');c.width=c.height=0;return blob}
function splitNames(s){return [...new Set(s.split(',').map(x=>x.trim()).filter(Boolean))]}
function chosen(sel){return [...sel.selectedOptions].map(o=>o.value)}
function selectedGalleries(prefix){const out=[];if($(prefix+'Child').checked)out.push('child');if($(prefix+'Family').checked)out.push('family');if(!out.length)throw Error('아이의 사진과 가족의 사진 중 하나 이상 선택해 주세요');return out}
async function uploadPhotos(){if(!photoWritesEnabled)throw Error('사진 서버가 연결되고 보안 검증이 끝난 뒤 등록할 수 있습니다.');const files=[...$('files').files];if(!files.length){toast('사진을 선택해주세요');return}const btn=$('startUpload');busy(btn,true);let done=0;const max=$('highQuality').checked?3200:2560,q=$('highQuality').checked?.90:.85;try{for(const file of files){const id=crypto.randomUUID(),root=`${familyId}`,original=`${root}/originals/${id}/${encodeURIComponent(file.name)}`,display=`${root}/display/${id}.webp`,thumb=`${root}/thumbs/${id}.webp`;let paths=[];try{
 $('uploadProgress').textContent=`${done+1} / ${files.length} · ${file.name} 변환 중`;const [disp,small]=await Promise.all([makeVariant(file,max,q),makeVariant(file,480,.76)]);
 for(const [path,blob] of [[original,file],[display,disp],[thumb,small]]){await objectUpload(path,blob);paths.push(path)}
 const row={id,family_id:familyId,owner_id:user.id,title:$('uploadTitle').value.trim()||file.name.replace(/\.[^.]+$/,''),caption:$('uploadCaption').value.trim(),taken_on:$('uploadDate').value||null,people:splitNames($('uploadPeople').value),original_path:original,display_path:display,thumb_path:thumb,mime_type:file.type,original_name:file.name,galleries:selectedGalleries('upload')};assert(await sb.from('photos').insert(row));const ids=chosen($('uploadAlbums'));if(ids.length)assert(await sb.from('photo_albums').insert(ids.map(album_id=>({family_id:familyId,photo_id:id,album_id}))));done++;$('uploadProgress').textContent=`${done} / ${files.length}장 저장 완료`;
 }catch(e){$('uploadProgress').textContent=`${done}장 저장됨. ${file.name}: ${e.message}`;toast('일부 업로드가 실패했습니다.');break}}
 if(done===files.length){close('uploadModal');$('files').value='';toast(`${done}장 등록했습니다`)}await loadData()
 }finally{busy(btn,false)}}
function editPhoto(){const p=viewerPhoto;if(!p)return;$('editTitle').value=p.title;$('editCaption').value=p.caption;$('editDate').value=p.taken_on||'';$('editPeople').value=(p.people||[]).join(', ');$('editChild').checked=(p.galleries||['family']).includes('child');$('editFamily').checked=(p.galleries||['family']).includes('family');const ids=links.filter(l=>l.photo_id===p.id).map(l=>l.album_id);[...$('editAlbums').options].forEach(o=>o.selected=ids.includes(o.value));open('editModal')}
async function saveEdit(){const p=viewerPhoto;if(!p)return;const btn=$('saveEdit');busy(btn,true);try{assert(await sb.from('photos').update({title:$('editTitle').value.trim(),caption:$('editCaption').value.trim(),taken_on:$('editDate').value||null,people:splitNames($('editPeople').value),galleries:selectedGalleries('edit')}).eq('id',p.id).eq('family_id',familyId));const old=links.filter(l=>l.photo_id===p.id).map(l=>l.album_id),now=chosen($('editAlbums'));const del=old.filter(id=>!now.includes(id)),add=now.filter(id=>!old.includes(id));if(del.length)assert(await sb.from('photo_albums').delete().eq('photo_id',p.id).in('album_id',del));if(add.length)assert(await sb.from('photo_albums').insert(add.map(album_id=>({family_id:familyId,photo_id:p.id,album_id}))));close('editModal');await loadData();const idx=viewList.findIndex(x=>x.id===p.id);if(idx>=0)await openViewer(idx);else close('viewer');toast('수정했습니다')}catch(e){toast(e.message)}finally{busy(btn,false)}}
async function setDeleted(isTrash){if(role!=='admin'||!viewerPhoto)return;const p=viewerPhoto;if(isTrash&&!confirm('사진을 휴지통으로 이동할까요? 원본은 아직 보관됩니다.'))return;try{assert(await sb.from('photos').update({deleted_at:isTrash?new Date().toISOString():null}).eq('id',p.id));close('viewer');stopSlide();await loadData();toast(isTrash?'휴지통으로 이동했습니다':'사진을 복구했습니다')}catch(e){toast(e.message)}}
async function toggleFav(){const p=viewerPhoto;if(!p)return;try{if(favorites.has(p.id))assert(await sb.from('favorites').delete().eq('photo_id',p.id).eq('user_id',user.id));else assert(await sb.from('favorites').insert({photo_id:p.id,family_id:familyId,user_id:user.id}));await loadData();const i=viewList.findIndex(x=>x.id===p.id);if(i>=0)await openViewer(i);else close('viewer')}catch(e){toast(e.message)}}
async function manage(){if(role!=='admin')return;renderManage();open('manageModal')}
function renderManage(){$('manageAlbums').replaceChildren();for(const a of albums){const d=document.createElement('div');d.className='manage-item';d.innerHTML=`<span>${esc(a.name)} <small>(${a.kind==='person'?'구성원':'주제'})</small></span>`;const group=document.createElement('span');const ren=document.createElement('button');ren.textContent='이름 수정';ren.onclick=async()=>{const name=prompt('새 앨범 이름',a.name);if(!name?.trim())return;try{assert(await sb.from('albums').update({name:name.trim()}).eq('id',a.id));await loadData();renderManage()}catch(e){toast(e.message)}};const del=document.createElement('button');del.textContent='삭제';del.className='danger';del.onclick=async()=>{if(!confirm(`'${a.name}' 앨범을 삭제할까요? 사진 자체는 삭제되지 않습니다.`))return;try{assert(await sb.from('albums').delete().eq('id',a.id));await loadData();renderManage()}catch(e){toast(e.message)}};group.append(ren,del);d.append(group);$('manageAlbums').append(d)}$('members').replaceChildren();members.forEach(m=>{const d=document.createElement('div');d.className='manage-item';const id=document.createElement('span');id.textContent=`구성원 · ${m.user_id.slice(0,8)}… ${m.user_id===user.id?'(나)':''}`;const sel=document.createElement('select');sel.style.maxWidth='130px';[['member','가족'],['admin','관리자']].forEach(([v,t])=>{const o=document.createElement('option');o.value=v;o.textContent=t;sel.append(o)});sel.value=m.role;sel.onchange=async()=>{try{assert(await sb.rpc('set_family_role',{fid:familyId,target_user:m.user_id,new_role:sel.value}));await loadAccount();renderManage();toast('권한을 변경했습니다')}catch(e){sel.value=m.role;toast(e.message)}};d.append(id,sel);$('members').append(d)})}
async function addAlbum(){const name=$('newAlbum').value.trim();if(!name)return toast('앨범 이름을 적어주세요');try{assert(await sb.from('albums').insert({family_id:familyId,name,kind:$('newAlbumType').value}));$('newAlbum').value='';await loadData();renderManage()}catch(e){toast(e.message)}}
async function invite(){try{const code=assert(await sb.rpc('create_invite',{fid:familyId}));$('inviteResult').textContent='초대 코드가 만들어졌습니다. 아래 링크를 복사해 가족에게만 보내세요.';const link=new URL(location.href);link.searchParams.set('invite',code);link.hash='';latestInviteLink=link.toString();hide('copyInviteLink',false)}catch(e){toast(e.message)}}
async function copyInviteLink(){if(!latestInviteLink)return;try{await navigator.clipboard.writeText(latestInviteLink);toast('가족 초대 링크를 복사했습니다')}catch(e){prompt('아래 링크를 복사하세요',latestInviteLink)}}
function saveBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
async function exportMetadata(){if(photos.length>=1000){$('backupStatus').textContent='사진 1000장 이상일 수 있습니다. 현재 프로그램은 1000장만 불러오므로 완전 백업을 보장할 수 없습니다.';return;}const obj={format:'family-photo-master-v1',exported_at:new Date().toISOString(),family_name:familyName,albums:albums.map(a=>({id:a.id,name:a.name,kind:a.kind})),photos:photos.map(p=>({id:p.id,title:p.title,caption:p.caption,people:p.people,taken_on:p.taken_on,original_name:p.original_name,original_path:p.original_path,display_path:p.display_path,thumb_path:p.thumb_path,galleries:p.galleries||['family'],deleted_at:p.deleted_at})),photo_albums:links};saveBlob(new Blob([JSON.stringify(obj,null,2)],{type:'application/json'}),`family-photo-info-${new Date().toISOString().slice(0,10)}.json`);toast('사진 정보 백업 파일을 만들었습니다')}
async function exportPhotos(){if(!r2Enabled){$('backupStatus').textContent='원본 백업은 R2 연결 후 시험합니다. 현재 앨범 정보만 JSON으로 백업할 수 있습니다.';return;}if(photos.length>=1000){$('backupStatus').textContent='현재 1000장 제한 때문에 전체 원본 백업이 아닐 수 있습니다.';return;}if(photos.length>25){$('backupStatus').textContent='브라우저 ZIP은 안전을 위해 25장 이하 시험용으로 제한했습니다. 대량 백업 기능은 아직 개발 중입니다.';return;}const btn=$('exportPhotos');busy(btn,true);$('backupStatus').textContent='원본 사진을 모으는 중…';try{if(!window.JSZip)throw Error('ZIP 라이브러리 로딩 실패');const zip=new JSZip();const selected=photos.filter(p=>!p.deleted_at);if(!selected.length)throw Error('저장할 사진이 없습니다');for(let i=0;i<selected.length;i++){const p=selected[i];$('backupStatus').textContent=`원본 ${i+1}/${selected.length} 다운로드 중`;const blob=await objectDownload(p.original_path);zip.file(`${String(i+1).padStart(4,'0')}_${p.id}_${(p.original_name||'photo').replace(/[\\/:*?"<>|]/g,'_')}`,blob)}const out=await zip.generateAsync({type:'blob',compression:'STORE'},meta=>{$('backupStatus').textContent=`ZIP 생성 ${Math.floor(meta.percent)}%`});saveBlob(out,`family-originals-${new Date().toISOString().slice(0,10)}.zip`);$('backupStatus').textContent='원본 ZIP 백업 완료. 별도 장소에 보관하세요.'}catch(e){$('backupStatus').textContent='원본 백업 실패: '+e.message}finally{busy(btn,false)}}
async function importMetadata(file){try{const obj=JSON.parse(await file.text());if(obj.format!=='family-photo-master-v1'||!Array.isArray(obj.photos)||!Array.isArray(obj.albums))throw Error('지원하지 않는 백업 파일');if(!confirm('앨범과 기존 사진의 제목/설명을 백업 내용으로 복원할까요? 원본 사진 파일은 복원되지 않으며, 현재 가족의 같은 ID를 가진 사진만 수정합니다.'))return;let n=0;for(const a of obj.albums){if(albums.some(x=>x.id===a.id))continue;assert(await sb.from('albums').insert({family_id:familyId,name:a.name,kind:a.kind}));n++}for(const p of obj.photos){const existing=photos.find(x=>x.id===p.id);if(!existing)continue;if(existing.owner_id!==user.id&&role!=='admin')continue;assert(await sb.from('photos').update({title:p.title||'',caption:p.caption||'',taken_on:p.taken_on||null,people:Array.isArray(p.people)?p.people:[],galleries:Array.isArray(p.galleries)&&p.galleries.length?p.galleries:['family']}).eq('id',p.id))}await loadData();renderManage();$('backupStatus').textContent=`정보 복원 완료. 앨범 ${n}개 추가. (사진 자체는 가져오지 않습니다)`}catch(e){$('backupStatus').textContent='복원 실패: '+e.message}}
function setView(next){stopSlide();view=next;selectedAlbum='';render()}
function bind(){
 $('modeLogin').onclick=()=>setAuthMode('login');$('modeSignup').onclick=()=>setAuthMode('signup');$('authForm').onsubmit=async e=>{e.preventDefault();const btn=$('authSubmit');busy(btn,true);$('authMessage').textContent='';try{const credentials={email:$('email').value.trim(),password:$('password').value};const res=authMode==='login'?await sb.auth.signInWithPassword(credentials):await sb.auth.signUp(credentials);assert(res);if(res.data?.session){user=res.data.session.user;await loadAccount()}$('authMessage').textContent=authMode==='signup'&&!res.data.session?'가입 메일을 확인하고 인증한 뒤 로그인하세요.':(!familyId?'로그인되었습니다. 가족 참여 정보를 확인해 주세요.':'')}catch(e){$('authMessage').textContent=e.message}finally{busy(btn,false)}};
 $('createFamily').onclick=async()=>{try{assert(await sb.rpc('create_family',{family_name:$('familyName').value.trim()}));await loadAccount();toast('가족 사진관을 만들었습니다')}catch(e){toast(e.message)}};
 $('joinFamily').onclick=async()=>{try{assert(await sb.rpc('join_family',{invite_code:$('joinCode').value.trim()}));await loadAccount();toast('가족 사진관에 참여했습니다')}catch(e){toast(e.message)}};
 $('logout').onclick=async()=>{stopSlide();await sb.auth.signOut();user=null;familyId=null;showMain()};
 $all('.nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));$all('[data-space]').forEach(b=>b.onclick=()=>setView(b.dataset.space));['search','albumFilter','personFilter','dateFilter'].forEach(id=>$(id).addEventListener(id==='search'?'input':'change',render));$('clearFilters').onclick=()=>{['search','albumFilter','personFilter','dateFilter'].forEach(id=>$(id).value='');render()};
 $('uploadButton').onclick=()=>{if(!photoWritesEnabled){toast('사진 서버 연결 및 접근 권한 검증 후 등록할 수 있습니다.');return;}$('uploadChild').checked=view==='child';$('uploadFamily').checked=view!=='child';$('uploadDate').value=new Date().toLocaleDateString('en-CA');$('uploadProgress').textContent='';open('uploadModal')};$('startUpload').onclick=()=>uploadPhotos().catch(e=>toast(e.message));$('manageButton').onclick=manage;
 $all('[data-close]').forEach(b=>b.onclick=()=>close(b.dataset.close));$('viewerClose').onclick=()=>{stopSlide();close('viewer')};$('prev').onclick=()=>movePhoto(-1);$('next').onclick=()=>movePhoto(1);$('slideToggle').onclick=()=>{if(slideTimer){stopSlide();return}slideTimer=setInterval(()=>movePhoto(1),4500);$('slideToggle').textContent='Ⅱ 일시정지'};
 $('favoriteButton').onclick=toggleFav;$('editButton').onclick=editPhoto;$('saveEdit').onclick=saveEdit;$('trashButton').onclick=()=>setDeleted(true);$('restoreButton').onclick=()=>setDeleted(false);$('downloadOriginal').onclick=()=>viewerPhoto&&download(viewerPhoto.original_path,viewerPhoto.original_name).catch(e=>toast(e.message));
 $('addAlbum').onclick=addAlbum;$('generateInvite').onclick=invite;$('copyInviteLink').onclick=copyInviteLink;$('exportMetadata').onclick=exportMetadata;$('exportPhotos').onclick=exportPhotos;$('importMetadata').onclick=()=>$('importFile').click();$('importFile').onchange=e=>{if(e.target.files[0])importMetadata(e.target.files[0]);e.target.value=''};
 document.addEventListener('keydown',e=>{if($('viewer').classList.contains('hidden'))return;if(e.key==='Escape'){stopSlide();close('viewer')}else if(e.key==='ArrowRight')movePhoto(1);else if(e.key==='ArrowLeft')movePhoto(-1)})}
function setAuthMode(mode){authMode=mode;$('modeLogin').classList.toggle('active',mode==='login');$('modeSignup').classList.toggle('active',mode==='signup');$('authSubmit').textContent=mode==='login'?'로그인':'가입하기';$('authMessage').textContent=''}
bind();const invitation=new URLSearchParams(location.search).get('invite');if(invitation){$('joinCode').value=invitation;history.replaceState(null,'',location.pathname+location.hash)}init().catch(e=>{showMain();toast('초기화 실패: '+e.message)});


// MASTER V1.4: 브라우저 메모리 전용 사진묶음 연습 — 서버/DB 쓰기 및 영구 저장 없음.
(function setupGroupPractice(){
 const need=['previewButton','previewModal','practiceGroup','practiceNewGroup','previewFiles','previewGrid','previewStage'];
 if(need.some(id=>!$(id)))return;
 let groups=[],selected='',items=[],visible=[],active=0,timer=null;
 const stop=()=>{if(timer)clearInterval(timer);timer=null;$('previewSlide').textContent='▶ 자동 슬라이드'};
 const group=()=>groups.find(g=>g.id===selected);
 const title=()=>group()?.name||'사진묶음';
 const closeStage=()=>{stop();hide('previewStage');$('practiceMedia').replaceChildren()};
 function redraw(){
  const sel=$('practiceGroup');sel.replaceChildren();
  for(const g of groups){const o=document.createElement('option');o.value=g.id;o.textContent=g.name+' ('+items.filter(x=>x.group===g.id).length+')';sel.append(o)}
  if(groups.some(g=>g.id===selected))sel.value=selected;
  visible=items.filter(x=>x.group===selected);$('previewGrid').replaceChildren();
  visible.forEach((item,index)=>{
   const card=document.createElement('div');card.className='practice-card';
   const btn=document.createElement('button');btn.type='button';btn.className='photo-card';
   const thumb=item.file.type.startsWith('video/')?document.createElement('video'):document.createElement('img');thumb.src=item.url;
   if(thumb.tagName==='VIDEO'){thumb.muted=true;thumb.preload='metadata';thumb.playsInline=true}else{thumb.alt=item.name;thumb.loading='lazy'}
   const meta=document.createElement('div');meta.className='meta';const strong=document.createElement('strong');strong.textContent=item.name;const small=document.createElement('small');small.textContent=item.file.type.startsWith('video/')?'▶ 동영상':item.categories.join(' · ');meta.append(strong,small);
   btn.append(thumb,meta);btn.onclick=()=>showStage(index);card.append(btn);
   const remove=document.createElement('button');remove.type='button';remove.className='practice-remove';remove.textContent='이 사진 제외';remove.onclick=()=>{if(!confirm('시험용 묶음에서 이 파일을 제외할까요? 노트북의 원본 파일은 삭제되지 않습니다.'))return;closeStage();URL.revokeObjectURL(item.url);items=items.filter(x=>x!==item);redraw()};card.append(remove);$('previewGrid').append(card);
  });
  $('previewCount').textContent=groups.length?`현재 「${title()}」 ${visible.length}개 · 전체 ${items.length}개 · 서버 저장 없음`:'먼저 사진묶음을 만들어 주세요.';
  $('practiceRename').disabled=!group();$('practiceDelete').disabled=!group();
 }
 function makeGroup(name){if(!name?.trim())return;const g={id:crypto.randomUUID(),name:name.trim().slice(0,80)};groups.push(g);selected=g.id;closeStage();redraw()}
 function showStage(index){if(!visible.length)return;stop();active=(index+visible.length)%visible.length;const item=visible[active],host=$('practiceMedia');host.replaceChildren();const el=document.createElement(item.file.type.startsWith('video/')?'video':'img');el.src=item.url;if(el.tagName==='VIDEO'){el.controls=true;el.playsInline=true;el.preload='metadata'}else el.alt=item.name;host.append(el);$('previewPosition').textContent=`${title()} · ${active+1} / ${visible.length}`;$('previewTitle').textContent=item.name;hide('previewStage',false)}
 function clearAll(){closeStage();for(const x of items)URL.revokeObjectURL(x.url);items=[];groups=[];selected='';$('previewFiles').value='';redraw()}
 const leave=()=>{clearAll();close('previewModal')};
 $('previewButton').onclick=()=>open('previewModal');$('previewClose').onclick=leave;$('previewDone').onclick=leave;
 $('previewClear').onclick=()=>{if(items.length&&!confirm('시험 중인 모든 사진묶음과 미리보기 목록을 비울까요? 원본 파일에는 영향이 없습니다.'))return;clearAll()};
 $('practiceNewGroup').onclick=()=>{const name=prompt('새 사진묶음 이름 (예: 아이의 첫 등교)');if(name?.trim())makeGroup(name)};
 $('practiceGroup').onchange=e=>{selected=e.target.value;closeStage();redraw()};
 $('practiceRename').onclick=()=>{const g=group();if(!g)return;const name=prompt('사진묶음 이름',g.name);if(name?.trim()){g.name=name.trim().slice(0,80);redraw()}};
 $('practiceDelete').onclick=()=>{const g=group();if(!g)return;if(!confirm(`「${g.name}」 묶음을 지울까요? 시험용 목록에서만 제외됩니다.`))return;closeStage();for(const x of items.filter(x=>x.group===g.id))URL.revokeObjectURL(x.url);items=items.filter(x=>x.group!==g.id);groups=groups.filter(x=>x.id!==g.id);selected=groups[0]?.id||'';redraw()};
 $('previewFiles').onchange=e=>{
  if(!group()){toast('먼저 사진묶음을 만들어 주세요.');e.target.value='';return}
  const files=Array.from(e.target.files||[]).filter(f=>f.type.startsWith('image/')||f.type.startsWith('video/')).slice(0,100);
  const categories=[$('previewChild').checked?'아이의 사진':null,$('previewFamily').checked?'가족의 사진':null].filter(Boolean);
  if(!categories.length){toast('사진관을 하나 이상 선택해 주세요.');e.target.value='';return}
  for(const file of files){items.push({file,name:file.name,url:URL.createObjectURL(file),group:selected,categories})}
  e.target.value='';closeStage();redraw();toast(`${files.length}개 파일을 「${title()}」에 추가했습니다 (시험용)`)
 };
 $('previewPrev').onclick=()=>showStage(active-1);$('previewNext').onclick=()=>showStage(active+1);
 $('previewHideStage').onclick=closeStage;
 $('previewSlide').onclick=()=>{if(timer){stop();return}if(visible.length<2){toast('슬라이드에는 파일이 2개 이상 필요합니다.');return}timer=setInterval(()=>{active=(active+1)%visible.length;const item=visible[active];showStageWithoutStop(item)},4000);$('previewSlide').textContent='Ⅱ 슬라이드 일시정지'};
 function showStageWithoutStop(item){const host=$('practiceMedia');host.replaceChildren();const el=document.createElement(item.file.type.startsWith('video/')?'video':'img');el.src=item.url;if(el.tagName==='VIDEO'){el.controls=true;el.playsInline=true}else el.alt=item.name;host.append(el);$('previewPosition').textContent=`${title()} · ${active+1} / ${visible.length}`;$('previewTitle').textContent=item.name;}
 document.addEventListener('keydown',e=>{if($('previewModal').classList.contains('hidden'))return;if(e.key==='Escape')leave();else if(!$('previewStage').classList.contains('hidden')&&e.key==='ArrowRight')showStage(active+1);else if(!$('previewStage').classList.contains('hidden')&&e.key==='ArrowLeft')showStage(active-1)});
 window.addEventListener('pagehide',clearAll);redraw();
})();

// MASTER V1.5: persistent shared GROUP METADATA only. No media upload is performed here.
(function setupPersistedGroups(){
 const ids=['sharedGroupsButton','sharedGroupsModal','sharedGroupName','sharedGroupsList','sharedGroupsStatus'];
 if(ids.some(id=>!$(id)))return;
 let groups=[],loadingGroups=false;
 const status=s=>{$('sharedGroupsStatus').textContent=s};
 const isManager=g=>g.created_by===user?.id||role==='admin';
 const categories=()=>[$('sharedGroupChild').checked?'child':null,$('sharedGroupFamily').checked?'family':null].filter(Boolean);
 const present=g=>(g.galleries||[]).map(x=>x==='child'?'아이의 사진':'가족의 사진').join(' · ');
 function renderGroups(){
  const host=$('sharedGroupsList');host.replaceChildren();
  const selectedFilter=$('sharedGroupFilter')?.value||'all';
  const searchText=($('sharedGroupSearch')?.value||'').trim().toLocaleLowerCase('ko-KR');
  const filteredGroups=groups.filter(g=>(selectedFilter==='all'||(selectedFilter==='mine'?g.created_by===user?.id:g.created_by!==user?.id))&&(!searchText||g.name.toLocaleLowerCase('ko-KR').includes(searchText)));
  for(const g of filteredGroups){
   const card=document.createElement('article');card.className='shared-group-card';
   const details=document.createElement('details');details.className='shared-group-details';
   const summary=document.createElement('summary');summary.className='shared-group-summary';
   const info=document.createElement('span');info.className='shared-group-info';
   const heading=document.createElement('strong');heading.textContent=g.name;
   const line=document.createElement('small');line.textContent=present(g)+' · '+(g.created_by===user?.id?'내가 만든 묶음':'가족이 만든 묶음')+' · '+new Date(g.created_at).toLocaleDateString('ko-KR');
   info.append(heading,line);
   const chevron=document.createElement('span');chevron.className='shared-group-chevron';chevron.textContent='⌄';chevron.setAttribute('aria-hidden','true');
   summary.append(info,chevron);details.append(summary);
   const content=document.createElement('div');content.className='shared-group-content';
   const note=document.createElement('p');note.className='help';note.textContent='현재 사진묶음 이름과 분류만 서버에 저장됩니다. 사진·동영상 공동 등록은 비공개 저장소 검증 후 제공됩니다.';content.append(note);
   if(isManager(g)){
    const controls=document.createElement('div');controls.className='shared-group-actions';
    const edit=document.createElement('button');edit.type='button';edit.textContent='이름·분류 수정';
    edit.onclick=()=>{
     if(content.querySelector('.shared-inline-editor'))return;
     details.open=true;
     const form=document.createElement('form');form.className='shared-inline-editor';
     const nameLabel=document.createElement('label');nameLabel.textContent='수정할 사진묶음 이름';
     const nameInput=document.createElement('input');nameInput.type='text';nameInput.maxLength=80;nameInput.required=true;nameInput.value=g.name;
     nameLabel.append(nameInput);
     const fieldset=document.createElement('fieldset');fieldset.className='space-select';
     const legend=document.createElement('legend');legend.textContent='사진관 분류 (한 가지 이상 선택)';fieldset.append(legend);
     const checks={};
     for(const [key,label] of [['child','아이의 사진'],['family','가족의 사진']]){
      const lab=document.createElement('label');lab.className='check';
      const input=document.createElement('input');input.type='checkbox';input.checked=(g.galleries||[]).includes(key);
      checks[key]=input;lab.append(input,document.createTextNode(label));fieldset.append(lab);
     }
     const actions=document.createElement('div');actions.className='shared-edit-actions';
     const save=document.createElement('button');save.type='submit';save.className='primary';save.textContent='변경 저장';
     const cancel=document.createElement('button');cancel.type='button';cancel.textContent='취소';
     cancel.onclick=()=>{form.remove();edit.disabled=false;};
     actions.append(save,cancel);form.append(nameLabel,fieldset,actions);
     content.append(form);edit.disabled=true;nameInput.focus();
     form.addEventListener('submit',async e=>{
      e.preventDefault();
      const name=nameInput.value.trim();
      const values=Object.entries(checks).filter(([,box])=>box.checked).map(([key])=>key);
      if(!name||name.length>80){toast('이름을 1~80글자로 입력하세요.');nameInput.focus();return}
      if(!values.length){toast('사진관 분류를 하나 이상 선택하세요.');return}
      save.disabled=true;cancel.disabled=true;save.textContent='저장 중…';
      try{
       assert(await sb.from('photo_groups').update({name,galleries:values}).eq('id',g.id).eq('family_id',familyId).select('id').single());
       toast('변경 사항을 저장했습니다.');await reload();
      }catch(err){toast('변경 저장 실패: '+err.message);save.disabled=false;cancel.disabled=false;save.textContent='변경 저장'}
     });
    };
    const del=document.createElement('button');del.type='button';del.className='danger';del.textContent='묶음 삭제';
    del.onclick=async()=>{
     if(!confirm(`「${g.name}」 묶음 정보를 삭제할까요? 이후 사진이 연결되면 사진부터 안전하게 분리해야 합니다.`))return;
     del.disabled=true;
     try{assert(await sb.from('photo_groups').delete().eq('id',g.id).eq('family_id',familyId).select('id').single());toast('묶음을 삭제했습니다.');await reload()}
     catch(e){toast('삭제 실패: '+e.message)}finally{del.disabled=false}
    };
    controls.append(edit,del);content.append(controls);
   }
   details.append(content);card.append(details);host.append(card);
  }
  status(groups.length?`공동 묶음 총 ${groups.length}개 · 현재 표시 ${filteredGroups.length}개 · 이름과 분류만 서버 저장`:'아직 공동 사진묶음이 없습니다. 첫 묶음을 만들어보세요.');
  if(groups.length&&!filteredGroups.length){const empty=document.createElement('p');empty.className='help';empty.textContent='검색 조건에 맞는 묶음이 없습니다.';host.append(empty)}
 }

 async function reload(){
  if(!sb||!user||!familyId){status('로그인 후 이용할 수 있습니다.');return}
  if(loadingGroups)return;
  loadingGroups=true;status('서버에서 목록을 불러오는 중…');
  try{const data=assert(await sb.from('photo_groups').select('id,family_id,name,galleries,created_by,created_at').eq('family_id',familyId).order('created_at',{ascending:false}).limit(500));groups=data||[];renderGroups()}
  catch(e){status('목록을 읽을 수 없습니다. Supabase에서 V1.5 SQL을 먼저 실행했는지 확인하세요. ('+e.message+')');$('sharedGroupsList').replaceChildren()}
  finally{loadingGroups=false}
 }
 $('sharedGroupsButton').onclick=()=>{if(!user||!familyId){toast('먼저 가족사진관에 로그인하세요.');return}open('sharedGroupsModal');showCreate(false);reload()};
 const leave=()=>close('sharedGroupsModal');$('sharedGroupsClose').onclick=leave;$('sharedGroupsDone').onclick=leave;
 const createPanel=$('sharedCreatePanel'),createToggle=$('sharedGroupNewToggle');
 const showCreate=visible=>{createPanel.classList.toggle('hidden',!visible);createToggle.setAttribute('aria-expanded',String(visible));createToggle.textContent=visible?'－ 새 묶음 닫기':'＋ 새 사진묶음';if(visible)$('sharedGroupName').focus();};
 createToggle.onclick=()=>showCreate(createPanel.classList.contains('hidden'));
 $('sharedGroupNewCancel').onclick=()=>showCreate(false);
 $('sharedGroupRefresh').onclick=reload;
 $('sharedGroupFilter').onchange=renderGroups;
 $('sharedGroupSearch').oninput=renderGroups;
 $('familyAccessCheck').onclick=async()=>{
  const result=$('familyAccessResult'),button=$('familyAccessCheck');
  if(!user||!familyId){result.textContent='로그인된 가족 계정이 없습니다.';return}
  button.disabled=true;result.textContent='Supabase에서 가족 권한과 사진묶음 조회를 확인하는 중…';
  try{
   const [membershipResult, groupResult, countResult]=await Promise.all([
    sb.from('memberships').select('role').eq('family_id',familyId).eq('user_id',user.id).single(),
    sb.from('photo_groups').select('id,created_by').eq('family_id',familyId).limit(500),
    sb.from('memberships').select('user_id').eq('family_id',familyId)
   ]);
   const membership=assert(membershipResult),items=assert(groupResult),memberRows=assert(countResult);
   if(!membership)throw Error('가족 가입 정보를 읽지 못했습니다.');
   const mine=items.filter(g=>g.created_by===user.id).length,others=items.length-mine;
   result.textContent=`✅ 내 계정 가족 인증 확인 · 역할: ${membership.role==='admin'?'관리자':'가족'} · 등록된 가족 계정 ${memberRows.length}명 · 사진묶음 ${items.length}개 (내가 만든 ${mine}개 / 다른 가족 ${others}개). 이는 현재 계정의 조회 시험이며 다른 가족 로그인·비회원 차단 시험을 대신하지 않습니다.`;
  }catch(err){result.textContent='⚠️ 점검 실패: '+err.message}
  finally{button.disabled=false}
 };
 $('sharedGroupCreate').onclick=async()=>{
  if(!user||!familyId)return;
  const name=$('sharedGroupName').value.trim(),galleries=categories();
  if(!name||name.length>80){toast('사진묶음 이름은 1~80글자로 입력하세요.');return}
  if(!galleries.length){toast('사진관 분류를 하나 이상 선택하세요.');return}
  const button=$('sharedGroupCreate');button.disabled=true;
  try{
   assert(await sb.from('photo_groups').insert({family_id:familyId,created_by:user.id,name,galleries}).select('id').single());
   $('sharedGroupName').value='';showCreate(false);toast('사진묶음 정보를 저장했습니다.');await reload();
  }catch(e){toast('묶음 저장 실패: '+e.message)}finally{button.disabled=false}
 };
})();
