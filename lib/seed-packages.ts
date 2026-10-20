import packageIndex from "@/public/packages/index.json";

export type SeedPackageMetadata = {
  version: string;
  bytes: number;
  sha256: string;
};

export function getSeedPackageMetadata(slug: string): SeedPackageMetadata | undefined {
  return (packageIndex as Record<string, SeedPackageMetadata>)[slug];
}
