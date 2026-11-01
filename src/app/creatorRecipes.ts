// Builds read from creators' videos on patch 16.21: the champion, the augments the title names and the items seen at the
// end of the game. Only what was read: slots that couldn't be read stay out, and nothing here says the build is stronger.
// Rebuild by hand on a new patch.

export const RECIPES_PATCH = '16.21';

export interface Recipe {
  champion: string;
  augments: string[];
  items: string[];
  channel: string;
}

export const CREATOR_RECIPES: Recipe[] = [
  { champion: 'Tahm Kench', augments: ['Goliath', 'Tank Engine'], items: ['Heartsteel', 'Riftmaker', 'Dusk and Dawn', 'Void Staff'], channel: 'BodyThoseFools' },
  { champion: "Cho'Gath", augments: ['Jeweled Gauntlet'], items: ['Lich Bane', 'Statikk Shiv', "Sorcerer's Shoes", "Nashor's Tooth", "Rabadon's Deathcap", 'Void Staff'], channel: 'MoreZwag' },
  { champion: 'Gangplank', augments: ['Ultra Hydra'], items: ['Manamune', 'Infinity Edge', 'Essence Reaver', "Lord Dominik's Regards"], channel: 'BodyThoseFools' },
  { champion: 'Morgana', augments: ['Spell Split'], items: ['Blackfire Torch', "Liandry's Torment", "Rabadon's Deathcap", 'Void Staff', 'Shadowflame'], channel: 'BodyThoseFools' },
  { champion: 'Garen', augments: ['Clown College'], items: ['Gluttonous Greaves', 'Phantom Dancer', "Sterak's Gage", 'The Collector', 'Infinity Edge'], channel: 'BodyThoseFools' },
  { champion: 'Nasus', augments: ['Overloaded'], items: ["Liandry's Torment", 'Blackfire Torch', "Rabadon's Deathcap", 'Shadowflame', 'Void Staff'], channel: 'BodyThoseFools' },
  { champion: 'Malzahar', augments: ["Pandora's Box"], items: ['Shadowflame', 'Blackfire Torch', "Liandry's Torment", "Rabadon's Deathcap", 'Void Staff'], channel: 'BodyThoseFools' },
  { champion: 'Smolder', augments: ['Vulnerability', 'Jeweled Gauntlet'], items: ['Black Cleaver', "Liandry's Torment", 'Essence Reaver', 'Infinity Edge', 'Hubris'], channel: 'BodyThoseFools' },
  { champion: 'Shaco', augments: ['Clown College'], items: ['Infinity Edge', 'Hubris', 'Voltaic Cyclosword', 'Trinity Force', "Serpent's Fang"], channel: 'MoreZwag' },
  { champion: 'Nidalee', augments: ['Enchanting Butterflies'], items: ["Luden's Echo", 'Shadowflame', "Rabadon's Deathcap", 'Void Staff', "Liandry's Torment"], channel: 'BodyThoseFools' },
  { champion: 'Graves', augments: ['Heavy is the Crown'], items: ['Hubris', 'Infinity Edge', 'Bloodthirster', "Lord Dominik's Regards"], channel: 'BodyThoseFools' },
  { champion: 'Caitlyn', augments: ['Big Shot'], items: ["Berserker's Greaves", 'Infinity Edge', 'Phantom Dancer', 'Essence Reaver'], channel: 'BodyThoseFools' },
  { champion: 'Twisted Fate', augments: ['Echo Cast'], items: ['Rapid Firecannon', 'Stormsurge', 'Lich Bane', "Rabadon's Deathcap", 'Shadowflame', "Luden's Echo"], channel: 'BodyThoseFools' },
];
