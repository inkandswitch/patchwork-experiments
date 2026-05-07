import { useDocument, AutomergeUrl } from "@automerge/react/slim";
import { useState } from "react";
import { SequencerDoc, Toggle } from "./datatype";
import { Player } from "./components/Player";
import { UIGrid } from "./components/SequencerGrid";
import { SongConfigurator } from "./components/SongConfigurator";
import {
  InstrumentSamplePlayerConfig,
  sampleInstrumentConfigs,
} from "./music/sample-instrument";
import {
  DRUM_PIECES_COUNT,
  drumConfigs,
  DrumSamplePlayerConfig,
} from "./music/drum";
import { toggleFn } from "./music/toggle-play";
import { globalInstrumentSchedulers } from "./music/instrument-scheduler";
import { SamplePlayer } from "./music/sample-player";
import { ROW_COUNT, SongConfig, totalStepsFromConfig } from "./config";
import { TinyPatchworkLayoutDoc } from "./patchwork-types";

type SequencerProps = {
  docUrl: AutomergeUrl;
};

function updateToggle(
  toggleRows: Toggle[][],
  x: number,
  y: number,
  isToggled: boolean,
  contactUrl: AutomergeUrl | null
) {
  toggleRows[y][x].toggled = isToggled;
  if (isToggled) {
    toggleRows[y][x].contactUrl = contactUrl;
    toggleRows[y][x].toggleOnTime = Date.now();
  } else {
    toggleRows[y][x].contactUrl = null;
    toggleRows[y][x].toggleOnTime = 0;
  }
}

export const Sequencer = ({ docUrl }: SequencerProps) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playStartTime, setPlayStartTime] = useState(0);
  const [playingIdx, setPlayingIdx] = useState(0);
  const [instrumentVolume, setInstrumentVolume] = useState(1.0);
  const [drumVolume, setDrumVolume] = useState(1.0);
  const [overridingInstrumentChosen, setOverridingInstrumentChosen] =
    useState(false);

  const [doc, changeDoc] = useDocument<SequencerDoc>(docUrl, { suspense: true });

  // Get contactUrl from patchwork account doc
  const accountDocHandle = window.accountDocHandle;
  const [accountDoc] = useDocument<TinyPatchworkLayoutDoc>(accountDocHandle?.url);
  const userContactUrl = accountDoc?.contactUrl || null;

  if (!doc || !doc.config) {
    return <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>Loading...</div>;
  }

  // Backward compatibility: ensure stepsPerBar exists
  if (!doc.config.stepsPerBar) {
    changeDoc((d) => {
      if (d.config) {
        d.config.stepsPerBar = 8;
      }
    });
  }

  const fetchOverridingInstrument = (
    overridingInstrumentUrl: string
  ): boolean => {
    if (
      confirm(
        "WARNING: This song includes an external instrument script that could contain malicious code. Press cancel to use the default sample player instead. Only press OK if you know what you're doing."
      )
    ) {
      console.log(overridingInstrumentUrl);
      import(overridingInstrumentUrl)
        .then((mod) => {
          const weirdInst = new mod.PianoSynth();
          if (globalInstrumentSchedulers.length > 0) {
            globalInstrumentSchedulers[0].updateInstrument(weirdInst);
          }
          changeDoc((d) => {
            d.config.overridingInstrument = overridingInstrumentUrl;
          });
        })
        .catch((e) => {
          alert("Failed to load external instrument script:\n\n " + e);
        });
      return true;
    } else {
      return false;
    }
  };

  const togglePlay = toggleFn(
    doc.stepGrid,
    setPlayingIdx,
    setIsPlaying,
    setPlayStartTime,
    setOverridingInstrumentChosen,
    fetchOverridingInstrument,
    doc.config
  );

  const handleToggleChange = (isToggled: boolean, x: number, y: number) => {
    changeDoc((d) => {
      if (isToggled && d.config.isMonophonic) {
        d.toggleRows.forEach((row) => {
          row[x].toggled = false;
          row[x].contactUrl = null;
          row[x].toggleOnTime = 0;
        });
      }
      updateToggle(d.toggleRows, x, y, isToggled, userContactUrl);
    });
  };

  const handleDrumToggleChange = (isToggled: boolean, x: number, y: number) => {
    changeDoc((d) => {
      updateToggle(d.drumToggleRows, x, y, isToggled, userContactUrl);
      d.drumToggleRows[y][x].toggled = isToggled;
    });
  };

  const handleConfigChange = (updateConfig: (config: SongConfig) => void) => {
    changeDoc((d) => {
      updateConfig(d.config);
      if (globalInstrumentSchedulers.length > 0) {
        globalInstrumentSchedulers[0].updateConfig(d.config);
      }
    });
  };

  const toggleDirection = () => {
    changeDoc((d) => {
      if (!d.config.stepDirection) {
        d.config.stepDirection = 1;
      }
      d.config.stepDirection = 0 - d.config.stepDirection;
      if (globalInstrumentSchedulers.length > 0) {
        globalInstrumentSchedulers[0].updateConfig(d.config);
      }
    });
  };

  const handleInstrumentChange = (instrumentName: string) => {
    changeDoc((d) => {
      d.config.instrument = sampleInstrumentConfigs[instrumentName];
      if (globalInstrumentSchedulers.length > 0) {
        const instrumentSamplePlayerConfig = new InstrumentSamplePlayerConfig(
          d.config.instrument
        );
        const samplePlayer = new SamplePlayer(
          instrumentSamplePlayerConfig,
          instrumentVolume
        );
        globalInstrumentSchedulers[0].updateInstrument(samplePlayer);
      }
    });
  };

  const handleDrumChange = (drumName: string) => {
    changeDoc((d) => {
      d.config.drum = drumConfigs[drumName];
      if (globalInstrumentSchedulers.length > 0) {
        const drumSamplePlayerConfig = new DrumSamplePlayerConfig(d.config.drum);
        const drumSamplePlayer = new SamplePlayer(
          drumSamplePlayerConfig,
          drumVolume
        );
        globalInstrumentSchedulers[0].updateDrum(drumSamplePlayer);
      }
    });
  };

  const duplicateFirstBarDrums = (
    isPlaying: boolean,
    instrumentVolume: number,
    drumVolume: number
  ) => {
    if (isPlaying) {
      togglePlay(instrumentVolume, drumVolume, overridingInstrumentChosen);
    }
    changeDoc((d) => {
      const copyStepCount = d.config["stepsPerBar"] * d.config.bars;
      const offset1 = copyStepCount;
      const offset2 = copyStepCount * 2;
      const offset3 = copyStepCount * 3;
      for (let i = 0; i < copyStepCount; i++) {
        const drumStep = Object.assign({}, d.stepGrid[i]["drum"]);
        if (i + offset1 < d.stepGrid.length) {
          d.stepGrid[i + offset1]["drum"] = drumStep;
        }
        if (i + offset2 < d.stepGrid.length) {
          d.stepGrid[i + offset2]["drum"] = drumStep;
        }
        if (i + offset3 < d.stepGrid.length) {
          d.stepGrid[i + offset3]["drum"] = drumStep;
        }
      }
      d.drumToggleRows.forEach((row) => {
        for (let i = 0; i < copyStepCount; i++) {
          const v = Object.assign({}, row[i]);
          if (i + offset1 < d.stepGrid.length) {
            row[i + offset1] = v;
          }
          if (i + offset2 < d.stepGrid.length) {
            row[i + offset2] = v;
          }
          if (i + offset3 < d.stepGrid.length) {
            row[i + offset3] = v;
          }
        }
      });
    });
  };

  const duplicateFirstBarNotes = (
    isPlaying: boolean,
    instrumentVolume: number,
    drumVolume: number
  ) => {
    if (isPlaying) {
      togglePlay(instrumentVolume, drumVolume, overridingInstrumentChosen);
    }
    changeDoc((d) => {
      const copyStepCount = d.config["stepsPerBar"] * d.config.bars;
      const offset1 = copyStepCount;
      const offset2 = copyStepCount * 2;
      const offset3 = copyStepCount * 3;
      for (let i = 0; i < copyStepCount; i++) {
        const instStep = Object.assign({}, d.stepGrid[i]["instrument"]);
        if (i + offset1 < d.stepGrid.length) {
          d.stepGrid[i + offset1]["instrument"] = instStep;
        }
        if (i + offset2 < d.stepGrid.length) {
          d.stepGrid[i + offset2]["instrument"] = instStep;
        }
        if (i + offset3 < d.stepGrid.length) {
          d.stepGrid[i + offset3]["instrument"] = instStep;
        }
      }
      d.toggleRows.forEach((row) => {
        for (let i = 0; i < copyStepCount; i++) {
          const v = Object.assign({}, row[i]);
          if (i + offset1 < d.stepGrid.length) {
            row[i + offset1] = v;
          }
          if (i + offset2 < d.stepGrid.length) {
            row[i + offset2] = v;
          }
          if (i + offset3 < d.stepGrid.length) {
            row[i + offset3] = v;
          }
        }
      });
    });
  };

  const clearGrid = (
    isPlaying: boolean,
    instrumentVolume: number,
    drumVolume: number
  ) => {
    if (!confirm("WARNING: Are you sure you want to clear the entire grid?")) {
      return;
    }
    if (isPlaying) {
      togglePlay(instrumentVolume, drumVolume, overridingInstrumentChosen);
    }
    changeDoc((d) => {
      d.toggleRows.forEach((row) => {
        row.forEach((toggle) => (toggle.toggled = false));
      });
      d.drumToggleRows.forEach((row) => {
        row.forEach((toggle) => (toggle.toggled = false));
      });
    });
  };

  const resetGrid = (
    isPlaying: boolean,
    instrumentVolume: number,
    drumVolume: number
  ) => {
    if (isPlaying) {
      togglePlay(instrumentVolume, drumVolume, overridingInstrumentChosen);
    }
    changeDoc((d) => {
      const totalSteps = totalStepsFromConfig(d.config);
      d.toggleRows = Array.from({ length: ROW_COUNT }, () =>
        Array.from({ length: totalSteps }, () => ({
          toggled: false,
          contactUrl: null,
          toggleOnTime: 0,
        }))
      );
      d.drumToggleRows = Array.from({ length: DRUM_PIECES_COUNT }, () =>
        Array.from({ length: totalSteps }, () => ({
          toggled: false,
          contactUrl: null,
          toggleOnTime: 0,
        }))
      );
      d.stepGrid = Array.from({ length: totalSteps }, () => ({
        instrument: {},
        drum: {},
      }));
    });
  };

  return (
    <div className="page" style={{ width: "100%", height: "100%", overflow: "hidden", position: "relative" }}>
      <Player
        title={doc.title}
        toggleRows={doc.toggleRows}
        drumToggleRows={doc.drumToggleRows}
        stepGrid={doc.stepGrid}
        config={doc.config}
        instrumentVolume={instrumentVolume}
        setInstrumentVolume={setInstrumentVolume}
        drumVolume={drumVolume}
        setDrumVolume={setDrumVolume}
        overridingInstrumentChosen={overridingInstrumentChosen}
        togglePlay={togglePlay}
        toggleDirection={toggleDirection}
        isPlaying={isPlaying}
      />
      <UIGrid
        toggleRows={doc.toggleRows}
        drumToggleRows={doc.drumToggleRows}
        handleToggleChange={handleToggleChange}
        handleDrumToggleChange={handleDrumToggleChange}
        playingIdx={playingIdx}
        playStartTime={playStartTime}
        isPlaying={isPlaying}
        config={doc.config}
      />
      <div className="clear-block"></div>
      <SongConfigurator
        config={doc.config}
        isPlaying={isPlaying}
        instrumentVolume={instrumentVolume}
        drumVolume={drumVolume}
        handleConfigChange={handleConfigChange}
        handleInstrumentChange={handleInstrumentChange}
        handleDrumChange={handleDrumChange}
        duplicateFirstBarNotes={duplicateFirstBarNotes}
        duplicateFirstBarDrums={duplicateFirstBarDrums}
        fetchOverridingInstrument={fetchOverridingInstrument}
        setOverridingInstrumentChosen={setOverridingInstrumentChosen}
        clearGrid={clearGrid}
        resetGrid={resetGrid}
      />
      <div className="clear-block"></div>
    </div>
  );
};
