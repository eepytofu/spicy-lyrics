import { $simpleLyricsMode } from "../../../../utils/stores.ts";
import { ArabicPersianRegex } from "../../../Addons.ts";
import { IdleEmphasisLetterScale } from "../../Animator/Shared.ts";
import { ConvertTime } from "../../ConvertTime.ts";
import { CurrentLineLyricsObject, LyricsObject } from "../../lyrics.ts";
import { distributeEmphasisTiming } from "./EmphasisTiming.ts";

const emphasisTimingOffsets = () => ({
  startTime: $simpleLyricsMode.get() ? -21 : 0,
  endTime: $simpleLyricsMode.get() ? -40 : 250,
});

interface LetterData {
  HTMLElement: HTMLElement;
  StartTime: number;
  EndTime: number;
  TotalTime: number;
  Emphasis: boolean;
  BGLetter?: boolean;
}

export interface EmphasisRenderUnit {
  HTMLElement: HTMLElement;
  /** Number of source glyphs represented by this visual unit. */
  Length: number;
}

const applyEmphasisUnits = (
  units: EmphasisRenderUnit[],
  applyTo: HTMLElement,
  lead: any,
  isBgWord: boolean,
): void => {
  const timingOffsets = emphasisTimingOffsets();
  const StartTime = ConvertTime(lead.StartTime) - timingOffsets.startTime;
  const EndTime = ConvertTime(lead.EndTime) - timingOffsets.endTime;
  const totalDuration = EndTime - StartTime;
  const word = applyTo;
  const Letters: LetterData[] = [];
  const timingWindows = distributeEmphasisTiming(
    StartTime,
    EndTime,
    units.map((unit) => unit.Length),
  );

  if (ArabicPersianRegex.test(lead.Text)) {
    word.setAttribute("font", "Vazirmatn");
  }

  units.forEach((unit, index) => {
    const letterElem = unit.HTMLElement;
    const timing = timingWindows[index];

    letterElem.classList.add("letter", "Emphasis");
    if ((letterElem.textContent ?? "").trim().length === 0) {
      letterElem.classList.add("SpaceLetter");
    }
    if (index === units.length - 1) {
      letterElem.classList.add("LastLetterInWord");
    }

    Letters.push({
      HTMLElement: letterElem,
      StartTime: timing.StartTime,
      EndTime: timing.EndTime,
      TotalTime: timing.EndTime - timing.StartTime,
      Emphasis: true,
      ...(isBgWord ? { BGLetter: true } : {}),
    });

    if (!$simpleLyricsMode.get()) {
      letterElem.style.setProperty("--gradient-position", "-20%");
    }
    letterElem.style.setProperty("--text-shadow-opacity", "0%");
    letterElem.style.setProperty("--text-shadow-blur-radius", "4px");
    letterElem.style.scale = IdleEmphasisLetterScale.toString();
    letterElem.style.transform = `translateY(calc(var(--DefaultLyricsSize) * 0.02))`;
  });

  word.classList.add("letterGroup");

  if (
    CurrentLineLyricsObject >= 0 &&
    LyricsObject.Types.Syllable.Lines?.[CurrentLineLyricsObject].Syllables
  ) {
    LyricsObject.Types.Syllable.Lines[CurrentLineLyricsObject].Syllables.Lead.push({
      HTMLElement: word,
      StartTime: StartTime,
      EndTime: EndTime,
      TotalTime: totalDuration,
      LetterGroup: true,
      Letters,
      ...(isBgWord ? { BGWord: true } : {}),
    });
  } else {
    console.warn(
      "Cannot add letter group: CurrentLineLyricsObject is invalid or Syllables.Lead doesn't exist"
    );
  }
};

/** Register already-rendered base/ruby units with the legacy letter animator. */
export function EmphasizeRenderedUnits(
  units: EmphasisRenderUnit[],
  applyTo: HTMLElement,
  lead: any,
  isBgWord: boolean = false,
): void {
  applyEmphasisUnits(units, applyTo, lead, isBgWord);
}

export default function Emphasize(
  letters: Array<string>,
  applyTo: HTMLElement,
  lead: any,
  isBgWord: boolean = false
) {
  const units = letters.map((letter) => {
    const letterElem = document.createElement("span");
    letterElem.textContent = letter;
    applyTo.appendChild(letterElem);
    return { HTMLElement: letterElem, Length: 1 };
  });
  applyEmphasisUnits(units, applyTo, lead, isBgWord);
}
