import { z } from "zod";
import * as VAPI from "vapi";

import { asyncFind, Duration, enforce, enforce_nonnull } from "vscript";
import assert from "assert";
import { audio_ref, range, video_ref } from "vutil";
import { ProcessingChainConfig } from "./zod_types.js";
import { lock_to_genlock } from "vutil/rtp_receiver.js";
import { shorten_label, unique_by, unique_by_n } from "./utils.js";

async function prepare_madi_ins(
  madi_ins: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of madi_ins) {
    await vm.i_o_module?.input.row(conf.source_id).mode.command.write("MADI");
    await vm.i_o_module?.input.row(conf.source_id).audio_timing.command.write({
      variant: "SynchronousOrSyntonous",
      value: { frequency: "F48000", genlock: vm.genlock!.instances.row(0) },
    });
  }
}

async function prepare_sdi_ins(
  sdi_ins: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of sdi_ins) {
    await vm.i_o_module?.input.row(conf.source_id).mode.command.write("SDI");
  }
}

async function prepare_audio_players(
  audio_players: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of audio_players) {
    const player = await vm.re_play?.audio.players.create_row({
      index: conf.source_id,
      allow_reuse_row: true,
    });
    if (!(await player?.capabilities.capacity.status.read())) {
      await player?.capabilities.capacity.command.write({
        variant: "Time",
        value: { time: new Duration(5, "s") },
      });
    }
    await player?.rename(conf.name);
  }
}

async function prepare_video_players(
  video_players: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of video_players) {
    const player = await vm.re_play?.video.players.create_row({
      allow_reuse_row: true,
      index: conf.source_id,
    });
    await player?.capabilities.command.write({
      capacity: { variant: "Frames", value: { frames: 10 } },
      input_caliber: {
        add_blanking: false,
        constraints: {
          variant: "Bandwidth",
          value: {
            max_bandwidth: ["6G", "12G"].includes(conf.video_format ?? "null")
              ? "b12_0Gb"
              : "b3_0Gb",
          },
        },
      },
    });
    console.log(
      `${player?.raw.kwl} has capabilities: ${JSON.stringify(await player?.capabilities.status.read())}`,
    );
    await player?.rename(conf.name);
  }
}
async function prepare_video_tx(
  rtp_video_outs: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of rtp_video_outs) {
    const tx = await vm.r_t_p_transmitter!.video_transmitters.create_row({
      allow_reuse_row: true,
      index: conf.output_id,
    });
    const maybe_session = await tx.generic.hosting_session.status.read();
    if (maybe_session) {
      await maybe_session.active.command.write(false);
    }
    await tx.constraints.max_bandwidth.command.write(
      conf.video_format == "12G" || conf.video_format == "6G"
        ? "b12_0Gb"
        : "b3_0Gb",
    );
    await tx.rename(conf.name);
    if (maybe_session) {
      vm.raw.write_unchecked(
        { kwl: maybe_session.raw.kwl, kw: "active_command" },
        true,
      );
    }
  }
}
async function prepare_audio_tx(
  rtp_audio_outs: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of rtp_audio_outs) {
    const tx = await vm.r_t_p_transmitter!.audio_transmitters.create_row({
      allow_reuse_row: true,
      index: conf.output_id,
    });
    await tx.rename(conf.name);
  }
}

async function prepare_video_rx(
  rtp_video_ins: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of rtp_video_ins) {
    const rx = await vm.r_t_p_receiver!.video_receivers.create_row({
      allow_reuse_row: true,
      index: conf.source_id,
    });
    await rx.generic.initiate_readout_on.command.write("FirstStreamPresent");
    if (await rx.media_specific.capabilities.status.read()) continue;
    await rx.media_specific.capabilities.command
      .write({
        read_speed: lock_to_genlock(rx),
        supports_clean_switching: true,
        jpeg_xs_caliber: null,
        st2042_2_caliber: null,
        supports_2022_6: true,
        st2110_20_caliber: "ST2110_upto_3G",
        supports_2110_40: true,
        supports_uhd_sample_interleaved: true,
      })
      .catch((e) => console.log(e));
    await rx.rename(conf.name);
  }
}

async function prepare_audio_rx(
  rtp_audio_ins: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of rtp_audio_ins) {
    const rx = await vm.r_t_p_receiver!.audio_receivers.create_row({
      allow_reuse_row: true,
      index: conf.source_id,
    });
    await rx.generic.initiate_readout_on.command.write("FirstStreamPresent");
    if (await rx.media_specific.capabilities.status.read()) continue;
    await rx.media_specific.capabilities.command
      .write({
        read_speed: lock_to_genlock(rx),
        channel_capacity: 16,
        payload_limit: "AtMost1984Bytes",
        supports_clean_switching: true,
      })
      .catch((e) => console.log(e));
    await rx.rename(conf.name);
  }
}

async function setup_processing_chain_video(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>,
) {
  async function set_vsrc(
    target_command: any,
    source: VAPI.AT1130.Video.Essence,
  ) {
    const kwl = target_command.parent.raw.kwl as string;
    console.log(
      `[${vm.raw.identify()}] ${kwl}: setting source to ${source.raw.kwl}`,
    );
    if (kwl.includes("sdi") || kwl.includes("transmitter")) {
      return await target_command.write(video_ref(source));
    } else {
      return await target_command.write(source);
    }
  }
  const find_target = () => {
    switch (config.output_type) {
      case "IP-VIDEO":
        return vm.r_t_p_transmitter?.video_transmitters.row(config.output_id)
          .v_src;
      case "SDI":
        return vm.i_o_module?.output.row(config.output_id).sdi.v_src;
      case "IP-AUDIO":
      case "MADI":
        assert(false);
    }
  };

  let target: any = find_target(); // type this out...

  const find_source = () => {
    switch (config.source_type) {
      case "IP-VIDEO":
        return vm.r_t_p_receiver?.video_receivers.row(config.source_id)
          .media_specific.output.video;
      case "SDI":
        return vm.i_o_module?.input.row(config.source_id).sdi.output.video;
      case "SDI2SI":
        return vm.i_o_module?.merger.row(0).output.row(0).video;
      case "PLAYER-VIDEO":
        return vm.re_play?.video.players.row(config.source_id).output.video;
      case "PLAYER-AUDIO":
      case "IP-AUDIO":
      case "MADI":
        assert(
          false,
          "Audio Only Output shouldn't be a target for video processing",
        );
    }
  };

  let source = enforce_nonnull(find_source()); // type this out...
  const find_splitter = async (v_src: VAPI.AT1130.Video.Essence) => {
    enforce(!!vm.splitter);
    const splitters = await vm.splitter.instances.rows();
    console.log(`[${vm.raw.identify()}] Searching for Splitter with v_src == ${v_src.raw.kwl}`);
    for (const splitter of splitters) {
      const v_src_split = await splitter.v_src.status.read();
      if (v_src.raw.kwl == v_src_split?.raw.kwl) return splitter;
    }
    return null;
  };

  if (config.splitter_phase !== null) {
    console.log(
      `[${vm.raw.identify()}] ${config.name}: Using Splitter; ignoring cc3d and delay... (todo)`,
    );
    let maybe_splitter = await find_splitter(source);
    console.log(`[${vm.raw.identify()}] ${config.name} -> ${maybe_splitter?.raw.kwl}`);
    if (!maybe_splitter) {
      maybe_splitter = await vm.splitter!.instances.create_row({
        name: `${shorten_label(config.name)}.SPL`,
      });
      await maybe_splitter.v_src.command.write(source);
    }
    console.log(
      `[${vm.raw.identify()}] ${config.name}: Splitter in use: ${maybe_splitter?.raw.kwl}`,
    );
    await set_vsrc(
      target.command,
      maybe_splitter.outputs.row(config.splitter_phase % 4).output,
    );
    return;
  }

  if (config.lut_name !== null) {
    console.log(`[${vm.raw.identify()}] ${config.name}: Adding CC3D...`);
    const cc3d = await vm.color_correction?.cc3d.create_row({
      name: `${shorten_label(config.name)}.CC3D`,
    });
    await cc3d?.reserve_uhd_resources.command.write(
      config.video_format == "12G" || config.video_format == "6G",
    );
    const fallback_lut = "3-NBCU_HLG2SDR_DL_v1";
    try {
      const has_lut = await fetch(`$http://{vm.raw.ip}/cube`)
        .then((r) => r.json())
        .then((j: any[]) => j.some((l) => l.name === config.lut_name))
        .catch((_) => false);
      await cc3d?.lut_name.command.write(
        has_lut ? config.lut_name : fallback_lut,
      );
    } catch (e) {
      await cc3d?.lut_name.command.write(fallback_lut);
    }
    await set_vsrc(target?.command, enforce_nonnull(cc3d?.output));
    target = cc3d?.v_src;
  }

  if (config.delay_frames) {
    console.log(`[${vm.raw.identify()}] ${config.name}: Adding Delay...`);
    const delay = await vm.re_play?.video.delays.create_row({
      name: `${shorten_label(config.name)}.DLY`,
    });
    await delay?.capabilities.command.write({
      delay_mode: config.delay_frames < 2 ? "FramePhaser" : "FrameSync_Freeze",
      capacity: {
        variant: "Frames",
        value: { frames: config.delay_frames },
      },
      input_caliber: {
        variant: "Single",
        value: {
          add_blanking: true,
          constraints: {
            variant: "Bandwidth",
            value: {
              max_bandwidth: ["12G", "6G"].includes(config.video_format ?? "")
                ? "b12_0Gb"
                : "b3_0Gb",
            },
          },
        },
      },
    });
    const out = await delay?.outputs.create_row();
    await out?.t_src.command.write(vm.genlock!.instances.row(0).backend.output);
    await out?.delay.offset.command
      .write({
        variant: "Frames",
        value: { frames: config.delay_frames },
      })
      .catch((_e) =>
        console.log(
          `[${vm.raw.identify()}] video delay refuses to accept delay setting of ${config.delay_frames?.toString()} ; contact support via clemens@arkonatech.com`,
        ),
      );
    await set_vsrc(target.command, out!.video);
    target = delay?.inputs.row(0).v_src;
  }

  await set_vsrc(target.command, source);
}
async function setup_processing_chain_audio(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>,
) {
  const find_target = () => {
    switch (config.output_type) {
      case "MADI":
      case "SDI":
        return vm.i_o_module?.output.row(config.output_id).a_src;
      case "IP-AUDIO":
        return vm.r_t_p_transmitter?.audio_transmitters.row(config.output_id)
          .a_src;
      case "IP-VIDEO":
        assert(false);
    }
  };

  const prepare_target = async () => {
    switch (config.output_type) {
      case "MADI":
        await vm.i_o_module?.output
          .row(config.output_id)
          .mode.command.write("MADI");
        break;
      case "SDI":
        await vm.i_o_module?.output
          .row(config.output_id)
          .mode.command.write("SDI");
        await vm.i_o_module?.output
          .row(config.output_id)
          .sdi.embedded_audio.command.write([
            "Embed",
            "Embed",
            "Embed",
            "Embed",
            "Off",
            "Off",
            "Off",
            "Off",
          ]);
        break;
      case "IP-AUDIO":
      case "IP-VIDEO":
    }
  };

  async function set_asrc(
    target_command: any,
    source: VAPI.AT1130.Audio.Essence,
  ) {
    const kwl = target_command.parent.raw.kwl as string;
    console.log(
      `[${vm.raw.identify()}] ${kwl}: setting source to ${source.raw.kwl}`,
    );
    if (kwl.includes("i_o_module") || kwl.includes("transmitter")) {
      return await target_command.write(audio_ref(source));
    } else {
      return await target_command.write(source);
    }
  }
  let target: any = find_target();
  await prepare_target();
  enforce(!!target, "Target is not present");
  const gain = await vm.audio_gain!.instances.create_row();
  await gain.rename(`${shorten_label(config.name)}`).catch();
  await set_asrc(target?.command, gain.output);
  target = gain.a_src;
  if (config.delay_frames) {
    const delay = await vm.re_play?.audio.delays.create_row();
    await gain.rename(`${shorten_label(config.name)}.DLY`).catch();
    await delay?.capabilities.num_channels.command.write(16).catch((_) => { });
    await delay?.capabilities.capacity.command
      .write({
        variant: "Time",
        value: { time: new Duration(config.delay_frames * 40, "ms") },
      })
      .catch((_) => { });
    await delay?.num_outputs.write(1);
    await delay?.outputs
      .row(0)
      .time.t_src.command.write(vm.genlock!.instances.row(0).backend.output);

    await set_asrc(target?.command, delay!.outputs.row(0).audio);
    target = delay?.inputs.a_src;
  }
  const shuffler = enforce_nonnull(
    await vm.audio_shuffler?.instances.create_row({
      name: `${shorten_label(config.name)}.SHF`,
    }),
  );
  await shuffler.genlock.command.write(vm.genlock!.instances.row(0));
  await shuffler.cross_fade.write(new Duration(30, "ms"));
  await set_asrc(target?.command, shuffler!.output);

  const find_source = () => {
    switch (config.source_type) {
      case "PLAYER-AUDIO":
        return vm.re_play!.audio.players.row(config.output_id).output.audio;
      case "IP-AUDIO":
        return vm.r_t_p_receiver!.audio_receivers.row(config.output_id)
          .media_specific.output.audio;
      case "MADI":
        return vm.i_o_module?.input.row(config.output_id).madi.output;
      case "SDI":
        return vm.i_o_module?.input.row(config.output_id).sdi.output.audio;
      case "SDI2SI":
      case "IP-VIDEO":
      case "PLAYER-VIDEO":
        assert(
          false,
          "Audio Only Output shouldn't be a target for video processing",
        );
    }
  };
  let source = enforce_nonnull(find_source()); // type this out...
  const shuffler_src = await shuffler.a_src.status.read();
  shuffler_src.fill(null);
  for (const idx of range(0, 80)) {
    shuffler_src[idx] = source.channels.reference_to_index(idx);
  }
  await shuffler.a_src.command.write(shuffler_src);
}
async function setup_processing_chain(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>,
) {
  console.log(
    `[${vm.raw.identify()}] Setting up processing chain (${config.flow_type}) "${config.name}" from ${config.source_type}/${config.source_id} to ${config.output_type}/${config.output_id}`,
  );
  if (
    config.source_type == "IP-VIDEO" ||
    config.source_type == "PLAYER-VIDEO" ||
    config.flow_type === "Video"
  ) {
    await setup_processing_chain_video(vm, config).catch((e) => {
      console.log(e);
    });
  }
  if (
    config.source_type == "IP-AUDIO" ||
    config.source_type == "PLAYER-AUDIO" ||
    config.flow_type === "Audio"
  ) {
    await setup_processing_chain_audio(vm, config).catch((e) => {
      console.log(e);
    });
  }
}
export async function setup_processing_chains(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>[],
) {
  console.log(`Preparing ${config.length} Processors`);
  const rtp_audio_ins = config
    .filter((c) => c.source_type === "IP-AUDIO")
    .filter(unique_by("source_id"));
  const rtp_video_ins = config
    .filter((c) => c.source_type === "IP-VIDEO")
    .filter(unique_by("source_id"));
  const sdi_ins = config
    .filter((c) => c.source_type === "SDI")
    .filter(unique_by("source_id"));
  const madi_ins = config
    .filter((c) => c.source_type === "MADI")
    .filter(unique_by("source_id"));
  const video_players = config
    .filter((c) => c.source_type === "PLAYER-VIDEO")
    .filter(unique_by("source_id"));
  const audio_players = config
    .filter((c) => c.source_type === "PLAYER-AUDIO")
    .filter(unique_by("source_id"));
  const rtp_video_outs = config
    .filter((c) => c.output_type === "IP-VIDEO")
    .filter(unique_by("output_id"));
  const rtp_audio_outs = config
    .filter((c) => c.output_type === "IP-AUDIO")
    .filter(unique_by("output_id"));

  // set up necessary scaffolding for routing only; no  addresses/interfaces etc are set up!
  await prepare_audio_rx(rtp_audio_ins, vm);
  await prepare_video_rx(rtp_video_ins, vm);
  await prepare_video_players(video_players, vm);
  await prepare_audio_players(audio_players, vm);
  await prepare_sdi_ins(sdi_ins, vm);
  await prepare_madi_ins(madi_ins, vm);
  await prepare_video_tx(rtp_video_outs, vm);
  await prepare_audio_tx(rtp_audio_outs, vm);

  for (const conf of config) {
    await setup_processing_chain(vm, conf);
  }
  await setup_follower_relations(vm);
}

async function setup_follower_relations(vm: VAPI.AT1130.Root) {
  const players_audio = (await vm.re_play?.audio.players.rows()) ?? [];
  const players_video = (await vm.re_play?.video.players.rows()) ?? [];

  for (const player of players_audio) {
    const name = await player.row_name();
    const maybe_leader =
      (await asyncFind(players_video, async (pv) => {
        const name_leader = await pv.row_name();
        return name === name_leader;
      })) ?? null;
    if (maybe_leader) {
      await player.gang.video.leader.command.write(maybe_leader);
    }
  }
}
