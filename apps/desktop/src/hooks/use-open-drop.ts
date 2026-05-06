import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useEditorStore } from "@/stores/editor-store";
import { useSettingsStore } from "@/stores/settings-store";
import { mark } from "@/lib/startup-metrics";
import type { PendingOpenPayload } from "@/lib/tauri";
import * as tauri from "@/lib/tauri";

async function handleOpenPayload(payload: PendingOpenPayload) {
  const current = useWorkspaceStore.getState().root;

  if (payload.workspace !== current) {
    await useWorkspaceStore.getState().openWorkspace(payload.workspace);
  }
  if (payload.file) {
    const store = useEditorStore.getState();
    const alreadyOpen = store.tabs.some(
      (t) => t.location.kind === "file" && t.location.path === payload.file,
    );
    if (alreadyOpen) {
      store.setActiveFile(payload.file);
    } else {
      const activeTab = store.tabs.find((t) => t.id === store.activeTabId);
      if (activeTab?.location.kind === "launcher") {
        await store.replaceTabWithFile(activeTab.id, payload.file);
      } else {
        await store.openFileInNewTab(payload.file);
      }
    }
  }
}

let openTask: Promise<void> = Promise.resolve();

function queueOpenTask(task: () => Promise<void>) {
  const nextTask = openTask.then(task);
  openTask = nextTask.catch(() => {});
  return nextTask;
}

function queueOpenPayload(payload: PendingOpenPayload) {
  return queueOpenTask(() => handleOpenPayload(payload));
}

export function createPendingOpenDrainer(
  takePendingOpen: () => Promise<PendingOpenPayload | null>,
  consumePendingOpen: (payload: PendingOpenPayload) => Promise<void>,
) {
  let drainRequested = false;
  let drainPromise: Promise<void> | null = null;

  return async function drainPendingOpens() {
    drainRequested = true;
    if (drainPromise) {
      await drainPromise;
      return;
    }

    drainPromise = (async () => {
      while (drainRequested) {
        drainRequested = false;
        while (true) {
          const payload = await takePendingOpen();
          if (!payload) break;
          try {
            await consumePendingOpen(payload);
          } catch (error) {
            console.error("Failed to process pending open", error);
          }
        }
      }
    })();

    try {
      await drainPromise;
    } finally {
      drainPromise = null;
    }
  };
}

const drainPendingOpens = createPendingOpenDrainer(tauri.takePendingOpen, queueOpenPayload);

// Guard against React 18 StrictMode double-mount
let startupInitiated = false;
let startupReady: Promise<void> = Promise.resolve();

async function resolveStartup() {
  mark("resolve-start");

  let pendingOpen: PendingOpenPayload | null = null;

  try {
    // Single IPC call returns settings, recents, pending opens, AND the
    // prefetched workspace restore bundle (when applicable). React's first
    // render can paint the full editor because everything is already in the
    // stores by the time we flip the gate.
    mark("ipc:get_startup_state:start");
    const startup = await tauri.getStartupState();
    mark("ipc:get_startup_state:end");

    useSettingsStore.getState().hydrateFromBackend({
      settings: startup.settings,
    });

    useWorkspaceStore.setState({
      recentWorkspaces: startup.recent_workspaces,
    });

    pendingOpen = startup.pending_open;

    if (startup.restore_bundle) {
      await useWorkspaceStore.getState().restoreFromBundle(startup.restore_bundle);
    }
  } catch (error) {
    console.error("Failed to resolve startup state", error);
    // Fall through to welcome screen — settings and workspace stores keep
    // whatever defaults they started with.
  }

  // Handle pending opens (CLI arg, drag-to-dock) BEFORE flipping the startup
  // gate. If the bundle above already hydrated the pending workspace,
  // `handleOpenPayload` short-circuits the workspace open and only opens the
  // requested file. Either way, by the time `setStartupResolved` flips, the
  // workspace store is populated, so React's first render is the full
  // `AppLayout` — no flash of `WelcomeScreen` while awaits resolve.
  if (pendingOpen) {
    try {
      await queueOpenPayload(pendingOpen);
    } catch (error) {
      console.error("Failed to handle pending open on startup", error);
    }
  }

  useWorkspaceStore.getState().setStartupResolved();
  mark("resolved");

  await tauri.showMainWindow();
}

export function useOpenDrop() {
  useEffect(() => {
    if (!startupInitiated) {
      startupInitiated = true;
      const startupTask = resolveStartup();
      startupReady = startupTask.catch(() => {});
    }

    // Listen for runtime open events (drag-drop, single-instance, macOS dock)
    const unlisten = listen("open:from-drop", () => {
      void startupReady.then(() => drainPendingOpens());
    });

    void unlisten.then(() => startupReady.then(() => drainPendingOpens()));

    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);
}
