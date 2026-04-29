import * as VAPI from "vapi";

type OpenConnectionOptions = {
  max_attempts?: number;
  initial_retry_delay_ms?: number;
  on_retry?: (attempt: number, delay_ms: number, error: unknown) => void;
};

function is_retryable_connection_error(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("status code: 503") ||
    message.includes("ECONNRESET") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ETIMEDOUT")
  );
}

function sleep(delay_ms: number) {
  return new Promise((resolve) => setTimeout(resolve, delay_ms));
}

export async function open_connection(
  url?: URL,
  options: OpenConnectionOptions = {},
) {
  url ??= new URL("ws://127.0.0.1");
  const max_attempts = options.max_attempts ?? 5;
  const initial_retry_delay_ms = options.initial_retry_delay_ms ?? 500;

  let last_error: unknown = null;
  for (let attempt = 1; attempt <= max_attempts; attempt += 1) {
    try {
      const vm = await VAPI.VM.open({
        ip: url.host,
        towel: "",
        login: url.username
          ? { user: url.username, password: url.password }
          : null,
        reject_unauthorized: false,
      });
      return vm;
    } catch (error) {
      last_error = error;
      if (attempt >= max_attempts || !is_retryable_connection_error(error)) {
        break;
      }
      const delay_ms = initial_retry_delay_ms * 2 ** (attempt - 1);
      options.on_retry?.(attempt, delay_ms, error);
      await sleep(delay_ms);
    }
  }

  const message =
    last_error instanceof Error ? last_error.message : String(last_error);
  throw new Error(
    `Could not connect to ${url.host} after ${max_attempts} attempt(s): ${message}`,
  );
}

export async function close_connection(vm: unknown) {
  const maybe_close = (vm as { close?: () => Promise<unknown> } | null)?.close;
  if (typeof maybe_close === "function") {
    await maybe_close.call(vm);
  }
}
