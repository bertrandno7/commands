import {
  Blocks,
  Bot,
  Boxes,
  ChartNoAxesCombined,
  Grid3X3,
  Sparkles,
  SunMedium,
  Wrench,
} from "lucide-react";
import type { CommandCategory } from "@/lib/commands";

export function CategoryIcon({ category, size = 18 }: { category: CommandCategory; size?: number }) {
  const props = { size, strokeWidth: 1.8 };
  if (category === "Analysis") return <ChartNoAxesCombined {...props} />;
  if (category === "AI") return <Bot {...props} />;
  if (category === "Facade") return <Grid3X3 {...props} />;
  if (category === "Massing") return <Boxes {...props} />;
  if (category === "Utilities") return <Wrench {...props} />;
  return <Blocks {...props} />;
}

export function TagIcon({ tag, size = 14 }: { tag: string; size?: number }) {
  const normalized = tag.toLowerCase();
  if (normalized.includes("sun") || normalized.includes("solar")) return <SunMedium size={size} />;
  return <Sparkles size={size} />;
}
