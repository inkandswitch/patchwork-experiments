import { AutomergeUrl } from "@automerge/automerge-repo";
import {
  defaultSongConfig,
  ROW_COUNT,
  SongConfig,
  totalStepsFromConfig,
} from "./config";
import { Step } from "./music/instrument-scheduler";
import { DRUM_PIECES_COUNT } from "./music/drum";


export type SequencerDoc = {
  title: string;
  toggleRows: Toggle[][];
  drumToggleRows: Toggle[][];
  stepGrid: Step[];
  config: SongConfig;
};

export type Toggle = {
  toggled: boolean;
  // User's contactUrl from patchwork-next account doc
  contactUrl: AutomergeUrl | null;
  toggleOnTime: number;
};

export const init = (doc: SequencerDoc) => {
  const config: SongConfig = defaultSongConfig();
  const totalSteps = totalStepsFromConfig(config);

  doc.title = "Untitled Song";
  doc.toggleRows = Array.from({ length: ROW_COUNT }, () =>
    Array.from({ length: totalSteps }, () => ({
      toggled: false,
      contactUrl: null,
      toggleOnTime: 0,
    }))
  );
  doc.drumToggleRows = Array.from({ length: DRUM_PIECES_COUNT }, () =>
    Array.from({ length: totalSteps }, () => ({
      toggled: false,
      contactUrl: null,
      toggleOnTime: 0,
    }))
  );
  doc.stepGrid = Array.from({ length: totalSteps }, () => ({
    instrument: {},
    drum: {},
  }));
  doc.config = config;
};

// Returns a default SequencerDoc object for use with repo.create()
export const defaultSequencerDoc = (): SequencerDoc => {
  const config: SongConfig = defaultSongConfig();
  const totalSteps = totalStepsFromConfig(config);

  return {
    title: "Untitled Song",
    toggleRows: Array.from({ length: ROW_COUNT }, () =>
      Array.from({ length: totalSteps }, () => ({
        toggled: false,
        contactUrl: null,
        toggleOnTime: 0,
      }))
    ),
    drumToggleRows: Array.from({ length: DRUM_PIECES_COUNT }, () =>
      Array.from({ length: totalSteps }, () => ({
        toggled: false,
        contactUrl: null,
        toggleOnTime: 0,
      }))
    ),
    stepGrid: Array.from({ length: totalSteps }, () => ({
      instrument: {},
      drum: {},
    })),
    config,
  };
};

const getTitle = (doc: SequencerDoc) => {
  return doc.title || "Mystery Song";
};

const setTitle = (doc: SequencerDoc, title: string) => {
  doc.title = title;
};

export const dataType = {
  init,
  getTitle,
  setTitle,
};
