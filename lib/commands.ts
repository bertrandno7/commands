export const commandCategories = [
  "Geometry",
  "Analysis",
  "AI",
  "Facade",
  "Massing",
  "Utilities",
] as const;

export type CommandCategory = (typeof commandCategories)[number];
export type CommandStatus =
  | "draft"
  | "imported-draft"
  | "published"
  | "archived";

export type CommandIO = {
  name: string;
  type: string;
  description?: string;
  required?: boolean;
};

export type CommandRecord = {
  id?: string;
  slug: string;
  name: string;
  commandName?: string;
  summary: string;
  description: string;
  category: CommandCategory;
  tags: string[];
  version: string;
  status: CommandStatus;
  author: { name: string; handle: string };
  cover?: string;
  rhinoVersions: string[];
  pythonEngine: string;
  dependencies: string[];
  permissions: string[];
  inputs: CommandIO[];
  outputs: CommandIO[];
  stats: { downloads: number; stars: number; forks: number };
  updatedAt: string;
  provenance: string;
  license: string | null;
  readme: string;
  keyFeatures: string[];
  sourceFile?: string;
  downloadAvailable?: boolean;
};

export type CommandSort = "updated" | "downloads" | "stars" | "name";

const IMPORT_DATE = "2026-10-15";
const IMPORT_PROVENANCE =
  "GH Library snapshot — 2026-10-15 · source reconciled with COMMANDS 044050f — 2026-10-20";
const UNATTRIBUTED_AUTHOR = {
  // The Drive snapshot was unattributed; the owner's latest COMMANDS repository
  // identifies all fifteen catalog entries as Bertrand Tan.
  name: "Bertrand Tan",
  handle: "bertrandno7",
};
const EMPTY_STATS = { downloads: 0, stars: 0, forks: 0 };
const DOCUMENT_RW = ["document.read", "document.write"];

function ports(names: string, type = "Rhino value"): CommandIO[] {
  return names.split(",").map((name) => ({
    name,
    type,
    required: false,
  }));
}

function importedReadme(name: string, purpose: string, sourceFile: string) {
  return `# ${name}\n\n${purpose}\n\n## Import status\n\nThis is an **imported draft** from \`${sourceFile}\` in the connected GH Library snapshot dated 2026-10-15. Creator attribution and the current executable source were reconciled with the owner's COMMANDS repository at commit \`044050f\`; the source license still requires an explicit declaration.\n\nA provisional package is available for review. Review the code, dependencies, permissions, and license before production use.`;
}

/**
 * Curated metadata from the connected Drive audit. These are discoverable draft
 * records, not claims that the source has been licensed or published.
 */
export const seedCommands: CommandRecord[] = [
  {
    slug: "spiral-stair",
    name: "SpiralStair",
    commandName: "SpiralStair",
    summary: "Generate a parameterized spiral stair with structural and railing elements.",
    description:
      "Builds spiral stair treads around an inner and outer radius, with an optional central column, rail, and balusters.",
    category: "Geometry",
    tags: ["stairs", "parametric", "railings", "construction"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: DOCUMENT_RW,
    inputs: ports("C,Ro,Ri,H,Rmax,Rot,T,Ov,CW,Hr,Pr"),
    outputs: ports("treads,column,rail,balusters,info", "Rhino geometry / data"),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "SpiralStair",
      "Creates spiral stair geometry including treads, a column, rail, and balusters from compact dimensional inputs.",
      "S001_spiral_staircase.py",
    ),
    keyFeatures: [
      "Parameterized inner and outer radii",
      "Optional column, handrail, and balusters",
      "Clockwise or counter-clockwise rotation",
    ],
    sourceFile: "S001_spiral_staircase.py",
    downloadAvailable: true,
  },
  {
    slug: "facade-panels",
    name: "FacadePanels",
    commandName: "FacadePanels",
    summary: "Panelize a single-face facade and separate flat panels from warped ones.",
    description:
      "Divides a single facade face into panels, measures diagonal warp, and groups panels by a configurable flatness tolerance.",
    category: "Facade",
    tags: ["panelization", "facade", "warp", "rationalization"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: DOCUMENT_RW,
    inputs: ports("S,W,Hp,J,Tol,Flip"),
    outputs: ports("panels,flat,warped,warp,info", "Rhino geometry / data"),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "FacadePanels",
      "Panelizes one facade surface and evaluates panel warp so fabrication-friendly panels can be separated from warped panels.",
      "F001_facade_panelizer.py",
    ),
    keyFeatures: [
      "Single-face facade subdivision",
      "Diagonal warp measurement",
      "Flat and warped result groups",
    ],
    sourceFile: "F001_facade_panelizer.py",
    downloadAvailable: true,
  },
  {
    slug: "pixelate",
    name: "Pixelate",
    commandName: "Pixelate",
    summary: "Voxelize closed masses using multiple cell patterns and optional height coloring.",
    description:
      "Converts closed mass geometry into Cube, Tetra, Tri, Stagger, or CubeStagger cells with optional gaps and height-based colors.",
    category: "Massing",
    tags: ["voxel", "massing", "mesh", "discretization"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: ["document.read", "document.write", "filesystem.write"],
    inputs: ports("Mass,Size,Height,Mode,Gap,Colour,Units"),
    outputs: ports("mesh,centres,cells,count,volume,info", "Rhino geometry / data"),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "Pixelate",
      "Voxelizes closed masses with several cell layouts, reporting generated cells, centers, count, and volume. An optional workflow captures PNG output.",
      "M004_pixelate.py",
    ),
    keyFeatures: [
      "Five cell-layout modes",
      "Optional inter-cell gaps",
      "Height-based coloring and optional PNG capture",
    ],
    sourceFile: "M004_pixelate.py",
    downloadAvailable: true,
  },
  {
    slug: "density",
    name: "Density",
    commandName: "Density",
    summary: "Calculate architectural density, envelope, volume, and facade-orientation metrics.",
    description:
      "Slices floor plates and reports GFA, FSI, GSI, OSR, floor count, footprint, projected area, volume, envelope, form factor, and directional facade areas.",
    category: "Analysis",
    tags: ["density", "gfa", "fsi", "gsi", "urban-metrics"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: ["document.read"],
    inputs: ports("Mass,Plot,Floor,First,North,Units"),
    outputs: ports(
      "plates,levels,floor_gfa,gfa,fsi,gsi,osr,L,footprint,projected,plot_area,volume,envelope,form_factor,facade,roof,metrics,info",
      "Rhino geometry / metric",
    ),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "Density",
      "Produces floor slices and a broad set of urban and building-form metrics, including directional facade areas.",
      "M003_density_metrics.py",
    ),
    keyFeatures: [
      "Floor plate and GFA calculation",
      "FSI, GSI, OSR, and floor-count metrics",
      "Envelope, form-factor, and oriented facade analysis",
    ],
    sourceFile: "M003_density_metrics.py",
    downloadAvailable: true,
  },
  {
    slug: "sun-hours",
    name: "SunHours",
    commandName: "SunHours",
    summary: "Compute shading-aware direct sun hours for a selected day.",
    description:
      "Uses a NOAA solar-position calculation to sample direct sun hours on geometry, including context shading, a colored mesh, legend, and sun path.",
    category: "Analysis",
    tags: ["solar", "sun-hours", "environmental", "mesh-analysis"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: ["document.read", "document.write"],
    inputs: ports("Geo,Ctx,Lat,Lon,Month,Day,H0,H1,Step,Grid,North,TZ"),
    outputs: ports("mesh,hours,sun,info,sunpath,legend", "Rhino geometry / analysis data"),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "SunHours",
      "Samples direct solar exposure for one day with context-aware shading and produces analysis geometry, a sun path, and a legend.",
      "A001_sun_hours.py",
    ),
    keyFeatures: [
      "NOAA solar-position calculation",
      "Context-aware ray shading",
      "Colored result mesh, legend, and sun path",
    ],
    sourceFile: "A001_sun_hours.py",
    downloadAvailable: true,
  },
  {
    slug: "sun-facade",
    name: "SunFacade",
    commandName: "SunFacade",
    summary: "Size facade openings from annual direct-sun exposure per panel cell.",
    description:
      "Samples annual direct sun with context shading and maps weighted or inverted exposure values to centered opening sizes.",
    category: "Facade",
    tags: ["facade", "solar", "openings", "environmental"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: DOCUMENT_RW,
    inputs: ports("S,Ctx,Lat,Lon,W,Hp,Min,Max,Weight,Invert,Flip,Step,North"),
    outputs: ports("frame,openings,glass,sun,ratio,info", "Rhino geometry / analysis data"),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "SunFacade",
      "Relates annual direct-sun exposure to facade opening size, with context shading and optional weighting or inversion.",
      "F002_sun_openings.py",
    ),
    keyFeatures: [
      "Annual cell-level sun sampling",
      "Context shading",
      "Weighted, invertible opening-size mapping",
    ],
    sourceFile: "F002_sun_openings.py",
    downloadAvailable: true,
  },
  {
    slug: "site-model",
    name: "SiteModel",
    commandName: "SiteModel",
    summary: "Build a layered urban context model from 3D BAG or OpenStreetMap data.",
    description:
      "Fetches 3D BAG data in the Netherlands or OpenStreetMap elsewhere and builds buildings, roads, paths, rail, water, green space, trees, stops, and labels with a temporary JSON cache.",
    category: "Utilities",
    tags: ["site", "context", "openstreetmap", "3d-bag", "gis"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: [
      "document.write",
      "network",
      "filesystem.read",
      "filesystem.write",
    ],
    inputs: ports("Lat,Lon,Radius,LoD,Source,TransitR,Refresh,Labels,Run"),
    outputs: ports(
      "buildings,roads,paths,rail,water,green,trees,stops,labels,site,info",
      "Rhino geometry / site data",
    ),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "SiteModel",
      "Generates layered site context from api.3dbag.nl or Overpass mirrors and caches source JSON temporarily.",
      "X000_site_model.py",
    ),
    keyFeatures: [
      "3D BAG support for Dutch sites",
      "OpenStreetMap/Overpass fallback",
      "Layered buildings, mobility, landscape, and labels",
    ],
    sourceFile: "X000_site_model.py",
    downloadAvailable: true,
  },
  {
    slug: "scoreboard",
    name: "Scoreboard",
    commandName: "Scoreboard",
    summary: "Compare design options with weighted metrics, targets, rankings, and Pareto fronts.",
    description:
      "Snapshots sticky option metrics, calculates weighted relative scores and targets, identifies the Pareto front, draws radar and score bars, persists JSON, and exports CSV.",
    category: "Analysis",
    tags: ["optimization", "options", "pareto", "decision-support"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: [
      "document.read",
      "document.write",
      "filesystem.read",
      "filesystem.write",
    ],
    inputs: ports("Name,Save,Metrics,Remove,Clear,Weights,Targets,Origin,Size,Units,File"),
    outputs: ports(
      "names,scores,ranks,pareto,best,table,options,chart,text,info",
      "Rhino geometry / option data",
    ),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "Scoreboard",
      "Maintains comparable design-option snapshots and visualizes weighted scores, ranks, targets, and the Pareto front.",
      "E001_option_scoreboard.py",
    ),
    keyFeatures: [
      "Persistent design-option snapshots",
      "Weighted scoring and target comparison",
      "Pareto, radar, score-bar, JSON, and CSV outputs",
    ],
    sourceFile: "E001_option_scoreboard.py",
    downloadAvailable: true,
  },
  {
    slug: "sun-carve",
    name: "SunCarve",
    commandName: "SunCarve",
    summary: "Carve massing to improve facade sun while limiting volume loss.",
    description:
      "Greedily evaluates planar or stepped cuts against own-facade sun gain, maximum volume loss, and optional neighboring benefit.",
    category: "Massing",
    tags: ["solar", "massing", "optimization", "carving"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: DOCUMENT_RW,
    inputs: ports(
      "Mass,Ctx,Lat,Lon,MaxCuts,MaxLoss,Slopes,Depths,Stepped,Floor,Objective,MinGain,Grid,Step,Units,Month,Day,MinSun,Neighbours,Reach",
    ),
    outputs: ports(
      "carved,cutters,sun,before,nsun,gain,ngain,loss,log,info",
      "Rhino geometry / optimization data",
    ),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "SunCarve",
      "Searches planar or stepped mass cuts that improve solar performance while respecting a volume-loss budget.",
      "M005_sun_carve.py",
    ),
    keyFeatures: [
      "Solar objective with volume-loss constraint",
      "Planar and stepped cut candidates",
      "Optional neighboring-sun benefit",
    ],
    sourceFile: "M005_sun_carve.py",
    downloadAvailable: true,
  },
  {
    slug: "brief-growth",
    name: "BriefGrowth",
    commandName: "BriefGrowth",
    summary: "Grow a whole spatial brief through an analysis field with hard area caps.",
    description:
      "Places and grows brief units through a G001 analysis field using area limits, adjacency, frontage, sun, and support criteria, with an optional facade skin.",
    category: "AI",
    tags: ["generative-design", "brief", "growth", "multi-objective"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["8"],
    pythonEngine: "Rhino 8 CPython",
    dependencies: ["numpy", "./G001_voxel_growth.py", "./G006_voxel_facade.py"],
    permissions: ["document.read", "document.write", "filesystem.read"],
    inputs: ports(
      "Plot,Brief,Lat,Lon,MaxHeight,Cell,Floor,MaxGSI,Cantilever,WindDir,Update,Seed,Context,LibPath,Run,Facade,Fins,Balconies",
    ),
    outputs: ports(
      "boxes,item,colours,labels,report,compliance,metrics,info,facade,facade_layer",
      "Rhino geometry / brief data",
    ),
    stats: EMPTY_STATS,
    updatedAt: IMPORT_DATE,
    provenance: IMPORT_PROVENANCE,
    license: null,
    readme: importedReadme(
      "BriefGrowth",
      "Grows a CSV-defined spatial brief against analysis and adjacency criteria, then optionally adds a configurable facade skin.",
      "G005_brief_growth.py",
    ),
    keyFeatures: [
      "Hard area caps and compliance reporting",
      "Adjacency, frontage, solar, support, and GSI criteria",
      "Optional fins, balconies, and facade layer",
    ],
    sourceFile: "G005_brief_growth.py",
    downloadAvailable: true,
  },
  {
    slug: "wind-screen",
    name: "WindScreen",
    commandName: "WindScreen",
    summary: "Run fast 2D wind screening at pedestrian height around early massing.",
    description:
      "Adapts a D2Q9 lattice-Boltzmann solver for qualitative option comparison, reporting relative wind speed, shelter, and acceleration around building footprints.",
    category: "Analysis",
    tags: ["wind", "screening", "microclimate", "massing"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["8"],
    pythonEngine: "Rhino 8 CPython",
    dependencies: ["numpy"],
    permissions: ["document.read", "document.write"],
    inputs: ports("Geo,WindDir,WindSpeed,Cell,Steps,Slice"),
    outputs: ports("field,ratios,shelter,peak,mean,info", "Rhino geometry / analysis data"),
    stats: EMPTY_STATS,
    updatedAt: "2026-10-20",
    provenance: "COMMANDS repository source and tested live preview — commit 044050f",
    license: null,
    readme: importedReadme(
      "WindScreen",
      "Provides rapid, qualitative pedestrian-height wind screening for early design comparison. It is not a calibrated CFD or NEN 8100 assessment.",
      "W001_wind_screening.py",
    ),
    keyFeatures: [
      "D2Q9 lattice-Boltzmann screening kernel",
      "Relative shelter and acceleration field",
      "Tested interactive browser preview",
    ],
    sourceFile: "W001_wind_screening.py",
    downloadAvailable: true,
  },
  {
    slug: "solar-radiation",
    name: "SolarRadiation",
    commandName: "SolarRadiation",
    summary: "Estimate cumulative solar radiation and photovoltaic yield with context shading.",
    description:
      "Evaluates cumulative incident solar energy on design geometry, with weather-aware context shading and an early photovoltaic-yield estimate.",
    category: "Analysis",
    tags: ["solar", "radiation", "pv", "environmental"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: ["document.read", "document.write", "network"],
    inputs: ports("Geo,Ctx,Lat,Lon,Weather,Grid,North,Efficiency"),
    outputs: ports("mesh,radiation,pv,legend,info", "Rhino geometry / analysis data"),
    stats: EMPTY_STATS,
    updatedAt: "2026-10-20",
    provenance: "COMMANDS repository source and live preview — commit 044050f",
    license: null,
    readme: importedReadme(
      "SolarRadiation",
      "Combines context-aware solar exposure with a preliminary PV-energy estimate.",
      "A002_solar_radiation.py",
    ),
    keyFeatures: ["Cumulative solar exposure", "Weather-data input", "Preliminary PV yield"],
    sourceFile: "A002_solar_radiation.py",
    downloadAvailable: true,
  },
  {
    slug: "wind-comfort",
    name: "WindComfort",
    commandName: "WindComfort",
    summary: "Screen pedestrian wind comfort across multiple climate sectors.",
    description:
      "Combines directional wind screening with climate frequencies to support early NEN 8100-oriented option comparison.",
    category: "Analysis",
    tags: ["wind", "comfort", "nen-8100", "climate"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["8"],
    pythonEngine: "Rhino 8 CPython",
    dependencies: ["numpy"],
    permissions: ["document.read", "document.write", "network"],
    inputs: ports("Geo,Weather,Sectors,Cell,Steps,Slice"),
    outputs: ports("comfort,exceedance,sectors,legend,info", "Rhino geometry / analysis data"),
    stats: EMPTY_STATS,
    updatedAt: "2026-10-20",
    provenance: "COMMANDS repository source and live preview — commit 044050f",
    license: null,
    readme: importedReadme(
      "WindComfort",
      "Aggregates directional wind screening into an early pedestrian-comfort comparison.",
      "W002_wind_comfort.py",
    ),
    keyFeatures: ["Multiple wind sectors", "Climate-frequency weighting", "Early comfort comparison"],
    sourceFile: "W002_wind_comfort.py",
    downloadAvailable: true,
  },
  {
    slug: "embodied-carbon",
    name: "EmbodiedCarbon",
    commandName: "EmbodiedCarbon",
    summary: "Estimate embodied carbon by structure, facade, reuse, and new construction.",
    description:
      "Turns early quantities and material assumptions into transparent embodied-carbon totals for rapid option comparison.",
    category: "Analysis",
    tags: ["carbon", "lca", "materials", "reuse"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["7", "8"],
    pythonEngine: "Rhino Python (engine unverified)",
    dependencies: [],
    permissions: ["document.read", "document.write"],
    inputs: ports("Geo,Structure,Facade,Reuse,Factors,Units"),
    outputs: ports("total,structure,facade,reuse,breakdown,info", "Analysis data"),
    stats: EMPTY_STATS,
    updatedAt: "2026-10-20",
    provenance: "COMMANDS repository source and live preview — commit 044050f",
    license: null,
    readme: importedReadme(
      "EmbodiedCarbon",
      "Compares structural, facade, reuse, and new-construction carbon contributions.",
      "M006_embodied_carbon.py",
    ),
    keyFeatures: ["Transparent factor-based estimate", "Reuse and new-build split", "Option-ready breakdown"],
    sourceFile: "M006_embodied_carbon.py",
    downloadAvailable: true,
  },
  {
    slug: "voxel-growth",
    name: "VoxelGrowth",
    commandName: "VoxelGrowth",
    summary: "Grow voxel massing through sun, density, support, and cantilever criteria.",
    description:
      "Uses an analysis field and hard geometric constraints to grow early massing one voxel at a time.",
    category: "AI",
    tags: ["generative-design", "voxel", "massing", "growth"],
    version: "0.1.0",
    status: "imported-draft",
    author: UNATTRIBUTED_AUTHOR,
    rhinoVersions: ["8"],
    pythonEngine: "Rhino 8 CPython",
    dependencies: ["numpy"],
    permissions: ["document.read", "document.write"],
    inputs: ports("Plot,Field,Target,Cell,MaxHeight,MaxGSI,Cantilever,Seed"),
    outputs: ports("voxels,score,metrics,history,info", "Rhino geometry / growth data"),
    stats: EMPTY_STATS,
    updatedAt: "2026-10-20",
    provenance: "GH Library G001 source reconciled with COMMANDS commit 044050f",
    license: null,
    readme: importedReadme(
      "VoxelGrowth",
      "Builds analysis-guided voxel massing while respecting density, support, and cantilever limits.",
      "G001_voxel_growth.py",
    ),
    keyFeatures: ["Analysis-driven growth", "Hard density and height limits", "Deterministic seeded options"],
    sourceFile: "G001_voxel_growth.py",
    downloadAvailable: true,
  },
];

export function getSeedCommand(slug: string): CommandRecord | undefined {
  return seedCommands.find((command) => command.slug === slug);
}

/** Backwards-compatible UI helper for the built-in catalog snapshot. */
export function findCommand(slug: string): CommandRecord | undefined {
  return getSeedCommand(slug);
}

export function filterCommands(
  records: CommandRecord[],
  options: {
    query?: string;
    category?: string;
    sort?: CommandSort;
  } = {},
): CommandRecord[] {
  const query = options.query?.trim().toLocaleLowerCase();
  const category = commandCategories.find(
    (value) => value.toLocaleLowerCase() === options.category?.toLocaleLowerCase(),
  );

  const filtered = records.filter((command) => {
    if (category && command.category !== category) return false;
    if (!query) return true;
    const haystack = [
      command.name,
      command.summary,
      command.description,
      command.category,
      command.author.name,
      command.author.handle,
      ...command.tags,
    ]
      .join(" ")
      .toLocaleLowerCase();
    return haystack.includes(query);
  });

  const sort = options.sort ?? "updated";
  return [...filtered].sort((a, b) => {
    if (sort === "downloads") return b.stats.downloads - a.stats.downloads;
    if (sort === "stars") return b.stats.stars - a.stats.stars;
    if (sort === "name") return a.name.localeCompare(b.name);
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

type StoredCommand = {
  id: string;
  slug: string;
  name: string;
  commandName: string;
  summary: string;
  description: string;
  category: string;
  tagsJson: string;
  status: string;
  authorName: string;
  authorHandle: string;
  coverKey: string | null;
  provenance: string;
  license: string | null;
  readme: string;
  keyFeaturesJson: string;
  rhinoVersionsJson: string;
  pythonEngine: string;
  dependenciesJson: string;
  permissionsJson: string;
  inputsJson: string;
  outputsJson: string;
  downloadCount: number;
  starCount: number;
  forkCount: number;
  updatedAt: string;
};

export function commandFromStoredRow(
  row: StoredCommand,
  version: string,
): CommandRecord {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    commandName: row.commandName,
    summary: row.summary,
    description: row.description,
    category: isCommandCategory(row.category) ? row.category : "Utilities",
    tags: parseStringArray(row.tagsJson),
    version,
    status: isCommandStatus(row.status) ? row.status : "draft",
    author: { name: row.authorName, handle: row.authorHandle },
    cover: row.coverKey ? `/api/v1/assets/${encodeURIComponent(row.id)}/cover` : undefined,
    rhinoVersions: parseStringArray(row.rhinoVersionsJson),
    pythonEngine: row.pythonEngine,
    dependencies: parseStringArray(row.dependenciesJson),
    permissions: parseStringArray(row.permissionsJson),
    inputs: parseIoArray(row.inputsJson),
    outputs: parseIoArray(row.outputsJson),
    stats: {
      downloads: row.downloadCount,
      stars: row.starCount,
      forks: row.forkCount,
    },
    updatedAt: row.updatedAt,
    provenance: row.provenance,
    license: row.license,
    readme: row.readme,
    keyFeatures: parseStringArray(row.keyFeaturesJson),
    downloadAvailable: true,
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseIoArray(value: string): CommandIO[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is CommandIO =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as CommandIO).name === "string" &&
        typeof (item as CommandIO).type === "string",
    );
  } catch {
    return [];
  }
}

function isCommandCategory(value: string): value is CommandCategory {
  return commandCategories.includes(value as CommandCategory);
}

function isCommandStatus(value: string): value is CommandStatus {
  return ["draft", "imported-draft", "published", "archived"].includes(value);
}
