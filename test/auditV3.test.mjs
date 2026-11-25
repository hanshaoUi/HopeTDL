import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { quoteShellArg } from '../shared/shellQuote.mjs'
import { specKey, invalidNumbers } from '../shared/specKey.mjs'
import { toArgs } from '../shared/jobSpec.mjs'
import { progressPercent, stagesForTask } from '../src/taskProgress.js'
import { normalizeTaskRecord } from '../src/taskState.js'

test('copied POSIX arguments cannot expand shell substitutions',{skip:process.platform==='win32'},()=>{
  const values=['hello world', '$HOME', '$(printf injected)', '`printf injected`', "a'b", 'a;b', '', '-100123']
  const result=spawnSync('/bin/sh',['-c',`printf '%s\\n' ${values.map(v=>quoteShellArg(v)).join(' ')}`],{encoding:'utf8'})
  assert.equal(result.status,0);assert.deepEqual(result.stdout.trimEnd().split('\n'),values.slice(0,-1).concat('-100123'))
})
test('PowerShell quoting preserves apostrophes and variable markers',()=>{
  assert.equal(quoteShellArg("a'b$HOME",true),"'a''b$HOME'")
  assert.equal(quoteShellArg('@channel',true),"'@channel'")
  assert.equal(quoteShellArg('1,2',true),"'1,2'")
})
test('runtime spec matching ignores JSON object key ordering',()=>{
  assert.equal(specKey({kind:'forward',target:{thread:1,peer:'@a'}}),specKey({target:{peer:'@a',thread:1},kind:'forward'}))
  assert(invalidNumbers({delayMs:NaN}));assert(invalidNumbers({startId:-1}));assert(!invalidNumbers({startId:12,kind:'comment-forward'}))
})
test('export content and all-message flags remain independent; blank selector is omitted',()=>{
  const args=toArgs({kind:'export',chat:'@a',all:false,withContent:true,selector:{type:'id',input:''}})
  assert(args.includes('--with-content'));assert(!args.includes('--all'));assert(!args.includes('-T'));assert(!args.includes('-i'))
})
test('forward router strings escape peers and preserve large integer topics',()=>{
  const args=toArgs({kind:'forward',from:'a.json',target:{peer:'a"b',thread:'9007199254740993'}})
  assert.equal(args[args.indexOf('--to')+1],'{ Peer: "a\\"b", Thread: 9007199254740993 }')
})
test('checkpoint summaries count completed groups without subtracting one',()=>{
  assert.equal(progressPercent({}, {current:1,total:1,stage:'checkpoint-summary'}),100)
  assert.deepEqual(stagesForTask({state:'running',spec:{kind:'comment-forward'}},{stage:'checkpoint'}).map(s=>s.state),['done','done','active'])
})
test('internal I/O errors are not mislabeled as missing tdl',()=>{
  assert.equal(normalizeTaskRecord({state:'failed',exitCode:-1,errorMessage:'invalid progress.json'}).failureCategory,'arguments')
  assert.equal(normalizeTaskRecord({state:'partial',failedCount:0}).summary,'部分成功（失败数量未知）')
})
