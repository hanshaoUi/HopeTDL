import test from 'node:test'
import assert from 'node:assert/strict'
import { safeDecimal, validateJob } from '../shared/validateJob.mjs'
import { invalidNumbers } from '../shared/specKey.mjs'
import { sourceChatForSpec, targetChatForSpec } from '../shared/jobSpec.mjs'

test('original decimal fields reject unsafe values and alternate numeric spellings',()=>{
  for(const v of ['9007199254740993','9007199254740992','1e2','0x10','1.5','-1']) assert(Number.isNaN(safeDecimal(v)))
  assert.equal(safeDecimal('9007199254740991'),Number.MAX_SAFE_INTEGER)
  assert.equal(safeDecimal(''),null)
  assert.equal(safeDecimal('',0),0)
  assert.equal(invalidNumbers(Number('9007199254740993')),true)
})
test('plan validation checks every workflow step before it is serialized',()=>{
  const exportSpec={kind:'export',chat:'source',output:'/tmp/messages.json',selector:{type:'id',input:''}}
  assert.doesNotThrow(()=>validateJob(exportSpec))
  assert.throws(()=>validateJob({...exportSpec,selector:{type:'last',input:''}}))
  for(const thread of ['abc','-1','1.2']) assert.throws(()=>validateJob({kind:'workflow',steps:[exportSpec,{kind:'forward',from:exportSpec.output,target:{peer:'target',thread}}]}))
  assert.throws(()=>validateJob({kind:'workflow',steps:[]}))
  assert.throws(()=>validateJob({kind:'workflow',steps:[{kind:'download',directory:'/tmp',source:{items:[]},resumeMode:'none'}]}))
  assert.doesNotThrow(()=>validateJob({kind:'download',directory:'/tmp',resumeMode:'continue'}))
})
test('workflow routes include nested source and destination without inventing a forward source',()=>{
  const spec={kind:'workflow',steps:[{kind:'export',chat:'source'},{kind:'forward',target:{peer:'target'}}]}
  assert.equal(sourceChatForSpec(spec),'source');assert.equal(targetChatForSpec(spec),'target')
  assert.equal(sourceChatForSpec(spec.steps[1]),'')
})
