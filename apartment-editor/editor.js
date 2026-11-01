import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';
import {starter,copy,clamp,snap,edgeId,edges,segment,area,roomBounds,bounds,center,moveNode,moveEdge,resizeEdge,resizeRoom,splitEdge,addRoom,addPolygonRoom,onEdge,project,safeDocument} from './geometry.js';
const $=id=>document.getElementById(id);
const STORE='satellite-apartment-plan-v2', OLD='satellite-apartment-editor-v1';
let doc=starter();try{const v=localStorage.getItem(STORE),old=localStorage.getItem(OLD);if(v)doc=safeDocument(JSON.parse(v));else if(old)doc=starter(JSON.parse(old));}catch(e){console.warn('Could not load old project',e);}
const isMobile=window.matchMedia('(pointer:coarse)').matches||window.innerWidth<780;
const scene=new THREE.Scene();scene.background=new THREE.Color('#e4efea');const world=new THREE.Group(),decor=new THREE.Group();scene.add(world,decor);
scene.add(new THREE.HemisphereLight(0xffffff,0xb4b5aa,2));const sun=new THREE.DirectionalLight(0xffffff,2);sun.position.set(-15,22,-10);scene.add(sun);
const viewport=$('viewport'),renderer=new THREE.WebGLRenderer({antialias:!isMobile,powerPreference:isMobile?'low-power':'default'});renderer.setPixelRatio(isMobile?Math.min(1,devicePixelRatio):Math.min(1.5,devicePixelRatio));renderer.outputColorSpace=THREE.SRGBColorSpace;viewport.appendChild(renderer.domElement);
const plan=new THREE.OrthographicCamera(-10,10,10,-10,.1,180),iso=new THREE.OrthographicCamera(-10,10,10,-10,.1,180),sideCam=new THREE.OrthographicCamera(-10,10,10,-10,.1,180),perspective=new THREE.PerspectiveCamera(45,1,.1,200);
const controls={plan:new OrbitControls(plan,renderer.domElement),iso:new OrbitControls(iso,renderer.domElement),perspective:new OrbitControls(perspective,renderer.domElement),side:new OrbitControls(sideCam,renderer.domElement)};
controls.plan.enableRotate=false;controls.side.enableRotate=false;for(const c of Object.values(controls)){c.enableDamping=false;c.addEventListener('change',invalidate);}
let mode='plan',side='front',cut=$('cut').checked,selected=null,drawMode=null,drawPoints=[],drag=null,interactive=[],renderScheduled=false,buildAt=0,buildTimer=null,textureCache=new Map(),assets=new Map(),building=0;
const caster=new THREE.Raycaster(),mouse=new THREE.Vector2(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),hit=new THREE.Vector3();
function status(s){$('status').textContent=s;}function activeCamera(){return mode==='plan'?plan:mode==='iso'?iso:mode==='perspective'?perspective:sideCam;}function activeControls(){return controls[mode==='front'||mode==='back'||mode==='left'||mode==='right'?'side':mode];}
function invalidate(){if(renderScheduled||document.hidden)return;renderScheduled=true;requestAnimationFrame(()=>{renderScheduled=false;renderer.render(scene,activeCamera());});}
function persist(){try{localStorage.setItem(STORE,JSON.stringify(doc));}catch(e){status('Хранилище переполнено — сохрани JSON');}}
function pointFromEvent(ev){const b=renderer.domElement.getBoundingClientRect();mouse.set((ev.clientX-b.left)/b.width*2-1,-((ev.clientY-b.top)/b.height)*2+1);caster.setFromCamera(mouse,activeCamera());if(!caster.ray.intersectPlane(plane,hit))return null;return {x:snap(hit.x),z:snap(hit.z)};}
function picked(ev){const b=renderer.domElement.getBoundingClientRect();mouse.set((ev.clientX-b.left)/b.width*2-1,-((ev.clientY-b.top)/b.height)*2+1);caster.setFromCamera(mouse,activeCamera());return caster.intersectObjects(interactive,false)[0]?.object||null;}
function dispose(group){const geometries=new Set(),materials=new Set();group.traverse(o=>{if(o.geometry&&!geometries.has(o.geometry)){geometries.add(o.geometry);o.geometry.dispose();}for(const m of (Array.isArray(o.material)?o.material:[o.material])){if(!m||materials.has(m))continue;materials.add(m);if(m.map&&!textureCacheHas(m.map))m.map.dispose();m.dispose();}});group.clear();}
function textureCacheHas(t){return [...textureCache.values()].some(x=>x.texture===t);}
function material(color,extra={}){return new THREE.MeshLambertMaterial({color,...extra});}
function box(parent,w,h,d,x,y,z,color,extra={}){const o=new THREE.Mesh(new THREE.BoxGeometry(Math.max(.015,w),Math.max(.015,h),Math.max(.015,d)),typeof color==='string'?material(color):color);o.position.set(x,y,z);Object.assign(o.userData,extra);parent.add(o);if(extra.hit)interactive.push(o);return o;}
function orb(parent,x,z,kind,id,color,r=.2){const mesh=new THREE.Mesh(new THREE.SphereGeometry(r*(isMobile?1.4:1),8,6),new THREE.MeshBasicMaterial({color,depthTest:false}));mesh.position.set(x,.9,z);mesh.renderOrder=50;mesh.userData={kind,id,hit:true};parent.add(mesh);interactive.push(mesh);return mesh;}
function floorGeometry(points){const contour=points.map(p=>new THREE.Vector2(p.x,p.z));const tris=THREE.ShapeUtils.triangulateShape(contour,[]);const vertices=[];const indices=[];const uvs=[];for(const p of points){vertices.push(p.x,-.06,p.z);uvs.push(p.x,p.z);}for(const t of tris)indices.push(...t);const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);g.computeVertexNormals();return g;}
function label(text,x,z){if(mode!=='plan'||drag)return;const canvas=document.createElement('canvas');canvas.width=400;canvas.height=100;const ctx=canvas.getContext('2d');ctx.font='bold 30px sans-serif';ctx.fillStyle='#4c736d';ctx.textAlign='center';ctx.fillText(text.slice(0,24),200,57);const t=new THREE.CanvasTexture(canvas);const o=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthWrite:false}));o.position.set(x,.2,z);o.scale.set(2.2,.55,1);decor.add(o);}
function floor(room){const coords=room.vertices.map(id=>doc.nodes[id]);const mat=material(room.color||'#dbdbd5',{side:THREE.DoubleSide});if(doc.textures?.[room.id]){const source=doc.textures[room.id];let cache=textureCache.get(room.id);if(!cache||cache.src!==source){if(cache)cache.texture.dispose();const t=new THREE.TextureLoader().load(source,invalidate);t.colorSpace=THREE.SRGBColorSpace;t.wrapS=t.wrapT=THREE.RepeatWrapping;textureCache.set(room.id,{src:source,texture:t});cache=textureCache.get(room.id);}const b=roomBounds(doc,room);cache.texture.repeat.set(Math.max(1,(b.maxX-b.minX)/.7),Math.max(1,(b.maxZ-b.minZ)/.7));mat.color.set('#ffffff');mat.map=cache.texture;}
 const g=floorGeometry(coords),o=new THREE.Mesh(g,mat);o.userData={kind:'room',id:room.id,hit:true};world.add(o);interactive.push(o);const c=center(doc,room);label(room.name,c.x,c.z);}
function addSegment(e,start,end,y0,y1,tint){const info=segment(doc,e);const len=info.length*(end-start);if(len<.025||y1-y0<.015)return;const t=(start+end)/2,p=onEdge(doc,e,t);const thickness=clamp(Number(doc.walls[e.id]?.thickness)||.14,.06,.5);const color=selected?.kind==='wall'&&selected.id===e.id?'#d79b64':tint;const o=box(world,len,y1-y0,thickness,p.x,(y0+y1)/2,p.z,color,{kind:'wall',id:e.id,hit:true});o.rotation.y=-Math.atan2(info.dz,info.dx);const collider=box(decor,len,.75,Math.max(.34,thickness),p.x,.42,p.z,new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),{kind:'wall',id:e.id,hit:true});collider.rotation.y=o.rotation.y;}
function addWall(e){const info=segment(doc,e);if(info.length<.12)return;const openings=doc.openings.filter(o=>o.wall===e.id).map(o=>({...o,t:clamp(o.t,.03,.97),half:Math.min(.45,Math.max(.1,o.width/info.length/2))})).sort((a,b)=>a.t-b.t);
 const low=mode==='plan'?.35:mode==='iso'&&cut?1.03:cut&&mode==='perspective'?1.1:doc.height;let from=0;
 for(const opening of openings){const s=clamp(opening.t-opening.half,from,1),end=clamp(opening.t+opening.half,s,1);if(s>from)addSegment(e,from,s,0,low,'#e2dcd3');if(end>s){const sill=opening.kind==='door'?0:.82,top=opening.kind==='door'?2.12:2.03;if(low>sill)addSegment(e,s,end,0,Math.min(sill,low),'#e2dcd3');if(low>top)addSegment(e,s,end,top,low,'#e2dcd3');if(mode!=='plan'&&low>sill){const m=onEdge(doc,e,(s+end)/2),o=box(world,info.length*(end-s),Math.min(top,low)-sill,.018,m.x,(Math.min(top,low)+sill)/2,m.z,material(opening.kind==='door'?'#d5b57a':'#86c5dc',{transparent:true,opacity:.52}),{kind:'opening',id:opening.id,hit:true});o.rotation.y=-Math.atan2(info.dz,info.dx);}}
 from=end;}if(from<1)addSegment(e,from,1,0,low,'#e2dcd3');}
function addFurniture(f){const group=new THREE.Group();group.position.set(f.x,0,f.z);group.rotation.y=(f.rotation||0)*Math.PI/180;world.add(group);
 if(f.type==='imported'&&f.asset){box(group,f.w,.15,f.d,0,.075,0,f.color||'#aa9e90',{kind:'furniture',id:f.id,hit:true});const stamp=building;const saved=assets.get(f.id);if(saved){const object=saved.clone(true);const b=new THREE.Box3().setFromObject(object),s=b.getSize(new THREE.Vector3());object.scale.set(f.w/s.x,f.h/s.y,f.d/s.z);group.add(object);}else{try{const raw=Uint8Array.from(atob(f.asset.split(',')[1]),c=>c.charCodeAt(0));new GLTFLoader().parse(raw.buffer,'',g=>{if(stamp!==building)return;assets.set(f.id,g.scene);rebuild();},()=>{});}catch{}}
 }else {const color=f.color||'#a0aaa0';if(f.type==='sofa'){box(group,f.w,.28,f.d,0,.33,0,color);box(group,f.w,.42,.16,0,.57,-f.d/2+.08,color);}else if(f.type==='bed'){box(group,f.w,.35,f.d,0,.25,0,'#a49389');box(group,f.w-.08,.16,f.d-.1,0,.54,0,color);}else if(f.type==='table'){box(group,f.w,.1,f.d,0,f.h-.05,0,color);box(group,.10,f.h-.1,.1,0,(f.h-.1)/2,0,'#7e695f');}else box(group,f.w,f.h,f.d,0,f.h/2,0,color);}
 const picker=box(decor,f.w,Math.max(.55,f.h),f.d,f.x,Math.max(.55,f.h)/2,f.z,new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}),{kind:'furniture',id:f.id,hit:true});picker.rotation.y=group.rotation.y;
 if(selected?.kind==='furniture'&&selected.id===f.id&&mode==='plan')orb(decor,f.x,f.z,'furniture',f.id,'#ffa43c',.21);}
function rebuild(){building++;interactive=[];dispose(world);dispose(decor);for(const [key,value] of textureCache)if(doc.textures?.[key]!==value.src){value.texture.dispose();textureCache.delete(key);}for(const r of doc.rooms)floor(r);
 const walls=edges(doc);for(const e of walls)addWall(e);for(const f of doc.furniture)addFurniture(f);
 if(mode==='plan'){for(const [id,p] of Object.entries(doc.nodes))orb(decor,p.x,p.z,'node',id,selected?.kind==='node'&&selected.id===id?'#ffc129':'#e55f45',.14);
 for(const e of walls){const {mid}=segment(doc,e);orb(decor,mid.x,mid.z,'wall',e.id,selected?.kind==='wall'&&selected.id===e.id?'#f6a828':'#87a9a1',.095);}for(const o of doc.openings){const e=walls.find(e=>e.id===o.wall);if(!e)continue;const p=onEdge(doc,e,o.t);orb(decor,p.x,p.z,'opening',o.id,o.kind==='door'?'#e7a70b':'#149cd0',.20);}}
 invalidate();}
function resizeViewport(){const w=viewport.clientWidth,h=viewport.clientHeight;if(!w||!h)return;renderer.setSize(w,h,false);const ar=w/h;perspective.aspect=ar;perspective.updateProjectionMatrix();for(const cam of [plan,iso,sideCam]){const size=cam.userData.size||20;cam.left=-size*ar/2;cam.right=size*ar/2;cam.top=size/2;cam.bottom=-size/2;cam.updateProjectionMatrix();}invalidate();}
function resetCamera(){const b=bounds(doc),cx=(b.minX+b.maxX)/2,cz=(b.minZ+b.maxZ)/2,aspect=Math.max(.3,viewport.clientWidth/Math.max(1,viewport.clientHeight)),span=Math.max((b.maxZ-b.minZ)*1.4,(b.maxX-b.minX)*1.2/aspect);for(const cam of [plan,iso,sideCam])cam.userData.size=span;
 plan.position.set(cx,45,cz);plan.up.set(0,0,-1);controls.plan.target.set(cx,0,cz);plan.lookAt(cx,0,cz);
 iso.position.set(cx+span*.72,span*.96,cz+span*.92);iso.up.set(0,1,0);controls.iso.target.set(cx,0,cz);iso.lookAt(cx,0,cz);
 perspective.position.set(cx+span*.8,span*.81,cz+span*.94);controls.perspective.target.set(cx,0,cz);perspective.lookAt(cx,0,cz);
 const location={front:[cx,doc.height*.7,b.minZ-span],back:[cx,doc.height*.7,b.maxZ+span],left:[b.minX-span,doc.height*.7,cz],right:[b.maxX+span,doc.height*.7,cz]}[side];sideCam.position.set(...location);sideCam.up.set(0,1,0);controls.side.target.set(cx,doc.height*.55,cz);sideCam.lookAt(cx,doc.height*.55,cz);resizeViewport();}
function setView(next){if(['front','back','left','right'].includes(next)){side=next;mode='side';$('side').value=next;}else{mode=next;$('side').value='';}
 for(const [name,c] of Object.entries(controls))c.enabled=name===mode;
 for(const x of ['plan','iso','perspective'])$(x).classList.toggle('active',mode===x);
 $('viewTitle').textContent=mode==='plan'?'План сверху':mode==='iso'?'Изометрия · как в Sims':mode==='perspective'?'3D · вращай':'Фасад · '+({front:'окна',back:'сзади',left:'слева',right:'справа'}[side]);
 $('tip').textContent=mode==='plan'?'Тяни красные углы, стены, двери, окна и мебель. Два пальца — масштаб.':'Вращай / приближай двумя пальцами. Для изменения формы используй план сверху.';
 const b=bounds(doc);$('measure').textContent=`${(b.maxX-b.minX).toFixed(1)} × ${(b.maxZ-b.minZ).toFixed(1)} м · потолок ${doc.height.toFixed(2)} м`;
 drag=null;drawMode=null;drawPoints=[];resetCamera();rebuild();}
function markChanged(rebuildNow=true){persist();if(rebuildNow)rebuild();}
function scheduleRebuild(){const now=performance.now();if(now-buildAt>75){buildAt=now;rebuild();return;}if(buildTimer)return;buildTimer=setTimeout(()=>{buildTimer=null;buildAt=performance.now();rebuild();},75);}
function roomSelect(){const s=$('furnitureRoom'),v=s.value;s.replaceChildren();for(const r of doc.rooms.filter(r=>r.kind!=='balcony')){const opt=document.createElement('option');opt.value=r.id;opt.textContent=r.name;s.appendChild(opt);}if([...s.options].some(x=>x.value===v))s.value=v;}
function updateSelection(){for(const id of ['wallPanel','cornerPanel','roomPanel','openingPanel','furniturePanel'])$(id).hidden=true;
 const sel=selected;if(sel?.kind==='wall'){const e=edges(doc).find(e=>e.id===sel.id);if(e){$('wallPanel').hidden=false;$('wallLength').value=segment(doc,e).length.toFixed(2);$('wallThickness').value=Math.round(100*(doc.walls[e.id]?.thickness||.14));$('removePartition').hidden=!doc.partitions.some(p=>edgeId(p.a,p.b)===e.id);}}
 if(sel?.kind==='node'){const p=doc.nodes[sel.id];if(p){$('cornerPanel').hidden=false;$('cornerX').value=p.x;$('cornerZ').value=p.z;}}
 if(sel?.kind==='room'){const r=doc.rooms.find(r=>r.id===sel.id);if(r){$('roomPanel').hidden=false;$('roomName').value=r.name;$('roomColor').value=r.color;$('roomStats').textContent=`Площадь ${area(doc,r).toFixed(2)} м² · ${r.vertices.length} углов`;}}
 if(sel?.kind==='opening'){const o=doc.openings.find(o=>o.id===sel.id);if(o){$('openingPanel').hidden=false;$('openingKind').value=o.kind;$('openingWidth').value=o.width;}}
 if(sel?.kind==='furniture'){const f=doc.furniture.find(f=>f.id===sel.id);if(f){$('furniturePanel').hidden=false;$('furnitureWidth').value=f.w;$('furnitureDepth').value=f.d;$('furnitureRotation').value=f.rotation||0;}}
}
function select(kind,id){selected={kind,id};updateSelection();rebuild();}
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}
function uid(){return 'u'+doc.nextId++;}
function addOpening(kind){const e=edges(doc).find(e=>e.id===selected?.id&&selected.kind==='wall');if(!e){status('Сначала выбери стену');return;}const length=segment(doc,e).length;if(length<.55){status('Стена слишком короткая');return;}const o={id:uid(),wall:e.id,kind,t:.5,width:Math.min(kind==='door'?.82:1.2,length*.45)};doc.openings.push(o);selected={kind:'opening',id:o.id};updateSelection();markChanged();}
function checkedChange(id,cb){$(id).addEventListener('change',cb);}
for(const name of ['plan','iso','perspective'])$(name).onclick=()=>setView(name);
checkedChange('side',e=>{if(e.target.value)setView(e.target.value);});checkedChange('cut',e=>{cut=e.target.checked;rebuild();});$('resetCamera').onclick=resetCamera;
$('saveJson').onclick=()=>download(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),'satellite-apartment.json');
checkedChange('openJson',async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>22_000_000)throw Error('Файл слишком большой');const raw=JSON.parse(await f.text());doc=raw.version===2?safeDocument(raw):raw.version===1?starter(raw):(()=>{throw Error('Неизвестная версия')})();selected=null;roomSelect();updateSelection();markChanged();resetCamera();status('Проект загружен');}catch(err){status('Ошибка: '+err.message);}finally{e.target.value='';}});
$('exportGlb').onclick=async()=>{status('Создаю GLB для Blender…');const prevMode=mode,prevCut=cut;try{mode='perspective';cut=false;rebuild();const exporter=new GLTFExporter();const binary=await exporter.parseAsync(world,{binary:true,onlyVisible:true,maxTextureSize:1024});download(new Blob([binary],{type:'model/gltf-binary'}),'my-apartment.glb');status('GLB сохранён');}catch(e){console.error(e);status('Ошибка экспорта: '+e.message);}finally{mode=prevMode;cut=prevCut;rebuild();}};
$('splitWall').onclick=()=>{const e=edges(doc).find(e=>e.id===selected?.id&&selected.kind==='wall');if(!e){status('Нажми на стену, чтобы добавить угол');return;}const id=splitEdge(doc,e);if(id){selected={kind:'node',id};updateSelection();markChanged();}else status('Слишком короткая стена');};
$('drawWall').onclick=()=>{if(mode!=='plan')setView('plan');drawMode=drawMode==='wall'?null:'wall';drawPoints=[];$('drawWall').classList.toggle('active',!!drawMode);status(drawMode?'Отметь начало и конец перегородки':'Рисование выключено');};
$('polygonRoom').onclick=()=>{if(mode!=='plan')setView('plan');drawMode='room';drawPoints=[];$('finishPolygon').hidden=false;status('Нажми 3 или больше углов нового помещения');};
$('finishPolygon').onclick=()=>{const room=addPolygonRoom(doc,drawPoints,'Новая комната');if(!room){status('Контур должен содержать 3 угла и не пересекать сам себя');return;}drawPoints=[];drawMode=null;$('finishPolygon').hidden=true;selected={kind:'room',id:room.id};roomSelect();updateSelection();markChanged();};
$('addRightRoom').onclick=()=>{const r=addRoom(doc,'Новая комната справа');selected={kind:'room',id:r.id};roomSelect();updateSelection();markChanged();resetCamera();};
$('removeRoom').onclick=()=>{const id=selected?.id,r=doc.rooms.find(x=>x.id===id);if(!r||!confirm('Удалить комнату «'+r.name+'»?'))return;doc.rooms=doc.rooms.filter(x=>x.id!==id);doc.furniture=doc.furniture.filter(x=>x.room!==id);selected=null;roomSelect();updateSelection();markChanged();};
$('roomName').onchange=e=>{const r=doc.rooms.find(x=>x.id===selected?.id);if(r){r.name=e.target.value.slice(0,60);roomSelect();markChanged();}};
$('roomColor').onchange=e=>{const r=doc.rooms.find(x=>x.id===selected?.id);if(r){r.color=e.target.value;markChanged();}};
for(const [button,axis,delta] of [['roomWPlus','x',.1],['roomWMinus','x',-.1],['roomDPlus','z',.1],['roomDMinus','z',-.1]])$(button).onclick=()=>{if(!resizeRoom(doc,selected?.id,axis,delta)){status('Нельзя изменить размер без пересечения стен');return;}updateSelection();markChanged();};
$('wallLength').onchange=e=>{const ed=edges(doc).find(x=>x.id===selected?.id);if(ed){if(!resizeEdge(doc,ed,Number(e.target.value)))status('Невозможно изменить длину; попробуй перетащить угол');updateSelection();markChanged();}};
$('wallThickness').onchange=e=>{if(selected?.kind!=='wall')return;doc.walls[selected.id]={...doc.walls[selected.id],thickness:clamp(Number(e.target.value)/100,.06,.5)};markChanged();};
for(const [input,prop] of [['cornerX','x'],['cornerZ','z']])$(input).onchange=e=>{if(selected?.kind!=='node')return;const p=doc.nodes[selected.id];if(!moveNode(doc,selected.id,prop==='x'?Number(e.target.value):p.x,prop==='z'?Number(e.target.value):p.z))status('Угол создаёт пересечение — перемещение отменено');updateSelection();markChanged();};
$('removePartition').onclick=()=>{doc.partitions=doc.partitions.filter(p=>edgeId(p.a,p.b)!==selected?.id);selected=null;updateSelection();markChanged();};
$('addWindow').onclick=()=>addOpening('window');$('addDoor').onclick=()=>addOpening('door');
$('openingKind').onchange=e=>{const o=doc.openings.find(x=>x.id===selected?.id);if(o){o.kind=e.target.value;markChanged();}};
$('openingWidth').onchange=e=>{const o=doc.openings.find(x=>x.id===selected?.id);if(o){o.width=clamp(Number(e.target.value),.4,3);markChanged();}};
$('removeOpening').onclick=()=>{doc.openings=doc.openings.filter(x=>x.id!==selected?.id);selected=null;updateSelection();markChanged();};
$('addFurniture').onclick=()=>{const r=doc.rooms.find(x=>x.id===$('furnitureRoom').value);if(!r)return;const c=center(doc,r),type=$('furnitureType').value;const sizes={sofa:[2,.9,.75],bed:[1.6,2,.6],table:[1,.7,.75],cabinet:[1.2,.65,1.8],box:[1,1,1]};const [w,d,h]=sizes[type];const f={id:uid(),room:r.id,type,x:c.x,z:c.z,w,d,h,rotation:0,color:'#a1a99c'};doc.furniture.push(f);selected={kind:'furniture',id:f.id};updateSelection();markChanged();};
checkedChange('importGlb',async e=>{const f=e.target.files?.[0];if(!f)return;try{if(f.size>8_000_000)throw Error('Максимум 8 МБ');const reader=new FileReader();const asset=await new Promise((resolve,reject)=>{reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(f);});const room=doc.rooms.find(x=>x.id===$('furnitureRoom').value),c=center(doc,room);const item={id:uid(),room:room.id,type:'imported',asset:asset.replace(/^data:[^;]+;/,'data:model/gltf-binary;'),x:c.x,z:c.z,w:1,d:1,h:1,rotation:0,color:'#a5aaa5'};doc.furniture.push(item);selected={kind:'furniture',id:item.id};updateSelection();markChanged();}catch(err){status('Не удалось импортировать GLB: '+err.message);}finally{e.target.value='';}});
for(const [input,key] of [['furnitureWidth','w'],['furnitureDepth','d'],['furnitureRotation','rotation']])$(input).onchange=e=>{const f=doc.furniture.find(x=>x.id===selected?.id);if(!f)return;const n=Number(e.target.value);if(!Number.isFinite(n))return;if(key!=='rotation'&&(n<.1||n>6))return;f[key]=n;updateSelection();markChanged();};
$('removeFurniture').onclick=()=>{doc.furniture=doc.furniture.filter(f=>f.id!==selected?.id);selected=null;updateSelection();markChanged();};
checkedChange('roomPhoto',async e=>{const f=e.target.files?.[0],r=doc.rooms.find(x=>x.id===selected?.id);if(!f||!r)return;if(f.size>2_500_000){status('Фото слишком большое (макс. 2.5 МБ)');return;}try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(f);});if(!/^data:image\/(png|jpeg|webp);base64,/.test(data))throw Error('Неподдерживаемое изображение');doc.textures[r.id]=data;markChanged();}catch(err){status(err.message);}finally{e.target.value='';}});
$('ceiling').value=doc.height;$('ceiling').onchange=e=>{const v=Number(e.target.value);if(v>=2&&v<=5){doc.height=v;markChanged();}else e.target.value=doc.height;};
$('resetDemo').onclick=()=>{if(!confirm('Сбросить всю планировку? Сначала сохрани JSON, если нужны изменения.'))return;doc=starter();selected=null;roomSelect();updateSelection();markChanged();resetCamera();};
// Pointer gestures. Two-finger pinch/pan stays with OrbitControls, while one finger drags a selected handle.
let pointerStart=null;
renderer.domElement.addEventListener('pointerdown',ev=>{
 if(ev.button!==0||!ev.isPrimary||mode!=='plan')return;
 if(drawMode){pointerStart={draw:true,screenX:ev.clientX,screenY:ev.clientY};return;}
 const object=picked(ev);if(!object){selected=null;updateSelection();return;}
 const {kind,id}=object.userData||{};if(!kind)return;
 selected={kind,id};updateSelection();rebuild();
 if(!['node','wall','opening','furniture'].includes(kind))return;
 const p=pointFromEvent(ev);if(!p)return;
 drag={kind,id,last:p,downX:ev.clientX,downY:ev.clientY,pointerId:ev.pointerId};activeControls().enabled=false;renderer.domElement.setPointerCapture(ev.pointerId);
 ev.preventDefault();
});
renderer.domElement.addEventListener('pointermove',ev=>{
 if(!drag||drag.pointerId!==ev.pointerId)return;const p=pointFromEvent(ev);if(!p)return;
 const deltaX=p.x-drag.last.x,deltaZ=p.z-drag.last.z;
 if(Math.abs(deltaX)+Math.abs(deltaZ)<.025)return;
 let good=false;
 if(drag.kind==='node')good=moveNode(doc,drag.id,doc.nodes[drag.id].x+deltaX,doc.nodes[drag.id].z+deltaZ);
 if(drag.kind==='wall'){const e=edges(doc).find(e=>e.id===drag.id);if(e)good=moveEdge(doc,e,deltaX,deltaZ);}
 if(drag.kind==='opening'){const o=doc.openings.find(x=>x.id===drag.id),e=edges(doc).find(e=>e.id===o?.wall);if(o&&e){o.t=clamp(project(doc,e,p),o.width/segment(doc,e).length/2+.025,1-o.width/segment(doc,e).length/2-.025);good=true;}}
 if(drag.kind==='furniture'){const f=doc.furniture.find(x=>x.id===drag.id);if(f){f.x=snap(f.x+deltaX);f.z=snap(f.z+deltaZ);good=true;}}
 if(good){drag.last=p;scheduleRebuild();}ev.preventDefault();
},{passive:false});
function completePointer(ev){if(drag&&drag.pointerId===ev.pointerId){drag=null;activeControls().enabled=true;if(renderer.domElement.hasPointerCapture(ev.pointerId))renderer.domElement.releasePointerCapture(ev.pointerId);persist();updateSelection();rebuild();return;}
 if(drawMode&&pointerStart&&ev.isPrimary){const d=Math.hypot(ev.clientX-pointerStart.screenX,ev.clientY-pointerStart.screenY);pointerStart=null;if(d>12)return;const p=pointFromEvent(ev);if(!p)return;drawPoints.push(p);
 if(drawMode==='wall'&&drawPoints.length===2){const [s,t]=drawPoints;if(Math.hypot(s.x-t.x,s.z-t.z)>.13){const a=uid(),b=uid();doc.nodes[a]=s;doc.nodes[b]=t;doc.partitions.push({a,b});selected={kind:'wall',id:edgeId(a,b)};updateSelection();markChanged();}drawPoints=[];drawMode=null;$('drawWall').classList.remove('active');}
 else {status(`Отмечено точек: ${drawPoints.length}`);invalidate();}}
}
renderer.domElement.addEventListener('pointerup',completePointer);renderer.domElement.addEventListener('pointercancel',ev=>{drag=null;pointerStart=null;activeControls().enabled=true;});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){drawMode=null;drawPoints=[];$('drawWall').classList.remove('active');$('finishPolygon').hidden=true;status('Рисование отменено');}});
new ResizeObserver(resizeViewport).observe(viewport);
window.addEventListener('visibilitychange',()=>{if(!document.hidden)invalidate();});
roomSelect();updateSelection();setView('plan');$('ceiling').value=doc.height;
