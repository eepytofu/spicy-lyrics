import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@spicemod/creator";
import type { Plugin } from "esbuild";
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
const compositionReportPlugin: Plugin = {
  name: "spicy-lyrics-composition-report",
  setup(build) {
    build.onEnd((result) => {
      if (!build.initialOptions.minify || !result.metafile) return;
      const outputDirectory = resolve(process.cwd(), "dist");
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(
        resolve(outputDirectory, "spicy-lyrics.meta.json"),
        `${JSON.stringify(result.metafile, null, 2)}\n`,
        "utf8",
      );
    });
  },
};

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
    metafile: true,
    plugins: [compositionReportPlugin],
    define: {
      __SPICY_LYRICS_BUILD_MARKER__: JSON.stringify(buildMarker),
    },
  },
});
