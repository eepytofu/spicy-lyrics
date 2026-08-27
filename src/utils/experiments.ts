import { persistAtom } from "./stores.ts";

export type Experiment = {
  id: string;
  label: string;
  description: string;
  default: boolean;
  pageClass?: string;
};

export const EXPERIMENTS = [
  {
    id: "disableKuromoji",
    label: "Disable Kuromoji",
    description: "Diagnostic hard-off for local Japanese readings. Only exact provider readings remain visible.",
    default: false,
    pageClass: undefined,
  },
  {
    id: "disableProviderReadings",
    label: "Disable Provider Readings",
    description: "Ignore provider-supplied Japanese readings so local Kuromoji output can be inspected independently.",
    default: false,
    pageClass: undefined,
  },
  {
    id: "highlightProviderReadings",
    label: "Highlight Provider Readings",
    description: "Tint provider-supplied Japanese readings gold for diagnostics.",
    default: false,
    pageClass: "Exp_HighlightProviderReadings",
  },
  {
    id: "newProgressBarStyling",
    label: "New SliderBar Styling",
    description: "New glass-like style for the SliderBar. Disable to revert back to the original one.",
    default: true,
    pageClass: "Exp_NewProgressBar",
  },
] as const satisfies readonly Experiment[];

export type RegisteredExperiment = (typeof EXPERIMENTS)[number];
export type ExperimentId = RegisteredExperiment["id"];

const makeStore = (key: string, defaultValue: boolean) => persistAtom<boolean>(key, defaultValue);
type ExperimentStore = ReturnType<typeof makeStore>;
const stores = new Map<string, ExperimentStore>(
  EXPERIMENTS.map((experiment) => [
    experiment.id,
    makeStore(`experiment:${experiment.id}`, experiment.default),
  ])
);

export function $experiment(id: ExperimentId): ExperimentStore {
  const store = stores.get(id);
  if (!store) throw new Error(`Unknown experiment "${id}"`);
  return store;
}

export function isExperimentEnabled(id: ExperimentId): boolean {
  return stores.get(id)?.get() ?? false;
}

export function ApplyExperimentClasses(element: HTMLElement): void {
  for (const experiment of EXPERIMENTS) {
    if (experiment.pageClass) {
      element.classList.toggle(experiment.pageClass, isExperimentEnabled(experiment.id));
    }
  }
}

export function onExperimentChange(callback: (experiment: Experiment) => void): void {
  for (const experiment of EXPERIMENTS) {
    stores.get(experiment.id)?.listen(() => callback(experiment));
  }
}
