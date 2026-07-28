import { createWorkerHandler } from "./http/handler";

const fetch = createWorkerHandler();

export default {
  fetch,
} satisfies ExportedHandler;
