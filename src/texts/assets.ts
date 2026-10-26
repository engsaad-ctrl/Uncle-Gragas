const ASSETS = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/';

/** Client asset path ("/lol-game-data/assets/…") → CommunityDragon URL (CDragon serves lowercase paths). */
export const assetUrl = (path: string) => (path ? ASSETS + path.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase() : '');
