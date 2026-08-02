// Compact lyrics card injected into Spotify's right-sidebar Now Playing View.
// Reuses the full synced lyrics pipeline by opening PageView into the card body.
// PageView is a global singleton, so the card is exclusive with the main page,
// PiP, fullscreen, and cinema view.
import PageView from "../Pages/PageView.ts";
import Fullscreen from "./Fullscreen.ts";
import { IsPIP, _IsPIP_after, IsPIPOpening } from "./PopupLyrics.ts";
import Session from "../Global/Session.ts";
import Global from "../Global/Global.ts";
import { Icons } from "../Styling/Icons.ts";
import { Maid } from "../../modules/Maid.ts";
import Whentil from "../../modules/Whentil.ts";
import { $npvLyricsExpanded, $npvLyricsOpen } from "../../utils/uiState.ts";
import {
  $currentLyricsData,
  $disableNpvLyrics,
  $hideNpvLyricsWhenUnavailable,
} from "../../utils/stores.ts";
import Logger from "../../utils/Logger.ts";
import { SpotifyPlayer } from "../Global/SpotifyPlayer.ts";
import { shouldHideNpvForMissingLyrics } from "./NPVAvailability.ts";

const cardLogger = new Logger("NPV Lyrics");

type CardState = "DORMANT" | "SHELL" | "ACTIVE";

let initialized = false;
let cardEl: HTMLElement | null = null;
let cardBodyEl: HTMLElement | null = null;
let cardOwnsPage = false;
let cardMaid: Maid | null = null;
const watcherMaid = new Maid();

let evaluateTimer: ReturnType<typeof setTimeout> | null = null;
let evaluating = false;
let evaluateAgain = false;
let stateAnimation: Animation | null = null;

const getNPV = (): HTMLElement | null =>
  document.querySelector<HTMLElement>(".Root__right-sidebar aside.NowPlayingView") ??
  document.querySelector<HTMLElement>(
    ".Root__right-sidebar aside#Desktop_PanelContainer_Id:has(.main-nowPlayingView-coverArtContainer)"
  );

export function NPVCardOwnsPage(): boolean {
  return cardOwnsPage;
}

export async function DeRenderNPVCard(): Promise<void> {
  await teardownCard();
}

export function RequestNPVCardEvaluate(): void {
  scheduleEvaluate();
}

function desiredState(): CardState {
  if ($disableNpvLyrics.get()) return "DORMANT";
  const npv = getNPV();
  if (!npv || !npv.isConnected || npv.closest("[inert]")) return "DORMANT";
  const pageBusyElsewhere =
    (PageView.IsOpened && !cardOwnsPage) ||
    IsPIP ||
    _IsPIP_after ||
    IsPIPOpening ||
    Fullscreen.IsOpen ||
    Fullscreen.CinemaViewOpen ||
    Spicetify.Platform.History.location.pathname === "/SpicyLyrics";
  if (pageBusyElsewhere) return "DORMANT";
  if (
    shouldHideNpvForMissingLyrics(
      $hideNpvLyricsWhenUnavailable.get(),
      SpotifyPlayer.GetUri(),
      $currentLyricsData.get(),
    )
  )
    return "DORMANT";
  return $npvLyricsOpen.get() ? "ACTIVE" : "SHELL";
}

async function teardownCard(): Promise<void> {
  if (cardOwnsPage) {
    cardOwnsPage = false;
    await PageView.Destroy();
  }
  cardMaid?.CleanUp();
  cardMaid = null;
  cardEl = null;
  cardBodyEl = null;
  lastToggleOpen = null;
  lastExpanded = null;
}

function insertCard(npv: HTMLElement, el: HTMLElement): boolean {
  const cover = npv.querySelector(".main-nowPlayingView-coverArtContainer");
  const anchor =
    cover?.closest(".main-nowPlayingView-nowPlayingWidget") ??
    cover?.closest(".main-nowPlayingView-section") ??
    cover?.parentElement ??
    null;
  if (anchor && anchor.parentElement && anchor !== npv) {
    anchor.insertAdjacentElement("afterend", el);
    return true;
  }
  const content = npv.querySelector(".main-nowPlayingView-content");
  if (content) {
    content.prepend(el);
    return true;
  }
  return false;
}

function setTooltip(target: Element, content: string, maidKey: string): void {
  try {
    const tip = Spicetify.Tippy(target, {
      ...Spicetify.TippyProps,
      content,
    });
    if (tip) cardMaid?.Give(() => tip.destroy(), maidKey);
  } catch (err) {
    cardLogger.warn("Failed to setup tooltip", err);
  }
}

let lastToggleOpen: boolean | null = null;
let lastExpanded: boolean | null = null;

const STATE_ANIM_MS = 350;
const STATE_ANIM_EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function animateStateChange(mutate: () => void): void {
  if (!cardEl || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    mutate();
    return;
  }
  const card = cardEl;
  const buttons = Array.from(card.querySelectorAll<HTMLElement>(".CardControl"));
  const firstCard = card.getBoundingClientRect();
  const firstButtons = buttons.map((button) => button.getBoundingClientRect());

  mutate();

  const lastCard = card.getBoundingClientRect();
  if (
    firstCard.width === 0 ||
    firstCard.height === 0 ||
    lastCard.width === 0 ||
    lastCard.height === 0
  )
    return;

  const morph = card.animate(
    [
      { width: `${firstCard.width}px`, height: `${firstCard.height}px` },
      { width: `${lastCard.width}px`, height: `${lastCard.height}px` },
    ],
    { duration: STATE_ANIM_MS, easing: STATE_ANIM_EASE }
  );
  if (card.classList.contains("Expanded")) holdEvaluateUntilSettled(morph);

  buttons.forEach((button, index) => {
    const first = firstButtons[index];
    const last = button.getBoundingClientRect();
    const dx = first.left - last.left;
    const dy = first.top - last.top;
    if (dx === 0 && dy === 0) return;
    button.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }],
      { duration: STATE_ANIM_MS, easing: STATE_ANIM_EASE }
    );
  });
}

function refreshCardUI(): void {
  if (!cardEl) return;
  const open = $npvLyricsOpen.get();
  const expanded = open && $npvLyricsExpanded.get();
  cardEl.classList.toggle("Collapsed", !open);
  cardEl.classList.toggle("Expanded", expanded);
  if (lastToggleOpen !== open) {
    lastToggleOpen = open;
    const toggle = cardEl.querySelector<HTMLElement>("#NPVCardToggle");
    if (toggle) {
      toggle.innerHTML = open ? Icons.Collapse : Icons.Uncollapse;
      setTooltip(toggle, open ? "Hide Lyrics" : "Show Lyrics", "toggle-tip");
    }
  }
  if (lastExpanded !== expanded) {
    lastExpanded = expanded;
    const maximize = cardEl.querySelector<HTMLElement>("#NPVCardMaximize");
    if (maximize) {
      maximize.innerHTML = expanded ? Icons.Minimize : Icons.Maximize;
      setTooltip(
        maximize,
        expanded ? "Exit Expanded" : "Expand Lyrics",
        "maximize-tip"
      );
    }
  }
}

function renderCardShell(npv: HTMLElement): boolean {
  const el = document.createElement("div");
  el.id = "SpicyLyricsNPVCard";
  el.innerHTML = `
        <div class="CardHeader">
            <span class="CardTitle">Lyrics</span>
            <div class="CardControls">
                <button id="NPVCardExpand" class="CardControl">${Icons.CinemaView}</button>
                <button id="NPVCardMaximize" class="CardControl">${Icons.Maximize}</button>
                <button id="NPVCardToggle" class="CardControl">${Icons.Collapse}</button>
            </div>
        </div>
        <div class="CardBody"></div>
    `;
  if (!insertCard(npv, el)) return false;
  cardMaid = new Maid();
  cardEl = el;
  cardMaid.Give(cardEl);
  cardBodyEl = cardEl.querySelector<HTMLElement>(".CardBody");

  const expand = cardEl.querySelector<HTMLElement>("#NPVCardExpand");
  if (expand) {
    expand.addEventListener("click", () => {
      Session.Navigate({ pathname: "/SpicyLyrics" });
    });
    setTooltip(expand, "Open Spicy Lyrics", "expand-tip");
  }

  const maximize = cardEl.querySelector<HTMLElement>("#NPVCardMaximize");
  if (maximize) {
    maximize.addEventListener("click", () => {
      animateStateChange(() => {
        const next = !$npvLyricsExpanded.get();
        $npvLyricsExpanded.set(next);
        if (next && !$npvLyricsOpen.get()) $npvLyricsOpen.set(true);
        refreshCardUI();
      });
    });
  }

  const toggle = cardEl.querySelector<HTMLElement>("#NPVCardToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      animateStateChange(() => {
        const open = $npvLyricsOpen.get();
        if (open && $npvLyricsExpanded.get()) $npvLyricsExpanded.set(false);
        $npvLyricsOpen.set(!open);
        refreshCardUI();
      });
    });
  }

  refreshCardUI();
  return true;
}

async function reconcile(): Promise<void> {
  if (cardEl && !cardEl.isConnected) {
    cardLogger.debug("Card was removed externally, cleaning up");
    await teardownCard();
  }

  const desired = desiredState();
  const current: CardState = !cardEl
    ? "DORMANT"
    : cardOwnsPage
      ? "ACTIVE"
      : "SHELL";

  if (desired === current) {
    if (cardEl) refreshCardUI();
    return;
  }

  cardLogger.debug(`State: ${current} -> ${desired}`);

  if (desired === "DORMANT") {
    await teardownCard();
    return;
  }

  if (current === "DORMANT") {
    const npv = getNPV();
    if (!npv) return;
    if (!renderCardShell(npv)) return;
  }

  if (desired === "ACTIVE" && !cardOwnsPage && cardBodyEl) {
    refreshCardUI();
    cardOwnsPage = true;
    await PageView.Open(cardBodyEl, { cardMode: true });
  } else if (desired === "SHELL" && cardOwnsPage) {
    cardOwnsPage = false;
    await PageView.Destroy();
    refreshCardUI();
  } else {
    refreshCardUI();
  }
}

async function evaluate(): Promise<void> {
  if (evaluating) {
    evaluateAgain = true;
    return;
  }
  evaluating = true;
  try {
    do {
      evaluateAgain = false;
      await reconcile();
    } while (evaluateAgain);
  } catch (err) {
    cardLogger.error("Reconcile failed", err);
  } finally {
    evaluating = false;
  }
}

function scheduleEvaluate(): void {
  if (evaluateTimer !== null) return;
  if (stateAnimation !== null) return;
  evaluateTimer = setTimeout(() => {
    evaluateTimer = null;
    void evaluate();
  }, 100);
}

function holdEvaluateUntilSettled(animation: Animation): void {
  if (evaluateTimer !== null) {
    clearTimeout(evaluateTimer);
    evaluateTimer = null;
  }
  stateAnimation = animation;
  const settle = () => {
    if (stateAnimation !== animation) return;
    stateAnimation = null;
    scheduleEvaluate();
  };
  animation.finished.then(settle, settle);
}

let observedSidebar: Element | null = null;

function attachSidebarObserver(): void {
  const sidebar = document.querySelector(".Root__right-sidebar");
  if (!sidebar || sidebar === observedSidebar) return;
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const target = record.target;
      if (cardEl && (target === cardEl || cardEl.contains(target))) continue;
      scheduleEvaluate();
      return;
    }
  });
  observer.observe(sidebar, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["inert"],
  });
  watcherMaid.Give(observer, "sidebar-observer");
  observedSidebar = sidebar;
  scheduleEvaluate();
}

function attachWatchers(): void {
  attachSidebarObserver();
  const topContainer = document.querySelector(".Root__top-container");
  const watchRoot = topContainer ?? document.querySelector(".Root") ?? document.body;
  const topObserver = new MutationObserver(() => {
    if (!observedSidebar || !observedSidebar.isConnected) {
      observedSidebar = null;
      attachSidebarObserver();
    }
  });
  topObserver.observe(watchRoot, {
    childList: true,
    subtree: topContainer === null,
  });
  watcherMaid.Give(topObserver, "top-observer");
}

export function initNPVLyrics(): void {
  if (initialized) return;
  initialized = true;

  for (const name of [
    "page:destroy",
    "page:open",
    "fullscreen:open",
    "fullscreen:exit",
    "platform:history",
    "playback:songchange",
  ]) {
    const id = Global.Event.listen(name, () => scheduleEvaluate());
    watcherMaid.Give(() => {
      Global.Event.unListen(id);
    });
  }

  watcherMaid.Give($npvLyricsOpen.listen(() => scheduleEvaluate()));
  watcherMaid.Give($npvLyricsExpanded.listen(() => scheduleEvaluate()));
  watcherMaid.Give($currentLyricsData.listen(() => scheduleEvaluate()));
  watcherMaid.Give($hideNpvLyricsWhenUnavailable.listen(() => scheduleEvaluate()));
  watcherMaid.Give($disableNpvLyrics.listen(() => scheduleEvaluate()));

  Whentil.When(
    () =>
      document.querySelector(".Root__right-sidebar") ??
      document.querySelector(".Root"),
    () => {
      attachWatchers();
    }
  );
}
