import assert from 'node:assert/strict';
import test from 'node:test';
import {apply_senders_config} from '../build/senders.js';
import {receiver_interfaces, sender_interface_config, validate_network_config} from '../build/core/network-config.js';
import {setup_processing_chains} from '../build/processors.js';

const conf={id:0,label:'Audio',stream_type:'2110-30',primary_destination_address:'239.1.1.1',secondary_destination_address:'239.2.1.1',primary_destination_port:5004,secondary_destination_port:5004,payload_type:96,vlan_id:null,channel_count:16,p_time:'p0_125',bit_depth:'L24'};
function mockCard(existing,available=[true,true]) {
  const events=[];
  const field=(name,value=null)=>({status:{read:async()=>value},command:{write:async v=>events.push([name,v])}});
  const session={row_name:field('session.name','Audio'),active:field('active',false),interfaces:field('interfaces'),raw:{kwl:'session'}};
  const tx={generic:{hosting_session:field('hosting',existing?session:null),ip_configuration:{media:{primary:{dst_address:field('primary'),header_settings:field('header',{})},secondary:{dst_address:field('secondary'),header_settings:field('header',{})}}}},row_name:field('tx.name')};
  const vifcs=[0,1].map(port=>({port,vlan_id:{read:async()=>0},ip_addresses:{rows:async()=>[{ip_address:{read:async()=>'192.0.2.1'}}]}}));
  const vm={raw:{identify:()=> 'mock',write_unchecked:(...args)=>events.push(['activate',...args])},network_interfaces:{ports:{row:port=>({virtual_interfaces:{rows:async()=>available[port]?[vifcs[port]]:[]}})}},r_t_p_transmitter:{audio_transmitters:{create_row:async()=>{events.push(['create']);return tx;}},sessions:{rows:async()=>[session],create_row:async()=>session}}};
  return {vm,events,vifcs};
}
test('reused sessions get current interfaces while inactive',async()=>{
  const {vm,events,vifcs}=mockCard(true);
  await apply_senders_config(vm,[conf]);
  assert.deepEqual(events.find(e=>e[0]==='interfaces')[1],{primary:vifcs[0],secondary:vifcs[1]});
  assert(events.findIndex(e=>e[0]==='active'&&e[1]===false)<events.findIndex(e=>e[0]==='interfaces'));
  assert(!events.some(e=>e[0]==='hosting'));
});
test('missing required TX leg fails before writes; disabled secondary is allowed',async()=>{
  const {vm,events}=mockCard(false,[true,false]);
  await assert.rejects(apply_senders_config(vm,[conf]),/TX "Audio".*port 1.*untagged/);
  assert.equal(events.length,0);
  await apply_senders_config(vm,[{...conf,secondary_destination_address:null}]);
  assert.equal(events.find(e=>e[0]==='interfaces')[1].secondary,null);
});
test('RX allows a single network but rejects no matching interface',async()=>{
  assert((await receiver_interfaces(mockCard(false,[true,false]).vm,conf)).primary);
  await assert.rejects(receiver_interfaces(mockCard(false,[false,false]).vm,conf),/RX "Audio"/);
});
test('preflight is read-only; shared video and ANC retain both required legs',async()=>{
  const {vm,events}=mockCard(false);
  await validate_network_config(vm,[conf],[conf]);
  assert.equal(events.length,0);
  const video={...conf,stream_type:'2110-20',secondary_destination_address:null};
  const anc={...conf,stream_type:'2110-40',primary_destination_address:null};
  const combined=sender_interface_config(anc,[video,anc]);
  assert.equal(combined.primary_destination_address,conf.primary_destination_address);
  assert.equal(combined.secondary_destination_address,conf.secondary_destination_address);
  assert.throws(()=>sender_interface_config(video,[video,{...anc,vlan_id:20}]),/same VLAN/);
});
test('resource allocation failure propagates with chain identity',async t=>{
  t.mock.method(console,'log',()=>{});t.mock.method(console,'table',()=>{});
  const tx={a_src:{}};
  const vm={raw:{identify:()=> 'mock'},system:{io_board:{info:{type:{read:async()=>null}}}},r_t_p_receiver:{runtime_constants:{}},r_t_p_transmitter:{runtime_constants:{},audio_transmitters:{create_row:async()=>tx,row:()=>tx}},audio_gain:{instances:{create_row:async()=>{throw Error('no gain capacity')}}}};
  let progress;
  await assert.rejects(setup_processing_chains(vm,[{name:'Audio',source_type:'VOID',source_id:0,output_type:'IP-AUDIO',output_id:0,flow_type:'Audio'}],(...p)=>progress=p),/Processing chain "Audio" failed: no gain capacity/);
  assert.notEqual(progress[2],'processors complete');
});
