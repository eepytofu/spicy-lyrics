import ReactDOM from "react-dom/client";
import { flushSync } from "react-dom";
import { PopupModal } from "../components/Modal.ts";
import LyricsChooser from "../components/ReactComponents/LyricsChooser.tsx";

export function OpenChooseLyrics(): void {
  const targetDocument = PopupModal.ownerDocument ?? document;
  const container = targetDocument.createElement("div");
  const root = ReactDOM.createRoot(container);
  const close = () => PopupModal.hide();

  flushSync(() => {
    root.render(<LyricsChooser onClose={close} />);
  });

  PopupModal.display({
    title: "Choose Lyrics",
    content: container,
    isLarge: true,
    modalId: "lyricsChooser",
    targetDocument,
    onClose: () => root.unmount(),
  });
}
