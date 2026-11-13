import z from "zod";
import * as VAPI from "vapi";
import { random_int, random_string } from "vutil/random.js";
import { range } from "vutil";

export const StreamType = z.enum([
  "2110-20",
  "2110-30",
  "2110-40",
  "2042-20",
  "2022-6",
  "2110-22",
]);
const blank_as_undefined = (value: unknown) => value == null || value === "" ? undefined : value;

export const SwitchType = z.preprocess(blank_as_undefined,
  z.enum(["Patch", "MakeBeforeBreak", "BreakBeforeMake"]).default("Patch"));

const BooleanText = z.preprocess((value) => {
  if (value == null || value === "") return undefined;
  if (typeof value === "string") {
    if (value.trim().toLowerCase() === "true") return true;
    if (value.trim().toLowerCase() === "false") return false;
  }
  return value;
}, z.boolean().default(true));

export const ChannelCount = z
  .string()
  .nullish()
  .transform((maybe_str) => {
    if (!!!maybe_str) return 16;
    const mabye_number = parseInt(maybe_str);
    if (isNaN(mabye_number)) return 16;
    return mabye_number;
  });


export const VLAN_ID = z
  .string()
  .nullish()
  .transform((id) => {
    if (!id || !!!id) return null;
    const maybe_num = parseInt(id);
    return isNaN(maybe_num) ? null : maybe_num;
  });

export const OutputType = z.enum(["IP-VIDEO", "IP-AUDIO", "SDI", "MADI"]);

export const VideoFormat = z.enum(["12G", "6G", "3G", "1.5G"]);
export const FrameSyncMode = z.enum([
  "FramePhaser",
  "FrameSync_Freeze",
  "FrameSync_Black",
]);
export const AudioFormat = z.enum(["p0_125", ...VAPI.Audio.Enums.PacketTime]);
export const BitFormat = z.enum(["L24", ...VAPI.Audio.Enums.Format]);
export const SenderConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  stream_type: StreamType,
  primary_destination_address: z.string().ip().nullable(),
  secondary_destination_address: z.string().ip().nullable(),
  primary_destination_port: z.coerce.number().int().nullable(),
  secondary_destination_port: z.coerce.number().int().nullable(),
  payload_type: z.coerce.number().int(),
  vlan_id: VLAN_ID,
  channel_count: ChannelCount,
  p_time: AudioFormat.nullable().default("p0_125"),
  bit_depth: BitFormat.nullable().default("L24"),
});

export const ReceiverConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  stream_type: StreamType, // eh... but oh well
  sync: BooleanText,
  uhd: z
    .string()
    .refine((v) => v.toLowerCase() === "true" || v.toLowerCase() === "false")
    .transform((v) => v.toLowerCase() === "true"),
  channel_capacity: z.preprocess(blank_as_undefined, z.coerce.number().int().positive().default(16)),
  switch_type: SwitchType,
  vlan_id: VLAN_ID,
});

export const SourceType = z.enum([
  "IP-VIDEO",
  "IP-AUDIO",
  "PLAYER-VIDEO",
  "PLAYER-AUDIO",
  "SDI",
  "SDI2SI",
  "MADI",
  "VOID",
]);

export const ProcessorType = z.enum([
  "CC1D",
  "CC3D",
  "VideoDelay",
  "AudioDelay",
]);

const random_name = () => {
  let str = "";
  const length = random_int(4, 8);
  for (let index = 0; index < length; index++) {
    str += String.fromCharCode(random_int(97, 122));
  }
  return str;
};
const optional_positive_number = z.preprocess(
  blank_as_undefined,
  z.coerce.number().positive().nullable().default(null),
);

const optional_positive_integer = z.preprocess(
  blank_as_undefined,
  z.coerce.number().int().positive().nullable().default(null),
);

export const ProcessingChainConfig = z.object({
  name: z
    .string()
    .nullable()
    .transform((maybe_str) => {
      return maybe_str ? maybe_str : "";
    }),
  flow_type: z.preprocess(blank_as_undefined, z.enum(["Video", "Audio"]).default("Video")),
  source_type: SourceType,
  video_format: VideoFormat.nullable().default(null),
  source_id: z.coerce.number().int("source_id needs to be an integer!"),
  lut_name: z.string().nullable().default(null),
  framesync_mode: z.preprocess(
    blank_as_undefined,
    FrameSyncMode.nullable().default(null),
  ),
  delay_audio_ms: optional_positive_number,
  delay_video_frames: optional_positive_integer,
  delay_video_ms: optional_positive_number,
  // Retain removed column names so legacy workbooks fail instead of silently
  // dropping their delay values.
  delay_audio: z.never().optional(),
  delay_frames: z.never().optional(),
  samplerate_converter: z.string().nullish().transform((bool_str) => {
    return bool_str?.toLowerCase().trim() == "true";
  }),
  splitter_phase: z.coerce.number().int().nullable(),
  output_type: OutputType,
  channel_count: ChannelCount,
  output_id: z.coerce.number().int("output_id needs to be an integer!"),
});

export function refine_config(
  configs: z.infer<typeof ProcessingChainConfig>[],
): z.infer<typeof ProcessingChainConfig>[] {
  const sdi_framesync_modes = new Map<number, z.infer<typeof FrameSyncMode>>();
  const errors: string[] = [];
  for (const conf of configs) {
    if (conf.name === "") {
      conf.name = `${conf.output_type}/${conf.output_id}.${conf.flow_type}`;
    }

    const is_video = conf.flow_type === "Video";
    const is_sdi_video = is_video && conf.source_type === "SDI";
    if (is_sdi_video && conf.framesync_mode == null) {
      errors.push(
        `Processing chain "${conf.name}": framesync_mode is required for SDI video sources.`,
      );
    }
    if (!is_sdi_video && conf.framesync_mode != null) {
      errors.push(
        `Processing chain "${conf.name}": framesync_mode must be blank unless this is an SDI video source.`,
      );
    }
    if (is_video && conf.delay_audio_ms != null) {
      errors.push(
        `Processing chain "${conf.name}": delay_audio_ms must be blank for video flows.`,
      );
    }
    if (
      !is_video &&
      (conf.delay_video_frames != null || conf.delay_video_ms != null)
    ) {
      errors.push(
        `Processing chain "${conf.name}": video delay fields must be blank for audio flows.`,
      );
    }
    if (
      conf.delay_video_frames != null &&
      conf.delay_video_ms != null
    ) {
      errors.push(
        `Processing chain "${conf.name}": delay_video_frames and delay_video_ms are mutually exclusive.`,
      );
    }

    if (is_sdi_video && conf.framesync_mode != null) {
      const mode = conf.framesync_mode;
      const existing = sdi_framesync_modes.get(conf.source_id);
      if (existing !== undefined && existing !== mode) {
        errors.push(
          `SDI input ${conf.source_id} has conflicting framesync_mode values: ${existing} and ${mode}.`,
        );
      }
      sdi_framesync_modes.set(conf.source_id, mode);
    }
  }
  if (errors.length) {
    throw new Error(`Invalid configuration:\n${errors.join("\n")}`);
  }
  return configs;
}
