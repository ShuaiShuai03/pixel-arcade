// Names, lessons and host-visible wording in English and Simplified Chinese.
const row = (nameEn, nameZh, lessonEn, lessonZh) => [
  { en: nameEn, zh: nameZh },
  { en: lessonEn, zh: lessonZh },
];
export const SECTOR_TEXT = [
  row(
    'Cloudbreak',
    '破云空域',
    'Sidestep aimed rounds and fans; release Fire when the cannon overheats.',
    '横移躲开瞄准弹和扇形弹幕；炮口过热时松开射击。',
  ),
  row(
    'Copper Coast',
    '铜色海岸',
    'A burst follows its warning line: leave the line once the lock appears.',
    '连射沿预警线发射：锁定出现后立刻离开该线。',
  ),
  row(
    'Storm Channel',
    '风暴航道',
    'A lit lane fires after a flash: climb or dive out of it. Fans leave gaps.',
    '亮起的横带闪烁后开火：上升或下潜离开。扇形弹幕有空隙。',
  ),
  row(
    'Dune Run',
    '沙丘航线',
    'Snipers shoot ahead of your motion: reverse after the warning, then clear the lane.',
    '狙击机会预判你的移动：预警后改变方向，并离开横带。',
  ),
  row(
    'Night Convoy',
    '夜间船团',
    'Break both turrets, then hit the gold core. Slide sideways out of a falling column.',
    '先击毁两座炮塔，再攻击金色核心；横移躲开落下的光柱。',
  ),
  row(
    'Frost Field',
    '霜原航段',
    'Bombers drop a curtain with one opening: read the rays and slide into it.',
    '轰炸机投下带缺口的弹幕：看清射线，移入缺口。',
  ),
  row(
    'Cinder Gate',
    '余烬之门',
    'The charged cannon commits to its line. Strike the core after the volley.',
    '蓄能炮沿预警线射出整串炮弹，齐射后攻击核心。',
  ),
  row(
    'Reef Patrol',
    '礁岸巡逻',
    'A ring leaves wide spaces: stand between two rays and let it pass.',
    '环形弹幕留有宽缝：站在两条射线之间让它通过。',
  ),
  row(
    'Foundry Belt',
    '熔炉传送带',
    'A grid of light leaves open aisles: pick one early. Turrets first, then the core.',
    '光幕网格留有空档：提前选定一条。先打炮塔，再打核心。',
  ),
  row(
    'Emerald Canopy',
    '翡翠林冠',
    "Snipers and bursts overlap: dodge the sniper's line first, then slip the burst.",
    '狙击机与连射交错：先躲开狙击线，再避开连射。',
  ),
  row(
    'Neon Harbor',
    '霓虹港口',
    'Rings and fans arrive together: watch the rays, then thread the grid lanes.',
    '环形和扇形弹幕同时出现：看清射线，再穿过网格间的横带。',
  ),
  row(
    'Ash Storm',
    '灰烬风暴',
    'A cross strike hits a lane and a column at once: escape on the diagonal.',
    '十字打击同时封锁横带与光柱：沿对角线逃离。',
  ),
  row(
    'Glacier Pass',
    '冰川隘口',
    'Snipers lead their shots while grids close the aisles: keep moving between columns.',
    '狙击机预判走位，网格封锁通道：在光柱之间持续移动。',
  ),
  row(
    'Sunken Fleet',
    '沉没舰队',
    'Curtains and rings fill the screen: find the opening before the cross strike lands.',
    '轰炸机弹幕与环形弹幕铺满画面：在十字打击落下前找到缺口。',
  ),
  row(
    'Mesa Gauntlet',
    '台地走廊',
    "Break the turrets, outrun the snipers' lead and punish each charged volley.",
    '击毁炮塔，摆脱狙击机预判，并在每次蓄能齐射后反击。',
  ),
  row(
    'Iron Skyway',
    '钢铁天桥',
    'Rings, bursts and turrets together: keep moving and spend a charge early.',
    '环形弹幕、连射和炮塔同时出现：持续移动，尽早使用拦截弹。',
  ),
  row(
    'Crimson Dusk',
    '绯红黄昏',
    'Snipers, bombers and fans overlap: sort threats by how soon they land.',
    '狙击机、轰炸机和扇形弹幕交错：按落点先后排序威胁。',
  ),
  row(
    'Asteroid Belt',
    '小行星带',
    'Rings, charged streams and bursts: fire in the pauses between volleys.',
    '环形弹幕、蓄能炮和连射交错：在齐射的间隙开火。',
  ),
  row(
    'Thunder Citadel',
    '雷霆要塞',
    "Turrets first, then the core; bombers' curtains and a cross strike close in.",
    '先炮塔后核心；轰炸机弹幕与十字打击逼近。',
  ),
  row(
    'Magma Rift',
    '熔岩裂谷',
    'Bursts, rings and leading snipers: change direction after every warning.',
    '连射、环形弹幕与预判的狙击机：每次预警后都要改变方向。',
  ),
  row(
    'Midnight Metropolis',
    '午夜都会',
    'Rings, curtains and turrets above a lit grid: plan your next safe lane.',
    '环形弹幕、轰炸机弹幕与炮塔，加上网格：规划下一条安全横带。',
  ),
  row(
    'Void Approach',
    '虚空前线',
    'Four volley types in one fight: stay mobile and watch the grid and columns.',
    '同一场战斗有四种齐射：保持机动，留意网格与光柱。',
  ),
  row(
    "Admiral's Wake",
    '统帅航迹',
    'Turrets, leading shots, curtains and charged streams: use every defence.',
    '炮塔、预判射击、轰炸机弹幕和蓄能炮：用上所有防御手段。',
  ),
  row(
    'Regent Carrier',
    '摄政航母',
    'The final carrier uses every volley: turrets first, then the core, charges ready.',
    '最终航母会用出所有齐射：先打炮塔再打核心，随时准备拦截弹。',
  ),
];

/** The result line shown by the host, worded for how the run ended. */
export function endMessage(env, { won, cause, total }) {
  if (won)
    return env.t(
      `All ${total} sectors cleared and every carrier destroyed. The skies are yours!`,
      `${total}片空域全部清空，所有航母均已击破。天空属于你！`,
    );
  if (cause === 'collision')
    return env.t(
      'Hull collision exhausted your shields. Give large ships room.',
      '机体碰撞耗尽了护盾，请与大型舰船保持距离。',
    );
  if (cause === 'hazard')
    return env.t(
      'A strike zone exhausted your shields. Leave a flashing lane or column before it fires.',
      '打击区域耗尽了护盾。在闪烁的横带或光柱开火前离开。',
    );
  return env.t(
    'Incoming fire exhausted your shields. Move across warning lines and use charges early.',
    '敌方炮火耗尽了护盾。横向避开预警线，提前使用拦截弹。',
  );
}
