import { createWorkerHandler } from "./http/handler";
import { withResponseCache } from "./http/cache";

const handler = createWorkerHandler();

export default {
  fetch(request, _env, context) {
    return withResponseCache(
      handler,
      caches.default,
      (promise) => context.waitUntil(promise),
    )(request);
  },
} satisfies ExportedHandler;
