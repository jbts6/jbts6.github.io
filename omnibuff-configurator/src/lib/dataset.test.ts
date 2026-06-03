import { describe, expect, it } from 'vitest'

import {
  exportSortedDataset,
  generateBuffKey,
  nextBuffId,
  normalizeDataset,
  type Dataset,
} from './dataset'

describe('dataset core', () => {
  it('nextBuffId starts at 100000 and increments from max', () => {
    const ds = {
      manifest: { id: 'x', name: 'x', files: [] },
      enums: { tags: [], event_type: [], action_kind: [], scope: [] },
      stat_defs: [],
      buff_defs: [
        {
          buff_id: 100000,
          buff_key: 'a',
          name: 'A',
          tags: [],
          duration: { type: 'PERMANENT' },
          stack: { mode: 'REPLACE', max_stack: 1 },
          effects: [],
          triggers: [],
        },
        {
          buff_id: 100005,
          buff_key: 'b',
          name: 'B',
          tags: [],
          duration: { type: 'PERMANENT' },
          stack: { mode: 'REPLACE', max_stack: 1 },
          effects: [],
          triggers: [],
        },
      ],
    } satisfies Dataset

    expect(nextBuffId(ds)).toBe(100006)
  })

  it('generateBuffKey uses primary modifier effect + duration turns', () => {
    const buff = {
      buff_id: 100000,
      buff_key: 'tmp',
      name: '战斗口粮',
      tags: ['BUFF'],
      duration: { type: 'TURNS', turns: 5 },
      stack: { mode: 'REPLACE', max_stack: 1 },
      effects: [{ kind: 'modifier', stat: 'ATK', op: 'ADD', phase: 'FLAT', priority: 100, value: 20 }],
      triggers: [],
    } satisfies Dataset['buff_defs'][number]

    expect(generateBuffKey(buff)).toBe('add_atk_20_t5')
  })

  it('normalizeDataset migrates old string id into buff_key and assigns buff_id', () => {
    const legacy: any = {
      manifest: { id: 'x', name: 'x', files: [] },
      enums: { tags: ['BUFF'], event_type: [], action_kind: [], scope: [] },
      stat_defs: [],
      buff_defs: [
        {
          id: 'buff_food_atk_20_5t',
          name: '战斗口粮',
          tags: ['BUFF'],
          duration: { type: 'TURNS', turns: 5 },
          stack: { mode: 'REPLACE', max_stack: 1 },
          effects: [{ kind: 'modifier', stat: 'ATK', op: 'ADD', phase: 'FLAT', priority: 100, value: 20 }],
          triggers: [],
        },
      ],
    }

    const ds = normalizeDataset(legacy)
    expect(ds.buff_defs[0].buff_id).toBeGreaterThanOrEqual(100000)
    expect(ds.buff_defs[0].buff_key).toBe('buff_food_atk_20_5t')
  })

  it('exportSortedDataset sorts buff_defs by buff_id ascending', () => {
    const ds = {
      manifest: { id: 'x', name: 'x', files: [] },
      enums: { tags: [], event_type: [], action_kind: [], scope: [] },
      stat_defs: [],
      buff_defs: [
        {
          buff_id: 100002,
          buff_key: 'b',
          name: 'B',
          tags: [],
          duration: { type: 'PERMANENT' },
          stack: { mode: 'REPLACE', max_stack: 1 },
          effects: [],
          triggers: [],
        },
        {
          buff_id: 100000,
          buff_key: 'a',
          name: 'A',
          tags: [],
          duration: { type: 'PERMANENT' },
          stack: { mode: 'REPLACE', max_stack: 1 },
          effects: [],
          triggers: [],
        },
      ],
    } satisfies Dataset

    const out = exportSortedDataset(ds)
    expect(out.buff_defs.map((b) => b.buff_id)).toEqual([100000, 100002])
  })
})

