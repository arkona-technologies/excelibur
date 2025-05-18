import z from "zod";
import * as VAPI from "vapi";

export const StreamType = z.enum([
  "2110-20",
  "2110-30",
  "2110-40",
  "2042-20",
  "2022-6",
  "2110-22",
]);
export const SwitchType = z
  .enum(["Patch", "MakeBeforeBreak", "BreakBeforeMake"])
  .default("Patch");

export const SenderConfig = z.object({
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

export const ReceiverConfig = z.object({
  id: z.coerce.number(),
  label: z.string(),
  stream_type: StreamType, // eh... but oh well
  sync: z.coerce.boolean().default(true),
  uhd: z
    .string()
    .refine((v) => v.toLowerCase() === "true" || v.toLowerCase() === "false")
    .transform((v) => v.toLowerCase() === "true"),
  channel_capacity: z.coerce.number().optional().default(16),
  switch_type: SwitchType,
});

export const SourceType = z.enum([
  "IP-VIDEO",
  "IP-AUDIO",
  "PLAYER-VIDEO",
  "PLAYER-AUDIO",
  "SDI",
  "SDI2SI",
  "MADI",
]);

export const OutputType = z.enum(["IP-VIDEO", "IP-AUDIO", "SDI", "MADI"]);

export const VideoFormat = z.enum(["12G", "6G", "3G", "1.5G"]);
export const AudioFormat = z.enum(["p0_125", ...VAPI.Audio.Enums.PacketTime]);

export const ProcessorType = z.enum([
  "CC1D",
  "CC3D",
  "VideoDelay",
  "AudioDelay",
]);

export const ProcessingChainConfig = z.object({
  name: z.string(),
  flow_type: z.enum(["Video", "Audio"]).optional().default("Video"),
  source_type: SourceType,
  video_format: VideoFormat.nullable().default(null),
  source_id: z.coerce.number().int("source_id needs to be an integer!"),
  lut_name: z.string().nullable().default(null),
  delay_frames: z.coerce.number().int().nullable().default(null),
  splitter_phase: z.coerce.number().int().nullable(),
  output_type: OutputType,
  output_id: z.coerce.number().int("output_id needs to be an integer!"),
});
