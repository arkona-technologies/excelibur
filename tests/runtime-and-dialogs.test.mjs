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
test('runtime reports the underlying spreadsheet error instead of only the exit code',async t=>{
  const dir=await fakeApp(t,'console.error("Error: Invalid workbook:\\nPROC row 3 framesync_mode: Required"); process.exit(1);');
  await assert.rejects(
    run_batch_capture_with_sdk({url:'ws://test.invalid',input_dir:dir,output_dir:dir,verbose:true},{app_root:dir}),
    /Invalid workbook:\nPROC row 3 framesync_mode: Required/,
  );
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
test('server downloads or saves the bundled spreadsheet template',async t=>{
  const appRoot=await fs.mkdtemp(path.join(os.tmpdir(),'excelibur-template-test-'));
  t.after(()=>fs.rm(appRoot,{recursive:true,force:true}));
  const templatePath=path.join(appRoot,'Excelibur_Template.xlsx');
  await fs.writeFile(templatePath,Buffer.from('xlsx-test'));

  let savedSource='';
  const desktop=buildServer({app_root:appRoot,desktop_file_dialogs:{
    pick_directory:async()=>'',
    pick_workbooks:async()=>[],
    save_template:async source=>{savedSource=source;return '/tmp/saved-template.xlsx';},
  }});
  t.after(()=>desktop.close());
  const saved=await desktop.inject({method:'POST',url:'/api/save-spreadsheet-template',payload:{}});
  assert.deepEqual(saved.json(),{ok:true,saved_path:'/tmp/saved-template.xlsx'});
  assert.equal(savedSource,templatePath);

  const browser=buildServer({app_root:appRoot});
  t.after(()=>browser.close());
  const fallback=await browser.inject({method:'POST',url:'/api/save-spreadsheet-template',payload:{}});
  assert.deepEqual(fallback.json(),{ok:true,download_url:'/api/spreadsheet-template'});
  const download=await browser.inject({method:'GET',url:'/api/spreadsheet-template'});
  assert.equal(download.statusCode,200);
  assert.equal(download.body,'xlsx-test');
  assert.match(download.headers['content-disposition'],/Excelibur_Template\.xlsx/);
});
