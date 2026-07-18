export const SOURCE_SETTINGS_COMMITTED_EVENT = "spicy-lyrics:source-settings-committed";

export function commitSourceSettingsChange(target: EventTarget = window): void {
  target.dispatchEvent(new Event(SOURCE_SETTINGS_COMMITTED_EVENT));
}

export function bindCoalescedSourceSettingsRefresh(
  refresh: () => void,
  target: EventTarget = window,
  delayMs = 180
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onCommit = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      refresh();
    }, delayMs);
  };

  target.addEventListener(SOURCE_SETTINGS_COMMITTED_EVENT, onCommit);
  return () => {
    target.removeEventListener(SOURCE_SETTINGS_COMMITTED_EVENT, onCommit);
    if (timer !== undefined) clearTimeout(timer);
  };
}
