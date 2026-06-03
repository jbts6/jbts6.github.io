import { useEffect, useMemo, useRef, useState } from "react";
import JSONEditor, { type JSONEditorOptions } from "jsoneditor";
import "jsoneditor/dist/jsoneditor.css";
import {
  decodeSaveText,
  encodeSaveText,
  fromJsonFriendly,
  toJsonFriendly,
  type DecodedSave,
  type SaveKind
} from "./codec";

type ModeChoice = "auto" | SaveKind;

function stripExt(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

function inferId(fileName: string): number | null {
  const lower = fileName.toLowerCase();
  if (lower === "global.rpgsave" || lower === "global") return 0;
  const match = lower.match(/^file(\d+)(?:\.rpgsave)?$/);
  return match ? Number(match[1]) : null;
}

function createDownload(content: string, fileName: string, mime = "text/plain;charset=utf-8"): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

export default function App() {
  const [status, setStatus] = useState("就绪");
  const [error, setError] = useState("");
  const [loadedName, setLoadedName] = useState("file1.rpgsave");
  const [modeChoice, setModeChoice] = useState<ModeChoice>("auto");
  const [saveId, setSaveId] = useState("1");
  const [decoded, setDecoded] = useState<DecodedSave | null>(null);
  const [jsonName, setJsonName] = useState("file1.json");

  const saveFileRef = useRef<HTMLInputElement | null>(null);
  const jsonFileRef = useRef<HTMLInputElement | null>(null);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<JSONEditor | null>(null);

  const outputSaveName = useMemo(() => `${stripExt(loadedName)}.edited.rpgsave`, [loadedName]);
  const outputJsonName = useMemo(() => `${stripExt(loadedName)}.json`, [loadedName]);

  useEffect(() => {
    if (!editorHostRef.current) return;
    const options: JSONEditorOptions = {
      mode: "tree",
      modes: ["tree", "view", "form", "code", "text"],
      language: "zh-CN",
      mainMenuBar: true,
      navigationBar: true,
      statusBar: true,
      onError: (value: Error) => setError(value.message)
    };
    const editor = new JSONEditor(editorHostRef.current, options, {});
    editorRef.current = editor;
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, []);

  function setEditorValue(value: unknown): void {
    if (!editorRef.current) throw new Error("编辑器尚未初始化。");
    editorRef.current.set(value as never);
  }

  function getEditorValue(): unknown {
    if (!editorRef.current) throw new Error("编辑器尚未初始化。");
    return editorRef.current.get();
  }

  async function handleSaveLoad(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      setStatus("解密中");
      const text = await file.text();
      const inferredId = inferId(file.name);
      if (inferredId != null) setSaveId(String(inferredId));
      const requestedId = inferredId ?? Number(saveId);
      const result = await decodeSaveText(text, file.name, Number.isFinite(requestedId) ? requestedId : null);
      const selectedKind = modeChoice === "auto" ? result.kind : modeChoice;
      const normalized = selectedKind === result.kind ? result : { ...result, kind: selectedKind };
      setLoadedName(file.name);
      setJsonName(`${stripExt(file.name)}.json`);
      setDecoded(normalized);
      if (normalized.saveId != null) setSaveId(String(normalized.saveId));
      setEditorValue(toJsonFriendly(normalized.value));
      setStatus(`已解密 ${file.name}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setStatus("解密失败");
    } finally {
      event.target.value = "";
    }
  }

  async function handleJsonLoad(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      setError("");
      const text = await file.text();
      setEditorValue(JSON.parse(text));
      setJsonName(file.name);
      setStatus(`已载入 ${file.name}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setStatus("载入失败");
    } finally {
      event.target.value = "";
    }
  }

  function currentKind(): SaveKind {
    if (modeChoice !== "auto") return modeChoice;
    return decoded?.kind ?? "v2";
  }

  function currentSaveId(): number | null {
    const kind = currentKind();
    if (kind === "config") return null;
    const value = Number(saveId);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error("v2 存档需要有效的槽位 ID。");
    }
    return value;
  }

  async function handleExportSave(): Promise<void> {
    try {
      setError("");
      const restored = fromJsonFriendly(getEditorValue());
      const text = await encodeSaveText(restored, currentKind(), currentSaveId(), decoded?.parts);
      createDownload(text, outputSaveName);
      setStatus(`已导出 ${outputSaveName}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setStatus("导出失败");
    }
  }

  function handleExportJson(): void {
    try {
      setError("");
      createDownload(JSON.stringify(getEditorValue(), null, 2), jsonName || outputJsonName, "application/json;charset=utf-8");
      setStatus(`已导出 ${jsonName || outputJsonName}`);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setStatus("导出失败");
    }
  }

  function handleValidate(): void {
    try {
      setError("");
      fromJsonFriendly(getEditorValue());
      setStatus("JSON 有效");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setStatus("校验失败");
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">OFFLINE SAVE FILE</div>
          <h1>大千世界2 存档编辑器</h1>
        </div>
        <div className="top-actions">
          <div className={error ? "status status-error" : "status"}>{status}</div>
          <button className="primary" onClick={() => saveFileRef.current?.click()}>打开存档</button>
          <button onClick={() => jsonFileRef.current?.click()}>打开 JSON</button>
          <button onClick={handleExportJson}>导出 JSON</button>
          <button onClick={() => void handleExportSave()}>导出存档</button>
        </div>
      </header>

      <main className="layout">
        <aside className="side-panel">
          <section className="panel">
            <div className="panel-title">文件</div>
            <dl className="meta-list">
              <div><dt>存档</dt><dd>{loadedName}</dd></div>
              <div><dt>类型</dt><dd>{decoded?.kind ?? "-"}</dd></div>
              <div><dt>槽位</dt><dd>{decoded?.saveId ?? "-"}</dd></div>
              <div><dt>Payload</dt><dd>{decoded ? decoded.payloadLength.toLocaleString() : "-"}</dd></div>
              <div><dt>MsgPack</dt><dd>{decoded ? formatBytes(decoded.msgpackLength) : "-"}</dd></div>
            </dl>
          </section>

          <section className="panel control-panel">
            <div className="panel-title">编码</div>
            <label>
              <span>输出类型</span>
              <select value={modeChoice} onChange={(event) => setModeChoice(event.target.value as ModeChoice)}>
                <option value="auto">auto</option>
                <option value="v2">v2 save/global</option>
                <option value="config">config</option>
              </select>
            </label>
            <label>
              <span>槽位 ID</span>
              <input value={saveId} onChange={(event) => setSaveId(event.target.value)} inputMode="numeric" />
            </label>
            <div className="button-grid">
              <button onClick={handleValidate}>校验</button>
              <button onClick={() => editorRef.current?.expandAll()}>展开</button>
              <button onClick={() => editorRef.current?.collapseAll()}>收起</button>
            </div>
          </section>

          {error && <section className="panel error-panel">{error}</section>}
        </aside>

        <section className="editor-panel">
          <div ref={editorHostRef} className="editor-host" />
        </section>
      </main>

      <input ref={saveFileRef} type="file" accept=".rpgsave,.txt" hidden onChange={(event) => void handleSaveLoad(event)} />
      <input ref={jsonFileRef} type="file" accept=".json" hidden onChange={(event) => void handleJsonLoad(event)} />
    </div>
  );
}
