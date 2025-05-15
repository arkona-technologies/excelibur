import fastifyStatic from "@fastify/static";
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
import { scrub } from "vutil";
import { base } from "./base.js";

const fastify = Fastify({
  //logger: true,
  bodyLimit: 1e6 /* ? */,
  caseSensitive: false,
});
fastify.addContentTypeParser("text/csv", function (_req, payload, done) {
  let body = "";
  payload.on("data", function (data) {
    body += data;
  });
  payload.on("end", function () {
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

fastify.post("/sender-config", async (req, _res) => {
  const tx_config = parse_csv(req.body as string, SenderConfig);
  apply_senders_config(vm, tx_config);
  return 200;
});
fastify.post("/receiver-config", async (req, _res) => {
  const rx_config = parse_csv(req.body as string, ReceiverConfig);
  await apply_receivers_config(vm, rx_config);
  return 200;
});
fastify.post("/processor-config", async (req, _res) => {
  const processors_config = parse_csv(
    req.body as string,
    ProcessingChainConfig,
  );
  await base(vm);
  await setup_processing_chains(vm, processors_config);
  return 200;
});
fastify.listen({ port: 4242, host: "0.0.0.0" }, (err, addr) => {
  if (err) {
    console.log(err);
  }
  console.log(`Listening on ${addr}`);
  console.log(fastify.printRoutes());
});
