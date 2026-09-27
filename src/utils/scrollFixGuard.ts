/*
 * Spicetify 2.45.1 applies its legacy scrolling fix on Spotify 1.3.x because
 * the released version predicate is wrong. Its body-wide MutationObserver
 * then calls getComputedStyle for every unmarked element after each child-list
 * mutation. Tagging added subtrees in the same observer delivery prevents that
 * queued scan from walking the whole document.
 *
 * Remove this when a Spicetify release containing the corrected predicate is
 * the minimum supported version.
 */
import Logger from "./Logger.ts";
import {
  isAffectedSpicetifyVersion,
  isAffectedSpotifyVersion,
} from "./scrollFixVersions.ts";

const MARKER = "data-scroll-optimized";
const SCAN_SELECTOR = `*:not([${MARKER}])`;
const guardLogger = new Logger("Scroll Fix Guard");

function tagSubtree(root: Element): void {
  root.setAttribute(MARKER, "true");
  for (const element of root.querySelectorAll(SCAN_SELECTOR)) {
    element.setAttribute(MARKER, "true");
  }
}

export function guardSpicetifyScrollingFix(): void {
  if (!isAffectedSpotifyVersion(Spicetify.Platform.version)) return;
  if (!isAffectedSpicetifyVersion(Spicetify.Config?.version)) return;

  const isVantagraph = /vantagraph/i.test(Spicetify.Config?.current_theme ?? "");
  if (
    isVantagraph &&
    Spicetify.LocalStorage.get("vantagraph:wrapper-guard") !== "false"
  ) {
    guardLogger.debug("Skipped because the active theme owns an equivalent guard");
    return;
  }

  if (document.querySelectorAll(SCAN_SELECTOR).length === 0) {
    guardLogger.debug("Skipped because the scan is already neutralized");
    return;
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element && node.isConnected) tagSubtree(node);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  tagSubtree(document.documentElement);
}
