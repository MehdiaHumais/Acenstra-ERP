import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Identifier of the currently running production build.
 * Next.js writes it to `.next/BUILD_ID` during `next build`.
 */
export function getBuildId(): string {
  if (process.env.ASCENTRA_BUILD_ID) return process.env.ASCENTRA_BUILD_ID;
  try {
    return readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
  } catch {
    return "development";
  }
}
