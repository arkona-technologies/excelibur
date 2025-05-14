import { z } from "zod";
import { parse_csv } from "./csv.js";
import * as VAPI from "vapi";

import fs from "fs";
import { dKeyword, Duration, enforce, enforce_nonnull, VSocket } from "vscript";
import { open_connection } from "./connection.js";
import { base } from "./base.js";
import { lock_to_genlock } from "vutil/rtp_receiver.js";
import assert from "assert";
import { video_ref } from "vutil";
import { isIPv4 } from "net";

async function prepare_madi_ins(
  madi_ins: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of madi_ins) {
    await vm.i_o_module?.input.row(conf.source_id).mode.command.write("MADI");
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
    await player?.capabilities.capacity.command.write({
      variant: "Time",
      value: { time: new Duration(5, "s") },
    });
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
    await tx.constraints.max_bandwidth.command.write(
      conf.video_format == "12G" || conf.video_format == "6G"
        ? "b12_0Gb"
        : "b3_0Gb",
    );
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
    await rx.media_specific.capabilities.command.write({
      read_speed: lock_to_genlock(rx),
      supports_clean_switching: true,
      jpeg_xs_caliber: null,
      st2042_2_caliber: null,
      supports_2022_6: true,
      st2110_20_caliber: "ST2110_upto_3G",
      supports_2110_40: true,
      supports_uhd_sample_interleaved: false,
    });
    await rx.generic.initiate_readout_on.command.write("FirstStreamPresent");
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
    await rx.media_specific.capabilities.command.write({
      read_speed: lock_to_genlock(rx),
      channel_capacity: 16,
      payload_limit: "AtMost1984Bytes",
      supports_clean_switching: true,
    });
    await rx.generic.initiate_readout_on.command.write("FirstStreamPresent");
  }
}

function shorten_label(label: string): string {
  const new_label = label
    .toLowerCase()
    .trim()
    .split(/[^a-zA-Z0-9]/g)
    .map((word) => word.replace(/[aeiou]/g, "")) // remove vowels
    .map((word) => word);
  return new_label.join("").substring(0, 28);
}

const StreamType = z.enum([
  "2110-20",
  "2110-30",
  "2110-40",
  "2042-20",
  "2022-6",
  "2110-22",
]);
const SwitchType = z
  .enum(["Patch", "MakeBeforeBreak", "BreakBeforeMake"])
  .default("Patch");

const SenderConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  name: z.string(),
  stream_type: StreamType,
  primary_destination_address: z.string().ip(),
  secondary_destination_address: z.string().ip().nullable(),
  primary_destination_port: z.coerce.number().int(),
  secondary_destination_port: z.coerce.number().int().nullable(),
  payload_type: z.coerce.number().int(),
});

const ReceiverConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  name: z.string(),
  stream_type: StreamType, // eh... but oh well
  sync: z.coerce.boolean().default(true),
  switch_type: SwitchType,
});

const SourceType = z.enum([
  "IP-VIDEO",
  "IP-AUDIO",
  "PLAYER-VIDEO",
  "PLAYER-AUDIO",
  "SDI",
  "SDI2SI",
  "MADI",
]);

const OutputType = z.enum(["IP-VIDEO", "IP-AUDIO", "SDI", "MADI"]);

const VideoFormat = z.enum(["12G", "6G", "3G", "1.5G"]);
const AudioFormat = z.enum(["p0_125", ...VAPI.Audio.Enums.PacketTime]);

const ProcessorType = z.enum(["CC1D", "CC3D", "VideoDelay", "AudioDelay"]);

const ProcessingChainConfig = z.object({
  name: z.string(),
  id: z.coerce.number(),
  flow_type: z.enum(["Video", "Audio"]).optional().default("Video"),
  source_type: SourceType,
  video_format: VideoFormat.nullable().default(null),
  source_id: z.coerce.number().int("source_id needs to be an integer!"),
  lut_name: z.string().nullable().default(null),
  delay_frames: z.coerce.number().int().nullable().default(null),
  output_type: OutputType,
  output_id: z.coerce.number().int("output_id needs to be an integer!"),
});

const unique_by = (prop: any) => (data: any, index: any, arr: any) =>
  index === arr.findIndex((t: any) => t[prop] === data[prop]);
const unique_by_n = (props: any[]) => (data: any, index: any, arr: any) =>
  index ===
  arr.findIndex((t: any) => {
    let maybe_true = true;
    for (const prop of props) {
      maybe_true = maybe_true && t[prop] === data[prop];
    }
    return maybe_true;
  });

async function set_vsrc(
  target_command: any,
  source: VAPI.AT1130.Video.Essence,
) {
  const kwl = target_command.parent.raw.kwl as string;
  console.log(
    `[${vm.raw.identify()}] ${kwl}: setting source to ${source.raw.kwl}`,
  );
  if (kwl.includes("sdi") || kwl.includes("transmitter")) {
    // i mean why not
    return await target_command.write(video_ref(source));
  } else {
    return await target_command.write(source);
  }
}

async function setup_processing_chain_video(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>,
) {
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

  if (config.lut_name) {
    console.log(`[${vm.raw.identify()}] ${config.name}: Adding CC3D...`);
    const cc3d = await vm.color_correction?.cc3d.create_row({
      name: `${shorten_label(config.name)}.CC3D`,
    });
    await cc3d?.reserve_uhd_resources.command.write(
      config.video_format == "12G" || config.video_format == "6G",
    );
    try {
      await cc3d?.lut_name.command.write(config.lut_name);
    } catch (e) {
      await cc3d?.lut_name.command.write("3-NBCU_HLG2SDR_DL_v1");
    }
    await target?.command.write(video_ref(cc3d?.output ?? null));
    await set_vsrc(target?.command, enforce_nonnull(cc3d?.output));

    target = cc3d?.v_src;
  }

  if (config.delay_frames) {
    console.log(`[${vm.raw.identify()}] ${config.name}: Adding Delay...`);
    const delay = await vm.re_play?.video.delays.create_row({
      name: `${shorten_label(config.name)}.DLY`,
    });
    await delay?.capabilities.command.write({
      delay_mode: "FramePhaser",
      capacity: { variant: "Frames", value: { frames: config.delay_frames } },
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
    await out?.delay.offset.command.write({
      variant: "Frames",
      value: { frames: config.delay_frames },
    }).catch();
    await set_vsrc(target.command, out!.video);
    target = delay?.inputs.row(0).v_src;
  }

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
  let target: any = find_target();
}
async function setup_processing_chain(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>,
) {
  if (config.flow_type === "Video") {
    await setup_processing_chain_video(vm, config);
  }
  if (config.flow_type === "Audio") {
    await setup_processing_chain_audio(vm, config);
  }
}
async function setup_processing_chains(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ProcessingChainConfig>[],
) {
  const rtp_audio_ins = config
    .filter((c) => c.source_type === "IP-AUDIO")
    .filter(unique_by("source_type"));
  const rtp_video_ins = config
    .filter((c) => c.source_type === "IP-VIDEO")
    .filter(unique_by("source_type"));
  const sdi_ins = config
    .filter((c) => c.source_type === "SDI")
    .filter(unique_by("source_type"));
  const madi_ins = config
    .filter((c) => c.source_type === "MADI")
    .filter(unique_by("source_type"));
  const video_players = config
    .filter((c) => c.source_type === "PLAYER-VIDEO")
    .filter(unique_by("source_type"));
  const audio_players = config
    .filter((c) => c.source_type === "PLAYER-AUDIO")
    .filter(unique_by("source_type"));
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

  const filtered_by_outputs = config.filter(
    unique_by_n(["output_id", "output_type", "name"]),
  );

  for (const conf of filtered_by_outputs) {
    await setup_processing_chain(vm, conf);
  }
}

async function find_best_vifc(port: VAPI.AT1130.NetworkInterfaces.Port) {
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

async function apply_senders_config(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof SenderConfig>[],
) {
  for (const conf of config) {
    const get_transmitter = () => {
      switch (conf.stream_type) {
        case "2110-20":
        case "2110-40":
        case "2042-20":
        case "2022-6":
        case "2110-22":
          return vm.r_t_p_transmitter?.video_transmitters.create_row({
            index: conf.id,
            name: conf.label,
            allow_reuse_row: true,
          });
        case "2110-30":
          return vm.r_t_p_transmitter?.audio_transmitters.create_row({
            index: conf.id,
            name: conf.label,
            allow_reuse_row: true,
          });
      }
    };
    const tx = enforce_nonnull(await get_transmitter());
    let session = await tx.generic.hosting_session.status.read();
    if (!(await tx.generic.hosting_session.status.read())) {
      session = await vm.r_t_p_transmitter!.sessions.create_row({
        name: `${conf.label}`,
      });
      await session?.interfaces.command.write({
        primary: await find_best_vifc(vm.network_interfaces.ports.row(0)),
        secondary: conf.secondary_destination_address
          ? await find_best_vifc(vm.network_interfaces.ports.row(1))
          : null,
      });
      await tx.generic.hosting_session.command.write(session);
    }
    enforce(!!session);
    await session.active.command.write(false);
    const get_ip_config = () => {
      switch (conf.stream_type) {
        case "2022-6":
        case "2110-20":
        case "2042-20":
        case "2110-22":
          return (tx as VAPI.AT1130.RTPTransmitter.VideoStreamerAsNamedTableRow)
            .generic.ip_configuration.video;
        case "2110-40":
          return (tx as VAPI.AT1130.RTPTransmitter.VideoStreamerAsNamedTableRow)
            .generic.ip_configuration.meta;
        case "2110-30":
          return (tx as VAPI.AT1130.RTPTransmitter.AudioStreamerAsNamedTableRow)
            .generic.ip_configuration.media;
      }
    };
    const ip_config = get_ip_config();
    await ip_config.primary.dst_address.command.write(
      `${conf.primary_destination_address}:${conf.primary_destination_port}`,
    );
    await ip_config.primary.header_settings.command.write({
      ...(await ip_config.primary.header_settings.status.read()),
      payload_type: conf.payload_type,
    });
    if (conf.secondary_destination_address) {
      await ip_config.secondary.dst_address.command.write(
        `${conf.secondary_destination_address}:${conf.secondary_destination_port ?? 9000}`,
      );
      await ip_config.secondary.header_settings.command.write({
        ...(await ip_config.secondary.header_settings.status.read()),
        payload_type: conf.payload_type,
      });
    }

    function get_transport_format(): VAPI.AT1130.RTPTransmitter.VideoFormat {
      switch (conf.stream_type) {
        case "2022-6":
          return { variant: "ST2022_6", value: {} };
        case "2110-20":
          return {
            variant: "ST2110_20",
            value: {
              transmit_scheduler_uhd: true,
              add_st2110_40: false,
              packing_mode: "GPM",
            },
          };
        case "2042-20":
          return {
            variant: "ST2042",
            value: { add_st2110_40: false, compression: "C_4_44" },
          };
        case "2110-22":
          return {
            variant: "JPEG_XS",
            value: {
              add_st2110_40: false,
              omit_mandatory_pre_header: false,
              lvl_weight_mode: "visual_optimization",
              compression: { variant: "Ratio", value: { ratio: 10 } },
            },
          };
        case "2110-40":
        case "2110-30":
          assert(false);
      }
    }

    if (tx instanceof VAPI.AT1130.RTPTransmitter.VideoStreamerAsNamedTableRow) {
      if (conf.stream_type != "2110-30" && conf.stream_type != "2110-40")
        await tx.configuration.transport_format.command.write(
          get_transport_format(),
        );
      if (conf.stream_type === "2110-40") {
        await tx.configuration.transport_format.command.write({
          ...(await tx.configuration.transport_format.status.read()),
          value: { add_st2110_40: true },
        } as any);
      }
    }

    session.active.command.write(true).catch();
  }
}

const processors = fs.readFileSync(
  enforce_nonnull(process.env["PROC"]),
  "utf8",
);
const tx = fs.readFileSync(enforce_nonnull(process.env["TX"]), "utf8");
// const rx = fs.readFileSync(enforce_nonnull(process.env["RX"]), "utf8");
const processors_config = parse_csv(processors, ProcessingChainConfig);
const tx_config = parse_csv(tx, SenderConfig);
// const rx_config = parse_csv(rx, ReceiverConfig);
const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;

await base(vm);
await apply_senders_config(vm, tx_config);
await setup_processing_chains(vm, processors_config);

process.exit(0);
