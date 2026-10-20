export type LiveCommandDemo = {
  id: string;
  slug: string;
  name: string;
  summary: string;
  path: string;
  completion: "complete" | "ready";
  metric: string;
  capture: string;
};

export const liveDemos: LiveCommandDemo[] = [
  {
    id: "A001",
    slug: "sun-hours",
    name: "SunHours",
    summary: "Run a shading-aware solar exposure study in a real WebGL viewport.",
    path: "/demo/sunhours.html",
    completion: "complete",
    metric: "#mean",
    capture: ".visual-panel",
  },
  {
    id: "W001",
    slug: "wind-screen",
    name: "WindScreen",
    summary: "Compare early pedestrian-wind options with a browser-side D2Q9 solver.",
    path: "/demo/wind.html",
    completion: "ready",
    metric: "#peak",
    capture: ".wind-stage",
  },
  {
    id: "M004",
    slug: "pixelate",
    name: "Pixelate",
    summary: "Explore five real pixel geometries, gaps, coloring, and massing modes.",
    path: "/demo/pixel.html",
    completion: "complete",
    metric: "#count",
    capture: ".pixel-stage",
  },
  ...[
    ["A002", "solar-radiation", "SolarRadiation", "Explore cumulative solar exposure and early photovoltaic yield.", "a002-solar-radiation"],
    ["E001", "scoreboard", "Scoreboard", "Compare weighted options, targets, rankings, and Pareto performance.", "e001-scoreboard"],
    ["F001", "facade-panels", "FacadePanels", "Panelize a facade and distinguish planar from warped cells.", "f001-facade-panels"],
    ["F002", "sun-facade", "SunFacade", "Map annual exposure into responsive facade opening ratios.", "f002-sun-facade"],
    ["G001", "voxel-growth", "VoxelGrowth", "Grow deterministic massing through analysis and geometric constraints.", "g001-voxel-growth"],
    ["G005", "brief-growth", "BriefGrowth", "Test a spatial brief against adjacency, area, and performance goals.", "g005-brief-growth"],
    ["M003", "density", "Density", "Inspect floor area, density, envelope, and orientation metrics.", "m003-density"],
    ["M005", "sun-carve", "SunCarve", "Carve early massing against solar gain and volume-loss limits.", "m005-sun-carve"],
    ["M006", "embodied-carbon", "EmbodiedCarbon", "Compare transparent structure, facade, reuse, and carbon assumptions.", "m006-embodied-carbon"],
    ["S001", "spiral-stair", "SpiralStair", "Configure a complete spiral stair and its structural components.", "s001-spiral-stair"],
    ["W002", "wind-comfort", "WindComfort", "Compare climate-weighted pedestrian comfort across wind sectors.", "w002-wind-comfort"],
    ["X000", "site-model", "SiteModel", "Explore a layered urban context import before running it in Rhino.", "x000-site-model"],
  ].map(([id, slug, name, summary, folder]) => ({
    id,
    slug,
    name,
    summary,
    path: `/commands/${folder}/preview/index.html`,
    completion: "ready" as const,
    metric: "[data-preview-metric]",
    capture: "[data-command-preview]",
  })),
];

export function getLiveDemo(slug: string): LiveCommandDemo | undefined {
  return liveDemos.find((demo) => demo.slug === slug);
}
