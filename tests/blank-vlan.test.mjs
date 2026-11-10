import assert from "node:assert/strict";
import test from "node:test";
import xlsx from "node-xlsx";
import { parse_workbook_buffer } from "../build/core/workbook.js";

test("workbook transmitter and receiver rows survive blank VLAN cells", (t) => {
  t.mock.method(console, "log", () => {});
  const workbook = xlsx.build([
    { name: "PROC", data: [["name", "source_type", "source_id", "output_type", "output_id"]] },
    { name: "TX", data: [
      ["id", "label", "stream_type", "primary_destination_address", "primary_destination_port", "secondary_destination_address", "secondary_destination_port", "payload_type", "vlan_id", "channel_count", "p_time", "bit_depth"],
      [0, "Audio", "2110-30", "239.62.45.1", 30001, "239.63.45.1", 30001, 96, null, 64, "p0_125", "L24"],
      [1, "Tagged audio", "2110-30", "239.62.45.2", 30001, "239.63.45.2", 30001, 96, 100, 32, "p0_125", "L24"],
    ] },
    { name: "RX", data: [
      ["id", "label", "stream_type", "uhd", "vlan_id"],
      [0, "Audio input", "2110-30", "false", null],
    ] },
  ]);
  const config = parse_workbook_buffer(workbook);
  assert.equal(config.tx_config.length, 2);
  assert.equal(config.tx_config[0].vlan_id, null);
  assert.equal(config.tx_config[0].channel_count, 64);
  assert.equal(config.tx_config[0].primary_destination_address, "239.62.45.1");
  assert.equal(config.tx_config[0].secondary_destination_address, "239.63.45.1");
  assert.equal(config.tx_config[1].vlan_id, 100);
  assert.equal(config.rx_config.length, 1);
  assert.equal(config.rx_config[0].vlan_id, null);
});
