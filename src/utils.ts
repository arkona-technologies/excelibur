import { isIPv4 } from "net";
import * as VAPI from "vapi";
export const unique_by = (prop: any) => (data: any, index: any, arr: any) =>
  index === arr.findIndex((t: any) => t[prop] === data[prop]);
export const unique_by_n =
  (props: any[]) => (data: any, index: any, arr: any) =>
    index ===
    arr.findIndex((t: any) => {
      let maybe_true = true;
      for (const prop of props) {
        maybe_true = maybe_true && t[prop] === data[prop];
      }
      return maybe_true;
    });

export function shorten_label(label: string): string {
  const new_label = label
    .toLowerCase()
    .trim()
    .split(/[^a-zA-Z0-9]/g)
    .map((word) => word.replace(/[aeiou]/g, "")) // remove vowels
    .map((word) => word);
  return new_label.join("").substring(0, 28);
}

export async function find_best_vifc(port: VAPI.AT1130.NetworkInterfaces.Port) {
  const vifcs = await port.virtual_interfaces.rows();
  for (const vifc of vifcs) {
    const addresses = await vifc.ip_addresses.rows();
    for (const masked_addr of addresses) {
      const addr = await masked_addr.ip_address.read();
      if (addr && isIPv4(addr)) return vifc;
    }
  }
  return null;
}
