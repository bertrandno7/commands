import { z } from "zod";
import { commandCategories } from "@/lib/commands";

export const commandPermissions = [
  "document.read",
  "document.write",
  "filesystem.read",
  "filesystem.write",
  "network",
  "clipboard",
  "subprocess",
] as const;

const relativePackagePath = z
  .string()
  .min(1)
  .max(240)
  .refine(isSafePackagePath, "Must be a safe relative package path");

const ioPortSchema = z
  .object({
    name: z.string().min(1).max(80),
    type: z.string().min(1).max(120),
    description: z.string().max(500).optional(),
    required: z.boolean().optional().default(false),
    default: z.unknown().optional(),
  })
  .strict();

const registryDependencySchema = z
  .object({
    id: z.string().min(1).max(160),
    version: z.string().min(1).max(80).default("*"),
  })
  .strict();

const uniqueStrings = <T extends z.ZodTypeAny>(schema: T, max: number) =>
  z
    .array(schema)
    .max(max)
    .refine((values) => new Set(values).size === values.length, "Values must be unique");

export const commandManifestSchema = z
  .object({
    schemaVersion: z.literal("1.0"),
    slug: z
      .string()
      .min(2)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().min(2).max(80),
    commandName: z
      .string()
      .min(2)
      .max(64)
      .regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    version: z
      .string()
      .regex(
        /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
        "Must be a semantic version",
      ),
    summary: z.string().min(10).max(240),
    description: z.string().min(10).max(4_000),
    category: z.enum(commandCategories),
    tags: uniqueStrings(z.string().min(1).max(40), 12).default([]),
    license: z.string().min(1).max(100).nullable(),
    entrypoint: z
      .object({
        file: relativePackagePath,
        callable: z.string().min(1).max(80).default("run"),
      })
      .strict(),
    icon: relativePackagePath,
    runtime: z
      .object({
        host: z.literal("rhino"),
        rhinoVersions: uniqueStrings(z.string().min(1).max(40), 8).refine(
          (values) => values.length > 0,
          "At least one Rhino version is required",
        ),
        pythonEngine: z.string().min(1).max(100),
      })
      .strict(),
    dependencies: z
      .object({
        python: uniqueStrings(z.string().min(1).max(160), 50).default([]),
        commands: z
          .array(registryDependencySchema)
          .max(50)
          .refine(
            (values) => new Set(values.map((value) => value.id)).size === values.length,
            "Command dependency ids must be unique",
          )
          .default([]),
        rhinoPlugins: uniqueStrings(z.string().min(1).max(160), 50).default([]),
        files: uniqueStrings(relativePackagePath, 50).default([]),
      })
      .strict(),
    permissions: uniqueStrings(z.enum(commandPermissions), 12).default([]),
    interface: z
      .object({
        inputs: z.array(ioPortSchema).max(100).default([]),
        outputs: z.array(ioPortSchema).max(100).default([]),
        objectives: z.array(ioPortSchema).max(30).optional(),
        metrics: z.array(ioPortSchema).max(50).optional(),
      })
      .strict(),
    agent: z
      .object({
        callable: z.boolean().default(false),
        description: z.string().max(1_000),
        inputSchema: z.record(z.unknown()).optional(),
        outputSchema: z.record(z.unknown()).optional(),
        sideEffects: uniqueStrings(z.enum(commandPermissions), 12).default([]),
      })
      .strict()
      .optional(),
    provenance: z
      .object({
        status: z.enum(["community-publish", "imported-draft"]),
        source: z.string().min(1).max(500),
        sourceFile: z.string().max(240).optional(),
        snapshotDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    for (const sideEffect of manifest.agent?.sideEffects ?? []) {
      if (!manifest.permissions.includes(sideEffect)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["agent", "sideEffects"],
          message: `Agent side effect ${sideEffect} must also be declared in permissions`,
        });
      }
    }
  });

export type CommandManifest = z.infer<typeof commandManifestSchema>;
export type CommandPermission = (typeof commandPermissions)[number];

export const catalogQuerySchema = z.object({
  q: z.string().max(160).optional(),
  category: z.string().max(40).optional(),
  sort: z.enum(["updated", "downloads", "stars", "name"]).default("updated"),
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export function parseManifest(input: unknown):
  | { success: true; data: CommandManifest; warnings: string[] }
  | { success: false; errors: string[] } {
  const parsed = commandManifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      errors: parsed.error.issues.map((issue) => {
        const path = issue.path.length ? issue.path.join(".") : "manifest";
        return `${path}: ${issue.message}`;
      }),
    };
  }

  const warnings: string[] = [];
  if (!parsed.data.license || parsed.data.license === "LicenseRef-Pending") {
    warnings.push("The package does not yet declare a resolved open-source license.");
  }
  if (parsed.data.permissions.includes("subprocess")) {
    warnings.push("This command can start local subprocesses.");
  }
  if (parsed.data.permissions.includes("network")) {
    warnings.push("This command can make network requests.");
  }

  return { success: true, data: parsed.data, warnings };
}

export function parseManifestJson(value: string):
  | { success: true; data: CommandManifest; warnings: string[] }
  | { success: false; errors: string[] } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return { success: false, errors: ["manifest: Must be valid JSON"] };
  }
  return parseManifest(decoded);
}

export function isSafePackagePath(value: string): boolean {
  if (!value || value !== value.normalize("NFC")) return false;
  if (value.includes("\\") || /[\0-\x1f<>:"|?*]/.test(value)) return false;
  if (value.startsWith("/") || /^[A-Za-z]:/.test(value)) return false;
  const segments = value.split("/");
  return !segments.some((segment) => {
    if (segment === "" || segment === "." || segment === "..") return true;
    if (/[ .]$/.test(segment)) return true;
    const stem = segment.split(".")[0]?.toLocaleLowerCase("en-US");
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/.test(stem ?? "");
  });
}
