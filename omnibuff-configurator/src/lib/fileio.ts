import { exportSortedDataset, normalizeDataset, type Dataset } from "./dataset";
import { isTauriRuntime } from "./runtime";

export type ImportResult = {
  dataset: Dataset;
  /** Tauri: full file path; Web: file name */
  sourceLabel: string;
};

export async function importDatasetAuto(): Promise<ImportResult | null> {
  if (isTauriRuntime()) return importDatasetTauri();
  return importDatasetWeb();
}

export async function exportDatasetAuto(ds: Dataset): Promise<{ targetLabel: string } | null> {
  if (isTauriRuntime()) return exportDatasetTauri(ds);
  return exportDatasetWeb(ds);
}

async function importDatasetTauri(): Promise<ImportResult | null> {
  const { open } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const picked = await open({
    multiple: false,
    filters: [{ name: "OmniBuff Dataset", extensions: ["json"] }],
  });
  if (!picked || Array.isArray(picked)) return null;

  const text = (await invoke("read_text_file", { path: picked })) as string;
  const parsed = JSON.parse(text);
  const dataset = normalizeDataset(parsed);
  return { dataset, sourceLabel: picked };
}

async function exportDatasetTauri(ds: Dataset): Promise<{ targetLabel: string } | null> {
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { invoke } = await import("@tauri-apps/api/core");

  const sorted = exportSortedDataset(ds);
  const path = await save({
    defaultPath: `${sorted.manifest.id}.dataset.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return null;

  await invoke("write_text_file", { path, contents: JSON.stringify(sorted, null, 2) });
  return { targetLabel: path };
}

async function importDatasetWeb(): Promise<ImportResult | null> {
  const file = await pickFileWeb(".json,application/json");
  if (!file) return null;
  const text = await file.text();
  const parsed = JSON.parse(text);
  const dataset = normalizeDataset(parsed);
  return { dataset, sourceLabel: file.name };
}

async function exportDatasetWeb(ds: Dataset): Promise<{ targetLabel: string } | null> {
  const sorted = exportSortedDataset(ds);
  const filename = `${sorted.manifest.id}.dataset.json`;
  downloadTextWeb(filename, JSON.stringify(sorted, null, 2));
  return { targetLabel: filename };
}

function pickFileWeb(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    input.addEventListener(
      "change",
      async () => {
        const f = input.files?.[0] ?? null;
        input.remove();
        resolve(f);
      },
      { once: true },
    );

    input.click();
  });
}

function downloadTextWeb(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

