import * as VAPI from "vapi";

export async function open_connection(url?: URL) {
  url ??= new URL("ws://127.0.0.1");
  const vm = await VAPI.VM.open({
    ip: url.host,
    towel: "",
    login: url.username ? { user: url.username, password: url.password } : null,
    reject_unauthorized: false,
  });
  return vm;
}
