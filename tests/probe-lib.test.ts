import { describe, expect, it } from 'vitest';
import { fillArgs, summarizeJson } from '../scripts/probe-lib.mjs';

describe('fillArgs', () => {
  it('fills required fields from hints, matching enums case-insensitively', () => {
    const schema = {
      type: 'object',
      properties: {
        champion: { type: 'string', enum: ['AATROX', 'AHRI'] },
        position: { type: 'string', enum: ['top', 'mid'] },
        lang: { type: 'string' },
        optional: { type: 'string' },
      },
      required: ['champion', 'position', 'lang'],
    };
    expect(fillArgs(schema)).toEqual({ champion: 'AHRI', position: 'mid', lang: 'ar_AE' });
  });

  it('uses the first enum value when no hint matches', () => {
    const schema = { properties: { region: { enum: ['na', 'euw'] } }, required: ['region'] };
    expect(fillArgs(schema, {})).toEqual({ region: 'na' });
  });

  it('uses defaults for numbers and booleans', () => {
    const schema = {
      properties: { limit: { type: 'integer', default: 5 }, flag: { type: 'boolean' } },
      required: ['limit', 'flag'],
    };
    expect(fillArgs(schema, {})).toEqual({ limit: 5, flag: false });
  });

  it('returns null when a required string cannot be filled', () => {
    const schema = { properties: { puuid: { type: 'string' } }, required: ['puuid'] };
    expect(fillArgs(schema, {})).toBeNull();
  });

  it('returns {} for a schema with no required fields', () => {
    expect(fillArgs({ type: 'object' })).toEqual({});
  });
});

describe('summarizeJson', () => {
  it('summarizes an array: length, first keys, first Arabic sample', () => {
    const s = summarizeJson([{ id: 1, name: 'السيف الأبدي', price: 3 }]);
    expect(s).toBe('array(1) keys=[id,name,price] ar="السيف الأبدي"');
  });

  it('summarizes an object by its keys', () => {
    expect(summarizeJson({ a: 1, b: 'x' })).toBe('object keys=[a,b] ar=none');
  });
});
