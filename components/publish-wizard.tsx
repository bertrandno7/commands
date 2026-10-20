"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { strFromU8, unzipSync } from "fflate";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  FileArchive,
  FileCode2,
  ImagePlus,
  LoaderCircle,
  PackageCheck,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import type { CommandCategory } from "@/lib/commands";
import type { CommandManifest } from "@/lib/validation";
import { parseManifest } from "@/lib/validation";

const steps = ["Package", "Validation", "Details", "Permissions", "Publish"];
const categories: CommandCategory[] = ["Geometry", "Analysis", "AI", "Facade", "Massing", "Utilities"];
const permissionOptions = [
  ["document.read", "Read selected model geometry and document state"],
  ["document.write", "Create or modify document geometry and layers"],
  ["network", "Access declared network hosts"],
  ["filesystem.read", "Read local files selected by the user"],
  ["filesystem.write", "Write local files or project sidecars"],
  ["clipboard", "Read or write the system clipboard"],
  ["subprocess", "Start a local subprocess"],
] as const;

export function PublishWizard({ userName }: { userName: string }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [packageManifest, setPackageManifest] = useState<CommandManifest | null>(null);
  const [packageError, setPackageError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<CommandCategory>("Geometry");
  const [version, setVersion] = useState("0.1.0");
  const [license, setLicense] = useState("MIT");
  const [rhino, setRhino] = useState("7+");
  const [python, setPython] = useState("Rhino Python / CPython 3");
  const [permissions, setPermissions] = useState<string[]>(["document.read", "document.write"]);
  const [dependencies, setDependencies] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error">("idle");
  const [error, setError] = useState("");

  const validation = useMemo(() => ({
    zip: !!file && /\.zip$/i.test(file.name),
    size: !!file && file.size <= 10 * 1024 * 1024,
    manifest: !!packageManifest,
    name: /^[A-Za-z][A-Za-z0-9_]{1,63}$/.test(name),
    version: /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version),
  }), [file, name, packageManifest, version]);

  const canAdvance = step === 0 ? !!file && !!packageManifest : step === 1 ? Object.values(validation).every(Boolean) : true;

  async function chooseFile(selected?: File | null) {
    if (!selected) return;
    setFile(selected);
    setPackageManifest(null);
    setPackageError("");
    try {
      const entries = unzipSync(new Uint8Array(await selected.arrayBuffer()));
      const manifestBytes = entries["command.json"];
      if (!manifestBytes) throw new Error("command.json must be at the archive root.");
      const parsedJson: unknown = JSON.parse(strFromU8(manifestBytes));
      const parsed = parseManifest(parsedJson);
      if (!parsed.success) throw new Error(parsed.errors.join(" · "));
      const manifest = parsed.data;
      setPackageManifest(manifest);
      setName(manifest.name);
      setSlug(manifest.slug);
      setSummary(manifest.summary);
      setDescription(manifest.description);
      setCategory(manifest.category);
      setVersion(manifest.version);
      setLicense(manifest.license ?? "LicenseRef-Pending");
      setRhino(manifest.runtime.rhinoVersions.join(" / "));
      setPython(manifest.runtime.pythonEngine);
      setPermissions(manifest.permissions);
      setDependencies([
        ...manifest.dependencies.python,
        ...manifest.dependencies.rhinoPlugins,
        ...manifest.dependencies.commands.map((item) => `${item.id}@${item.version}`),
        ...manifest.dependencies.files,
      ].join(", "));
    } catch (cause) {
      setPackageError(cause instanceof Error ? cause.message : "Unable to read command.json.");
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || !packageManifest) return;
    setStatus("submitting");
    setError("");
    const body = new FormData();
    body.set("package", file);
    body.set("manifest", JSON.stringify(packageManifest));
    body.set("readme", description);
    body.set("changelog", "Initial public release.");
    try {
      const response = await fetch("/api/publish", { method: "POST", body });
      const result = await response.json() as { error?: string; slug?: string; url?: string };
      if (!response.ok) throw new Error(result.error || "Publishing failed");
      router.push(result.url || `/commands/${result.slug || packageManifest.slug}`);
      router.refresh();
    } catch (cause) {
      setStatus("error");
      setError(cause instanceof Error ? cause.message : "Publishing failed");
    }
  }

  return (
    <form className="publish-wizard" onSubmit={submit}>
      <div className="wizard-steps">
        {steps.map((label, index) => <button key={label} type="button" className={`${index === step ? "active" : ""} ${index < step ? "complete" : ""}`} onClick={() => index < step && setStep(index)}><span>{index < step ? <Check size={13} /> : index + 1}</span><em>{label}</em></button>)}
      </div>

      <div className="wizard-card">
        <div className="wizard-card-heading"><div><span>STEP {step + 1} OF 5</span><h2>{steps[step]}</h2></div><p>Publishing as <strong>{userName}</strong></p></div>

        {step === 0 && (
          <div className="wizard-pane">
            <label className={`drop-zone ${dragging ? "dragging" : ""}`} onDragEnter={() => setDragging(true)} onDragLeave={() => setDragging(false)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setDragging(false); chooseFile(event.dataTransfer.files[0]); }}>
              <input type="file" accept=".zip,.command.zip" onChange={(event) => void chooseFile(event.target.files?.[0])} />
              {file ? <><span className={`drop-icon ${packageManifest ? "success" : ""}`}><FileArchive /></span><h3>{file.name}</h3><p>{(file.size / 1024 / 1024).toFixed(2)} MB · {packageManifest ? `${packageManifest.name} v${packageManifest.version} detected` : "Manifest needs attention"}</p><em>Choose another file</em></> : <><span className="drop-icon"><UploadCloud /></span><h3>Drop your command package here</h3><p>A `.command.zip` up to 10 MB</p><em>Browse files</em></>}
            </label>
            {packageError && <div className="form-error"><AlertCircle size={16} /> {packageError}</div>}
            <div className="package-requirements"><strong>Expected at the archive root</strong><span><FileCode2 size={15} /> command.json</span><span><FileCode2 size={15} /> src/main.py</span><span><FileCode2 size={15} /> README.md</span><span><ImagePlus size={15} /> icon.svg</span></div>
          </div>
        )}

        {step === 1 && (
          <div className="wizard-pane validation-pane">
            <div className="validation-summary"><span className="drop-icon success"><PackageCheck /></span><div><h3>{Object.values(validation).every(Boolean) ? "Package ready for details" : "A few things need attention"}</h3><p>Fast structural checks run locally. The server performs authoritative validation before publishing.</p></div></div>
            <div className="validation-list">
              {Object.entries({ "Recognized ZIP archive": validation.zip, "Compressed package is under 10 MB": validation.size, "Canonical command.json is valid": validation.manifest, "Command name is valid": validation.name, "Semantic version is valid": validation.version }).map(([label, passed]) => <div key={label} className={passed ? "passed" : "warning"}>{passed ? <CheckCircle2 /> : <AlertCircle />}<span><strong>{label}</strong><small>{passed ? "Passed" : "Review before publishing"}</small></span></div>)}
            </div>
            <label className="field"><span>Package version</span><input value={version} readOnly /><small>Read from command.json. Rebuild the package to change it.</small></label>
          </div>
        )}

        {step === 2 && (
          <div className="wizard-pane form-grid">
            <label className="field"><span>Command name</span><input value={name} readOnly /></label>
            <label className="field"><span>URL slug</span><div className="input-prefix"><em>commands/</em><input value={slug} readOnly /></div></label>
            <label className="field field-wide"><span>One-line summary</span><input value={summary} readOnly /><small>Read from command.json</small></label>
            <label className="field field-wide"><span>Description</span><textarea value={description} readOnly rows={7} /></label>
            <label className="field"><span>Category</span><select value={category} disabled>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Open-source license</span><input value={license} readOnly /></label>
            <label className="field"><span>Rhino compatibility</span><input value={rhino} readOnly /></label>
            <label className="field"><span>Python runtime</span><input value={python} readOnly /></label>
          </div>
        )}

        {step === 3 && (
          <div className="wizard-pane">
            <div className="permission-heading"><ShieldCheck /><div><h3>Declare every side effect</h3><p>People should know what code can touch before they download it.</p></div></div>
            <div className="permission-picker">{permissionOptions.map(([value, label]) => <label key={value}><input type="checkbox" checked={permissions.includes(value)} disabled /><span><strong>{label}</strong><code>{value}</code></span></label>)}</div>
            <label className="field"><span>Declared dependencies</span><input value={dependencies || "Bundled Rhino APIs only"} readOnly /><small>Read from command.json. Rebuild the package to change permissions or dependencies.</small></label>
          </div>
        )}

        {step === 4 && (
          <div className="wizard-pane publish-preview">
            <div className="preview-package-icon"><PackageCheck /></div>
            <span className="eyebrow"><i /> READY TO PUBLISH</span>
            <h3>{name || "UntitledCommand"} <em>v{version}</em></h3>
            <p>{summary || "Add a concise summary before publishing."}</p>
            <div className="preview-facts"><span><strong>{category}</strong><small>Category</small></span><span><strong>Rhino {rhino}</strong><small>Compatibility</small></span><span><strong>{permissions.length}</strong><small>Permissions</small></span><span><strong>{license}</strong><small>License</small></span></div>
            <div className="publish-confirm"><CheckCircle2 /><p>This creates an immutable <strong>v{version}</strong> release. You can publish newer versions, but this package and checksum will remain addressable.</p></div>
            {error && <div className="form-error"><AlertCircle size={16} /> {error}</div>}
          </div>
        )}

        <div className="wizard-footer">
          <button type="button" className="button button-light" onClick={() => setStep((value) => Math.max(0, value - 1))} disabled={step === 0}><ArrowLeft size={15} /> Back</button>
          {step < 4 ? <button type="button" className="button button-dark" disabled={!canAdvance} onClick={() => setStep((value) => value + 1)}>Continue <ArrowRight size={15} /></button> : <button className="button button-dark" disabled={status === "submitting"}>{status === "submitting" ? <LoaderCircle className="spin" size={16} /> : <UploadCloud size={16} />} Publish v{version}</button>}
        </div>
      </div>
    </form>
  );
}
