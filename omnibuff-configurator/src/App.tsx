import { useMemo, useState } from "react";
import {
  Badge,
  Button,
  Card,
  Checkbox,
  Collapse,
  Divider,
  Form,
  Input,
  InputNumber,
  Layout,
  message,
  Select,
  Space,
  Tag,
  Tooltip,
  Tree,
  Typography,
} from "antd";
import { PlusOutlined, ReloadOutlined } from "@ant-design/icons";

import { t } from "./i18n/zh-CN";
import {
  generateBuffKey,
  nextBuffId,
  snakeCase,
  type Dataset,
} from "./lib/dataset";
import { exportDatasetAuto, importDatasetAuto } from "./lib/fileio";

import "./App.css";

type NodeRef =
  | { kind: "manifest" }
  | { kind: "enums" }
  | { kind: "stats_root" }
  | { kind: "buffs_root" }
  | { kind: "stat"; id: string }
  | { kind: "buff"; id: number };

type Issue = {
  severity: "error" | "warn";
  path: string;
  message: string;
  node: NodeRef;
};

type FieldType = "string" | "number" | "boolean" | "enum" | "stat_ref" | "buff_ref" | "tags";
type FieldSchema = {
  key: string;
  label: string;
  type: FieldType;
  hint?: string;
  placeholder?: string;
  options?: (ds: Dataset) => string[];
  i18nPrefix?: string;
  showIf?: (ctx: { obj: Record<string, unknown>; ds: Dataset }) => boolean;
};
type TemplateSchema = {
  label: string;
  defaults: Record<string, unknown>;
  fields: FieldSchema[];
};

const SAMPLE: Dataset = {
  manifest: {
    id: "rpg_tests",
    name: "RPG Tests Dataset",
    files: [
      { type: "enums", path: "res://data/rpg_tests/enums.json" },
      { type: "stat_defs", path: "res://data/rpg_tests/stat_defs.json" },
      { type: "buff_defs", path: "res://data/rpg_tests/buff_defs.json" },
    ],
  },
  enums: {
    tags: ["BUFF", "DEBUFF", "BONUS_DAMAGE", "SKILL", "DOT", "AURA"],
    event_type: ["DAMAGE", "DOT", "LIFE", "COMMAND"],
    action_kind: ["APPLY_BUFF", "DISPEL", "BONUS_DAMAGE", "ADD_STACKS", "SET_STACKS", "HEAL"],
    scope: ["SELF", "SOURCE", "TARGET"],
  },
  stat_defs: [
    { id: "HP", default: 100, min: 0, max: 99999, clamp: true, derived: { type: "LINEAR", from: "STR", ratio: 20 } },
    { id: "STR", default: 0, min: 0, max: 999, clamp: true },
    { id: "ATK", default: 10, min: 0, max: 9999, clamp: true },
  ],
  buff_defs: [
    {
      buff_id: 100000,
      buff_key: "add_atk_20_t5",
      name: "战斗口粮",
      tags: ["BUFF"],
      duration: { type: "TURNS", turns: 5 },
      stack: { mode: "REPLACE", max_stack: 1 },
      notes: "示例：加攻击 +20，持续 5 回合。",
      effects: [{ kind: "modifier", stat: "ATK", op: "ADD", phase: "FLAT", priority: 100, value: 20 }],
      triggers: [],
    },
    {
      buff_id: 100001,
      buff_key: "thorns_bonus_50",
      name: "荆棘",
      tags: ["BUFF"],
      duration: { type: "PERMANENT" },
      stack: { mode: "REPLACE", max_stack: 1 },
      effects: [],
      triggers: [
        {
          event_type: "DAMAGE",
          event_phase: "AFTER_TAKE",
          scope: "SOURCE",
          filters: { require_hit: true, require_not_bonus_damage: true },
          action: { kind: "BONUS_DAMAGE", ratio: 0.5, tags: ["BONUS_DAMAGE"] },
        },
      ],
    },
  ],
};

const EVENT_PHASE_BY_TYPE: Record<string, string[]> = {
  DAMAGE: ["BUILD", "BEFORE_DEAL", "BEFORE_TAKE", "RESOLVE", "APPLY", "AFTER_DEAL", "AFTER_TAKE"],
  DOT: ["TURN_START", "TURN_END"],
  LIFE: ["DEATH", "REVIVE"],
  COMMAND: ["BEFORE", "AFTER"],
};

const EFFECT_TEMPLATES: Record<string, TemplateSchema> = {
  modifier: {
    label: "属性修饰",
    defaults: { kind: "modifier", stat: "ATK", op: "ADD", phase: "FLAT", priority: 100, value: 10 },
    fields: [
      { key: "stat", label: "属性", type: "stat_ref", hint: "stat_id" },
      { key: "op", label: "运算符", type: "enum", options: () => ["ADD", "MUL", "OVERRIDE"], i18nPrefix: "op" },
      { key: "value", label: "数值", type: "number", hint: "value" },
      { key: "priority", label: "优先级", type: "number", hint: "priority" },
    ],
  },
  shield: {
    label: "护盾",
    defaults: { kind: "shield", value: 20 },
    fields: [{ key: "value", label: "护盾值", type: "number", hint: "value" }],
  },
  dot: {
    label: "DOT（周期伤害）",
    defaults: { kind: "dot", damage: 5, interval: 1, turns: 5 },
    fields: [
      { key: "damage", label: "每跳伤害", type: "number" },
      { key: "interval", label: "间隔（秒）", type: "number" },
      { key: "turns", label: "持续（回合）", type: "number" },
    ],
  },
};

const FILTER_SCHEMAS: Record<string, FieldSchema[]> = {
  DAMAGE: [
    { key: "require_hit", label: "必须命中", type: "boolean", hint: "require_hit" },
    { key: "require_not_bonus_damage", label: "不递归追加伤害", type: "boolean", hint: "require_not_bonus_damage" },
  ],
  LIFE: [{ key: "tag_any", label: "命中任意 Tag", type: "tags", hint: "tag_any" }],
  DOT: [{ key: "tag_any", label: "命中任意 Tag", type: "tags", hint: "tag_any" }],
  COMMAND: [{ key: "tag_any", label: "命中任意 Tag", type: "tags", hint: "tag_any" }],
};

const ACTION_TEMPLATES: Record<string, TemplateSchema> = {
  HEAL: {
    label: "治疗",
    defaults: { kind: "HEAL", value: 5 },
    fields: [{ key: "value", label: "治疗量", type: "number", hint: "value" }],
  },
  BONUS_DAMAGE: {
    label: "追加伤害",
    defaults: { kind: "BONUS_DAMAGE", ratio: 0.5, tags: ["BONUS_DAMAGE"] },
    fields: [
      { key: "ratio", label: "倍率（ratio）", type: "number", hint: "ratio" },
      { key: "tags", label: "Tags", type: "tags", hint: "tags" },
    ],
  },
};

function getTemplate(name: string, templates: Record<string, TemplateSchema>, fallback: string): TemplateSchema {
  return templates[name] ?? templates[fallback];
}

function fmtEnum(i18nPrefix: string | undefined, id: string, advanced: boolean) {
  if (!i18nPrefix) return id;
  const zh = t(`${i18nPrefix}.${id}`, id);
  return advanced ? `${zh} (${id})` : zh;
}

function fmtTag(id: string, advanced: boolean) {
  const zh = t(`tag.${id}`, id);
  return advanced ? `${zh} (${id})` : zh;
}

function fmtStat(id: string, advanced: boolean) {
  const zh = id; // 真实版会从 stat display map 来
  return advanced ? `${zh} (${id})` : zh;
}

function nodeTitle(ds: Dataset, n: NodeRef, advanced: boolean) {
  if (n.kind === "buff") {
    const b = ds.buff_defs.find((x) => x.buff_id === n.id);
    if (!b) return advanced ? `Buff [${n.id}]` : `Buff`;
    return advanced ? `${b.name} (${b.buff_key}) [${b.buff_id}]` : b.name;
  }
  if (n.kind === "stat") {
    return fmtStat(n.id, advanced);
  }
  if (n.kind === "manifest") return t("nav.manifest", "Manifest");
  if (n.kind === "enums") return t("nav.enums", "Enums");
  if (n.kind === "stats_root") return t("nav.stats", "Stats");
  if (n.kind === "buffs_root") return t("nav.buffs", "Buffs");
  return "Unknown";
}

function computeIssues(ds: Dataset): Issue[] {
  const issues: Issue[] = [];
  const seenIds = new Set<number>();
  const seenKeys = new Set<string>();

  for (const b of ds.buff_defs) {
    if (b.buff_id < 100000) {
      issues.push({
        severity: "warn",
        path: `$.buffs[${b.buff_id}].buff_id`,
        message: "建议 buff_id 从 100000 开始",
        node: { kind: "buff", id: b.buff_id },
      });
    }
    if (seenIds.has(b.buff_id)) {
      issues.push({
        severity: "error",
        path: `$.buffs[${b.buff_id}].buff_id`,
        message: `重复的 buff_id: ${b.buff_id}`,
        node: { kind: "buff", id: b.buff_id },
      });
    }
    seenIds.add(b.buff_id);

    const k = String(b.buff_key ?? "").trim();
    if (!k) {
      issues.push({
        severity: "error",
        path: `$.buffs[${b.buff_id}].buff_key`,
        message: "buff_key 不能为空",
        node: { kind: "buff", id: b.buff_id },
      });
    } else {
      if (!/^[a-z][a-z0-9_]*$/.test(k)) {
        issues.push({
          severity: "error",
          path: `$.buffs[${b.buff_id}].buff_key`,
          message: "buff_key 必须是 snake_case 且以字母开头",
          node: { kind: "buff", id: b.buff_id },
        });
      }
      if (seenKeys.has(k)) {
        issues.push({
          severity: "error",
          path: `$.buffs[${b.buff_id}].buff_key`,
          message: `重复的 buff_key: ${k}`,
          node: { kind: "buff", id: b.buff_id },
        });
      }
      seenKeys.add(k);
    }
  }

  return issues;
}

function renderSchema(
  ds: Dataset,
  schema: FieldSchema[],
  obj: Record<string, unknown>,
  onPatch: (patch: Record<string, unknown>) => void,
  advanced: boolean,
) {
  const fields = schema.filter((f) => (f.showIf ? f.showIf({ obj, ds }) : true));

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
      {fields.map((f) => {
        const v = obj[f.key];

        const label = (
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{f.label}</span>
            <span style={{ color: "rgba(255,255,255,0.35)", fontFamily: "var(--mono)" }}>
              {advanced ? f.hint ?? f.key : ""}
            </span>
          </div>
        );

        if (f.type === "boolean") {
          return (
            <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
              {label}
              <Checkbox checked={Boolean(v ?? false)} onChange={(e) => onPatch({ [f.key]: e.target.checked })}>
                {f.label}
              </Checkbox>
            </Card>
          );
        }

        if (f.type === "number") {
          return (
            <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
              {label}
              <InputNumber
                style={{ width: "100%" }}
                value={Number(v ?? 0)}
                onChange={(val) => onPatch({ [f.key]: Number(val ?? 0) })}
                placeholder={f.placeholder}
              />
            </Card>
          );
        }

        if (f.type === "enum") {
          const opts = f.options ? f.options(ds) : [];
          return (
            <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
              {label}
              <Select
                value={String(v ?? opts[0] ?? "")}
                onChange={(val) => onPatch({ [f.key]: val })}
                options={opts.map((o) => ({ value: o, label: fmtEnum(f.i18nPrefix, o, advanced) }))}
              />
            </Card>
          );
        }

        if (f.type === "stat_ref") {
          const stats = (ds.stat_defs as any[]).map((s) => String(s.id));
          return (
            <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
              {label}
              <Select
                value={String(v ?? stats[0] ?? "")}
                onChange={(val) => onPatch({ [f.key]: val })}
                options={stats.map((id) => ({ value: id, label: fmtStat(id, advanced) }))}
                showSearch
                optionFilterProp="label"
              />
            </Card>
          );
        }

        if (f.type === "buff_ref") {
          return (
            <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
              {label}
              <Select
                value={Number(v ?? ds.buff_defs[0]?.buff_id ?? 0)}
                onChange={(val) => onPatch({ [f.key]: Number(val) })}
                options={ds.buff_defs.map((b) => ({
                  value: b.buff_id,
                  label: advanced ? `${b.name} (${b.buff_key}) [${b.buff_id}]` : b.name,
                }))}
                showSearch
                optionFilterProp="label"
              />
            </Card>
          );
        }

        if (f.type === "tags") {
          const selected = Array.isArray(v) ? (v as string[]) : [];
          return (
            <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
              {label}
              <Checkbox.Group
                value={selected}
                options={ds.enums.tags.map((tagId) => ({
                  label: fmtTag(tagId, advanced),
                  value: tagId,
                }))}
                onChange={(vals) => onPatch({ [f.key]: vals })}
              />
            </Card>
          );
        }

        return (
          <Card key={f.key} size="small" style={{ background: "rgba(0,0,0,0.18)" }}>
            {label}
            <Input value={String(v ?? "")} onChange={(e) => onPatch({ [f.key]: e.target.value })} placeholder={f.placeholder} />
          </Card>
        );
      })}
    </div>
  );
}

export default function App() {
  const [ds, setDs] = useState<Dataset>(SAMPLE);
  const [selected, setSelected] = useState<NodeRef>({ kind: "buff", id: SAMPLE.buff_defs[0].buff_id });
  const [advanced, setAdvanced] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [currentPath, setCurrentPath] = useState<string | null>(null);

  const issues = useMemo(() => computeIssues(ds), [ds]);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warnCount = issues.filter((i) => i.severity === "warn").length;
  const ok = errorCount === 0;

  const selectedBuff = selected.kind === "buff" ? ds.buff_defs.find((b) => b.buff_id === selected.id) : null;

  const treeData = useMemo(() => {
    return [
      { key: "manifest", title: nodeTitle(ds, { kind: "manifest" }, advanced) },
      { key: "enums", title: nodeTitle(ds, { kind: "enums" }, advanced) },
      {
        key: "stats_root",
        title: nodeTitle(ds, { kind: "stats_root" }, advanced),
        children: (ds.stat_defs as any[]).map((s) => ({ key: `stat:${s.id}`, title: fmtStat(String(s.id), advanced) })),
      },
      {
        key: "buffs_root",
        title: nodeTitle(ds, { kind: "buffs_root" }, advanced),
        children: ds.buff_defs.map((b) => ({
          key: `buff:${b.buff_id}`,
          title: nodeTitle(ds, { kind: "buff", id: b.buff_id }, advanced),
        })),
      },
    ];
  }, [advanced, ds]);

  function setSelectedFromKey(key: string) {
    if (key === "manifest") return setSelected({ kind: "manifest" });
    if (key === "enums") return setSelected({ kind: "enums" });
    if (key === "stats_root") return setSelected({ kind: "stats_root" });
    if (key === "buffs_root") return setSelected({ kind: "buffs_root" });
    if (key.startsWith("stat:")) return setSelected({ kind: "stat", id: key.slice("stat:".length) });
    if (key.startsWith("buff:")) return setSelected({ kind: "buff", id: Number(key.slice("buff:".length)) });
  }

  function updateBuff(patch: Partial<Dataset["buff_defs"][number]>) {
    if (!selectedBuff) return;
    setDs((prev) => ({
      ...prev,
      buff_defs: prev.buff_defs.map((b) => (b.buff_id === selectedBuff.buff_id ? { ...b, ...patch } : b)),
    }));
  }

  function addNewBuff() {
    setDs((prev) => {
      const id = nextBuffId(prev);
      const buff: Dataset["buff_defs"][number] = {
        buff_id: id,
        buff_key: "tmp",
        name: "新 Buff",
        tags: ["BUFF"],
        duration: { type: "TURNS", turns: 3 },
        stack: { mode: "REPLACE", max_stack: 1 },
        effects: [{ ...EFFECT_TEMPLATES.modifier.defaults }],
        triggers: [],
      } as any;
      buff.buff_key = generateBuffKey(buff as any);
      return { ...prev, buff_defs: [...prev.buff_defs, buff] };
    });
  }

  async function onImport() {
    try {
      const res = await importDatasetAuto();
      if (!res) return;
      setDs(res.dataset);
      setCurrentPath(res.sourceLabel);
      setSelected({ kind: "manifest" });
      message.success("导入成功");
    } catch (e: any) {
      message.error(`导入失败：${String(e?.message ?? e)}`);
    }
  }

  async function onExport() {
    try {
      const res = await exportDatasetAuto(ds);
      if (!res) return;
      setCurrentPath(res.targetLabel);
      message.success("导出成功");
    } catch (e: any) {
      message.error(`导出失败：${String(e?.message ?? e)}`);
    }
  }

  return (
    <Layout style={{ height: "100%", background: "transparent" }}>
      <Layout.Header style={{ height: 56, background: "rgba(255,255,255,0.05)", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
        <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "space-between" }}>
          <Space size={12} align="center">
            <Typography.Text style={{ fontFamily: "var(--display)", fontWeight: 700 }}>
              OmniBuff 配置器
            </Typography.Text>
            <Tag color={ok ? "green" : "red"}>{ok ? "已通过校验" : "存在错误"}</Tag>
            <Tag style={{ fontFamily: "var(--mono)" }}>{ds.manifest.id}</Tag>
            {currentPath && (
              <Tag style={{ maxWidth: 420, overflow: "hidden", textOverflow: "ellipsis" }} title={currentPath}>
                {currentPath}
              </Tag>
            )}
          </Space>

          <Space>
            <Button onClick={onImport}>导入</Button>
            <Button onClick={onExport} type="primary">
              导出
            </Button>
            <Tooltip title="高级模式：显示英文 key/ID，适合程序与调试使用。">
              <Button onClick={() => setAdvanced((v) => !v)}>{advanced ? "高级：开" : "高级：关"}</Button>
            </Tooltip>
            <Tooltip title="点击展开/收起右侧校验结果面板">
              <Button onClick={() => setShowIssues((v) => !v)}>
                校验结果{" "}
                <Badge
                  count={`${errorCount}E/${warnCount}W`}
                  style={{
                    backgroundColor: errorCount > 0 ? "#ff4d6d" : warnCount > 0 ? "#ffbe0b" : "#41f3b4",
                    // 亮底徽标用深色字，避免在 darkmode 下发灰看不清
                    color: "#06110f",
                  }}
                />
              </Button>
            </Tooltip>
          </Space>
        </div>
      </Layout.Header>

      <Layout>
        <Layout.Sider width={320} style={{ background: "rgba(255,255,255,0.03)", borderRight: "1px solid rgba(255,255,255,0.08)" }}>
          <div style={{ padding: 12 }}>
            <Space style={{ width: "100%", justifyContent: "space-between" }}>
              <Typography.Text type="secondary">导航</Typography.Text>
              <Button size="small" icon={<PlusOutlined />} onClick={addNewBuff}>
                新 Buff
              </Button>
            </Space>
            <Divider style={{ margin: "10px 0" }} />
            <Tree
              defaultExpandAll
              treeData={treeData as any}
              selectedKeys={[
                selected.kind === "buff"
                  ? `buff:${selected.id}`
                  : selected.kind === "stat"
                    ? `stat:${selected.id}`
                    : selected.kind,
              ]}
              onSelect={(keys) => {
                const k = keys[0] as string | undefined;
                if (k) setSelectedFromKey(k);
              }}
            />
          </div>
        </Layout.Sider>

        <Layout.Content style={{ padding: 16, overflow: "auto" }}>
          <Card
            title={
              <Space>
                <Typography.Text strong>{nodeTitle(ds, selected, advanced)}</Typography.Text>
                {selected.kind === "buff" && selectedBuff && (
                  <Tag style={{ fontFamily: "var(--mono)" }}>
                    {advanced ? `${selectedBuff.buff_key} [${selectedBuff.buff_id}]` : selectedBuff.buff_key}
                  </Tag>
                )}
              </Space>
            }
            style={{ background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.08)" }}
          >
            {selected.kind === "buff" && selectedBuff && (
              <Form layout="vertical">
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <Form.Item label="Buff ID（只读）">
                    <Input value={String(selectedBuff.buff_id)} readOnly />
                  </Form.Item>
                  <Form.Item label="英文 Key（可编辑）">
                    <Space.Compact style={{ width: "100%" }}>
                      <Input
                        value={selectedBuff.buff_key}
                        onChange={(e) => updateBuff({ buff_key: snakeCase(e.target.value) })}
                        placeholder="snake_case"
                      />
                      <Button
                        icon={<ReloadOutlined />}
                        onClick={() => updateBuff({ buff_key: generateBuffKey(selectedBuff as any) })}
                      >
                        生成
                      </Button>
                    </Space.Compact>
                  </Form.Item>
                  <Form.Item label="名称">
                    <Input value={selectedBuff.name} onChange={(e) => updateBuff({ name: e.target.value })} />
                  </Form.Item>
                  <Form.Item label="Tags">
                    <Checkbox.Group
                      value={selectedBuff.tags}
                      options={ds.enums.tags.map((tagId) => ({ value: tagId, label: fmtTag(tagId, advanced) }))}
                      onChange={(vals) => updateBuff({ tags: vals as string[] })}
                    />
                  </Form.Item>
                  <Form.Item label="持续">
                    <Space>
                      <Select
                        value={selectedBuff.duration.type}
                        onChange={(val) => {
                          if (val === "PERMANENT") updateBuff({ duration: { type: "PERMANENT" } as any });
                          else updateBuff({ duration: { type: "TURNS", turns: selectedBuff.duration.turns ?? 3 } as any });
                        }}
                        options={[
                          { value: "PERMANENT", label: advanced ? `${t("duration.PERMANENT")} (PERMANENT)` : t("duration.PERMANENT") },
                          { value: "TURNS", label: advanced ? `${t("duration.TURNS")} (TURNS)` : t("duration.TURNS") },
                        ]}
                        style={{ width: 220 }}
                      />
                      {selectedBuff.duration.type === "TURNS" && (
                        <InputNumber
                          min={1}
                          value={selectedBuff.duration.turns ?? 1}
                          onChange={(val) => updateBuff({ duration: { type: "TURNS", turns: Number(val ?? 1) } as any })}
                        />
                      )}
                    </Space>
                  </Form.Item>
                </div>

                <Divider />
                <Collapse
                  items={[
                    {
                      key: "effects",
                      label: (
                        <Space size={8}>
                          <span>Effects</span>
                          {(selectedBuff.effects?.length ?? 0) > 0 && (
                            <Badge
                              count={selectedBuff.effects.length}
                              style={{ backgroundColor: "#41f3b4", color: "#06110f" }}
                              overflowCount={99}
                            />
                          )}
                        </Space>
                      ),
                      children: (
                        <Space orientation="vertical" style={{ width: "100%" }}>
                          {(selectedBuff.effects ?? []).map((eff, idx) => {
                            const effObj = (eff ?? {}) as Record<string, unknown>;
                            const kind = String(effObj.kind ?? "modifier");
                            const tpl = getTemplate(kind, EFFECT_TEMPLATES, "modifier");
                            return (
                              <Card
                                key={`eff:${idx}`}
                                size="small"
                                title={`Effect #${idx + 1} · ${tpl.label}`}
                                extra={
                                  <Select
                                    value={kind}
                                    onChange={(val) => {
                                      const t = getTemplate(String(val), EFFECT_TEMPLATES, "modifier");
                                      updateBuff({
                                        effects: selectedBuff.effects.map((e, i) => (i === idx ? { ...t.defaults } : e)),
                                      });
                                    }}
                                    options={Object.entries(EFFECT_TEMPLATES).map(([k, tt]) => ({ value: k, label: tt.label }))}
                                    style={{ width: 180 }}
                                  />
                                }
                                style={{ background: "rgba(0,0,0,0.20)" }}
                              >
                                {renderSchema(
                                  ds,
                                  tpl.fields,
                                  effObj,
                                  (patch) =>
                                    updateBuff({
                                      effects: selectedBuff.effects.map((e, i) => (i === idx ? { ...(e as any), ...patch } : e)),
                                    }),
                                  advanced,
                                )}
                              </Card>
                            );
                          })}
                          <Button
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={() =>
                              updateBuff({
                                effects: [...selectedBuff.effects, { ...EFFECT_TEMPLATES.modifier.defaults }],
                              })
                            }
                          >
                            添加 Effect
                          </Button>
                        </Space>
                      ),
                    },
                    {
                      key: "triggers",
                      label: (
                        <Space size={8}>
                          <span>Triggers</span>
                          {(selectedBuff.triggers?.length ?? 0) > 0 && (
                            <Badge
                              count={selectedBuff.triggers.length}
                              style={{ backgroundColor: "#41f3b4", color: "#06110f" }}
                              overflowCount={99}
                            />
                          )}
                        </Space>
                      ),
                      children: (
                        <Space orientation="vertical" style={{ width: "100%" }}>
                          {(selectedBuff.triggers ?? []).map((tr, idx) => {
                            const tObj = tr as any;
                            const et = String(tObj.event_type ?? "DAMAGE");
                            const actionKind = String(tObj.action?.kind ?? "HEAL");
                            const actionTpl = getTemplate(actionKind, ACTION_TEMPLATES, "HEAL");
                            const filterSchema = FILTER_SCHEMAS[et] ?? [];
                            return (
                              <Card key={`tr:${idx}`} size="small" title={`Trigger #${idx + 1}`} style={{ background: "rgba(0,0,0,0.20)" }}>
                                <Space style={{ width: "100%" }} wrap>
                                  <Select
                                    value={et}
                                    onChange={(val) => {
                                      const nextEt = String(val);
                                      const phases = EVENT_PHASE_BY_TYPE[nextEt] ?? [];
                                      const nextPhase = phases[0] ?? "AFTER_TAKE";
                                      updateBuff({
                                        triggers: selectedBuff.triggers.map((t, i) =>
                                          i === idx ? { ...tObj, event_type: nextEt, event_phase: nextPhase } : t,
                                        ),
                                      });
                                    }}
                                    options={ds.enums.event_type.map((x) => ({
                                      value: x,
                                      label: advanced ? `${t(`event_type.${x}`, x)} (${x})` : t(`event_type.${x}`, x),
                                    }))}
                                    style={{ width: 240 }}
                                  />
                                  <Select
                                    value={String(tObj.event_phase ?? EVENT_PHASE_BY_TYPE[et]?.[0] ?? "")}
                                    onChange={(val) => {
                                      updateBuff({
                                        triggers: selectedBuff.triggers.map((t, i) =>
                                          i === idx ? { ...tObj, event_phase: String(val) } : t,
                                        ),
                                      });
                                    }}
                                    options={(EVENT_PHASE_BY_TYPE[et] ?? []).map((p) => ({
                                      value: p,
                                      label: advanced ? `${t(`event_phase.${p}`, p)} (${p})` : t(`event_phase.${p}`, p),
                                    }))}
                                    style={{ width: 240 }}
                                  />
                                  <Select
                                    value={String(tObj.scope ?? "SELF")}
                                    onChange={(val) => {
                                      updateBuff({
                                        triggers: selectedBuff.triggers.map((t, i) =>
                                          i === idx ? { ...tObj, scope: String(val) } : t,
                                        ),
                                      });
                                    }}
                                    options={ds.enums.scope.map((x) => ({
                                      value: x,
                                      label: advanced ? `${t(`scope.${x}`, x)} (${x})` : t(`scope.${x}`, x),
                                    }))}
                                    style={{ width: 200 }}
                                  />
                                </Space>

                                <Divider />
                                <Typography.Text type="secondary">Filters</Typography.Text>
                                {renderSchema(
                                  ds,
                                  filterSchema,
                                  (tObj.filters ?? {}) as Record<string, unknown>,
                                  (patch) =>
                                    updateBuff({
                                      triggers: selectedBuff.triggers.map((t, i) =>
                                        i === idx ? { ...tObj, filters: { ...(tObj.filters ?? {}), ...patch } } : t,
                                      ),
                                    }),
                                  advanced,
                                )}

                                <Divider />
                                <Space style={{ justifyContent: "space-between", width: "100%" }}>
                                  <Typography.Text type="secondary">Action</Typography.Text>
                                  <Select
                                    value={actionKind}
                                    onChange={(val) => {
                                      const nextKind = String(val);
                                      const tpl = getTemplate(nextKind, ACTION_TEMPLATES, "HEAL");
                                      updateBuff({
                                        triggers: selectedBuff.triggers.map((t, i) =>
                                          i === idx ? { ...tObj, action: { ...tpl.defaults } } : t,
                                        ),
                                      });
                                    }}
                                    options={ds.enums.action_kind.map((x) => ({
                                      value: x,
                                      label: advanced ? `${t(`action_kind.${x}`, x)} (${x})` : t(`action_kind.${x}`, x),
                                    }))}
                                    style={{ width: 240 }}
                                  />
                                </Space>
                                {renderSchema(
                                  ds,
                                  actionTpl.fields,
                                  (tObj.action ?? {}) as Record<string, unknown>,
                                  (patch) =>
                                    updateBuff({
                                      triggers: selectedBuff.triggers.map((t, i) =>
                                        i === idx ? { ...tObj, action: { ...(tObj.action ?? {}), ...patch } } : t,
                                      ),
                                    }),
                                  advanced,
                                )}
                              </Card>
                            );
                          })}
                          <Button
                            type="dashed"
                            icon={<PlusOutlined />}
                            onClick={() =>
                              updateBuff({
                                triggers: [
                                  ...selectedBuff.triggers,
                                  {
                                    event_type: "DAMAGE",
                                    event_phase: "AFTER_TAKE",
                                    scope: "SELF",
                                    filters: { require_hit: true },
                                    action: { ...ACTION_TEMPLATES.HEAL.defaults },
                                  },
                                ],
                              })
                            }
                          >
                            添加 Trigger
                          </Button>
                        </Space>
                      ),
                    },
                  ]}
                />
              </Form>
            )}

            {selected.kind !== "buff" && (
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                真实版将把 “manifest / enums / stats” 也做成 schema-driven 表单（并接入 Tauri 导入/导出）。
              </Typography.Paragraph>
            )}
          </Card>
        </Layout.Content>

        {showIssues && (
          <Layout.Sider width={360} style={{ background: "rgba(255,255,255,0.03)", borderLeft: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ padding: 12, height: "100%", overflow: "auto" }}>
              <Typography.Text type="secondary">校验结果</Typography.Text>
              <Divider style={{ margin: "10px 0" }} />
              {issues.length === 0 ? (
                <Typography.Paragraph style={{ color: "rgba(255,255,255,0.72)" }}>
                  看起来一切正常。
                </Typography.Paragraph>
              ) : (
                <Space orientation="vertical" style={{ width: "100%" }}>
                  {issues.map((iss, idx) => (
                    <Card
                      key={`${iss.path}:${idx}`}
                      size="small"
                      style={{ background: "rgba(0,0,0,0.22)", borderColor: "rgba(255,255,255,0.10)", cursor: "pointer" }}
                      onClick={() => setSelected(iss.node)}
                      title={
                        <Space>
                          <Badge color={iss.severity === "error" ? "#ff4d6d" : "#ffbe0b"} />
                          <span>{iss.message}</span>
                        </Space>
                      }
                    >
                      <Typography.Text style={{ fontFamily: "var(--mono)", color: "rgba(255,255,255,0.45)" }}>
                        {iss.path}
                      </Typography.Text>
                    </Card>
                  ))}
                </Space>
              )}
            </div>
          </Layout.Sider>
        )}
      </Layout>
    </Layout>
  );
}
