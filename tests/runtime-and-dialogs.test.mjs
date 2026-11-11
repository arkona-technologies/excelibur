import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {run_batch_capture_with_sdk} from '../build/core/server-sdk-runner.js';
import {buildServer} from '../build/server-app.js';

async function fakeApp(t, script) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'excelibur-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  await fs.mkdir(path.join(dir,'build/cli'),{recursive:true});
  await fs.writeFile(path.join(dir,'build/cli/run-with-sdk.js'),script);
  return dir;
}
test('capture wait reaches child process including zero; invalid delay rejected',async t=>{
  const dir=await fakeApp(t,'console.log("WAIT:" + process.env.WAIT_SECONDS_BEFORE_CAPTURE);');
  for(const wait of [0,17]) {
    const logs=[];
    await run_batch_capture_with_sdk({url:'ws://test.invalid',input_dir:dir,output_dir:dir,verbose:true,wait_seconds_before_capture:wait},{app_root:dir,on_log:s=>logs.push(s)});
    assert(logs.includes(`WAIT:${wait}`));
  }
  await assert.rejects(run_batch_capture_with_sdk({wait_seconds_before_capture:-1}),/nonnegative/);
});
test('runtime child ignoring SIGTERM is forcibly stopped', {timeout:10000},async t=>{
  const dir=await fakeApp(t,'process.on("SIGTERM",()=>{}); setInterval(()=>{},1000); console.log("READY");');
  const started=Date.now();
  await assert.rejects(run_batch_capture_with_sdk({url:'ws://test.invalid',input_dir:dir,output_dir:dir,verbose:true},{app_root:dir,on_log:s=>{if(s==='READY') process.emit('SIGTERM');}}),/Runtime process exited/);
  assert(Date.now()-started>=1900);
});
test('server uses desktop native file dialogs and returns cancellations',async t=>{
  let cancel=false;
  const server=buildServer({desktop_file_dialogs:{
    pick_directory:async prompt=>{assert.equal(prompt,'Folder');return '/tmp/output';},
    pick_workbooks:async()=>{if(cancel)throw Error('File selection cancelled');return ['/tmp/a.xlsx','/tmp/b.xlsx'];},
  }});
  t.after(()=>server.close());
  const folder=await server.inject({method:'POST',url:'/api/pick-directory',payload:{prompt:'Folder'}});
  assert.deepEqual(folder.json(),{ok:true,path:'/tmp/output'});
  const files=await server.inject({method:'POST',url:'/api/pick-workbooks',payload:{}});
  assert.deepEqual(files.json(),{ok:true,paths:['/tmp/a.xlsx','/tmp/b.xlsx']});
  cancel=true;
  const cancelled=await server.inject({method:'POST',url:'/api/pick-workbooks',payload:{}});
  assert.equal(cancelled.statusCode,400);
});
