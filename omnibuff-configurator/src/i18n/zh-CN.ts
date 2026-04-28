export const zhCN: Record<string, string> = {
  "nav.manifest": "清单",
  "nav.enums": "枚举",
  "nav.stats": "属性",
  "nav.buffs": "Buff",

  "tag.BUFF": "增益",
  "tag.DEBUFF": "减益",
  "tag.DOT": "持续伤害",
  "tag.AURA": "光环",
  "tag.SKILL": "技能",
  "tag.BONUS_DAMAGE": "追加伤害",

  "event_type.DAMAGE": "伤害结算",
  "event_type.DOT": "持续伤害",
  "event_type.LIFE": "生死事件",
  "event_type.COMMAND": "指令事件",

  "scope.SELF": "自身",
  "scope.SOURCE": "来源",
  "scope.TARGET": "目标",

  "op.ADD": "加法",
  "op.MUL": "乘法",
  "op.OVERRIDE": "覆盖",

  "phase.FLAT": "平铺加成",
  "phase.PERCENT": "百分比",
  "phase.FINAL": "最终加成",

  "duration.PERMANENT": "永久",
  "duration.TURNS": "回合数",

  "action_kind.HEAL": "治疗",
  "action_kind.BONUS_DAMAGE": "追加伤害",
  "action_kind.APPLY_BUFF": "施加 Buff",
  "action_kind.DISPEL": "驱散",
  "action_kind.ADD_STACKS": "增加层数",
  "action_kind.SET_STACKS": "设定层数",

  "event_phase.BUILD": "构建",
  "event_phase.BEFORE_DEAL": "出手前",
  "event_phase.BEFORE_TAKE": "受击前",
  "event_phase.RESOLVE": "结算",
  "event_phase.APPLY": "应用",
  "event_phase.AFTER_DEAL": "出手后",
  "event_phase.AFTER_TAKE": "受击后",
  "event_phase.TURN_START": "回合开始",
  "event_phase.TURN_END": "回合结束",
  "event_phase.DEATH": "死亡",
  "event_phase.REVIVE": "复活",
  "event_phase.BEFORE": "之前",
  "event_phase.AFTER": "之后",
};

export function t(key: string, fallback?: string) {
  return zhCN[key] ?? fallback ?? key;
}

