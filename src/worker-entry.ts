import { createStartHandler, defaultStreamHandler } from "@tanstack/react-start/server";

/** Worker entry: SSR, server functions and server routes (`/rpc`) via Start. */
export default {
  fetch: createStartHandler(defaultStreamHandler),
};
