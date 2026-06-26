import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import type { AutomergeUrl, Repo } from "@automerge/automerge-repo";
import {
  useDocHandle,
  createDocumentProjection,
} from "@automerge/automerge-repo-solid-primitives";
import { subscribe } from "@inkandswitch/patchwork-providers";
import type {
  PhysicalFrameConfig,
  CalibrationDoc,
  ControlMap,
  HostMode,
} from "./folder-datatype";
import type { AccountDoc } from "./account";
import {
  ensurePhysicalFrameConfig,
  ensureRootFolder,
  DEFAULT_SIDEBAR_TOOL_ID,
} from "./account";
import type { ControlState } from "./controls";
import {
  addSystem,
  currentSystem,
  firstSystemId,
  loadCurrentSystemId,
  saveCurrentSystemId,
} from "./systems";
import { createCamera } from "./camera";
import { ControlPanel } from "./ControlPanel";
import { SetupPhase } from "./setup/SetupPhase";
import { SampleBackgroundPhase } from "./sample/SampleBackgroundPhase";
import { UseStage } from "./use/UseStage";
import type { DocHandle } from "@automerge/automerge-repo";

// Inline so a host-app `button` reset can't collapse the chrome buttons to 0×0
// (the cause of the earlier invisible/unclickable chrome).
const CHROME_BTN_STYLE: Record<string, string> = {
  height: "2rem",
  "min-width": "2rem",
  padding: "0 0.6rem",
  display: "inline-flex",
  "align-items": "center",
  "justify-content": "center",
  font: "inherit",
  "font-size": "0.9rem",
  "line-height": "1",
  cursor: "pointer",
  background: "var(--studio-fill, #fff)",
  color: "var(--studio-line, #111)",
  border: "1px solid var(--studio-fill-offset-20, #ccc)",
  "border-radius": "4px",
  "pointer-events": "auto",
};

export function App(props: {
  accountHandle: DocHandle<AccountDoc>;
  repo: Repo;
  element: HTMLElement;
}) {
  const repo = props.repo;
  const accountUrl = props.accountHandle.url;

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

  // Ensure the frame's config subdoc exists on the account; create lazily once.
  const [configUrl] = createResource(async () =>
    ensurePhysicalFrameConfig(props.accountHandle, repo),
  );
  const configHandle = useDocHandle<PhysicalFrameConfig>(() => configUrl() ?? undefined);
  const config = createDocumentProjection<PhysicalFrameConfig>(configHandle);

  // Ensure the account's root folder so the sidebar can list/create docs.
  void ensureRootFolder(props.accountHandle, repo);

  // The account sidebar tool (default chee/sideboard). Read reactively from the
  // account doc so a configured override wins.
  const accountDoc = createDocumentProjection<AccountDoc>(
    useDocHandle<AccountDoc>(() => props.accountHandle.url),
  );
  const sidebarToolId = () =>
    accountDoc()?.accountSidebarToolId ?? DEFAULT_SIDEBAR_TOOL_ID;

  // ---- Current system (per-frame-instance; localStorage-persisted) ---------
  const [systemId, setSystemId] = createSignal<string | null>(
    loadCurrentSystemId(accountUrl),
  );
  const selectSystem = (id: string) => {
    saveCurrentSystemId(accountUrl, id);
    setSystemId(id);
  };

  // Ensure at least one system exists, and a current selection. Auto-creates a
  // default "System 1" the first time, so a fresh account behaves like a single
  // rig without the user having to add one.
  let ensuringSystem = false;
  createEffect(() => {
    const cfg = config();
    const handle = configHandle();
    if (!cfg || !handle || ensuringSystem) return;
    const ids = Object.keys(cfg.systems ?? {});
    if (ids.length === 0) {
      ensuringSystem = true;
      void addSystem(handle, repo, "System 1")
        .then((id) => selectSystem(id))
        .finally(() => (ensuringSystem = false));
      return;
    }
    // If our selected id is missing/unknown, fall back to the first system.
    if (!systemId() || !cfg.systems[systemId()!]) {
      selectSystem(firstSystemId(cfg)!);
    }
  });

  const system = createMemo(() => currentSystem(config(), systemId()));
  const controls = createMemo<ControlMap>(() => system()?.controls ?? {});

  // The current system's calibration doc.
  const calibrationUrl = createMemo<AutomergeUrl | undefined>(
    () => system()?.calibrationUrl ?? undefined,
  );
  const calHandle = useDocHandle<CalibrationDoc>(() => calibrationUrl());
  const calDoc = createDocumentProjection<CalibrationDoc>(calHandle);

  // Phase 3.5 quick fix: default to "use" (not "setup") so the main document
  // area + camera loop + apriltags reader + physical controls run by default —
  // controls need the loop running regardless of any "mode". (Modes are being
  // dismantled; setup/sample stay reachable via the panel until Phase 4 extracts
  // calibration into its own tool.) The camera loop runs uncalibrated too
  // (presence-only), which is exactly what control tags need.
  const mode = createMemo<HostMode>(() => {
    const m = config()?.hostMode;
    return m === "setup" || m === "sample" ? m : "use";
  });

  // Calibration must be solved before Sample/Use are usable.
  const calibrated = createMemo(() => !!calDoc()?.homographyCamToBoard);

  const setHostMode = (m: HostMode) => {
    if ((m === "sample" || m === "use") && !calibrated()) return; // gate behind calibration
    // Use needs a sampled background (for the marks layer) → nudge to Sample first.
    if (m === "use" && !background()) m = "sample";
    configHandle()?.change((d) => {
      d.hostMode = m;
    });
  };

  const requestFullscreen = () => {
    props.element.requestFullscreen?.().catch(() => {});
  };

  // ---- Selected document (via SelectedDocProvider) -------------------------
  // The account sidebar dispatches `patchwork:open-document`, which the
  // `patchwork-selected-doc-provider` wrapper turns into `patchwork:selected-view`.
  // We subscribe from an element INSIDE that wrapper to learn the current
  // { url, toolId } and feed it to the box.
  //
  // IMPORTANT: the provider component loads ASYNC and attaches its
  // `patchwork:subscribe` listener only once mounted. `subscribe()` is one-shot,
  // so subscribing too early drops the request forever (selection never arrives).
  // Mirror patchwork-frame: wait for the provider's `patchwork:mounted` event
  // (with matching componentId) before subscribing.
  type SelectedView = { url: AutomergeUrl; toolId: string | null };
  const [selectedView, setSelectedView] = createSignal<SelectedView | null>(
    null,
  );
  let selectionEl!: HTMLDivElement;
  let selectedDocProviderEl!: HTMLElement;
  const [selectedDocProviderReady, setSelectedDocProviderReady] =
    createSignal(false);
  onMount(() => {
    const onMounted = (event: Event) => {
      const detail = (event as CustomEvent<{ componentId?: string }>).detail;
      if (detail?.componentId !== "patchwork-selected-doc-provider") return;
      setSelectedDocProviderReady(true);
    };
    selectedDocProviderEl.addEventListener("patchwork:mounted", onMounted);
    onCleanup(() =>
      selectedDocProviderEl.removeEventListener("patchwork:mounted", onMounted),
    );
  });
  // Subscribe only once the provider is ready (re-runs when readiness flips).
  createEffect(() => {
    if (!selectedDocProviderReady()) return;
    const off = subscribe<SelectedView | null>(
      selectionEl,
      { type: "patchwork:selected-view" },
      (view) => setSelectedView(view),
    );
    onCleanup(off);
  });
  const selectedDocUrl = () => selectedView()?.url ?? undefined;
  const selectedToolId = () => selectedView()?.toolId ?? undefined;

  // Control state (resolved from reserved-tag presence inside UseStage) is
  // reported up here so App can drive frame-level layout — chiefly the account
  // sidebar's visibility via the left-sidebar control.
  const [controlState, setControlState] = createSignal<ControlState>({
    setup: false,
    "hide-controls": false,
    "left-sidebar": false,
  });
  // Hide frame chrome (control panel + top-right buttons) for a clean projector
  // view — driven by the hide-controls control tag.
  const hideControls = () => controlState()["hide-controls"];

  // One-time startup gesture: camera start AND browser fullscreen both require a
  // user gesture (can't be auto-triggered on load). Show a "Start projecting"
  // overlay; clicking it (the gesture) starts the camera + enters fullscreen.
  const [started, setStarted] = createSignal(false);
  const startProjecting = () => {
    setStarted(true);
    if (!camera.active()) void camera.start(camera.deviceId());
    void props.element.requestFullscreen?.().catch(() => {});
  };
  // Manual sidebar override (button in the panel) — usable while control tags
  // are being debugged. Sidebar is open if the control tag OR the manual toggle
  // says so.
  const [manualSidebar, setManualSidebar] = createSignal(false);
  const sidebarOpen = () => controlState()["left-sidebar"] || manualSidebar();

  return (
    // SelectedDocProvider wraps the whole frame: the sidebar's
    // `patchwork:open-document` events bubble up to it, and our
    // `patchwork:selected-view` subscription (on .sph-root inside) reads back
    // the current selection. `patchwork-view` defaults to display:contents (no
    // box) — but .sph-root uses position:absolute;inset:0, which then resolves
    // against an ancestor that collapses to 0 height. So give THIS wrapper an
    // explicit sized, positioned box to be .sph-root's containing block.
    <patchwork-view
      component="patchwork-selected-doc-provider"
      ref={selectedDocProviderEl}
      style={{
        display: "block",
        position: "relative",
        width: "100%",
        // The mount element collapses to 0 height in this host, so percentage /
        // inset chains bottom out at 0. A physical frame fills the projected
        // screen, so anchor to the viewport height directly (robust regardless
        // of the parent chain). min-height keeps it from collapsing.
        height: "100dvh",
        "min-height": "100dvh",
      }}
    >
    <div class="sph-root" ref={selectionEl}>
      {/* Startup overlay: one click to start the camera + enter fullscreen
          (both need a user gesture, so they can't auto-run on load). */}
      <Show when={configHandle() && config() && !started()}>
        <div class="sph-start-overlay">
          <button class="sph-start-button" onClick={startProjecting}>
            ▶ Start projecting
          </button>
          <div class="sph-start-hint">Starts the camera and goes fullscreen</div>
        </div>
      </Show>

      <Show
        when={configHandle() && config() && calHandle()}
        fallback={<div class="sph-loading">Preparing physical frame…</div>}
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
            <SampleBackgroundPhase
              calDoc={calDoc()!}
              hostDoc={config()!}
              camera={camera}
            />
          </Match>
          <Match when={mode() === "use"}>
            <UseStage
              hostHandle={configHandle()!}
              hostDoc={config()!}
              calDoc={calDoc()!}
              repo={repo}
              camera={camera}
              getBackground={background}
              controls={controls()}
              selectedDocUrl={selectedDocUrl}
              selectedToolId={selectedToolId}
              onControlState={setControlState}
            />
          </Match>
        </Switch>
      </Show>

      {/* Frame-level chrome — always available, not tied to any mode.
          • Camera toggle: nothing physical works until the camera stream is
            started (getUserMedia needs a user gesture), so this is a top-level
            control. Camera on → the loop runs → apriltags + physical controls.
          • Sidebar toggle: the manual equivalent of the left-sidebar control tag.
          Hidden while the hide-controls control is active (clean projector view). */}
      <Show when={configHandle() && config() && !hideControls()}>
        <div
          class="sph-frame-chrome"
          style={{
            position: "absolute",
            top: "0.4rem",
            right: "0.4rem",
            "z-index": "41",
            display: "flex",
            gap: "0.35rem",
            "pointer-events": "auto",
          }}
        >
          <button
            style={CHROME_BTN_STYLE}
            data-active={camera.active() ? "" : undefined}
            title={camera.active() ? "Stop camera" : "Start camera"}
            onClick={() => camera.toggle()}
          >
            {camera.active() ? "◉ Camera" : "○ Camera"}
          </button>
          <button
            style={CHROME_BTN_STYLE}
            data-active={sidebarOpen() ? "" : undefined}
            title={sidebarOpen() ? "Hide documents" : "Show documents"}
            onClick={() => setManualSidebar((v) => !v)}
          >
            ☰
          </button>
        </div>
      </Show>

      {/* Account sidebar — the real document navigation + create-new (sideboard).
          Open via the left-sidebar control tag or the toggle above; when open it
          overlays the document area (one thing active at a time). Dispatches
          patchwork:open-document, caught by the SelectedDocProvider wrapper. The
          embedded document stays mounted underneath, just covered. */}
      <Show when={sidebarOpen()}>
        <div class="sph-account-sidebar">
          <patchwork-view
            attr:tool-id={sidebarToolId()}
            attr:doc-url={props.accountHandle.url}
          />
        </div>
      </Show>

      {/* The panel reads the config doc (barPosition, surfaceBrightness, …), so
          only render it once the config subdoc has loaded — it's lazily created
          on first mount and is undefined for the first frame(s). Hidden while the
          hide-controls control is active (clean projector view). */}
      <Show when={configHandle() && config() && !hideControls()}>
        <ControlPanel
          hostHandle={configHandle()!}
          hostDoc={config()!}
          calHandle={calHandle()}
          calDoc={calDoc()}
          repo={repo}
          mode={mode()}
          setHostMode={setHostMode}
          requestFullscreen={requestFullscreen}
          camera={camera}
          calibrated={calibrated()}
          hasBackground={!!background()}
          config={config()}
          configHandle={configHandle()}
          currentSystemId={systemId()}
          onSelectSystem={selectSystem}
          onAddSystem={(name: string) => {
            const handle = configHandle();
            if (handle) void addSystem(handle, repo, name).then(selectSystem);
          }}
          onSample={() => {
            const g = camera.grabGray();
            // Only overwrite on a successful grab; a null grab (camera not ready)
            // shouldn't silently clear an existing reference.
            if (g) setBackground(g);
            else
              console.warn(
                "[physical-frame] background sample failed — camera not ready?",
                { active: camera.active(), liveSize: camera.getLiveSize() },
              );
          }}
        />
      </Show>
    </div>
    </patchwork-view>
  );
}
