import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../public/model.js';
test('sample graph is valid and unscored',()=>{const w=M.exampleWorkspace();assert.equal(w.nodes.length,10);assert.ok(w.edges.every(e=>e.confidence===null));assert.deepEqual(M.validateWorkspace(w),w);});
test('unsafe source URLs are rejected',()=>assert.throws(()=>M.safeUrl('javascript:alert(1)')));
test('dangling relationships are rejected',()=>{const w=M.exampleWorkspace();assert.throws(()=>M.validateGraph(w.nodes,[{id:'bad',from:'missing',to:'s01',relation:'informs'}],w.sources));});
test('stale results cannot overwrite current graph',()=>{const w=M.exampleWorkspace(),r=M.makeRequest(w,'Assess diet','mandarin',['s01']);const result=M.validateResult({...M.requestPacket(w,r).requiredOutput,report:{title:'Report',markdown:'Evidence limitations.'}},r,w);assert.throws(()=>M.mergeChanges({...w,revision:1},result));assert.equal(M.mergeChanges(w,result).nodes.length,10);});
test('a completed run must contain a report',()=>{const w=M.exampleWorkspace(),r=M.makeRequest(w,'Question','',['s01']);assert.throws(()=>M.validateResult({...M.requestPacket(w,r).requiredOutput,report:{markdown:''}},r,w));});
