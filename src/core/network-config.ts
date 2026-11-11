import * as VAPI from "vapi";
import { z } from "zod";
import { SenderConfig, ReceiverConfig } from "../zod_types.js";
import { find_best_vifc } from "../utils.js";

type Sender = z.infer<typeof SenderConfig>;
type Receiver = z.infer<typeof ReceiverConfig>;

export async function sender_interfaces(vm: VAPI.AT1130.Root, conf: Sender) {
  const resolve = async (port: number, address: string | null) => {
    if (!address) return null;
    const vifc = await find_best_vifc(vm.network_interfaces.ports.row(port), conf.vlan_id);
    if (!vifc) throw new Error(`TX "${conf.label}": no IPv4 interface on media port ${port} for VLAN ${conf.vlan_id ?? "untagged"}`);
    return vifc;
  };
  return {
    primary: await resolve(0, conf.primary_destination_address),
    secondary: await resolve(1, conf.secondary_destination_address),
  };
}

export async function receiver_interfaces(vm: VAPI.AT1130.Root, conf: Receiver) {
  const primary = await find_best_vifc(vm.network_interfaces.ports.row(0), conf.vlan_id);
  const secondary = await find_best_vifc(vm.network_interfaces.ports.row(1), conf.vlan_id);
  // RX sheets do not specify required legs; retain support for single-network cards.
  if (!primary && !secondary) throw new Error(`RX "${conf.label}": no IPv4 interface on media ports 0 or 1 for VLAN ${conf.vlan_id ?? "untagged"}`);
  return { primary, secondary };
}

/** Video and ANC share a transmitter/session, so their required legs must be combined. */
export function sender_interface_config(conf: Sender, configs: Sender[]): Sender {
  if (conf.stream_type === "2110-30") return conf;
  const shared = configs.filter(c => c.id === conf.id && c.stream_type !== "2110-30");
  if (shared.some(c => (c.vlan_id ?? 0) !== (conf.vlan_id ?? 0))) {
    throw new Error(`TX ${conf.id}: video and ancillary streams must use the same VLAN`);
  }
  return {
    ...conf,
    primary_destination_address: shared.find(c => c.primary_destination_address)?.primary_destination_address ?? null,
    secondary_destination_address: shared.find(c => c.secondary_destination_address)?.secondary_destination_address ?? null,
  };
}

export async function validate_network_config(vm: VAPI.AT1130.Root, tx: Sender[], rx: Receiver[]) {
  const checked = new Set<string>();
  for (const conf of tx) {
    const effective = sender_interface_config(conf, tx);
    const key = `tx/${effective.vlan_id ?? 0}/${!!effective.primary_destination_address}/${!!effective.secondary_destination_address}`;
    if (checked.has(key)) continue;
    await sender_interfaces(vm, effective);
    checked.add(key);
  }
  for (const conf of rx) {
    const key = `rx/${conf.vlan_id ?? 0}`;
    if (checked.has(key)) continue;
    await receiver_interfaces(vm, conf);
    checked.add(key);
  }
}
