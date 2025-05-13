import { z } from "zod";
import { parse_csv } from "./csv.js";
import * as VAPI from "vapi";

import fs from "fs";
import { Duration, enforce_nonnull } from "vscript";
import { open_connection } from "./connection.js";
import { base } from "./base.js";
import { lock_to_genlock } from "vutil/rtp_receiver.js";

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
  secondary_destination_address: z.string().ip(),
  primary_destination_port: z.coerce.number().int(),
  secondary_destination_port: z.coerce.number().int(),
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
  source_type: SourceType,
  video_format: VideoFormat.nullable().default(null),
  source_id: z.coerce.number().int("source_id needs to be an integer!"),
  lut_name: z.string().nullable().default(null),
  delay_ms: z.coerce.number().int().nullable().default(null),
  output_type: OutputType,
  output_id: z.coerce.number().int("output_id needs to be an integer!"),
});

const unique_by = (prop: any) => (data: any, index: any, arr: any) =>
  index === arr.findIndex((t: any) => t[prop] === data[prop]);
const unique_by_2 =
  (prop1: any, prop2: any) => (data: any, index: any, arr: any) =>
    index ===
    arr.findIndex(
      (t: any) => t[prop1] === data[prop1] && t[prop2] === data[prop2],
    );

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

  await prepare_audio_rx(rtp_audio_ins, vm);
  await prepare_video_rx(rtp_video_ins, vm);
  await prepare_video_players(video_players, vm);
  await prepare_audio_players(audio_players, vm);
  await prepare_sdi_ins(sdi_ins, vm);
  await prepare_madi_ins(madi_ins, vm);
  

  const filtered_by_outputs = config.filter(unique_by_2('output_id', 'output_type'));


  console.log(vm.raw.identify());
  console.log("rtp audio", rtp_audio_ins);
  console.log("rtp video", rtp_video_ins);
  console.log("sdi in", sdi_ins);

  console.log("Filtered for outputs", filtered_by_outputs);
}

const file = fs.readFileSync(enforce_nonnull(process.env["CSV"]), "utf8");
const config = parse_csv(file, ProcessingChainConfig);

console.log(config);
const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;

await setup_processing_chains(vm, config);
await base(vm);

process.exit(0);
async function prepare_madi_ins(
  madi_ins: {
    id: number;
    name: string;
    source_type:
      | "IP-VIDEO"
      | "IP-AUDIO"
      | "PLAYER-VIDEO"
      | "PLAYER-AUDIO"
      | "SDI"
      | "SDI2SI"
      | "MADI";
    video_format: "12G" | "6G" | "3G" | "1.5G" | null;
    source_id: number;
    lut_name: string | null;
    delay_ms: number | null;
    output_type: "IP-VIDEO" | "IP-AUDIO" | "SDI" | "MADI";
    output_id: number;
  }[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of madi_ins) {
    await vm.i_o_module?.input.row(conf.source_id).mode.command.write("MADI");
  }
}

async function prepare_sdi_ins(
  sdi_ins: {
    id: number;
    name: string;
    source_type:
      | "IP-VIDEO"
      | "IP-AUDIO"
      | "PLAYER-VIDEO"
      | "PLAYER-AUDIO"
      | "SDI"
      | "SDI2SI"
      | "MADI";
    video_format: "12G" | "6G" | "3G" | "1.5G" | null;
    source_id: number;
    lut_name: string | null;
    delay_ms: number | null;
    output_type: "IP-VIDEO" | "IP-AUDIO" | "SDI" | "MADI";
    output_id: number;
  }[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of sdi_ins) {
    await vm.i_o_module?.input.row(conf.source_id).mode.command.write("SDI");
  }
}

async function prepare_audio_players(
  audio_players: {
    id: number;
    name: string;
    source_type:
      | "IP-VIDEO"
      | "IP-AUDIO"
      | "PLAYER-VIDEO"
      | "PLAYER-AUDIO"
      | "SDI"
      | "SDI2SI"
      | "MADI";
    video_format: "12G" | "6G" | "3G" | "1.5G" | null;
    source_id: number;
    lut_name: string | null;
    delay_ms: number | null;
    output_type: "IP-VIDEO" | "IP-AUDIO" | "SDI" | "MADI";
    output_id: number;
  }[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of audio_players) {
    const player = await vm.re_play?.audio.players.create_row({
      index: conf.source_id,
    });
    await player?.capabilities.capacity.command.write({
      variant: "Time",
      value: { time: new Duration(5, "s") },
    });
  }
}

async function prepare_video_players(
  video_players: {
    id: number;
    name: string;
    source_type:
      | "IP-VIDEO"
      | "IP-AUDIO"
      | "PLAYER-VIDEO"
      | "PLAYER-AUDIO"
      | "SDI"
      | "SDI2SI"
      | "MADI";
    video_format: "12G" | "6G" | "3G" | "1.5G" | null;
    source_id: number;
    lut_name: string | null;
    delay_ms: number | null;
    output_type: "IP-VIDEO" | "IP-AUDIO" | "SDI" | "MADI";
    output_id: number;
  }[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of video_players) {
    const player = await vm.re_play?.video.players.create_row({
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

async function prepare_video_rx(
  rtp_video_ins: z.infer<typeof ProcessingChainConfig>[],
  vm: VAPI.AT1130.Root,
) {
  for (const conf of rtp_video_ins) {
    const rx = await vm.r_t_p_receiver!.video_receivers.create_row({
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
