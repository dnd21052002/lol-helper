/**
 * Static counter data - curated manually.
 * Format: enemyChampionId → list of counter picks with win rate & tip.
 *
 * Sau này sẽ scrape từ u.gg/op.gg hoặc dùng Riot API stats.
 * Hiện tại chỉ cover ~30 champion phổ biến nhất.
 */

export interface CounterData {
  championId: number;
  championName: string;
  winRate: number;
  tip: string;
}

// Key = enemy champion ID
export const COUNTER_MAP: Record<number, CounterData[]> = {
  // Aatrox (266)
  266: [
    { championId: 114, championName: 'Fiora', winRate: 54.1, tip: 'Parry Aatrox Q sweetspots. Short trades with Vital procs.' },
    { championId: 58, championName: 'Renekton', winRate: 52.8, tip: 'Dash through Q sweetspots. All-in early with empowered W.' },
    { championId: 240, championName: 'Kled', winRate: 52.3, tip: 'Aggressive all-ins. Remount mechanic counters his burst.' }
  ],
  // Ahri (103)
  103: [
    { championId: 238, championName: 'Zed', winRate: 53.5, tip: 'Dodge charm with shadow swap. All-in at 6.' },
    { championId: 55, championName: 'Katarina', winRate: 52.1, tip: 'Roam advantage. Dodge charm with Shunpo.' },
    { championId: 7, championName: 'LeBlanc', winRate: 51.8, tip: 'Burst before she can charm. W back to dodge.' }
  ],
  // Darius (122)
  122: [
    { championId: 17, championName: 'Teemo', winRate: 54.2, tip: 'Kite with blind and poison. Never let him stack passive.' },
    { championId: 150, championName: 'Gnar', winRate: 53.1, tip: 'Poke in mini form. Disengage when he pulls.' },
    { championId: 85, championName: 'Kennen', winRate: 52.7, tip: 'Ranged poke. E away from his pull.' }
  ],
  // Yasuo (157)
  157: [
    { championId: 90, championName: 'Malzahar', winRate: 54.8, tip: 'Passive blocks windwall mind games. R suppresses through windwall.' },
    { championId: 80, championName: 'Pantheon', winRate: 53.2, tip: 'Point-click stun ignores windwall. Early dominance.' },
    { championId: 99, championName: 'Lux', winRate: 51.5, tip: 'Outrange him. Bind when he dashes in.' }
  ],
  // Zed (238)
  238: [
    { championId: 90, championName: 'Malzahar', winRate: 55.1, tip: 'Passive shield blocks combo. R when he ults you.' },
    { championId: 127, championName: 'Lissandra', winRate: 53.8, tip: 'Self-ult when he ults. Root him after shadow swap.' },
    { championId: 8, championName: 'Vladimir', winRate: 52.4, tip: 'Pool his ult damage. Sustain through poke.' }
  ],
  // Jinx (222)
  222: [
    { championId: 119, championName: 'Draven', winRate: 54.5, tip: 'Stronger early all-in. Punish her weak laning.' },
    { championId: 236, championName: 'Lucian', winRate: 53.0, tip: 'Short trades with passive. Zone her from farm.' },
    { championId: 51, championName: 'Caitlyn', winRate: 52.2, tip: 'Outrange with traps. Headshot poke in lane.' }
  ],
  // Lux (99)
  99: [
    { championId: 238, championName: 'Zed', winRate: 54.3, tip: 'All-in at 6. Dodge Q with shadow.' },
    { championId: 105, championName: 'Fizz', winRate: 53.7, tip: 'E dodges everything. All-in post-6.' },
    { championId: 55, championName: 'Katarina', winRate: 52.0, tip: 'Shunpo dodges Q. Roam when she plays safe.' }
  ],
  // Thresh (412)
  412: [
    { championId: 25, championName: 'Morgana', winRate: 55.2, tip: 'Black Shield blocks hook and flay. Free lane.' },
    { championId: 117, championName: 'Lulu', winRate: 52.5, tip: 'Polymorph his ADC engage. Poke with Q.' },
    { championId: 37, championName: 'Sona', winRate: 51.3, tip: 'Outscale. Sustain through his poke. Stay behind minions.' }
  ],
  // Lee Sin (64)
  64: [
    { championId: 121, championName: "Kha'Zix", winRate: 53.4, tip: 'Stronger 1v1 in isolated fights. Invade when Q evolved.' },
    { championId: 104, championName: 'Graves', winRate: 52.8, tip: 'Healthy clears. Kite with E. Outscale.' },
    { championId: 254, championName: 'Vi', winRate: 51.9, tip: 'Point-click ult. Stronger ganks post-6.' }
  ],
  // Vayne (67)
  67: [
    { championId: 119, championName: 'Draven', winRate: 55.8, tip: 'Massive early damage. Zone her completely.' },
    { championId: 51, championName: 'Caitlyn', winRate: 53.5, tip: 'Range advantage. Trap her tumble spots.' },
    { championId: 202, championName: 'Jhin', winRate: 52.1, tip: 'W root + 4th shot burst. Punish short range.' }
  ],
  // Katarina (55)
  55: [
    { championId: 90, championName: 'Malzahar', winRate: 55.0, tip: 'R cancels her ult. Passive blocks burst.' },
    { championId: 127, championName: 'Lissandra', winRate: 53.6, tip: 'Root/ult stops her resets. Zone with W.' },
    { championId: 1, championName: 'Annie', winRate: 52.8, tip: 'Point-click stun stops ult. Burst with Tibbers.' }
  ],
  // Master Yi (11)
  11: [
    { championId: 33, championName: 'Rammus', winRate: 56.2, tip: 'Taunt + thornmail. He kills himself attacking you.' },
    { championId: 72, championName: 'Skarner', winRate: 53.1, tip: 'Ult suppresses through his R. Sticky CC.' },
    { championId: 113, championName: 'Sejuani', winRate: 52.5, tip: 'Heavy CC chain. Peel for carries.' }
  ],
  // Garen (86)
  86: [
    { championId: 67, championName: 'Vayne', winRate: 55.3, tip: 'Kite forever. Condemn when he Qs. True damage shreds.' },
    { championId: 17, championName: 'Teemo', winRate: 54.0, tip: 'Blind his Q. Kite with poison. Never melee range.' },
    { championId: 85, championName: 'Kennen', winRate: 52.9, tip: 'Ranged bully. E away from his engage.' }
  ],
  // Sylas (517)
  517: [
    { championId: 69, championName: 'Cassiopeia', winRate: 53.8, tip: 'Grounded prevents his E. Sustained DPS wins.' },
    { championId: 90, championName: 'Malzahar', winRate: 53.2, tip: 'Stolen ult is weaker without voidlings. Push and roam.' },
    { championId: 61, championName: 'Orianna', winRate: 52.0, tip: 'Safe poke. Ball zone control. Outscale.' }
  ],
  // Jax (24)
  24: [
    { championId: 90, championName: 'Malzahar', winRate: 53.5, tip: 'Suppress ignores counterstrike. Kite with voidlings.' },
    { championId: 150, championName: 'Gnar', winRate: 53.0, tip: 'Kite in mini. Mega form CC when he jumps.' },
    { championId: 85, championName: 'Kennen', winRate: 52.4, tip: 'Ranged poke. Stun when he leaps. Never auto in counterstrike.' }
  ],
  // Irelia (39)
  39: [
    { championId: 24, championName: 'Jax', winRate: 53.9, tip: 'Counterstrike blocks her passive autos. Outscale.' },
    { championId: 58, championName: 'Renekton', winRate: 53.1, tip: 'Stun breaks her all-in. Short trades with W.' },
    { championId: 86, championName: 'Garen', winRate: 52.0, tip: 'Silence stops her combo. Spin in her face.' }
  ],
  // Kai\'Sa (145)
  145: [
    { championId: 119, championName: 'Draven', winRate: 54.2, tip: 'Bully early. She needs items to scale.' },
    { championId: 51, championName: 'Caitlyn', winRate: 53.0, tip: 'Range advantage. Trap when she dashes in.' },
    { championId: 21, championName: 'Miss Fortune', winRate: 52.3, tip: 'Lane bully. Q bounce poke. Ult in teamfights.' }
  ],
  // Yone (777)
  777: [
    { championId: 58, championName: 'Renekton', winRate: 54.5, tip: 'Stun his E return. All-in early.' },
    { championId: 80, championName: 'Pantheon', winRate: 53.8, tip: 'Point-click stun. Shield blocks his combo.' },
    { championId: 90, championName: 'Malzahar', winRate: 53.0, tip: 'Suppress when he Es in. Push and roam.' }
  ],
  // Viego (234)
  234: [
    { championId: 24, championName: 'Jax', winRate: 53.5, tip: 'Counterstrike blocks his passive autos. Outscale 1v1.' },
    { championId: 58, championName: 'Renekton', winRate: 52.8, tip: 'Early dominance. Stun and burst before he heals.' },
    { championId: 240, championName: 'Kled', winRate: 52.1, tip: 'Aggressive all-in. Grievous wounds on W.' }
  ]
};

/**
 * Get counter picks for a given enemy champion.
 */
export function getCountersFor(enemyChampionId: number): CounterData[] {
  return COUNTER_MAP[enemyChampionId] ?? [];
}
