import * as VAPI from "vapi";
import { z } from "zod";
import { ReceiverConfig } from "./zod_types.js";
import { Duration, enforce, enforce_nonnull, Timestamp } from "vscript";
import { find_best_vifc } from "./utils.js";
import { lock_to_genlock } from "vutil/rtp_receiver.js";

export async function apply_receivers_config(
  vm: VAPI.AT1130.Root,
  config: z.infer<typeof ReceiverConfig>[],
) {
  for (const conf of config) {
    console.log(`[${vm.raw.identify()}] Applying sender-config @${conf.stream_type}/${conf.id} with label ${conf.label}`);
    const get_receiver = () => {
      switch (conf.stream_type) {
        case "2110-20":
        case "2110-40":
        case "2042-20":
        case "2022-6":
        case "2110-22":
          return vm.r_t_p_receiver?.video_receivers.create_row({
            index: conf.id,
            allow_reuse_row: true,
          });
        case "2110-30":
          return vm.r_t_p_receiver?.audio_receivers.create_row({
            index: conf.id,
            allow_reuse_row: true,
          });
      }
    };
    const rx = enforce_nonnull(await get_receiver());
    await rx.rename(conf.label);
    await rx.generic.initiate_readout_on.command.write("FirstStreamPresent");
    let session = await rx.generic.hosting_session.status.read();
    if (!session) {
      session = await vm.r_t_p_receiver!.sessions.create_row({
        name: `${conf.label}`,
      });
      await session?.interfaces.command.write({
        primary: await find_best_vifc(vm.network_interfaces.ports.row(0)),
        secondary: await find_best_vifc(vm.network_interfaces.ports.row(1)),
      });
      await rx.generic.hosting_session.command.write(session);
    }
    enforce(!!session);
    await session.active.command.write(false);
    if (conf.switch_type == "Patch") {
      await session.switch_type.command.write({
        variant: conf.switch_type,
        value: {},
      });
    } else {
      await session.switch_type.command.write({
        variant: conf.switch_type,
        value: { switch_time: new Timestamp(1) },
      });
    }

    await rx.generic.timing.safety_margin.command.write(
      new Duration(500, "us"),
    );
    if (rx instanceof VAPI.AT1130.RTPReceiver.VideoReceiverAsNamedTableRow) {
      type rx_caps = VAPI.AT1130.RTPReceiver.VideoCapabilities;
      if (conf.uhd) {
        await rx.media_specific.capabilities.command.write({
          supports_2022_6: true,
          read_speed: lock_to_genlock(rx),
          st2110_20_caliber: "ST2110_singlelink_uhd",
          supports_2110_40: true,
          supports_clean_switching: true,
          supports_uhd_sample_interleaved: true,
          jpeg_xs_caliber:
            conf.stream_type === "2110-22" ? "JPEG_XS_singlelink_uhd" : null,
          st2042_2_caliber:
            conf.stream_type === "2042-20" ? "ST2042_2_singlelink_uhd" : null,
        });
      } else {
        await rx.media_specific.capabilities.command.write({
          supports_2022_6: true,
          read_speed: lock_to_genlock(rx),
          st2110_20_caliber: "ST2110_upto_3G",
          supports_2110_40: true,
          supports_clean_switching: true,
          supports_uhd_sample_interleaved: true,
          jpeg_xs_caliber:
            conf.stream_type == "2110-22" ? "JPEG_XS_upto_3G" : null,
          st2042_2_caliber:
            conf.stream_type == "2042-20" ? "ST2042_2_upto_3G" : null,
        });
      }

      await session.active.command.write(false);
      if (conf.sync) {
        await rx.generic.timing.target.command.write({
          variant: "TimeSource",
          value: { t_src: vm.p_t_p_clock.output, use_rtp_timestamp: false },
        });
      } else {
        await rx.generic.timing.target.command.write({
          variant: "IngressPlusX",
          value: { read_delay: new Duration(4, "ms") },
        });
      }
    }
    if (rx instanceof VAPI.AT1130.RTPReceiver.AudioReceiverAsNamedTableRow) {
      await rx.media_specific.capabilities.command.write({
        payload_limit: "AtMost1984Bytes",
        read_speed: lock_to_genlock(rx),
        channel_capacity: conf.channel_capacity,
        supports_clean_switching: true,
      });
      await rx.generic.timing.target.command.write({
        variant: "IngressPlusX",
        value: { read_delay: new Duration(2, "ms") },
      });
    }
    await session.active.command.write(true);
  }
}
