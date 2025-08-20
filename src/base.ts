import * as VAPI from "vapi";
import {
  asyncFilterMap,
  asyncIter,
  asyncMap,
  Duration,
  enforce,
} from "vscript";
import { enumerate, range, scrub } from "vutil";
// import { setup_ptp } from "vutil/ptp.js";
import { setup_sdi_io } from "vutil/sdi_connections.js";

// export async function base(vm: VAPI.AT1130.Root, ptp_domain?: number) {
//   await scrub(vm, { kwl_whitelist: [/system.nmos/, /system.services/] });
//   await setup_ptp(vm, {
//     ptp_domain: ptp_domain ?? 127,
//     locking_policy: "Locking",
//   });
//   await setup_sdi_io(vm).catch((_) => { });
//   await vm.r_t_p_receiver?.settings.clean_switching_policy.write("Whatever");
//   await vm.r_t_p_receiver?.settings.reserved_bandwidth.write(8);
//   await vm.system_clock.t_src.write(vm.p_t_p_clock.output);
//   const ltc_clock = await vm.master_clock.ltc_generators.create_row();
//   await ltc_clock.t_src.command.write(
//     vm.genlock!.instances.row(0).backend.output,
//   );
//   await ltc_clock.frame_rate.command.write("f25");
//   await vm.audio_shuffler?.global_cross_fade.write(new Duration(50, "ms"));
//   console.log(`Finished Base Setup @${vm.raw.identify()}`);
// }

export async function find_best_ptp_domain(port: VAPI.AT1130.PTPFlows.Port) {
  console.log(`Looking for best domain for port ${port.raw.kwl}`);
  const vm = VAPI.VM.adopt(port.raw.backing_store) as VAPI.AT1130.Root;
  const agents = await asyncMap(range(0, 128), async (domain) => {
    const agent = await vm.p_t_p_flows.agents.create_row({
      allow_reuse_row: true,
    });
    await agent.mode.write("SlaveOnly");
    await agent.domain.command.write(domain);
    await agent.hosting_port.command.write(port);
    return agent as VAPI.AT1130.PTPFlows.AgentAsNamedTableRow;
  });
  await asyncIter(agents, async (a) => {
    await a.output.ptp_traits.wait_until((tr) => !!tr).catch((_e) => {});
  });
  type MasterParams = {
    domain: number;
    prio1: number;
    prio2: number;
    tp: VAPI.PTP.SourceType;
    name?: string;
  };
  const best_masters: MasterParams[] = await asyncFilterMap(
    await vm.p_t_p_flows.visible_masters.rows(),
    async (bm) => {
      const domain = await bm.ptp_traits.domain.read();
      const prio1 = await bm.ptp_traits.grandmaster_priority_1.read();
      const prio2 = await bm.ptp_traits.grandmaster_priority_2.read();
      const tp = await bm.ptp_traits.source_type.read();
      const name = await bm.ptp_traits.grandmaster_identity
        .read()
        .then((id) =>
          id.map((uint) => uint.toString(16).padStart(2, "0")).join(":"),
        );
      if (domain == null || prio1 == null || prio2 == null || tp == null) {
        return undefined;
      }
      return {
        domain,
        prio1,
        prio2,
        tp,
        name,
      };
    },
  );
  best_masters.sort((a, b) => {
    if (a.prio1 != b.prio1) return a.prio1 < b.prio1 ? -1 : 1;
    const st_a = VAPI.PTP.Enums.SourceType.indexOf(a.tp);
    const st_b = VAPI.PTP.Enums.SourceType.indexOf(b.tp);
    if (st_a != st_b) return st_a < st_b ? -1 : 1;
    if (a.prio2 != b.prio2) return a.prio2 < b.prio2 ? -1 : 1;
    return 0;
  });
  await asyncIter(agents, async (ag) => {
    await ag.hosting_port.command.write(null);
  });
  await vm.p_t_p_flows.agents.delete_all();
  return { port, master: best_masters.at(0) };
}

function chunk(array: any[], chunk_size: number) {
  return Array.from(
    { length: Math.ceil(array.length / chunk_size) },
    (_, index) => array.slice(index * chunk_size, (index + 1) * chunk_size),
  );
}

export async function setup_timing(vm: VAPI.AT1130.Root) {
  const ports = await vm.p_t_p_flows.ports.rows();
  const map: Awaited<ReturnType<typeof find_best_ptp_domain>>[] = [];
  for (const ports_subset of chunk(ports, 2)) {
    const to_map = await asyncMap(ports_subset, async (port) => {
      return await find_best_ptp_domain(port);
    });
    for (const m of to_map) map.push(m); // quick hack
  }
  const agents = await asyncFilterMap(map, async (pars) => {
    if (!!!pars.master) return undefined;
    const agent = await vm.p_t_p_flows.agents.create_row();
    await agent.domain.command.write(pars.master.domain);
    await agent.hosting_port.command.write(pars.port);
    await agent.mode.write("SlaveOnly");
    console.log(
      `Set up ${await agent.row_name()} for Master ${pars.master.name ?? "N/A"} on domain ${pars.master.domain}@${pars.port.raw.kwl}`,
    );
    return agent;
  });
  if (agents.length) {
    const has_responses = await Promise.any(
      agents.map((agent) =>
        agent.slave_statistics.num_delayresps_received
          .wait_until((d) => d > 20, { timeout: new Duration(10, "s") })
          .then(() => true)
          .catch(() => false),
      ),
    );
    console.log(
      `[${vm.raw.identify()}]: switch delay_resp_mode ? ${has_responses}`,
    );
    if (!has_responses) {
      for (const agent of agents) {
        const current =
          await agent.slave_settings.delay_req_routing.status.read();
        await agent.slave_settings.delay_req_routing.command.write(
          current === "Multicast" ? "Unicast" : "Multicast",
        );
      }
    }
  }
  const comb = await vm.time_flows.combinators.create_row();
  await comb.quorum.command.write(1);
  const tsrc = new Array(8).fill(null);
  for (const [idx, agent] of enumerate(agents)) tsrc[idx] = agent.output;
  await comb.t_src.command.write(tsrc);
  await vm.p_t_p_clock.t_src.command.write(comb.output);
  await vm.p_t_p_clock.mode.write("LockToInput");

  if (agents.length == 0) {
    console.log("Couldn't find suitable Masters! Using InternalOscillator");
    await vm.p_t_p_clock.mode.write("UseInternalOscillator");
  }
  for (const genlock of [...vm.genlock!.instances]) {
    await genlock.t_src.command.write(vm.p_t_p_clock.output);
  }
  return vm
    .genlock!.instances.row(0)
    .state.wait_until((s) => s == "Calibrated" || s === "FreeRun", {
      timeout: new Duration(5, "min"),
    })
    .then((_) => true)
    .catch((_) => false);
}

export async function base(vm: VAPI.AT1130.Root) {
  await scrub(vm, { kwl_whitelist: [/system.nmos/, /system.services/] });

  // const ports = await vm.p_t_p_flows.ports.rows();
  // await Promise.any(
  //   ports.map((p) =>
  //     p.active.wait_until((active) => active, {
  //       timeout: new Duration(1, "min"),
  //     }),
  //   ),
  // );
  // await setup_timing(vm);

  await setup_timing_freerun(vm);

  await setup_sdi_io(vm).catch((_) => {});
  await vm.r_t_p_receiver?.settings.clean_switching_policy.write("Whatever");
  await vm.r_t_p_transmitter?.settings.reserved_bandwidth.write(2);
  await vm.system_clock.t_src.write(vm.p_t_p_clock.output);
  await vm.system_clock.time_standard.command.write("TAI");
  const ltc_clock = await vm.master_clock.ltc_generators.create_row();
  await ltc_clock.t_src.command
    .write(vm.genlock!.instances.row(0).backend.output)
    .catch((_) => {});
  await ltc_clock.frame_rate.command.write("f25");
  await vm.audio_shuffler?.global_cross_fade.write(new Duration(50, "ms"));
  console.log(`Finished Base Setup @${vm.raw.identify()}`);
}

async function setup_timing_freerun(vm: VAPI.AT1130.Root) {
  await vm.p_t_p_clock.mode.write("UseInternalOscillator");
  for (const genlock of [...vm.genlock!.instances]) {
    await genlock.t_src.command.write(vm.p_t_p_clock.output);
  }
  await vm
    .genlock!.instances.row(0)
    .state.wait_until((s) => s == "Calibrated" || s === "FreeRun", {
      timeout: new Duration(5, "min"),
    });
}
