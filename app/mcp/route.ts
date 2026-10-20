import {
  filterCommands,
  getSeedCommand,
  seedCommands,
  type CommandRecord,
} from "@/lib/commands";
import { manifestFromCommand } from "@/lib/command-package";
import { commandCategories } from "@/lib/commands";
import { isMissingStorage } from "@/app/api/v1/_lib/http";
import {
  findPublishedVersion,
  listPublishedCommands,
  seedEngagement,
} from "@/app/api/v1/_lib/repository";

export const dynamic = "force-dynamic";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: unknown;
};

const tools = [
  {
    name: "search_commands",
    description:
      "Search the public COMMANDS catalog by name, summary, creator, tag, or category.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Optional free-text query." },
        category: { type: "string", enum: commandCategories },
        limit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_command_manifest",
    description:
      "Get the machine-readable package manifest for a public command and optional version.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
        version: { type: "string" },
      },
      required: ["slug"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
] as const;

export async function POST(request: Request) {
  let message: JsonRpcRequest;
  try {
    const decoded: unknown = await request.json();
    if (!isRequest(decoded)) return rpcError(null, -32600, "Invalid Request");
    message = decoded;
  } catch {
    return rpcError(null, -32700, "Parse error");
  }

  if (message.method === "notifications/initialized") {
    return new Response(null, { status: 202 });
  }
  if (message.method === "initialize") {
    const requested = getProtocolVersion(message.params);
    return rpcResult(message.id, {
      protocolVersion: requested ?? "2024-11-05",
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "commands-registry", version: "0.1.0" },
      instructions:
        "Search and inspect public Rhino command packages. Tools are read-only and never execute command code.",
    });
  }
  if (message.method === "ping") return rpcResult(message.id, {});
  if (message.method === "tools/list") return rpcResult(message.id, { tools });
  if (message.method === "tools/call") {
    return handleToolCall(message.id, message.params);
  }
  return rpcError(message.id, -32601, "Method not found");
}

async function handleToolCall(id: JsonRpcRequest["id"], params: unknown) {
  if (!isRecord(params) || typeof params.name !== "string") {
    return rpcError(id, -32602, "Invalid tool call parameters");
  }
  const args = isRecord(params.arguments) ? params.arguments : {};

  if (params.name === "search_commands") {
    const query = typeof args.query === "string" ? args.query.slice(0, 160) : undefined;
    const category = typeof args.category === "string" ? args.category : undefined;
    const rawLimit = typeof args.limit === "number" ? args.limit : 10;
    const limit = Math.max(1, Math.min(20, Math.trunc(rawLimit)));

    let stored: CommandRecord[] = [];
    let engagement = new Map<
      string,
      { downloads: number; stars: number; forks: number }
    >();
    try {
      [stored, engagement] = await Promise.all([
        listPublishedCommands(),
        seedEngagement(),
      ]);
    } catch (error) {
      if (!isMissingStorage(error)) throw error;
    }
    const bySlug = new Map(
      seedCommands.map((command) => [
        command.slug,
        engagement.has(command.slug)
          ? { ...command, stats: engagement.get(command.slug) ?? command.stats }
          : command,
      ]),
    );
    for (const command of stored) bySlug.set(command.slug, command);
    const matches = filterCommands([...bySlug.values()], { query, category }).slice(
      0,
      limit,
    );
    const compact = matches.map((command) => ({
      slug: command.slug,
      name: command.name,
      summary: command.summary,
      category: command.category,
      version: command.version,
      status: command.status,
      tags: command.tags,
      permissions: command.permissions,
      author: command.author,
      manifestUrl: `/api/v1/commands/${command.slug}/versions/${command.version}/manifest`,
    }));
    return toolResult(id, { commands: compact, count: compact.length });
  }

  if (params.name === "get_command_manifest") {
    if (
      typeof args.slug !== "string" ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(args.slug)
    ) {
      return toolFailure(id, "A valid kebab-case `slug` is required.");
    }
    const version = typeof args.version === "string" ? args.version : undefined;
    try {
      const stored = await findPublishedVersion(args.slug, version);
      if (stored) {
        return toolResult(id, {
          manifest: JSON.parse(stored.version.manifestJson),
          checksumSha256: stored.version.checksumSha256,
          downloadUrl: `/api/v1/commands/${args.slug}/versions/${stored.version.version}/download`,
        });
      }
    } catch (error) {
      if (!isMissingStorage(error)) {
        if (error instanceof SyntaxError) return toolFailure(id, "Stored manifest is invalid.");
        throw error;
      }
    }

    const seed = getSeedCommand(args.slug);
    if (!seed || (version && version !== seed.version)) {
      return toolFailure(id, "Command version not found.");
    }
    return toolResult(id, {
      manifest: manifestFromCommand(seed),
      checksumSha256: null,
      downloadUrl: `/api/v1/commands/${seed.slug}/versions/${seed.version}/download`,
      warning: "Imported draft; attribution and license are unresolved.",
    });
  }

  return toolFailure(id, `Unknown tool: ${params.name}`);
}

function toolResult(id: JsonRpcRequest["id"], structuredContent: unknown) {
  return rpcResult(id, {
    content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }],
    structuredContent,
    isError: false,
  });
}

function toolFailure(id: JsonRpcRequest["id"], message: string) {
  return rpcResult(id, {
    content: [{ type: "text", text: message }],
    isError: true,
  });
}

function rpcResult(id: JsonRpcRequest["id"], result: unknown) {
  return rpcResponse({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(
  id: JsonRpcRequest["id"],
  code: number,
  message: string,
) {
  return rpcResponse({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function rpcResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
    },
  });
}

function isRequest(value: unknown): value is JsonRpcRequest {
  return (
    isRecord(value) &&
    value.jsonrpc === "2.0" &&
    typeof value.method === "string" &&
    (value.id === undefined ||
      value.id === null ||
      typeof value.id === "string" ||
      typeof value.id === "number")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getProtocolVersion(params: unknown): string | null {
  return isRecord(params) && typeof params.protocolVersion === "string"
    ? params.protocolVersion
    : null;
}
