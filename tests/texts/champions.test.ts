import { describe, expect, it } from 'vitest';
import detailAr from '../fixtures/cdragon/champion-103.ar_ae.json' with { type: 'json' };
import detailEn from '../fixtures/cdragon/champion-103.default.json' with { type: 'json' };
import summaryAr from '../fixtures/cdragon/champion-summary.ar_ae.sample.json' with { type: 'json' };
import summaryEn from '../fixtures/cdragon/champion-summary.default.sample.json' with { type: 'json' };
import spellsAr from '../fixtures/cdragon/summoner-spells.ar_ae.sample.json' with { type: 'json' };
import spellsEn from '../fixtures/cdragon/summoner-spells.default.sample.json' with { type: 'json' };
import stylesAr from '../fixtures/cdragon/perkstyles.ar_ae.json' with { type: 'json' };
import stylesEn from '../fixtures/cdragon/perkstyles.default.json' with { type: 'json' };
import { assetUrl } from '../../src/texts/assets.js';
import { buildChampionDetail, buildChampionList, buildSpellTexts, buildStyleTexts } from '../../src/texts/champions.js';

const ASSETS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';

describe('assetUrl', () => {
  it('maps client asset paths to lowercase CommunityDragon URLs', () => {
    expect(assetUrl('/lol-game-data/assets/v1/champion-icons/103.png')).toBe(`${ASSETS}v1/champion-icons/103.png`);
    expect(assetUrl('/lol-game-data/assets/ASSETS/Items/Icons2D/A.PNG')).toBe(`${ASSETS}assets/items/icons2d/a.png`);
    expect(assetUrl('')).toBe('');
  });
});

describe('buildChampionList', () => {
  const list = buildChampionList(summaryAr, summaryEn);
  it('drops the "none" entry and Jade variants (ids >= 10000)', () => {
    expect(list.map((c) => c.id).sort((a, b) => a - b)).toEqual([62, 103]);
  });
  it('carries Arabic and English names, alias and portrait', () => {
    expect(list.find((c) => c.id === 62)).toEqual({
      id: 62, name: 'ووكونغ', enName: 'Wukong', alias: 'MonkeyKing', portraitUrl: `${ASSETS}v1/champion-icons/62.png`,
    });
  });
});

describe('buildChampionDetail', () => {
  const d = buildChampionDetail(detailAr, detailEn);
  it('lists passive then Q W E R with English names and Arabic descriptions', () => {
    expect(d.abilities.map((a) => a.key)).toEqual(['P', 'Q', 'W', 'E', 'R']);
    expect(d.abilities[1]).toMatchObject({ enName: 'Orb of Deception', name: 'كرة الخداع' });
    expect(d.abilities[1].html).toContain('ترمي آري كرتها');
    expect(d.abilities[1].iconUrl).toBe(`${ASSETS}assets/characters/ahri/hud/icons2d/icons_ahri_q.png`);
    expect(d).toMatchObject({ id: 103, name: 'آري', enName: 'Ahri', alias: 'Ahri' });
  });
});

describe('buildSpellTexts / buildStyleTexts', () => {
  it('builds summoner spells with both names', () => {
    const s = buildSpellTexts(spellsAr, spellsEn);
    expect(s.get(4)).toMatchObject({ id: 4, name: 'الانتقال الخاطف', enName: 'Flash' });
    expect(s.get(4)!.html).toContain('تنقلك');
    expect(s.get(4)!.iconUrl).toBe(`${ASSETS}data/spells/icons2d/summoner_flash.png`);
  });
  it('builds rune trees', () => {
    const t = buildStyleTexts(stylesAr.styles, stylesEn.styles);
    expect(t.get(8100)).toMatchObject({ name: 'سيطرة', enName: 'Domination', html: '' });
  });
});
