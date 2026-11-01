import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultDocument,bounds,totalWidth,validateDocument,keepFurnitureWithinRooms,roomForPosition} from '../model.js';

test('default apartment is three aligned rooms and a balcony dimension',()=>{
 const d=defaultDocument();assert.equal(totalWidth(d.dims),11.5);
 assert.equal(bounds(d,'bedroom').minX,4.5);
 assert.equal(bounds(d,'kitchen').maxX,11.5);
 assert.ok(d.dims.balconyWidth>0);
});
test('default document validates and makes independent copy',()=>{
 const d=validateDocument(defaultDocument());d.dims.living=7;
 assert.equal(defaultDocument().dims.living,4.5);
});
test('reject invalid geometry, poisoned files and duplicates',()=>{
 const a=defaultDocument();a.dims.height=Infinity;assert.throws(()=>validateDocument(a));
 const b=defaultDocument();b.furniture.push({...b.furniture[0]});assert.throws(()=>validateDocument(b));
 const c=defaultDocument();c.textures={living:'javascript:alert(1)'};assert.equal(validateDocument(c).textures.living,undefined);
});
test('changing room widths retains furniture inside room',()=>{
 const d=defaultDocument();d.dims.living=2.2;keepFurnitureWithinRooms(d);
 for(const item of d.furniture){const b=bounds(d,item.room);assert.ok(item.x>=b.minX && item.x<=b.maxX);}
});
test('identify room from world position',()=>{
 const d=defaultDocument();assert.equal(roomForPosition(d,10,2),'kitchen');assert.equal(roomForPosition(d,12,2),null);
});

test('extra walls survive saved project and reject invalid coordinates',()=>{
 const d=defaultDocument();d.extraWalls.push({x1:1,z1:1,x2:2.4,z2:2.5});
 const loaded=validateDocument(JSON.parse(JSON.stringify(d)));assert.equal(loaded.extraWalls.length,1);
 loaded.extraWalls[0].x2=100;assert.throws(()=>validateDocument(loaded));
});

test('facade openings remain editable in JSON and reject invalid width',()=>{
 const d=defaultDocument();assert.equal(d.openings.length,4);
 d.openings[0].x=1.55;d.openings[0].w=1.1;
 const saved=validateDocument(JSON.parse(JSON.stringify(d)));
 assert.equal(saved.openings[0].x,1.55);
 assert.equal(saved.openings[0].w,1.1);
 const invalid=defaultDocument();invalid.openings[0].w=-1;
 assert.throws(()=>validateDocument(invalid));
});

test('legacy JSON without openings loads default facade',()=>{
 const d=defaultDocument();delete d.openings;
 assert.equal(validateDocument(d).openings.length,4);
});

import {resizeWall,resizeStructure} from '../model.js';

test('legacy v1 JSON without thickness controls stays compatible',()=>{
 const d=defaultDocument();delete d.dims.wallThickness;
 d.extraWalls.push({x1:1,z1:1,x2:3,z2:1});
 const loaded=validateDocument(d);
 assert.equal(loaded.dims.wallThickness,.13);
 assert.equal(loaded.extraWalls[0].thickness,.13);
});

test('custom partition length and thickness persist',()=>{
 const d=defaultDocument();const wall={x1:1,z1:1,x2:2,z2:1,thickness:.25};d.extraWalls.push(wall);
 assert.equal(resizeWall(d,wall,3),true);
 assert.ok(Math.abs(wall.x2-4)<.00001);
 const loaded=validateDocument(d);
 assert.equal(loaded.extraWalls[0].thickness,.25);
 assert.equal(Math.round(loaded.extraWalls[0].x2),4);
});

test('wall endpoint length stays within floor and too-short length rejected',()=>{
 const d=defaultDocument();const wall={x1:11,z1:2,x2:11.3,z2:2};
 assert.equal(resizeWall(d,wall,5),true);
 assert.ok(wall.x2<=totalWidth(d.dims));
 const snapshot={...wall};assert.equal(resizeWall(d,wall,.05),false);
 assert.deepEqual(wall,snapshot);
});

test('structural wall dimensions resize adjacent rooms without changing total width',()=>{
 const d=defaultDocument();const total=totalWidth(d.dims);
 assert.equal(resizeStructure(d,'seam-0',5),true);
 assert.equal(d.dims.living,5);
 assert.equal(d.dims.bedroom,3.4);
 assert.equal(totalWidth(d.dims),total);
 assert.equal(resizeStructure(d,'back',5),true);
 assert.equal(d.dims.depth,5);
 assert.equal(resizeStructure(d,'hall',2),true);
 assert.equal(d.dims.hallDepth,2);
 assert.equal(resizeStructure(d,'seam-0',8.9),false);
});

test('structural wall thickness overrides validate and survive JSON',()=>{
 const d=defaultDocument();d.structuralThicknesses={front:.31,'seam-0':.2};
 const loaded=validateDocument(JSON.parse(JSON.stringify(d)));
 assert.deepEqual(loaded.structuralThicknesses,d.structuralThicknesses);
 loaded.structuralThicknesses.front=.6;
 assert.throws(()=>validateDocument(loaded));
});