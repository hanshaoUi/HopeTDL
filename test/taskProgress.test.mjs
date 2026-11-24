import test from 'node:test'
import assert from 'node:assert/strict'
import { progressPercent, stagesForTask } from '../src/taskProgress.js'
import { isTaskFailed } from '../src/taskState.js'
test('a group started is not counted as completed',()=>{
  assert.equal(progressPercent({progress:{current:1,total:1,stage:'export-post'}}),0)
  assert.equal(progressPercent({progress:{current:1,total:2,stage:'done'}}),50)
  assert.equal(progressPercent({progress:{current:2,total:2,stage:'rehearsal'}}),100)
  assert.equal(progressPercent({progress:{current:0,total:0,stage:'export-list'}}),null)
})
test('rehearsal never marks forwarding or checkpoints completed',()=>{
  assert.deepEqual(stagesForTask({state:'success',spec:{kind:'comment-forward',dryRun:true}}).map(s=>s.state),['done','skipped','skipped'])
})
test('workflow stages retain persisted multi-step compatibility',()=>{
  assert.deepEqual(stagesForTask({state:'failed',currentStep:2,spec:{kind:'workflow',steps:[{kind:'export'},{kind:'forward'},{kind:'upload'}]}}).map(s=>s.state),['done','fail',''])
})
test('failure counters include interrupted, partial and failed tasks consistently',()=>{
  assert.deepEqual(['interrupted','partial','failed','success','stopped','queued'].filter(state=>isTaskFailed({state})),['interrupted','partial','failed'])
})

test('terminal comment tasks never show an active phase',()=>{
  for(const state of ['failed','partial','interrupted','stopped'])assert(!stagesForTask({state,spec:{kind:'comment-forward'},progress:{stage:'forward-post'}}).some(s=>s.state==='active'))
})
