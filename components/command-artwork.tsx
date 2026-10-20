import type { CommandCategory } from "@/lib/commands";

const coverBySlug: Record<string, string> = {
  "spiral-stair": "/assets/thumbnails/S001.png",
  "facade-panels": "/assets/thumbnails/F001.png",
  pixelate: "/assets/thumbnails/M004.png",
  density: "/assets/thumbnails/M003.png",
  "sun-hours": "/assets/thumbnails/A001.png",
  "wind-screen": "/assets/thumbnails/W001.png",
  "sun-facade": "/assets/thumbnails/F002.png",
  "site-model": "/assets/thumbnails/X000.png",
  scoreboard: "/assets/thumbnails/E001.png",
  "sun-carve": "/assets/thumbnails/M005.png",
  "brief-growth": "/assets/thumbnails/G005.png",
  "solar-radiation": "/assets/thumbnails/A002.png",
  "wind-comfort": "/assets/thumbnails/W002.png",
  "embodied-carbon": "/assets/thumbnails/M006.png",
  "voxel-growth": "/assets/thumbnails/G001.png",
};

export function commandCover(slug: string) {
  return coverBySlug[slug];
}

export function CommandArtwork({
  slug,
  name,
  category,
  priority = false,
}: {
  slug: string;
  name: string;
  category: CommandCategory;
  priority?: boolean;
}) {
  const src = commandCover(slug);
  return (
    <div className={`command-artwork category-${category.toLowerCase()}`}>
      {src ? (
        // Generated project asset. Native img keeps the card lightweight on Workers.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={`${name} command preview`} loading={priority ? "eager" : "lazy"} />
      ) : (
        <div className="procedural-art" aria-label={`${name} abstract preview`}>
          <i /><i /><i /><i /><i />
        </div>
      )}
      <span className="artwork-label">Rhino / Python</span>
    </div>
  );
}
