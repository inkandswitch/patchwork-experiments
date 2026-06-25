import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import type { AutomergeUrl, DocHandle, Repo } from "@automerge/automerge-repo";
import {
  makeDocumentProjection,
  useDocHandle,
  createDocumentProjection,
  useRepo,
} from "@automerge/automerge-repo-solid-primitives";
import {
  getRegistry,
  createDocOfDatatype2,
} from "@inkandswitch/patchwork-plugins";
import type {
  SpatialHostDoc,
  CalibrationDoc,
} from "./folder-datatype";
import { CALIBRATION_DATATYPE_ID } from "./folder-datatype";
import { createCamera } from "./camera";
import { ControlPanel } from "./ControlPanel";
import { SetupPhase } from "./setup/SetupPhase";
import { SampleBackgroundPhase } from "./sample/SampleBackgroundPhase";
import { UseStage } from "./use/UseStage";
import type { HostMode } from "./folder-datatype";

export function App(props: {
  handle: DocHandle<SpatialHostDoc>;
  element: HTMLElement;
}) {
  const repo = useRepo() as Repo;
  const doc = makeDocumentProjection<SpatialHostDoc>(props.handle);

  // Single shared camera (panel toggle + setup capture + use detector).
  const camera = createCamera();
  onCleanup(() => camera.dispose());

  // Ephemeral, per-instance empty-surface background reference (downscaled
  // grayscale). Sampled in the Sample phase, read by the Use frame loop. Never
  // persisted. Switching camera device invalidates it.
  const [background, setBackground] = createSignal<Uint8Array | null>(null);
  let lastDeviceId: string | undefined = camera.deviceId();
  createEffect(() => {
    const id = camera.deviceId();
    if (id !== lastDeviceId) {
      lastDeviceId = id;
      setBackground(null);
    }
  });

  // Ensure the dedicated calibration doc exists; create it lazily once.
  const [calibrationUrl] = createResource<AutomergeUrl, string>(
    () => doc.calibrationUrl ?? "__create__",
    async (marker): Promise<AutomergeUrl> => {
      if (marker !== "__create__") return marker as AutomergeUrl;
      const dt = await getRegistry("patchwork:datatype").loadWhenReady(
        CALIBRATION_DATATYPE_ID,
      );
      const created = await createDocOfDatatype2(dt as never, repo);
      props.handle.change((d) => {
        d.calibrationUrl = created.url;
      });
      return created.url;
    },
  );

  // Reactive calibration handle + doc.
  const calHandle = useDocHandle<CalibrationDoc>(() => calibrationUrl());
  const calDoc = createDocumentProjection<CalibrationDoc>(calHandle);

  // Flow is Setup → Sample → Use.
  const mode = createMemo<HostMode>(() =>
    doc.hostMode === "use" || doc.hostMode === "sample" ? doc.hostMode : "setup",
  );

  // Calibration must be solved before Sample/Use are usable.
  const calibrated = createMemo(() => !!calDoc()?.homographyCamToBoard);

  const setHostMode = (m: HostMode) => {
    if ((m === "sample" || m === "use") && !calibrated()) return; // gate behind calibration
    // Use needs a sampled background (for the walls layer) → nudge to Sample first.
    if (m === "use" && !background()) m = "sample";
    props.handle.change((d) => {
      d.hostMode = m;
    });
  };

  const requestFullscreen = () => {
    props.element.requestFullscreen?.().catch(() => {});
  };

  return (
    <div class="sph-root">
      <Show
        when={calHandle()}
        fallback={<div class="sph-loading">Preparing calibration…</div>}
      >
        <Switch
          fallback={
            <SetupPhase
              calHandle={calHandle()!}
              calDoc={calDoc()!}
              camera={camera}
            />
          }
        >
          <Match when={mode() === "sample"}>
            <SampleBackgroundPhase calDoc={calDoc()!} camera={camera} />
          </Match>
          <Match when={mode() === "use"}>
            <UseStage
              hostHandle={props.handle}
              hostDoc={doc}
              calDoc={calDoc()!}
              repo={repo}
              camera={camera}
              getBackground={background}
            />
          </Match>
        </Switch>
      </Show>

      <ControlPanel
        hostHandle={props.handle}
        hostDoc={doc}
        calHandle={calHandle()}
        calDoc={calDoc()}
        repo={repo}
        mode={mode()}
        setHostMode={setHostMode}
        requestFullscreen={requestFullscreen}
        camera={camera}
        calibrated={calibrated()}
        hasBackground={!!background()}
        onSample={() => {
          const g = camera.grabGray();
          // Only overwrite on a successful grab; a null grab (camera not ready)
          // shouldn't silently clear an existing reference.
          if (g) setBackground(g);
          else
            console.warn(
              "[spatial-host] background sample failed — camera not ready?",
              { active: camera.active(), liveSize: camera.getLiveSize() },
            );
        }}
      />
    </div>
  );
}
