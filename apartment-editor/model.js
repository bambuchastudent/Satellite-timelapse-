/** Pure, dependency-free apartment document helpers. All dimensions are meters. */
export const ROOM_IDS = ['living','bedroom','kitchen'];
export const ROOM_NAMES = {living:'Гостиная',bedroom:'Спальня',kitchen:'Кухня'};
export const DEFAULT = Object.freeze({
  version:1, units:'m',
  dims:{living:4.5,bedroom:3.9,kitchen:3.1,depth:4.1,hallDepth:1.4,height:2.65,balconyWidth:1.6,balconyDepth:1.65,wallThickness:.13},
  extraWalls:[],
  structuralThicknesses:{},
  openings:[
    {id:'window-living',kind:'window',x:1.3,w:1.3},
    {id:'balcony-door',kind:'door',x:4.05,w:.85},
    {id:'window-bedroom',kind:'window',x:6.75,w:1.45},
    {id:'window-kitchen',kind:'window',x:9.95,w:1.3}
  ],
  finishes:{living:'#bc9d7e',bedroom:'#d4bca2',kitchen:'#b9b9a7',hall:'#c8c1b3',wall:'#f0ede5'},
  furniture:[
    {id:'sofa-1',type:'sofa',room:'living',x:1.45,z:2.15,w:2.1,d:0.85,h:0.75,rotation:0,color:'#607f82'},
    {id:'table-1',type:'table',room:'living',x:3.15,z:1.8,w:1.05,d:0.65,h:0.45,rotation:0,color:'#b87a57'},
    {id:'bed-1',type:'bed',room:'bedroom',x:6.35,z:2.4,w:1.6,d:2,h:0.57,rotation:0,color:'#d4b5aa'},
    {id:'wardrobe-1',type:'wardrobe',room:'bedroom',x:5.05,z:1.1,w:0.65,d:1.4,h:2.1,rotation:0,color:'#c2a784'},
    {id:'kitchen-1',type:'cabinet',room:'kitchen',x:9.1,z:3.45,w:1.4,d:0.55,h:0.92,rotation:0,color:'#cfdad2'}
  ]
});
const copy = v => JSON.parse(JSON.stringify(v));
export function defaultDocument(){ return copy(DEFAULT); }
const limits={living:[2,9],bedroom:[2,9],kitchen:[2,8],depth:[2.5,9],hallDepth:[.8,3],height:[2,4.5],balconyWidth:[.8,3],balconyDepth:[.6,3],wallThickness:[.06,.5]};
export function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
export function totalWidth(d){return d.living+d.bedroom+d.kitchen;}
export function bounds(doc,room){
 const d=doc.dims;
 switch(room){
 case 'living':return {minX:0,maxX:d.living,minZ:0,maxZ:d.depth};
 case 'bedroom':return {minX:d.living,maxX:d.living+d.bedroom,minZ:0,maxZ:d.depth};
 case 'kitchen':return {minX:d.living+d.bedroom,maxX:totalWidth(d),minZ:0,maxZ:d.depth};
 default:throw Error('Unknown room: '+room);
 }
}
export function validateDocument(input){
 if(!input||typeof input!=='object'||input.version!==1||!input.dims||!Array.isArray(input.furniture))throw Error('Ожидался JSON проекта версии 1');
 const doc=defaultDocument();
 for(const [key,[min,max]] of Object.entries(limits)){
   const value=Number(input.dims[key]??doc.dims[key]);
   if(!Number.isFinite(value)||value<min||value>max)throw Error(`Недопустимый размер ${key}: ${input.dims[key]} (${min}–${max} м)`);
   doc.dims[key]=value;
 }
 for(const key of Object.keys(doc.finishes)){
   const value=input.finishes?.[key];
   if(typeof value==='string' && /^#[0-9a-fA-F]{6}$/.test(value))doc.finishes[key]=value;
 }
 doc.structuralThicknesses={};
 const structuralIds=['left','right','front','back','hall','seam-0','seam-1'];
 for(const [id,value] of Object.entries(input.structuralThicknesses??{})){
  if(!structuralIds.includes(id))continue;
  const width=Number(value);
  if(!Number.isFinite(width)||width<.06||width>.5)throw Error('Недопустимая толщина стены');
  doc.structuralThicknesses[id]=width;
 }
 doc.extraWalls=[];
 if(input.extraWalls!==undefined && !Array.isArray(input.extraWalls))throw Error('Неверный формат перегородок');
 for(const wall of (input.extraWalls??[]).slice(0,200)){
  const w={};
  for(const k of ['x1','x2','z1','z2']){
   w[k]=Number(wall?.[k]);if(!Number.isFinite(w[k]))throw Error('Некорректные координаты стены');
  }
  if(Math.min(w.x1,w.x2)<0||Math.max(w.x1,w.x2)>totalWidth(doc.dims)||Math.min(w.z1,w.z2)<-doc.dims.balconyDepth||Math.max(w.z1,w.z2)>doc.dims.depth+doc.dims.hallDepth)throw Error('Стена выходит за границы чертежа');
  const len=Math.hypot(w.x2-w.x1,w.z2-w.z1);
  if(len<.1||len>30)throw Error('Длина перегородки должна быть от 0.1 до 30 м');
  w.thickness=Number(wall.thickness??doc.dims.wallThickness);
  if(!Number.isFinite(w.thickness)||w.thickness<.06||w.thickness>.5)throw Error('Недопустимая толщина перегородки');
  doc.extraWalls.push(w);
 }
 doc.openings=[];
 if(input.openings!==undefined && !Array.isArray(input.openings))throw Error('Некорректные проёмы');
 const openingIds=new Set();
 for(const entry of (input.openings??doc.openings).slice(0,40)){
  if(typeof entry.id!=='string'||entry.id.length>80||openingIds.has(entry.id)||!['window','door'].includes(entry.kind))throw Error('Неверное окно или дверь');
  openingIds.add(entry.id);
  const x=Number(entry.x),w=Number(entry.w);
  if(!Number.isFinite(x)||!Number.isFinite(w)||w<.45||w>3||x-w/2<.05||x+w/2>totalWidth(doc.dims)-.05)throw Error('Окно или дверь вне фасада');
  doc.openings.push({id:entry.id,kind:entry.kind,x,w});
 }
 if(input.openings===undefined)doc.openings=copy(DEFAULT.openings);
 doc.furniture=[];
 const ids=new Set();
 for(const item of input.furniture.slice(0,150)){
  if(typeof item.id!=='string'||item.id.length>80||ids.has(item.id)||!ROOM_IDS.includes(item.room))throw Error('Некорректный ID или комната предмета мебели');
  ids.add(item.id);
  const o={id:item.id,type:['sofa','bed','table','wardrobe','cabinet','box','imported'].includes(item.type)?item.type:'box',room:item.room};
  for(const k of ['x','z','w','d','h','rotation']){
   o[k]=Number(item[k]);if(!Number.isFinite(o[k]))throw Error('Некорректная координата мебели: '+k);
  }
  for(const k of ['w','d','h'])if(o[k]<.1||o[k]>6)throw Error('Некорректный размер мебели: '+k);
  o.color=/^#[0-9a-fA-F]{6}$/.test(item.color||'')?item.color:'#b5aaa0';
  if(o.type==='imported'&&typeof item.asset==='string'){
    if(item.asset.length>20_000_000||!item.asset.startsWith('data:model/gltf-binary;base64,'))throw Error('Некорректный GLB-ассет');
    o.asset=item.asset;
  }
  const b=bounds(doc,o.room),pad=Math.max(o.w,o.d)/2;
  o.x=clamp(o.x,b.minX+Math.min(pad,(b.maxX-b.minX)/2),b.maxX-Math.min(pad,(b.maxX-b.minX)/2));
  o.z=clamp(o.z,b.minZ+Math.min(pad,(b.maxZ-b.minZ)/2),b.maxZ-Math.min(pad,(b.maxZ-b.minZ)/2));
  doc.furniture.push(o);
 }
 // Optional embedded floor photos: keeps the JSON self-contained and local.
 doc.textures={};
 for(const key of ROOM_IDS){const t=input.textures?.[key];if(typeof t==='string'&&/^data:image\/(png|jpeg|webp);base64,/.test(t)&&t.length<8_000_000)doc.textures[key]=t;}
 return doc;
}
export function keepFurnitureWithinRooms(doc){
 for(const o of doc.furniture){const b=bounds(doc,o.room);const pad=Math.max(o.w,o.d)/2;const px=Math.min(pad,(b.maxX-b.minX)/2),pz=Math.min(pad,(b.maxZ-b.minZ)/2);o.x=clamp(o.x,b.minX+px,b.maxX-px);o.z=clamp(o.z,b.minZ+pz,b.maxZ-pz);}
}
export function roomForPosition(doc,x,z){return ROOM_IDS.find(k=>{const b=bounds(doc,k);return x>=b.minX&&x<=b.maxX&&z>=b.minZ&&z<=b.maxZ;})??null;}

/** Change a custom wall's length while keeping its first endpoint fixed, within the floor bounds. */
export function resizeWall(doc, wall, targetLength){
 const len=Math.hypot(wall.x2-wall.x1,wall.z2-wall.z1);
 if(!Number.isFinite(targetLength)||targetLength<.1||targetLength>30||len<.1)return false;
 const ux=(wall.x2-wall.x1)/len,uz=(wall.z2-wall.z1)/len,d=doc.dims;
 const xMax=totalWidth(d), zMin=-d.balconyDepth,zMax=d.depth+d.hallDepth;
 const xLimit=ux>0?(xMax-wall.x1)/ux:ux<0?-wall.x1/ux:Infinity;
 const zLimit=uz>0?(zMax-wall.z1)/uz:uz<0?(zMin-wall.z1)/uz:Infinity;
 const allowed=Math.min(targetLength,xLimit,zLimit);
 if(allowed<.1)return false;
 wall.x2=Math.round((wall.x1+ux*allowed)*100)/100;
 wall.z2=Math.round((wall.z1+uz*allowed)*100)/100;
 return true;
}
/** Structural wall width/room sizing; return false for non-adjustable boundary. */
export function resizeStructure(doc,id,value){
 const d=doc.dims,n=Number(value);
 if(!Number.isFinite(n))return false;
 if(id==='seam-0'){
  const sum=d.living+d.bedroom;if(n<2||n>9||sum-n<2||sum-n>9)return false;
  const delta=n-d.living;d.living=n;d.bedroom-=delta;
  for(const f of doc.furniture)if(f.room==='bedroom')f.x+=delta;
 } else if(id==='seam-1'){
  const sum=d.bedroom+d.kitchen;if(n<2||n>9||sum-n<2||sum-n>8)return false;
  const delta=n-d.bedroom;d.bedroom=n;d.kitchen-=delta;
  for(const f of doc.furniture)if(f.room==='kitchen')f.x+=delta;
 } else if(id==='right'){
  if(n<2||n>8)return false;d.kitchen=n;
 } else if(id==='back'){
  if(n<2.5||n>9)return false;d.depth=n;
 } else if(id==='hall'){
  if(n<.8||n>3)return false;d.hallDepth=n;
 } else return false;
 keepFurnitureWithinRooms(doc);
 return true;
}