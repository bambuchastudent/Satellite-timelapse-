// Shared-vertex 2D floorplan. Units: metres. Pure JS, no dependencies.
export const copy=v=>JSON.parse(JSON.stringify(v));
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export const snap=x=>Math.round(x*20)/20;
export const edgeId=(a,b)=>[a,b].sort().join('~');
const colors=['#e8d8c2','#d9e4ef','#e2e4d5','#e5d8dc','#d8e5dd','#e6e0d4'];
export function starter(legacy=null){
 const d=legacy?.dims||{},widths=[d.living||4.5,d.bedroom||3.9,d.kitchen||3.1,2.9,2.7],depth=d.depth||4.1;
 const doc={version:2,height:d.height||2.65,nodes:{},rooms:[],partitions:[],walls:{},openings:[],furniture:[],textures:{},nextId:1};
 const node=(x,z)=>{const id='n'+doc.nextId++;doc.nodes[id]={x,z};return id;};
 const xs=[0];widths.forEach(w=>xs.push(xs.at(-1)+w));
 const top=xs.map(x=>node(x,0)),bottom=xs.map(x=>node(x,depth));
 ['Гостиная','Спальня','Кухня','Комната справа 1','Комната справа 2'].forEach((name,i)=>doc.rooms.push({id:'r'+doc.nextId++,name,color:colors[i],vertices:[top[i],top[i+1],bottom[i+1],bottom[i]]}));
 const outer=[[xs[5],depth+.8],[xs[5]-.7,depth+2.35],[xs[4]+.6,depth+2.9],[xs[3]+.5,depth+3.15],[xs[2]+.8,depth+3.2],[xs[2]-.6,depth+4.1],[xs[1]-.6,depth+4.6],[.85,depth+4.7],[0,depth+3.85]].map(p=>node(...p));
 doc.rooms.push({id:'corridor',name:'Коридор и прихожая',color:'#e6e1d7',vertices:[...bottom,...outer]});
 const balcony=[[xs[1]-.8,0],[xs[1]-.8,-1.55],[xs[1]+.8,-1.55],[xs[1]+.8,0]].map(p=>node(...p));
 doc.rooms.push({id:'balcony',name:'Балкон',color:'#cbded1',kind:'balcony',vertices:balcony});
 for(let i=0;i<5;i++){doc.openings.push({id:'o'+doc.nextId++,wall:edgeId(top[i],top[i+1]),kind:'window',t:.5,width:Math.min(1.25,widths[i]*.46)});doc.openings.push({id:'o'+doc.nextId++,wall:edgeId(bottom[i],bottom[i+1]),kind:'door',t:.5,width:.85});}
 doc.openings.push({id:'o'+doc.nextId++,wall:edgeId(top[0],top[1]),kind:'door',t:.88,width:.65});
 const add=(room,type,x,z,w,d,h,color)=>doc.furniture.push({id:'f'+doc.nextId++,room:doc.rooms[room].id,type,x,z,w,d,h,color,rotation:0});
 add(0,'sofa',1.55,2,2,.9,.78,'#749a9b');add(0,'table',3.2,1.9,1,.6,.7,'#bd9b7b');add(1,'bed',xs[1]+1.9,2,1.6,2,.55,'#caa6a1');add(2,'cabinet',xs[2]+1.4,3.4,1.6,.6,.85,'#b1bbb1');
 if(legacy){if(Array.isArray(legacy.furniture))doc.furniture=legacy.furniture.map(f=>({...f,id:String(f.id),room:({living:doc.rooms[0].id,bedroom:doc.rooms[1].id,kitchen:doc.rooms[2].id})[f.room]||doc.rooms[0].id}));
 if(Array.isArray(legacy.extraWalls))for(const w of legacy.extraWalls){const a=node(Number(w.x1),Number(w.z1)),b=node(Number(w.x2),Number(w.z2));doc.partitions.push({a,b});doc.walls[edgeId(a,b)]={thickness:w.thickness||.13};}
 if(Array.isArray(legacy.openings)&&legacy.openings.length){
 const oldFront=new Set([edgeId(top[0],top[1]),edgeId(top[1],top[2]),edgeId(top[2],top[3])]);
 doc.openings=doc.openings.filter(o=>!oldFront.has(o.wall));
 for(const o of legacy.openings){const index=xs.findIndex((v,i)=>i<xs.length-1&&Number(o.x)>=v&&Number(o.x)<=xs[i+1]);if(index>=0)doc.openings.push({id:String(o.id),wall:edgeId(top[index],top[index+1]),kind:o.kind==='door'?'door':'window',t:clamp((Number(o.x)-xs[index])/(xs[index+1]-xs[index]),.1,.9),width:Number(o.w)||.8});}}if(legacy.textures)doc.textures=legacy.textures;}
 return doc;
}
export function edges(doc){const map=new Map();for(const r of doc.rooms){for(let i=0;i<r.vertices.length;i++){const a=r.vertices[i],b=r.vertices[(i+1)%r.vertices.length];if(r.kind==='balcony'&&doc.nodes[a].z===0&&doc.nodes[b].z===0)continue;const id=edgeId(a,b);if(!map.has(id))map.set(id,{id,a,b,rooms:[]});map.get(id).rooms.push(r.id);}}
 for(const p of doc.partitions||[]){const id=edgeId(p.a,p.b);if(!map.has(id))map.set(id,{id,a:p.a,b:p.b,rooms:[]});}return [...map.values()];}
export function segment(doc,e){const a=doc.nodes[e.a],b=doc.nodes[e.b],dx=b.x-a.x,dz=b.z-a.z;return {a,b,dx,dz,length:Math.hypot(dx,dz),mid:{x:(a.x+b.x)/2,z:(a.z+b.z)/2}};}
export function area(doc,r){let a=0;const p=r.vertices.map(v=>doc.nodes[v]);for(let i=0;i<p.length;i++){const u=p[i],v=p[(i+1)%p.length];a+=u.x*v.z-v.x*u.z;}return Math.abs(a)/2;}
export function roomBounds(doc,r){const p=r.vertices.map(v=>doc.nodes[v]);return {minX:Math.min(...p.map(n=>n.x)),maxX:Math.max(...p.map(n=>n.x)),minZ:Math.min(...p.map(n=>n.z)),maxZ:Math.max(...p.map(n=>n.z))};}
export function bounds(doc){const p=Object.values(doc.nodes);return {minX:Math.min(...p.map(n=>n.x)),maxX:Math.max(...p.map(n=>n.x)),minZ:Math.min(...p.map(n=>n.z)),maxZ:Math.max(...p.map(n=>n.z))};}
export function center(doc,r){const p=r.vertices.map(v=>doc.nodes[v]);return {x:p.reduce((s,n)=>s+n.x,0)/p.length,z:p.reduce((s,n)=>s+n.z,0)/p.length};}
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
export function simplePolygon(p){if(p.length<3||p.some(n=>!n))return false;let signed=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];if(Math.hypot(a.x-b.x,a.z-b.z)<.08)return false;signed+=a.x*b.z-b.x*a.z;for(let j=i+2;j<p.length;j++){if(i===0&&j===p.length-1)continue;const c=p[j],d=p[(j+1)%p.length];if(cross(a,b,c)*cross(a,b,d)<-1e-8&&cross(c,d,a)*cross(c,d,b)<-1e-8)return false;}}return Math.abs(signed)>.2;}
const valid=d=>d.rooms.every(r=>simplePolygon(r.vertices.map(id=>d.nodes[id])));
export function moveNode(doc,id,x,z){const old=doc.nodes[id];if(!old)return false;doc.nodes[id]={x:snap(clamp(x,-8,70)),z:snap(clamp(z,-8,50))};if(!valid(doc)){doc.nodes[id]=old;return false;}return true;}
export function moveEdge(doc,e,dx,dz){const a={...doc.nodes[e.a]},b={...doc.nodes[e.b]};doc.nodes[e.a]={x:snap(a.x+dx),z:snap(a.z+dz)};doc.nodes[e.b]={x:snap(b.x+dx),z:snap(b.z+dz)};if(!valid(doc)){doc.nodes[e.a]=a;doc.nodes[e.b]=b;return false;}return true;}
export function resizeEdge(doc,e,length){const {a,b,length:L}=segment(doc,e);return length>=.15&&length<60&&L>0&&moveNode(doc,e.b,a.x+(b.x-a.x)*length/L,a.z+(b.z-a.z)*length/L);}
export function resizeRoom(doc,id,axis,delta){const r=doc.rooms.find(x=>x.id===id);if(!r||!['x','z'].includes(axis))return false;const b=roomBounds(doc,r),maximum=axis==='x'?b.maxX:b.maxZ;const ids=r.vertices.filter(n=>doc.nodes[n][axis]>=maximum-.02),old=ids.map(n=>[n,{...doc.nodes[n]}]);ids.forEach(n=>doc.nodes[n][axis]=snap(doc.nodes[n][axis]+delta));if(!valid(doc)){old.forEach(([n,v])=>doc.nodes[n]=v);return false;}return true;}
export function splitEdge(doc,e){const {mid,length}=segment(doc,e);if(length<.3)return null;const id='n'+doc.nextId++;doc.nodes[id]={x:snap(mid.x),z:snap(mid.z)};for(const r of doc.rooms){for(let i=r.vertices.length-1;i>=0;i--){if(edgeId(r.vertices[i],r.vertices[(i+1)%r.vertices.length])===e.id)r.vertices.splice(i+1,0,id);}}for(const p of [...doc.partitions])if(edgeId(p.a,p.b)===e.id){doc.partitions.splice(doc.partitions.indexOf(p),1,{a:p.a,b:id},{a:id,b:p.b});}
 const edge1=edgeId(e.a,id),edge2=edgeId(id,e.b);if(doc.walls[e.id]){doc.walls[edge1]={...doc.walls[e.id]};doc.walls[edge2]={...doc.walls[e.id]};delete doc.walls[e.id];}
 // Remap openings by physical position on the old wall, irrespective of edge orientation.
 for(const o of doc.openings.filter(o=>o.wall===e.id)){
  const originalPoint=onEdge(doc,e,o.t),newId=o.t<.5?edge1:edge2,actual=edges(doc).find(x=>x.id===newId);
  o.wall=newId;o.t=clamp(project(doc,actual,originalPoint),.03,.97);
 }
 return id;}
export function addRoom(doc,name='Новая комната'){const b=bounds(doc),x=b.maxX+.2,z=0,vertices=[[x,z],[x+2.9,z],[x+2.9,z+4],[x,z+4]].map(([x,z])=>{const id='n'+doc.nextId++;doc.nodes[id]={x,z};return id;});const room={id:'r'+doc.nextId++,name,color:colors[doc.rooms.length%colors.length],vertices};doc.rooms.push(room);return room;}
export function addPolygonRoom(doc,points,name='Новая комната'){if(!simplePolygon(points))return null;const vertices=points.map(p=>{const found=Object.entries(doc.nodes).find(([,n])=>Math.hypot(p.x-n.x,p.z-n.z)<.22);if(found)return found[0];const id='n'+doc.nextId++;doc.nodes[id]={x:snap(p.x),z:snap(p.z)};return id;});if(new Set(vertices).size<3||!simplePolygon(vertices.map(id=>doc.nodes[id])))return null;const room={id:'r'+doc.nextId++,name,color:colors[doc.rooms.length%colors.length],vertices};doc.rooms.push(room);return room;}
export function onEdge(doc,e,t){const {a,dx,dz}=segment(doc,e);return {x:a.x+dx*t,z:a.z+dz*t};}
export function project(doc,e,p){const {a,dx,dz,length}=segment(doc,e);return clamp(((p.x-a.x)*dx+(p.z-a.z)*dz)/(length*length||1),0,1);}
export function safeDocument(raw){if(!raw||raw.version!==2||!raw.nodes||!Array.isArray(raw.rooms)||raw.rooms.length>100)throw Error('Неизвестный формат проекта');const d=copy(raw);d.height=clamp(Number(d.height)||2.65,2,5);if(Object.keys(d.nodes).length>2000)throw Error('Слишком много углов');for(const [id,n] of Object.entries(d.nodes))if(!Number.isFinite(n.x)||!Number.isFinite(n.z)||Math.abs(n.x)>100||Math.abs(n.z)>100)throw Error('Неверная точка '+id);if(!d.rooms.every(r=>Array.isArray(r.vertices)&&r.vertices.length<=150&&simplePolygon(r.vertices.map(id=>d.nodes[id]))))throw Error('Некорректная форма помещения');d.partitions=Array.isArray(d.partitions)?d.partitions.slice(0,200):[];d.walls=d.walls||{};d.openings=Array.isArray(d.openings)?d.openings.slice(0,150):[];d.furniture=Array.isArray(d.furniture)?d.furniture.slice(0,180):[];d.textures=d.textures||{};d.nextId=Math.max(Number(d.nextId)||1,200);const validEdges=new Set(edges(d).map(e=>e.id));d.openings=d.openings.filter(o=>validEdges.has(o.wall)&&Number.isFinite(o.t)&&Number.isFinite(o.width)&&['window','door'].includes(o.kind));return d;}
