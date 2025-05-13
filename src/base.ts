import { scrub } from "vutil";
import * as VAPI from "vapi";
import { setup_ptp } from "vutil/ptp.js";
import { setup_sdi_io } from "vutil/sdi_connections.js";
import { Duration } from "vscript";

export async function base(vm: VAPI.AT1130.Root) {
  await scrub(vm, { kwl_whitelist: [/system.nmos/, /system.services/] });
  await setup_ptp(vm, { ptp_domain: 127, locking_policy: "Locking" });
  await setup_sdi_io(vm).catch((_) => {});
  await vm.r_t_p_receiver?.settings.clean_switching_policy.write("Whatever");
  await vm.r_t_p_receiver?.settings.reserved_bandwidth.write(8);
  await vm.system_clock.t_src.write(vm.p_t_p_clock.output);
  const ltc_clock = await vm.master_clock.ltc_generators.create_row();
  await ltc_clock.t_src.command.write(
    vm.genlock!.instances.row(0).backend.output,
  );
  await ltc_clock.frame_rate.command.write("f25");
  await vm.audio_shuffler?.global_cross_fade.write(new Duration(50, "ms"));
  console.log(`Finished Base Setup @${vm.raw.identify()}`);
}
