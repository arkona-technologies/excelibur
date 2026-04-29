import * as VAPI from "vapi";
import { open_connection } from "../connection.js";
import { ensure_supported_release } from "../core/card.js";
import { prefetch_sdk_from_card } from "../core/sdk.js";

async function main() {
  const url = process.env["URL"];
  if (!url) {
    throw new Error("Need to specify URL, for example URL=ws://172.16.220.211");
  }

  const vm = (await open_connection(new URL(url))) as VAPI.AT1130.Root;
  const release = await ensure_supported_release(vm);
  const cached = await prefetch_sdk_from_card({ url, release });
  console.log(`Release: ${release}`);
  console.log(`Cached SDK tarballs in ${cached.cache_dir}`);
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
