import fastifyStatic from "@fastify/static";
import FastifyMultipart from "@fastify/multipart";
import FormBody from "@fastify/formbody";
import * as VAPI from "vapi";
import Fastify from "fastify";
import path from "path";
import { open_connection } from "./connection.js";
import { parse_csv } from "./csv.js";
import {
  ProcessingChainConfig,
  ReceiverConfig,
  SenderConfig,
} from "./zod_types.js";
import { apply_senders_config } from "./senders.js";
import { setup_processing_chains } from "./processors.js";
import { apply_receivers_config } from "./receivers.js";
import { base } from "./base.js";
import { enforce_nonnull } from "vscript";
import cors from "@fastify/cors";
function stream_to_string(stream: any): Promise<string> {
  const chunks: any[] = [];
  return new Promise((resolve, reject) => {
    stream.on("data", (chunk: any) => chunks.push(Buffer.from(chunk)));
    stream.on("error", (err: any) => reject(err));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

const fastify = Fastify({
  //logger: true,
  bodyLimit: 1e6 /* ? */,
  caseSensitive: false,
});

fastify.addContentTypeParser(
  "application/json",
  { parseAs: "string" },
  function(_req: any, body: any, done: any) {
    try {
      var json: any = JSON.parse(body);
      done(null, json);
    } catch (err: any) {
      err.statusCode = 400;
      done(err, undefined);
    }
  },
);

fastify.addContentTypeParser("text/csv", function(_req, payload, done) {
  let body = "";
  payload.on("data", function(data) {
    body += data;
  });
  payload.on("end", function() {
    try {
      done(null, body);
    } catch (e) {
      done(e as any);
    }
  });
  payload.on("error", done);
});
const vm = (await open_connection(
  new URL(process.env["URL"] ?? "ws://127.0.0.1"),
)) as VAPI.AT1130.Root;
fastify.register(fastifyStatic, {
  root: path.resolve("./web"),
});
fastify.register(FastifyMultipart);
fastify.register(FormBody);
fastify.register(cors, { origin: "*" });

fastify.post("/sender-config", async (req, _res) => {
  const maybe_csv = await stream_to_string(
    enforce_nonnull(await req.file()).file,
  );
  const tx_config = parse_csv(maybe_csv, SenderConfig);
  apply_senders_config(vm, tx_config);
  return `Done`;
});
fastify.post("/receiver-config", async (req, _res) => {
  const maybe_csv = await stream_to_string(
    enforce_nonnull(await req.file()).file,
  );
  const rx_config = parse_csv(maybe_csv, ReceiverConfig);
  await apply_receivers_config(vm, rx_config);
  return `Done`;
});
fastify.post("/base-setup", {}, async (_req: any, _res) => {
  await base(vm);
  const traits = await vm.p_t_p_clock.output.ptp_traits.read();
  const domain = await traits?.domain.read();
  return domain ?? "N/A";
});

fastify.post("/processor-config", async (req, _res) => {
  const maybe_csv = await stream_to_string(
    enforce_nonnull(await req.file()).file,
  );
  const processors_config = parse_csv(maybe_csv, ProcessingChainConfig);
  await setup_processing_chains(vm, processors_config);
  return `Done`;
});
fastify.listen(
  { port: parseInt(process.env["PORT"] ?? "4242"), host: "0.0.0.0" },
  (err, addr) => {
    if (err) {
      console.log(err);
    }
    console.log(`Listening on ${addr}`);
    console.log(fastify.printRoutes());
  },
);
