import assert from 'node:assert/strict';
import test from 'node:test';
import xlsx from 'node-xlsx';
import { parse_rows, parse_csv } from '../build/csv.js';
import { parse_workbook_buffer } from '../build/core/workbook.js';
import { SenderConfig, ReceiverConfig, ProcessingChainConfig, refine_config } from '../build/zod_types.js';

const header = ['id','label','stream_type','primary_destination_address','primary_destination_port','secondary_destination_address','secondary_destination_port','payload_type','vlan_id','channel_count','p_time','bit_depth'];
const row = [0,'Audio','2110-30','239.1.1.1',5004,'239.2.1.1',5004,96,null,16,'p0_125','L24'];
const workbook = rows => xlsx.build([
  { name:'PROC',data:[['name','source_type','source_id','output_type','output_id']] },
  { name:'TX',data:[header,...rows] },
  { name:'RX',data:[['id','label','stream_type','uhd']] },
]);

test('blank channel counts default to 16; labels retain commas, quotes and newlines', () => {
  const input = [...row]; input[1] = 'Audio, "Main"\nSecond line'; input[9] = null;
  const config = parse_workbook_buffer(workbook([input,[],Array(12).fill(null)]));
  assert.equal(config.tx_config.length,1);
  assert.equal(config.tx_config[0].label,input[1]);
  assert.equal(config.tx_config[0].channel_count,16);
});

test('quoted CSV preserves special characters and rejects malformed quotes', () => {
  const input = [...row]; input[1] = 'Audio, "Main"\nSecond line';
  const csv = [header,input].map(r=>r.map(c=>c==null?'':`"${String(c).replaceAll('"','""')}"`).join(',')).join('\r\n');
  assert.equal(parse_csv(csv,SenderConfig)[0].label,input[1]);
  assert.throws(()=>parse_csv(csv+'\n"unclosed',SenderConfig),/unterminated/);
});

test('invalid populated rows fail the workbook with sheet, row and field', () => {
  const input = [...row]; input[3] = 'not-an-ip';
  assert.throws(()=>parse_workbook_buffer(workbook([[],input])),/TX row 3, primary_destination_address/);
});

test('workbook validation reports independent errors across sheets and processor rows', () => {
  const procHeader=['name','flow_type','source_type','source_id','video_format','framesync_mode','delay_audio_ms','delay_video_frames','delay_video_ms','splitter_phase','output_type','output_id'];
  const txHeader=header;
  const rxHeader=['id','label','stream_type','uhd','sync','channel_capacity','switch_type'];
  const invalidTx=[...row]; invalidTx[3]='not-an-ip';
  const buffer=xlsx.build([
    {name:'PROC',data:[procHeader,
      ['SDI A','Video','SDI',0,'3G',null,10,null,null,null,'SDI',0],
      ['Audio A','Audio','IP-AUDIO',0,null,null,null,null,20,null,'IP-AUDIO',0],
    ]},
    {name:'TX',data:[txHeader,invalidTx]},
    {name:'RX',data:[rxHeader,[0,'Video','2110-20','false','invalid',16,'Patch']]},
  ]);
  assert.throws(
    ()=>parse_workbook_buffer(buffer),
    error => {
      assert.match(error.message,/TX row 2, primary_destination_address/);
      assert.match(error.message,/RX row 2, sync/);
      assert.match(error.message,/SDI A.*framesync_mode is required/);
      assert.match(error.message,/SDI A.*delay_audio_ms must be blank/);
      assert.match(error.message,/Audio A.*video delay fields must be blank/);
      return true;
    },
  );
});

test('false sync is honored; blank optional fields use defaults; invalid boolean rejected', () => {
  const h = ['id','label','stream_type','uhd','sync','channel_capacity','switch_type'];
  for (const value of ['false','FALSE',false]) {
    const [rx] = parse_rows([h,[0,'Video','2110-20',false,value,null,null]],ReceiverConfig);
    assert.equal(rx.sync,false); assert.equal(rx.channel_capacity,16); assert.equal(rx.switch_type,'Patch');
  }
  assert.equal(parse_rows([h,[0,'Video','2110-20',false,null]],ReceiverConfig)[0].sync,true);
  assert.throws(()=>parse_rows([h,[0,'Video','2110-20',false,'nope']],ReceiverConfig),/sync/);
});

const processor = overrides => ProcessingChainConfig.parse({
  name:'Chain', flow_type:'Video', source_type:'IP-VIDEO', source_id:0,
  framesync_mode:null, delay_audio_ms:null, delay_video_frames:null,
  delay_video_ms:null, video_format:'3G', lut_name:null, splitter_phase:null,
  output_type:'SDI', output_id:0, ...overrides,
});

test('processor frame sync is required only for SDI video and shared inputs cannot conflict', () => {
  assert.throws(()=>refine_config([processor({source_type:'SDI'})]),/framesync_mode is required/);
  assert.throws(()=>refine_config([processor({framesync_mode:'FramePhaser'})]),/must be blank/);
  assert.doesNotThrow(()=>refine_config([processor({source_type:'SDI',framesync_mode:'FramePhaser'})]));
  assert.throws(()=>refine_config([
    processor({source_type:'SDI',framesync_mode:'FramePhaser'}),
    processor({name:'Other',source_type:'SDI',framesync_mode:'FrameSync_Black'}),
  ]),/conflicting framesync_mode/);
});

test('processor delay units follow flow type and video units are mutually exclusive', () => {
  assert.doesNotThrow(()=>refine_config([processor({delay_video_frames:1})]));
  assert.doesNotThrow(()=>refine_config([processor({delay_video_ms:100.5})]));
  assert.throws(()=>refine_config([processor({delay_video_frames:1,delay_video_ms:20})]),/mutually exclusive/);
  assert.throws(()=>refine_config([processor({delay_audio_ms:20})]),/delay_audio_ms must be blank/);
  assert.throws(()=>refine_config([processor({flow_type:'Audio',source_type:'IP-AUDIO',output_type:'IP-AUDIO',delay_video_ms:20})]),/video delay fields must be blank/);
  assert.throws(()=>processor({delay_video_frames:0}),/greater than 0/);
});

test('legacy processor delay columns are rejected instead of ignored', () => {
  const header=['name','flow_type','source_type','source_id','delay_frames','video_format','splitter_phase','output_type','output_id'];
  assert.throws(()=>parse_rows([header,['Old','Video','IP-VIDEO',0,1,'3G',null,'SDI',0]],ProcessingChainConfig),/delay_frames/);
});
