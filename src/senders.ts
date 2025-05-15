import * as VAPI from "vapi";
import { enforce, enforce_nonnull } from "vscript";
import { z } from "zod";
import { find_best_vifc } from "./utils.js";
import { SenderConfig } from "./zod_types.js";
import assert from "assert";

export async function apply_senders_config(
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
            allow_reuse_row: true,
          });
        case "2110-30":
          return vm.r_t_p_transmitter?.audio_transmitters.create_row({
            index: conf.id,
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
    await tx.rename(conf.label);
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
