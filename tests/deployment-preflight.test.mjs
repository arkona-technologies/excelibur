import assert from 'node:assert/strict';
import test from 'node:test';

test('empty workbooks and missing interfaces fail before clearing card configuration',async t=>{
  let clears=0;
  t.mock.module('../build/base.js',{namedExports:{base:async()=>{clears++;}}});
  t.mock.module('../build/core/card.js',{namedExports:{ensure_supported_release:async()=> '2.9.test'}});
  t.mock.module('../build/core/sdk.js',{namedExports:{ensure_installed_sdk_matches_release:async()=>{}}});
  const {apply_workbook_config}=await import('../build/core/deploy.js');
  const empty={raw_config:[],processors_config:[],tx_config:[],rx_config:[]};
  await assert.rejects(apply_workbook_config({},empty),/no configuration rows/);
  const vm={network_interfaces:{ports:{row:()=>({virtual_interfaces:{rows:async()=>[]}})}}};
  await assert.rejects(apply_workbook_config(vm,{...empty,tx_config:[{id:0,label:'Audio',stream_type:'2110-30',vlan_id:null,primary_destination_address:'239.1.1.1',secondary_destination_address:null}]}),/no IPv4 interface/);
  assert.equal(clears,0);
});
