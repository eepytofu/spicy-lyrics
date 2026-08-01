import { execFileSync } from "node:child_process";
import { defineConfig } from "@spicemod/creator";
import { createBuildMarker } from "./project/buildMarker";
import { ProjectName, ProjectVersion } from "./project/config";

function readGit(args: string[]): string | undefined {
  try {
    return execFileSync("git", args, {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

const revision = readGit(["rev-parse", "--short", "HEAD"]);
const dirty = Boolean(readGit(["status", "--porcelain", "--untracked-files=normal"]));
const buildMarker = createBuildMarker(ProjectVersion, revision, dirty);

export default defineConfig({
  name: ProjectName,
  version: ProjectVersion,
  framework: "react",
  linter: "oxlint",
  template: "extension",
  packageManager: "npm",
  cssId: "slstyles",
  devModeVarName: "__SLdev__m",
  esbuildOptions: {
    legalComments: "inline",
    define: {
      __SPICY_LYRICS_BUILD_MARKER__: JSON.stringify(buildMarker),
    },
  },
});
