import { downloadCommandPackage } from "@/app/api/v1/_lib/download";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; version: string }> },
) {
  const { slug, version } = await context.params;
  return downloadCommandPackage(request, slug, version);
}
