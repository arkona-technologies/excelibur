import * as VAPI from "vapi";

export async function detect_card_release(
  vm: VAPI.AT1130.Root,
): Promise<string | null> {
  const booted = await vm.system.partitions.booted.read();
  if (!booted) {
    return null;
  }
  if (typeof booted === "string") {
    return booted;
  }
  return await booted.version.read();
}

export async function ensure_supported_release(
  vm: VAPI.AT1130.Root,
  supported_prefix = "2.9.",
) {
  const release = await detect_card_release(vm);
  if (!release) {
    throw new Error("Could not determine card software release");
  }
  if (!release.startsWith(supported_prefix)) {
    throw new Error(
      `Unsupported card software release '${release}'. This Excelibur branch only supports ${supported_prefix}x.`,
    );
  }
  return release;
}
