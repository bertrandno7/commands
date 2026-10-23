"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Box,
  CheckCircle2,
  Database,
  FileBox,
  Loader2,
  LockKeyhole,
  Trash2,
  UploadCloud,
  Wind,
  Sun,
} from "lucide-react";

type StoredProjectFile = {
  name: string;
  size: number;
  type: string;
  lastModified: number;
  role: "analysis" | "context";
  blob: Blob;
};

type ProjectRecord = {
  key?: string;
  version?: number;
  name: string;
  units: "m" | "cm" | "mm" | "ft";
  files: StoredProjectFile[];
  updatedAt?: string;
};

const DB_NAME = "commands-project-v1";
const DB_VERSION = 1;
const STORE = "project";
const ACTIVE_KEY = "active";
const SUPPORTED = new Set(["obj", "stl", "glb"]);

function extension(name: string) {
  return name.toLowerCase().split(".").pop() ?? "";
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return Math.max(1, Math.round(bytes / 1024)) + " KB";
  return (bytes / (1024 * 1024)).toFixed(bytes > 20 * 1024 * 1024 ? 0 : 1) + " MB";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local project storage."));
  });
}

async function readActive(): Promise<ProjectRecord | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(ACTIVE_KEY);
      request.onsuccess = () => resolve((request.result as ProjectRecord | undefined) ?? null);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

async function writeActive(record: ProjectRecord) {
  const db = await openDb();
  const next = {
    ...record,
    key: ACTIVE_KEY,
    version: 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(next, ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  try {
    const channel = new BroadcastChannel("commands-project");
    channel.postMessage({ type: "commands:project-changed", updatedAt: next.updatedAt });
    channel.close();
  } catch {
    // IndexedDB remains the source of truth when BroadcastChannel is unavailable.
  }
  return next;
}

async function removeActive() {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(ACTIVE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  try {
    const channel = new BroadcastChannel("commands-project");
    channel.postMessage({ type: "commands:project-changed", updatedAt: null });
    channel.close();
  } catch {}
}

function validateFiles(files: File[]) {
  if (!files.length) return "Choose at least one analysis geometry file.";
  const unsupported = files.find((file) => !SUPPORTED.has(extension(file.name)));
  if (unsupported) return unsupported.name + " is not supported yet. Use OBJ, STL, or GLB.";
  const tooLarge = files.find((file) => file.size > 60 * 1024 * 1024);
  if (tooLarge) return tooLarge.name + " is over the 60 MB per-file browser limit.";
  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (total > 120 * 1024 * 1024) return "Keep the active project below 120 MB for browser analysis.";
  return null;
}

export function ProjectGeometryManager() {
  const [active, setActive] = useState<ProjectRecord | null>(null);
  const [analysis, setAnalysis] = useState<File[]>([]);
  const [context, setContext] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [units, setUnits] = useState<ProjectRecord["units"]>("m");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    readActive()
      .then((record) => {
        setActive(record);
        if (record) {
          setName(record.name);
          setUnits(record.units);
        }
      })
      .catch((error: Error) => setMessage(error.message))
      .finally(() => setBusy(false));
  }, []);

  const activeStats = useMemo(() => {
    const files = active?.files ?? [];
    return {
      count: files.length,
      bytes: files.reduce((sum, file) => sum + file.size, 0),
    };
  }, [active]);

  async function saveProject() {
    const validation = validateFiles(analysis);
    if (validation) {
      setMessage(validation);
      return;
    }
    if (context.length) {
      const unsupported = context.find((file) => !SUPPORTED.has(extension(file.name)));
      if (unsupported) {
        setMessage(unsupported.name + " is not supported yet. Use OBJ, STL, or GLB.");
        return;
      }
    }

    setBusy(true);
    setMessage(null);
    try {
      const normalize = (file: File, role: "analysis" | "context"): StoredProjectFile => ({
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
        role,
        blob: file,
      });
      const baseName = analysis[0]?.name.replace(/\.[^.]+$/, "") || "COMMANDS Project";
      const record = await writeActive({
        name: name.trim() || baseName,
        units,
        files: [
          ...analysis.map((file) => normalize(file, "analysis")),
          ...context.map((file) => normalize(file, "context")),
        ],
      });
      setActive(record);
      setMessage("Project saved locally. Use the experimental SunHours or WindScreen links to test it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the project.");
    } finally {
      setBusy(false);
    }
  }

  async function clearProject() {
    setBusy(true);
    setMessage(null);
    try {
      await removeActive();
      setActive(null);
      setAnalysis([]);
      setContext([]);
      setName("");
      setMessage("Active project cleared. Command previews will fall back to sample geometry.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear the project.");
    } finally {
      setBusy(false);
    }
  }

  if (busy && !active) {
    return (
      <div className="project-manager-loading">
        <Loader2 className="spin" size={18} /> Opening local project storage…
      </div>
    );
  }

  return (
    <div className="project-manager">
      <section className="project-manager-main">
        <div className="project-manager-heading">
          <div>
            <span className="section-kicker"><Box size={14} /> Shared project geometry</span>
            <h2>Upload once. Run different commands.</h2>
            <p>
              Your geometry stays in this browser and becomes the common input for browser-capable COMMANDS.
              No model is uploaded to our server.
            </p>
          </div>
          <div className="local-only-pill"><LockKeyhole size={14} /> Local only</div>
        </div>

        <div className="project-upload-grid">
          <label className="project-dropzone">
            <input
              type="file"
              accept=".obj,.stl,.glb"
              multiple
              onChange={(event) => setAnalysis(Array.from(event.target.files ?? []))}
            />
            <UploadCloud size={25} />
            <strong>Analysis geometry</strong>
            <span>OBJ · STL · GLB</span>
            <small>Surfaces that receive analysis results.</small>
            {analysis.length > 0 && (
              <em>{analysis.length} file{analysis.length === 1 ? "" : "s"} selected</em>
            )}
          </label>

          <label className="project-dropzone project-dropzone-secondary">
            <input
              type="file"
              accept=".obj,.stl,.glb"
              multiple
              onChange={(event) => setContext(Array.from(event.target.files ?? []))}
            />
            <FileBox size={24} />
            <strong>Context geometry</strong>
            <span>Optional</span>
            <small>Shadows and wind obstacles, without result colouring.</small>
            {context.length > 0 && (
              <em>{context.length} file{context.length === 1 ? "" : "s"} selected</em>
            )}
          </label>
        </div>

        <div className="project-fields">
          <label>
            <span>Project name</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My project" />
          </label>
          <label>
            <span>Source units</span>
            <select value={units} onChange={(event) => setUnits(event.target.value as ProjectRecord["units"])}>
              <option value="m">Metres</option>
              <option value="cm">Centimetres</option>
              <option value="mm">Millimetres</option>
              <option value="ft">Feet</option>
            </select>
          </label>
          <button className="button button-dark" onClick={saveProject} disabled={busy || !analysis.length}>
            {busy ? <Loader2 className="spin" size={15} /> : <Database size={15} />}
            Save as active project
          </button>
        </div>

        {message && <p className="project-message"><CheckCircle2 size={14} /> {message}</p>}
      </section>

      <aside className="active-project-card">
        <span className="eyebrow"><i /> ACTIVE PROJECT</span>
        {active ? (
          <>
            <h3>{active.name}</h3>
            <div className="active-project-stats">
              <span><strong>{activeStats.count}</strong><small>files</small></span>
              <span><strong>{formatBytes(activeStats.bytes)}</strong><small>local data</small></span>
              <span><strong>{active.units}</strong><small>source units</small></span>
            </div>
            <div className="active-project-files">
              {active.files.map((file, index) => (
                <div key={file.name + "-" + index}>
                  <FileBox size={14} />
                  <span><strong>{file.name}</strong><small>{file.role + " · " + formatBytes(file.size)}</small></span>
                </div>
              ))}
            </div>
            <div className="project-command-links">
              <Link href="/demo/sunhours.html?project=1"><Sun size={15} /> Experimental SunHours</Link>
              <Link href="/demo/wind.html?project=1"><Wind size={15} /> Experimental WindScreen</Link>
            </div>
            <button className="project-clear" type="button" onClick={clearProject} disabled={busy}>
              <Trash2 size={14} /> Clear active project
            </button>
          </>
        ) : (
          <div className="active-project-empty">
            <Box size={30} />
            <h3>No active project</h3>
            <p>Choose analysis geometry on the left. It will persist across command previews on this device.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
