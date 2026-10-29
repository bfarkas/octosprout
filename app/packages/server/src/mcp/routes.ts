/** Stateless Streamable HTTP endpoint for remote MCP clients. */
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServerForBackend, type McpBackend } from "@octosprout/cli/mcp";
import type { FastifyInstance, FastifyRequest } from "fastify";

export interface McpRouteOptions {
  origin: string;
  authenticateBearer(request: FastifyRequest): Promise<{ actor: string } | undefined> | { actor: string } | undefined;
  backend: McpBackend;
}

export function registerMcpRoutes(app: FastifyInstance, options: McpRouteOptions): void {
  app.route({
    method: ["GET", "POST", "DELETE"],
    url: "/mcp",
    handler: async (request, reply) => {
      const auth = await options.authenticateBearer(request);
      if (!auth) {
        return reply
          .code(401)
          .header("WWW-Authenticate", `Bearer resource_metadata="${options.origin}/.well-known/oauth-protected-resource", scope="workspace"`)
          .send({ error: "unauthorized" });
      }
      // Omitting the generator is the SDK's stateless mode.
      const transport = new StreamableHTTPServerTransport();
      const server = createMcpServerForBackend(() => options.backend, { actor: auth.actor, sync: false });
      // The CLI's public MCP factory and the server resolve the same SDK at runtime.
      await server.connect(transport as never);
      reply.hijack();
      await transport.handleRequest(request.raw, reply.raw, request.body);
    },
  });
}
