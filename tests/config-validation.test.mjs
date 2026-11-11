import assert from 'node:assert/strict';
import test from 'node:test';
import xlsx from 'node-xlsx';
import { parse_rows, parse_csv } from '../build/csv.js';
import { parse_workbook_buffer } from '../build/core/workbook.js';
import { SenderConfig, ReceiverConfig } from '../build/zod_types.js';

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

test('false sync is honored; blank optional fields use defaults; invalid boolean rejected', () => {
  const h = ['id','label','stream_type','uhd','sync','channel_capacity','switch_type'];
  for (const value of ['false','FALSE',false]) {
    const [rx] = parse_rows([h,[0,'Video','2110-20',false,value,null,null]],ReceiverConfig);
    assert.equal(rx.sync,false); assert.equal(rx.channel_capacity,16); assert.equal(rx.switch_type,'Patch');
  }
  assert.equal(parse_rows([h,[0,'Video','2110-20',false,null]],ReceiverConfig)[0].sync,true);
  assert.throws(()=>parse_rows([h,[0,'Video','2110-20',false,'nope']],ReceiverConfig),/sync/);
});
