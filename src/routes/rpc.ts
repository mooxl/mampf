import { createFileRoute } from "@tanstack/react-router";
import { rpcWebHandler } from "../server/rpc";

/** The Effect RPC server, mounted as a Start server route. */
export const Route = createFileRoute("/rpc")({
  server: {
    handlers: {
      POST: ({ request }) => rpcWebHandler(request),
    },
  },
});
