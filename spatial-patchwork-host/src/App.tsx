import { createMemo, createResource, onCleanup, Show } from "solid-js";
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
import { UseStage } from "./use/UseStage";

export function App(props: {
  handle: DocHandle<SpatialHostDoc>;
  element: HTMLElement;
}) {
  const repo = useRepo() as Repo;
  const doc = makeDocumentProjection<SpatialHostDoc>(props.handle);

  // Single shared camera (panel toggle + setup capture + use detector).
  const camera = createCamera();
  onCleanup(() => camera.dispose());

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

  const mode = createMemo(() => (doc.hostMode === "use" ? "use" : "setup"));

  const setHostMode = (m: "setup" | "use") =>
    props.handle.change((d) => {
      d.hostMode = m;
    });

  const requestFullscreen = () => {
    props.element.requestFullscreen?.().catch(() => {});
  };

  return (
    <div class="sph-root">
      <Show
        when={calHandle()}
        fallback={<div class="sph-loading">Preparing calibration…</div>}
      >
        <Show
          when={mode() === "use"}
          fallback={
            <SetupPhase
              calHandle={calHandle()!}
              calDoc={calDoc()!}
              camera={camera}
            />
          }
        >
          <UseStage
            hostHandle={props.handle}
            hostDoc={doc}
            calDoc={calDoc()!}
            repo={repo}
            camera={camera}
          />
        </Show>
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
      />
    </div>
  );
}
