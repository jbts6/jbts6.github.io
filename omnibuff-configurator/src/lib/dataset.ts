export type Dataset = {
  manifest: { id: string; name: string; files: Array<{ type: string; path: string }> }
  enums: { tags: string[]; event_type: string[]; action_kind: string[]; scope: string[] }
  stat_defs: Array<Record<string, unknown>>
  buff_defs: BuffDef[]
}

export type BuffDef = {
  buff_id: number
  buff_key: string
  name: string
  tags: string[]
  duration: { type: 'PERMANENT' | 'TURNS'; turns?: number }
  stack: { mode: 'REPLACE' | 'ADD_STACK' | 'MULTI_INSTANCE'; max_stack: number }
  notes?: string
  triggers: Array<Record<string, unknown>>
  effects: Array<Record<string, unknown>>
}

export function snakeCase(s: string) {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

export function nextBuffId(ds: Dataset) {
  const ids = ds.buff_defs.map((b) => Number(b.buff_id)).filter((n) => Number.isFinite(n))
  const max = ids.length ? Math.max(...ids) : 99999
  return Math.max(100000, max + 1)
}

function primaryModifierSummary(buff: BuffDef) {
  const e0 = (buff.effects?.[0] ?? {}) as Record<string, unknown>
  if (String(e0.kind ?? '') !== 'modifier') return null

  const op = String(e0.op ?? 'ADD').toLowerCase()
  const stat = String(e0.stat ?? 'STAT').toLowerCase()
  const value = Number(e0.value ?? 0)

  const turns = buff.duration.type === 'TURNS' ? Number(buff.duration.turns ?? 0) : 0
  const dur = turns > 0 ? `_t${turns}` : ''
  return `${op}_${stat}_${value}${dur}`
}

export function generateBuffKey(buff: BuffDef) {
  const s = primaryModifierSummary(buff)
  if (s) return snakeCase(s)
  return snakeCase(buff.buff_key || `buff_${buff.buff_id}`)
}

export function normalizeDataset(input: any): Dataset {
  const ds = input as Partial<Dataset>
  const out: Dataset = {
    manifest: (ds.manifest ?? { id: 'dataset', name: 'Dataset', files: [] }) as any,
    enums: (ds.enums ?? { tags: [], event_type: [], action_kind: [], scope: [] }) as any,
    stat_defs: (ds.stat_defs ?? []) as any,
    buff_defs: [],
  }

  let next = 100000
  const seen = new Set<number>()

  for (const raw of (ds.buff_defs ?? []) as any[]) {
    const b = raw ?? {}

    const buff_id =
      typeof b.buff_id === 'number'
        ? b.buff_id
        : typeof b.id === 'number'
          ? b.id
          : undefined

    let idFinal = Number.isFinite(buff_id) ? Number(buff_id) : next++
    if (idFinal < 100000) idFinal = 100000 + (idFinal % 100000)
    while (seen.has(idFinal)) idFinal++
    seen.add(idFinal)
    next = Math.max(next, idFinal + 1)

    const buff_key =
      typeof b.buff_key === 'string'
        ? b.buff_key
        : typeof b.key === 'string'
          ? b.key
          : typeof b.id === 'string'
            ? b.id
            : `buff_${idFinal}`

    const normalized: BuffDef = {
      buff_id: idFinal,
      buff_key: snakeCase(buff_key),
      name: String(b.name ?? '未命名 Buff'),
      tags: Array.isArray(b.tags) ? b.tags : [],
      duration: b.duration ?? { type: 'PERMANENT' },
      stack: b.stack ?? { mode: 'REPLACE', max_stack: 1 },
      notes: typeof b.notes === 'string' ? b.notes : undefined,
      triggers: Array.isArray(b.triggers) ? b.triggers : [],
      effects: Array.isArray(b.effects) ? b.effects : [],
    }

    out.buff_defs.push(normalized)
  }

  return out
}

export function exportSortedDataset(ds: Dataset): Dataset {
  return {
    ...ds,
    buff_defs: [...ds.buff_defs].sort((a, b) => a.buff_id - b.buff_id),
  }
}

