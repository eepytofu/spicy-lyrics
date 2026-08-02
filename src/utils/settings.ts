import React from "react";
import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import SettingsPanel from "../components/ReactComponents/SettingsPanel/index.tsx";
import ExperimentsPanel from "../components/ReactComponents/SettingsPanel/ExperimentsPanel.tsx";

const MODAL_ID = "settingsPanel";

function renderPanel(element: React.ReactElement, direction?: "forward" | "back") {
  const container = document.createElement("div");
  container.className = direction ? `sl-sp-page sl-sp-page--${direction}` : "sl-sp-page";
  const root = ReactDOM.createRoot(container);
  flushSync(() => root.render(element));
  return { container, root };
}

export function openSettingsPanel() {
  const { container, root } = renderPanel(
    React.createElement(SettingsPanel, { onOpenExperiments: openExperimentsPanel })
  );
  PopupModal.display({
    title: "Settings",
    content: container,
    isLarge: true,
    modalId: MODAL_ID,
    onClose: () => {
      root.unmount();
    },
  });
}

function backToSettings() {
  const { container, root } = renderPanel(
    React.createElement(SettingsPanel, { onOpenExperiments: openExperimentsPanel }),
    "back"
  );
  PopupModal.transition({
    title: "Settings",
    content: container,
    modalId: MODAL_ID,
    onClose: () => root.unmount(),
  });
}

export function openExperimentsPanel() {
  const { container, root } = renderPanel(
    React.createElement(ExperimentsPanel, { onBack: backToSettings }),
    "forward"
  );
  PopupModal.transition({
    title: "Experiments",
    content: container,
    modalId: MODAL_ID,
    onClose: () => root.unmount(),
  });
}
