import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { defaultDocument, validateDocument, bounds, totalWidth, ROOM_IDS, ROOM_NAMES, clamp, keepFurnitureWithinRooms, roomForPosition } from './model.js';

const $ = id => document.getElementById(id);
const root = $('viewport');
const message = (text, error=false) => { $('status').textContent = text; $('error').hidden = !error; if(error) $('error').textContent = text; };
const STORAGE_KEY = 'satellite-apartment-editor-v1';
let documentData = defaultDocument();
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) documentData = validateDocument(JSON.parse(saved)); } catch (e) { console.warn('Saved project could not be loaded:', e); }
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e5eeee');
const world = new THREE.Group(); world.name = 'Apartment'; scene.add(world);
const decorations = new THREE.Group(); scene.add(decorations);
scene.add(new THREE.HemisphereLight(0xffffff, 0x9ba5a2, 2.1));
const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(0, 12, -6); scene.add(sun);
const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, preserveDrawingBuffer:true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;
root.appendChild(renderer.domElement);
const perspective = new THREE.PerspectiveCamera(46, 1, 0.1, 180);
const overhead = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 180);
const orbit3d = new OrbitControls(perspective, renderer.domElement);
orbit3d.enableDamping = true; orbit3d.maxPolarAngle = Math.PI * 0.49;
const orbit2d = new OrbitControls(overhead, renderer.domElement);
orbit2d.enableRotate = false; orbit2d.enableDamping = true;
let is2d = true;
let drawingWalls = false;
let wallStart = null;
let wallPreview = null;
let selectedId = null;
let selectedWall = null, selectedOpening = null;
let selectedMesh = null;
let wallCut = true;
let redrawVersion = 0;
let drag = null;
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0,1,0),0);
const hit = new THREE.Vector3();
let interactive = [];
const loader = new GLTFLoader();

function mat(color, extra={}) { return new THREE.MeshStandardMaterial({ color, roughness:.82, ...extra }); }
const wallMaterial = mat('#f0ede5');
const windowMaterial = mat('#91c8d2', { transparent:true, opacity:.46, roughness:.17, metalness:.08, depthWrite:false, side:THREE.DoubleSide });
const darkMaterial = mat('#4b6765');
function meshBox(parent, w,h,d,x,y,z,color, name='') {
  const o = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), typeof color==='string'?mat(color):color);
  o.position.set(x,y,z); o.name=name; o.castShadow=false; o.receiveShadow=true; parent.add(o); return o;
}
function surface(parent, x0, x1, z0, z1, color, name) { return meshBox(parent,x1-x0,.07,z1-z0,(x0+x1)/2,-.05,(z0+z1)/2,color,name); }
function addWallX(x,z0,z1,h, cut=false) {
 if (z1<=z0) return;
 const actual = cut ? Math.min(.43,h) : h;
 meshBox(world,.13,actual,z1-z0,x,actual/2,(z0+z1)/2,wallMaterial,'Wall');
}
function addWallZ(z,x0,x1,h,cut=false) {
 if(x1<=x0)return;
 const actual=cut ? Math.min(.43,h) : h;
 meshBox(world,x1-x0,actual,.13,(x0+x1)/2,actual/2,z,wallMaterial,'Wall');
}
function openingFacade(x0,x1,openings,height) {
 const sorted=[...openings].sort((a,b)=>a.x-b.x);
 let cursor=x0;
 for(const entry of sorted){
  const start=Math.max(x0,entry.x-entry.w/2), end=Math.min(x1,entry.x+entry.w/2);
  if(end<=start)continue;
  addWallZ(0,cursor,start,height,wallCut);
  const base=entry.door?0:.85, top=Math.min(height,entry.door?2.13:2.08);
  if(!wallCut){
   if(base>0)meshBox(world,end-start,base,.13,(start+end)/2,base/2,0,wallMaterial,'Window sill');
   if(top<height)meshBox(world,end-start,height-top,.13,(start+end)/2,(height+top)/2,0,wallMaterial,'Lintel');
  }
  if(entry.door) {
   const glass=meshBox(world,end-start,top,.035,(start+end)/2,top/2,-.016,windowMaterial,'Balcony door glass');glass.userData.openingId=entry.id;interactive.push(glass);
   meshBox(world,.035,top,.075,(start+end)/2,top/2,-.035,darkMaterial,'Door stile');
  } else {
   const glass=meshBox(world,end-start,top-base,.03,(start+end)/2,(top+base)/2,-.02,windowMaterial,'Window glass');glass.userData.openingId=entry.id;interactive.push(glass);
   meshBox(world,end-start,.035,.06,(start+end)/2,(top+base)/2,-.05,darkMaterial,'Window bar');
   meshBox(world,.035,top-base,.06,(start+end)/2,(top+base)/2,-.05,darkMaterial,'Window frame');
  }
  cursor=Math.max(cursor,end);
 }
 addWallZ(0,cursor,x1,height,wallCut);
}
function addCustomWall(w,h,index){
 const dx=w.x2-w.x1,dz=w.z2-w.z1,length=Math.hypot(dx,dz);
 if(length<.1)return;
 const actual=wallCut?Math.min(.43,h):h;
 const obj=meshBox(world,length,actual,.13,(w.x1+w.x2)/2,actual/2,(w.z1+w.z2)/2,wallMaterial,'Custom partition');
 obj.rotation.y=-Math.atan2(dz,dx);
 obj.userData.wallIndex=index;interactive.push(obj);
}
function addPlanHandles(){
 const marker=(kind,id,x,z,color,radius=.17)=>{
  const circle=new THREE.Mesh(new THREE.SphereGeometry(radius,12,8),new THREE.MeshBasicMaterial({color,depthTest:false}));
  circle.position.set(x,.27,z);circle.userData.handleKind=kind;circle.userData.handleId=id;
  circle.renderOrder=50;decorations.add(circle);interactive.push(circle);
 };
 (documentData.extraWalls??[]).forEach((w,i)=>{
  marker('wall-start',i,w.x1,w.z1,0xd85c41);
  marker('wall-end',i,w.x2,w.z2,0xd85c41);
  marker('wall-move',i,(w.x1+w.x2)/2,(w.z1+w.z2)/2,0xf5a745,.14);
 });
 for(const o of (documentData.openings??[]))marker('opening',o.id,o.x,0,o.kind==='door'?0x4a9f72:0x198cbd,.21);
 const d=documentData.dims;
 marker('seam',0,d.living,d.depth*.47,0x3b9c77,.24);
 marker('seam',1,d.living+d.bedroom,d.depth*.47,0x3b9c77,.24);
}
function addRoomLabel(text,x,z) {
 const cv=document.createElement('canvas');cv.width=512;cv.height=112;
 const ctx=cv.getContext('2d');ctx.clearRect(0,0,512,112);ctx.font='bold 41px sans-serif';ctx.textAlign='center';ctx.fillStyle='#476c6c';ctx.fillText(text,256,70);
 const texture = new THREE.CanvasTexture(cv);texture.colorSpace=THREE.SRGBColorSpace;
 const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthWrite:false}));
 sprite.position.set(x,.11,z);sprite.scale.set(1.65,.37,1); decorations.add(sprite);
}
function makeFloorTexture(dataUrl, xSize, zSize){
 const texture = new THREE.TextureLoader().load(dataUrl,()=>{renderer.render(scene,activeCamera());});
 texture.colorSpace = THREE.SRGBColorSpace;
 texture.wrapS=texture.wrapT=THREE.RepeatWrapping;
 texture.repeat.set(Math.max(.25,xSize/.7),Math.max(.25,zSize/.7));
 return texture;
}
function addFurniture(item) {
 const group=new THREE.Group();group.name=`${item.type} ${item.id}`;group.userData.itemId=item.id;
 group.position.set(item.x,0,item.z);group.rotation.y = (item.rotation||0)*Math.PI/180;
 world.add(group);
 const body=(w,h,d,x,y,z,c,name)=>meshBox(group,w,h,d,x,y,z,c,name);
 if(item.type==='imported'&&item.asset){
  const stub=body(item.w,.06,item.d,0,.03,0,'#b9d0c9','Loading furniture');stub.userData.placeholder=true;
  const version=redrawVersion;
  try {
   const encoded=item.asset.slice(item.asset.indexOf(',')+1);const bytes=Uint8Array.from(atob(encoded),ch=>ch.charCodeAt(0));
   loader.parse(bytes.buffer,'',(gltf)=>{
    if(version!==redrawVersion)return;
    group.remove(stub);const object=gltf.scene;
    const bb=new THREE.Box3().setFromObject(object);const sz=bb.getSize(new THREE.Vector3());const mid=bb.getCenter(new THREE.Vector3());
    if(![sz.x,sz.y,sz.z].every(v=>Number.isFinite(v)&&v>0.00001))return;
    object.position.sub(mid);
    const norm=new THREE.Group();norm.scale.set(item.w/sz.x,item.h/sz.y,item.d/sz.z);
    object.position.y+=sz.y/2;norm.add(object);group.add(norm);
    attachSelection(group,item.id);highlightSelection();
   },error=>{console.error(error);message('Не удалось загрузить GLB: '+error.message,true);});
  }catch(e){ console.error(e);message('Ошибка импортированного GLB: '+e.message,true); }
 } else {
   const c=item.color;
   if(item.type==='sofa'){
    body(item.w,.28,item.d,0,.33,0,c,'Sofa seat');
    body(item.w,.48,.16,0,.59,-item.d/2+.08,c,'Sofa back');
    for(const s of [-1,1])body(.12,.25,item.d,s*(item.w/2-.06),.47,0,c,'Sofa arm');
   } else if(item.type==='bed'){
    body(item.w,.36,item.d,0,.30,0,'#c5b39f','Bed base');
    body(item.w-.08,.15,item.d-.14,0,.55,0,c,'Mattress');
    body(item.w,.8,.13,0,.40,-item.d/2+.065,'#8e7162','Headboard');
    for(const s of [-1,1])body(item.w*.4,.09,.27,s*item.w*.23,.66,-item.d*.31,'#f5f1e8','Pillow');
   } else if(item.type==='table'){
    body(item.w,.09,item.d,0,item.h-.045,0,c,'Table top');
    for(const x of [-1,1])for(const z of [-1,1])body(.065,item.h-.09,.065,x*(item.w/2-.10),(item.h-.09)/2,z*(item.d/2-.10),'#665247','Leg');
   } else if(item.type==='wardrobe'){
    body(item.w,item.h,item.d,0,item.h/2,0,c,'Wardrobe');
    body(.02,item.h*.78,.02,0,item.h/2,item.d/2+.012,'#897363','Doors');
   } else {
    body(item.w,item.h,item.d,0,item.h/2,0,c,'Furniture');
    if(item.type==='cabinet')body(item.w,.05,item.d,0,item.h-.025,0,'#d4d5cc','Cabinet top');
   }
   attachSelection(group,item.id);
 }
 return group;
}
function attachSelection(group,id){
 group.traverse(o=>{if(o.isMesh){o.userData.itemId=id;interactive.push(o);}});
}
function disposeGroup(group){
 group.traverse(obj=>{if(obj.geometry)obj.geometry.dispose();if(obj.material){for(const m of [obj.material].flat()){ if(m.map)m.map.dispose();m.dispose(); }}});
 for(const obj of [...group.children])group.remove(obj);
}
function rebuildScene(){
 redrawVersion++;
 interactive=[];
 disposeGroup(world);disposeGroup(decorations);
 const d=documentData.dims, w=totalWidth(d), h=d.height;
 const ranges={living:[0,d.living],bedroom:[d.living,d.living+d.bedroom],kitchen:[d.living+d.bedroom,w]};
 for(const room of ROOM_IDS){
  const [start,end]=ranges[room], color=documentData.finishes[room];
  const obj=surface(world,start,end,0,d.depth,color,ROOM_NAMES[room]+' floor');
  if(documentData.textures?.[room])obj.material=mat('#ffffff',{map:makeFloorTexture(documentData.textures[room],end-start,d.depth)});
  addRoomLabel(ROOM_NAMES[room],(start+end)/2,d.depth*.52);
 }
 surface(world,0,w,d.depth,d.depth+d.hallDepth,documentData.finishes.hall,'Hall floor');
 addRoomLabel('Коридор',w/2,d.depth+d.hallDepth/2);
 // Exterior, partitions and corridor with doors.
 addWallX(0,0,d.depth+d.hallDepth,h,wallCut);
 addWallX(w,0,d.depth+d.hallDepth,h,wallCut);
 addWallZ(d.depth+d.hallDepth,0,w,h,wallCut);
 for(const x of [d.living,d.living+d.bedroom]){
  addWallX(x,0,d.depth*.58,h,wallCut);
  addWallX(x,d.depth*.85,d.depth,h,wallCut);
  if(!wallCut)meshBox(world,.13,h-2.05,d.depth*.27,x,(h+2.05)/2,d.depth*.715,wallMaterial,'Partition lintel');
 }
 for(const room of ROOM_IDS){
  const [start,end]=ranges[room],c=(start+end)/2, opening=Math.min(.84,(end-start)*.35);
  addWallZ(d.depth,start,c-opening/2,h,wallCut);addWallZ(d.depth,c+opening/2,end,h,wallCut);
  if(!wallCut&&h>2.1)meshBox(world,opening,h-2.1,.13,c,(h+2.1)/2,d.depth,wallMaterial,'Door lintel');
 }
 openingFacade(0,w,(documentData.openings??[]).map(o=>({...o,door:o.kind==='door'})),h);
 // Balcony centred on the border of the living room and bedroom.
 const balconyX=d.living-.15,balconyStart=balconyX-d.balconyWidth/2, balconyEnd=balconyX+d.balconyWidth/2;
 surface(world,balconyStart,balconyEnd,-d.balconyDepth,0,'#adb5b2','Balcony floor');
 meshBox(world,d.balconyWidth,.09,.08,balconyX,1,-d.balconyDepth,'#426d70','Balcony railing');
 for(const x of [balconyStart,balconyEnd]){
  meshBox(world,.065,1,.065,x,.5,-d.balconyDepth,'#426d70','Balcony posts');
  meshBox(world,.06,.8,d.balconyDepth,x,.42,-d.balconyDepth/2,'#8b9b98','Balcony side');
 }
 (documentData.extraWalls??[]).forEach((wall,i)=>addCustomWall(wall,h,i));
 addPlanHandles();
 for(const furniture of documentData.furniture)addFurniture(furniture);
 decorations.visible = is2d;
 highlightSelection();
 $('sceneInfo').textContent=`${w.toFixed(1)} × ${(d.depth+d.hallDepth).toFixed(1)} м · потолки ${h.toFixed(2)} м`;
 renderer.render(scene,activeCamera());
}
function activeCamera(){return is2d?overhead:perspective;}
function resetCamera(){
 const d=documentData.dims, cx=totalWidth(d)/2,cz=d.depth/2,range=Math.max(totalWidth(d),d.depth+d.hallDepth+d.balconyDepth);
 perspective.position.set(cx+range*.7,range*.95,cz+range*.9);
 orbit3d.target.set(cx,0,cz*.78);orbit3d.update();
 const a=Math.max(1,root.clientWidth/root.clientHeight);
 overhead.left=-range*.68*a;overhead.right=range*.68*a;overhead.top=range*.68;overhead.bottom=-range*.68;overhead.updateProjectionMatrix();
 overhead.up.set(0,0,-1);overhead.position.set(cx,35,(d.depth-d.balconyDepth+d.hallDepth)/2);overhead.lookAt(cx,0,(d.depth-d.balconyDepth+d.hallDepth)/2);
 orbit2d.target.set(cx,0,(d.depth-d.balconyDepth+d.hallDepth)/2);orbit2d.update();
}
function resize(){const w=root.clientWidth,h=root.clientHeight;if(w<10||h<10)return;renderer.setSize(w,h,false);perspective.aspect=w/h;perspective.updateProjectionMatrix();overhead.left=-overhead.top*w/h;overhead.right=overhead.top*w/h;overhead.updateProjectionMatrix();}
const observer=new ResizeObserver(resize);observer.observe(root);
function highlightSelection(){
 selectedMesh=null;
 for(const o of world.children){if(o.isGroup&&o.userData.itemId===selectedId){selectedMesh=o;break;}}
 const item=documentData.furniture.find(o=>o.id===selectedId);
 $('selectedFields').hidden=!item;
 $('selectionStatus').textContent=item?`${item.type} · ${ROOM_NAMES[item.room]}`:'Выбери мебель кликом';
 if(item){for(const [key,id] of Object.entries({x:'itemX',z:'itemZ',w:'itemW',d:'itemD',h:'itemH',rotation:'itemRot'}))$(id).value=Number(item[key]).toFixed(key==='rotation'?0:2);$('itemColor').value=item.color;}
 const wall=documentData.extraWalls?.[selectedWall];
 $('wallPanel').hidden=!wall;
 if(wall)for(const [key,id] of Object.entries({x1:'wallX1',z1:'wallZ1',x2:'wallX2',z2:'wallZ2'}))$(id).value=wall[key].toFixed(2);
 const opening=documentData.openings?.find(o=>o.id===selectedOpening);
 $('openingPanel').hidden=!opening;
 if(opening){$('openingKind').value=opening.kind;$('openingX').value=opening.x.toFixed(2);$('openingW').value=opening.w.toFixed(2);}
}
function selectFurniture(id){selectedId=id;selectedWall=null;selectedOpening=null;highlightSelection();}
function selectWall(index){selectedId=null;selectedWall=index;selectedOpening=null;highlightSelection();}
function selectOpening(id){selectedId=null;selectedWall=null;selectedOpening=id;highlightSelection();}
function clearSelection(){selectedId=null;selectedWall=null;selectedOpening=null;highlightSelection();}
function saveLocal(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(documentData));message('Сохранено на этом устройстве');}catch(e){message('Автосохранение переполнено — скачай JSON проекта');}}
let saveScheduled;
function update(){rebuildScene();clearTimeout(saveScheduled);saveScheduled=setTimeout(saveLocal,350);}
function download(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function resetFileInput(input){input.value='';}
function syncInputs(){
 for(const element of document.querySelectorAll('[data-dim]'))element.value=documentData.dims[element.dataset.dim];
 $('floorColor').value=documentData.finishes[$('floorRoom').value];
}
for(const element of document.querySelectorAll('[data-dim]')) element.addEventListener('change',()=>{
 const key=element.dataset.dim, old=documentData.dims[key], v=Number(element.value);
 const min=Number(element.min),max=Number(element.max);
 if(!Number.isFinite(v)||v<min||v>max){message(`Размер должен быть от ${min} до ${max} м`,true);element.value=old;return;}
 const delta=v-old;
 if(key==='living'){for(const f of documentData.furniture)if(f.room!=='living')f.x+=delta;for(const wall of (documentData.extraWalls??[])){if(wall.x1>old)wall.x1+=delta;if(wall.x2>old)wall.x2+=delta;}}
 if(key==='bedroom'){for(const f of documentData.furniture)if(f.room==='kitchen')f.x+=delta;for(const wall of (documentData.extraWalls??[])){if(wall.x1>documentData.dims.living+old)wall.x1+=delta;if(wall.x2>documentData.dims.living+old)wall.x2+=delta;}}
 documentData.dims[key]=v;keepFurnitureWithinRooms(documentData);documentData.openings?.forEach(constrainOpening);resetCamera();update();
});
function constrainOpening(entry){
 const total=totalWidth(documentData.dims);
 entry.w=clamp(Number(entry.w),.45,Math.min(3,total-.2));
 entry.x=clamp(Number(entry.x),entry.w/2+.08,total-entry.w/2-.08);
}
for(const [field,key] of [['wallX1','x1'],['wallZ1','z1'],['wallX2','x2'],['wallZ2','z2']])$(field).addEventListener('change',e=>{
 const w=documentData.extraWalls?.[selectedWall];if(!w)return;
 const v=Number(e.target.value);if(!Number.isFinite(v))return highlightSelection();
 const old=w[key],d=documentData.dims;
 w[key]=clamp(Math.round(v*10)/10,key.startsWith('x')?0:-d.balconyDepth,key.startsWith('x')?totalWidth(d):d.depth+d.hallDepth);
 if(Math.hypot(w.x1-w.x2,w.z1-w.z2)<.1)w[key]=old;
 update();
});
$('deleteWall').addEventListener('click',()=>{if(selectedWall===null)return;documentData.extraWalls.splice(selectedWall,1);selectedWall=null;update();});
function newOpening(kind){
 const d=documentData.dims,w=kind==='window'?1.15:.85;
 const x=kind==='window'?d.living+d.bedroom+d.kitchen*.5:d.living-.4;
 const entry={id:`${kind}-${Date.now()}`,kind,x,w};constrainOpening(entry);
 documentData.openings.push(entry);selectOpening(entry.id);update();
}
$('addWindow').addEventListener('click',()=>newOpening('window'));
$('addDoor').addEventListener('click',()=>newOpening('door'));
$('openingKind').addEventListener('change',e=>{const o=documentData.openings.find(v=>v.id===selectedOpening);if(o){o.kind=e.target.value;update();}});
for(const [id,key] of [['openingX','x'],['openingW','w']])$(id).addEventListener('change',e=>{
 const o=documentData.openings.find(v=>v.id===selectedOpening);if(!o)return;
 const v=Number(e.target.value);if(!Number.isFinite(v))return highlightSelection();
 o[key]=v;constrainOpening(o);update();
});
$('deleteOpening').addEventListener('click',()=>{documentData.openings=documentData.openings.filter(o=>o.id!==selectedOpening);selectedOpening=null;update();});
$('floorRoom').addEventListener('change',()=>{$('floorColor').value=documentData.finishes[$('floorRoom').value];$('floorTexture').value='';});
$('floorColor').addEventListener('input',e=>{documentData.finishes[$('floorRoom').value]=e.target.value;update();});
$('floorTexture').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>4_000_000){message('Нужна JPG/PNG/WebP фотография до 4 МБ',true);return;}
 try{const data=await fileToDataURL(file);documentData.textures??={};documentData.textures[$('floorRoom').value]=data;update();}catch(err){message(err.message,true);}
});
$('clearTexture').addEventListener('click',()=>{if(documentData.textures)delete documentData.textures[$('floorRoom').value];$('floorTexture').value='';update();});
function fileToDataURL(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Ошибка чтения файла'));reader.readAsDataURL(file);});}
$('addFurniture').addEventListener('click',()=>{
 const room=$('newRoom').value,type=$('newType').value,b=bounds(documentData,room);
 const sizes={sofa:[2.0,.9,.75],bed:[1.6,2,.65],table:[1.05,.7,.75],wardrobe:[1.3,.6,2.1],cabinet:[1.1,.6,.9],box:[.8,.8,.8]};
 const [w,d,h]=sizes[type];const id=`${type}-${Date.now()}-${Math.floor(Math.random()*10000)}`;
 documentData.furniture.push({id,type,room,x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2,w,d,h,rotation:0,color:'#8caeaa'});
 selectFurniture(id);update();
});
$('importGlb').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;
 if(!file.name.toLowerCase().endsWith('.glb')||file.size>10_000_000){message('Выбери GLB до 10 МБ',true);return;}
 const data=await fileToDataURL(file);const room=$('newRoom').value,b=bounds(documentData,room);
 const id='imported-'+Date.now();
 documentData.furniture.push({id,type:'imported',room,x:(b.minX+b.maxX)/2,z:(b.minZ+b.maxZ)/2,w:1,d:1,h:1,rotation:0,color:'#aaaaaa',asset:data.replace(/^data:[^,]+,/, 'data:model/gltf-binary;base64,')});
 selectFurniture(id);resetFileInput(e.target);update();
});
for(const [key,id] of Object.entries({x:'itemX',z:'itemZ',w:'itemW',d:'itemD',h:'itemH',rotation:'itemRot'}))$(id).addEventListener('change',e=>{
 const f=documentData.furniture.find(x=>x.id===selectedId);if(!f)return;
 const value=Number(e.target.value);if(!Number.isFinite(value)||(key==='w'||key==='d'||key==='h')&&(value<.1||value>6)){highlightSelection();return;}
 f[key]=value;keepFurnitureWithinRooms(documentData);update();
});
$('itemColor').addEventListener('input',e=>{const f=documentData.furniture.find(x=>x.id===selectedId);if(f){f.color=e.target.value;update();}});
$('deleteItem').addEventListener('click',()=>{documentData.furniture=documentData.furniture.filter(o=>o.id!==selectedId);clearSelection();update();});
$('saveJson').addEventListener('click',()=>download(new Blob([JSON.stringify(documentData,null,2)],{type:'application/json'}),'apartment-project.json'));
$('openJson').addEventListener('change',async e=>{
 const file=e.target.files?.[0];if(!file)return;if(file.size>22_000_000){message('Файл JSON больше 22 МБ',true);return;}
 try{documentData=validateDocument(JSON.parse(await file.text()));clearSelection();syncInputs();resetCamera();update();}catch(err){message('Ошибка JSON: '+err.message,true);}finally{resetFileInput(e.target);}
});
$('exportGlb').addEventListener('click',async()=>{
 message('Подготавливаю GLB…');try{
  const group=world.clone(true);group.traverse(o=>{if(o.isMesh){o.material=o.material.clone();}});
  const exporter=new GLTFExporter();
  const buffer=await exporter.parseAsync(group,{binary:true,onlyVisible:true,maxTextureSize:2048});
  download(new Blob([buffer],{type:'model/gltf-binary'}),'my-apartment.glb');message('GLB готов для Blender');
 }catch(err){console.error(err);message('Не удалось экспортировать GLB: '+err.message,true);}
});
function setView(twoD){is2d=twoD;if(!twoD){drawingWalls=false;wallStart=null;clearWallPreview();}orbit3d.enabled=!is2d;orbit2d.enabled=is2d&&!drawingWalls;decorations.visible=is2d;$('view2d').classList.toggle('active',is2d);$('view3d').classList.toggle('active',!is2d);$('modeLabel').textContent=is2d?'План сверху':'3D · редактирование';$('drawWall').classList.toggle('active',drawingWalls);$('modeHint').textContent=drawingWalls?'Нажми начальную и конечную точки стены. Esc — отмена.':'Мебель и окна перетаскиваются; колесо — масштаб, мышь — вращение';}
$('view3d').addEventListener('click',()=>setView(false));
$('view2d').addEventListener('click',()=>setView(true));
$('cutWalls').addEventListener('change',e=>{wallCut=e.target.checked;rebuildScene();});
$('resetCamera').addEventListener('click',resetCamera);
function clearWallPreview(){if(wallPreview){decorations.remove(wallPreview);wallPreview.geometry.dispose();wallPreview.material.dispose();wallPreview=null;}}
function getPlanPoint(event){
 toPointer(event);raycaster.setFromCamera(pointer,overhead);
 if(!raycaster.ray.intersectPlane(dragPlane,hit))return null;
 const d=documentData.dims;
 return {x:clamp(Math.round(hit.x*10)/10,0,totalWidth(d)),z:clamp(Math.round(hit.z*10)/10,-d.balconyDepth,d.depth+d.hallDepth)};
}
function showWallPreview(end){
 clearWallPreview();if(!wallStart)return;
 const points=[new THREE.Vector3(wallStart.x,.18,wallStart.z),new THREE.Vector3(end.x,.18,end.z)];
 wallPreview=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xe97443,depthTest:false}));
 decorations.add(wallPreview);
}
$('drawWall').addEventListener('click',()=>{
 if(!is2d)setView(true);
 drawingWalls=!drawingWalls;wallStart=null;clearWallPreview();setView(true);
 message(drawingWalls?'Рисование: выбери две точки стены':'Режим рисования выключен');
});
$('undoWall').addEventListener('click',()=>{
 if(!documentData.extraWalls?.length){message('Дополнительных стен пока нет');return;}
 documentData.extraWalls.pop();selectedWall=null;wallStart=null;clearWallPreview();update();
});
window.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawingWalls){wallStart=null;clearWallPreview();message('Начало стены отменено');}});
function toPointer(event){const r=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-r.left)/r.width*2-1,-((event.clientY-r.top)/r.height)*2+1);}
function findHit(event){toPointer(event);raycaster.setFromCamera(pointer,activeCamera());return raycaster.intersectObjects(interactive,false)[0]??null;}
renderer.domElement.addEventListener('pointerdown',event=>{
 if(event.button!==0)return;
 if(drawingWalls&&is2d){
  const p=getPlanPoint(event);if(!p)return;
  if(!wallStart){wallStart=p;message(`Начало стены: ${p.x.toFixed(1)} × ${p.z.toFixed(1)} м`);}
  else {const length=Math.hypot(p.x-wallStart.x,p.z-wallStart.z);
   if(length>=.1){documentData.extraWalls??=[];documentData.extraWalls.push({x1:wallStart.x,z1:wallStart.z,x2:p.x,z2:p.z});selectWall(documentData.extraWalls.length-1);wallStart=null;clearWallPreview();update();message(`Перегородка ${length.toFixed(2)} м добавлена`);}
   else message('Вторая точка должна быть не ближе 10 см',true);}
  return;
 }
 const target=findHit(event);
 if(!target){clearSelection();return;}
 const meta=target.object.userData;
 let kind='furniture', id=meta.itemId;
 if(meta.handleKind){kind=meta.handleKind;id=meta.handleId;}
 else if(meta.openingId){kind='opening';id=meta.openingId;}
 else if(meta.wallIndex!==undefined){kind='wall-move';id=meta.wallIndex;}
 if(kind==='furniture')selectFurniture(id);
 else if(kind.startsWith('wall'))selectWall(id);
 else if(kind==='opening')selectOpening(id);
 else if(kind==='seam')clearSelection();
 toPointer(event);raycaster.setFromCamera(pointer,activeCamera());
 if(!raycaster.ray.intersectPlane(dragPlane,hit))return;
 const item=documentData.furniture.find(o=>o.id===id);
 const wall=documentData.extraWalls?.[id];
 const opening=documentData.openings?.find(o=>o.id===id);
 const anchor=kind==='furniture'&&item?{x:item.x,z:item.z}:kind.startsWith('wall')&&wall?{x:kind==='wall-start'?wall.x1:kind==='wall-end'?wall.x2:(wall.x1+wall.x2)/2,z:kind==='wall-start'?wall.z1:kind==='wall-end'?wall.z2:(wall.z1+wall.z2)/2}:kind==='opening'&&opening?{x:opening.x,z:0}:kind==='seam'?{x:id===0?documentData.dims.living:documentData.dims.living+documentData.dims.bedroom,z:documentData.dims.depth*.47}:null;
 if(!anchor)return;
 drag={kind,id,pointerId:event.pointerId,offsetX:anchor.x-hit.x,offsetZ:anchor.z-hit.z,lastX:anchor.x,lastZ:anchor.z};
 orbit3d.enabled=orbit2d.enabled=false;
 renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener('pointermove',event=>{
 if(drawingWalls&&is2d&&wallStart){const p=getPlanPoint(event);if(p)showWallPreview(p);return;}
 if(!drag)return;
 toPointer(event);raycaster.setFromCamera(pointer,activeCamera());if(!raycaster.ray.intersectPlane(dragPlane,hit))return;
 const d=documentData.dims,total=totalWidth(d);
 const x=Math.round((hit.x+drag.offsetX)*20)/20,z=Math.round((hit.z+drag.offsetZ)*20)/20;
 if(drag.kind==='furniture'){
  const item=documentData.furniture.find(o=>o.id===drag.id);if(!item)return;
  item.x=x;item.z=z;keepFurnitureWithinRooms(documentData);
  if(selectedMesh)selectedMesh.position.set(item.x,0,item.z);
  $('itemX').value=item.x.toFixed(2);$('itemZ').value=item.z.toFixed(2);
 }else if(drag.kind.startsWith('wall')){
  const wall=documentData.extraWalls?.[drag.id];if(!wall)return;
  if(drag.kind==='wall-move'){
   const dx=clamp(x-drag.lastX,-Math.min(wall.x1,wall.x2),total-Math.max(wall.x1,wall.x2));
   const dz=clamp(z-drag.lastZ,-d.balconyDepth-Math.min(wall.z1,wall.z2),d.depth+d.hallDepth-Math.max(wall.z1,wall.z2));
   wall.x1+=dx;wall.x2+=dx;wall.z1+=dz;wall.z2+=dz;drag.lastX+=dx;drag.lastZ+=dz;
  }else{
   const suffix=drag.kind==='wall-start'?'1':'2';
   const nx=clamp(x,0,total),nz=clamp(z,-d.balconyDepth,d.depth+d.hallDepth);
   const other=suffix==='1'?{x:wall.x2,z:wall.z2}:{x:wall.x1,z:wall.z1};
   if(Math.hypot(nx-other.x,nz-other.z)>=.1){wall['x'+suffix]=nx;wall['z'+suffix]=nz;}
  }
  rebuildScene();
 }else if(drag.kind==='opening'){
  const opening=documentData.openings.find(o=>o.id===drag.id);if(!opening)return;
  opening.x=x;constrainOpening(opening);rebuildScene();
 }else if(drag.kind==='seam'){
  const left=drag.id===0?'living':'bedroom',right=drag.id===0?'bedroom':'kitchen';
  const delta=x-drag.lastX;
  const leftMin=Number(document.querySelector(`[data-dim="${left}"]`).min),rightMin=Number(document.querySelector(`[data-dim="${right}"]`).min);
  const allowed=clamp(delta,leftMin-d[left],d[right]-rightMin);
  if(Math.abs(allowed)<.001)return;
  d[left]+=allowed;d[right]-=allowed;drag.lastX+=allowed;
  for(const f of documentData.furniture)if(f.room===right)f.x+=allowed;
  for(const wall of documentData.extraWalls){if(wall.x1>drag.lastX-allowed)wall.x1+=allowed*.5;if(wall.x2>drag.lastX-allowed)wall.x2+=allowed*.5;}
  for(const o of documentData.openings)if(o.x>drag.lastX-allowed)o.x+=allowed*.5;
  keepFurnitureWithinRooms(documentData);documentData.openings.forEach(constrainOpening);syncInputs();rebuildScene();
 }
});
function finishDrag(){if(!drag)return;drag=null;orbit3d.enabled=!is2d;orbit2d.enabled=is2d&&!drawingWalls;rebuildScene();saveLocal();}
renderer.domElement.addEventListener('pointerup',finishDrag);
renderer.domElement.addEventListener('pointercancel',finishDrag);
window.addEventListener('blur',finishDrag);
function frame(){requestAnimationFrame(frame);orbit3d.update();orbit2d.update();renderer.render(scene,activeCamera());}
syncInputs();resetCamera();resize();setView(true);rebuildScene();frame();
message('План сверху готов — размеры и перегородки можно редактировать');