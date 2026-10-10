// Review-only, network-free catalog; never evaluates grants or reads source logs.
const { ACHIEVEMENT_DEFINITIONS, ACHIEVEMENT_SERIES } = require('../../../out/achievements');
const { achievementCopyFor } = require('../../../out/i18n');
const { ACHIEVEMENT_IMAGE_FILES, achievementImageDataUrl } = require('../../../out/achievementIcons');
const { ACHIEVEMENT_GALLERY, achievementGalleryKey } = require('../../../out/achievementGallery');
const { achievementConditionFor } = require('../../../out/achievementConditions');
const { API_ACHIEVEMENT_DEFINITIONS, isAchievementMoneyId } = require('../../../out/achievementMoneyCatalog');
const { achievementMoneyCopyFor } = require('../../../out/achievementMoneyCopy');

// Units and evidence notes, not independently maintained award thresholds.
const evidence = {
  'sonnet-main': ['已处理 Token', 'processed tokens', '仅认可可确认的 Sonnet 模型家族。', 'Verified Sonnet family only.'],
  'opus-cannon': ['已处理 Token', 'processed tokens', '仅认可可确认的 Opus 模型家族。', 'Verified Opus family only.'],
  'haiku-worker': ['已处理 Token', 'processed tokens', '仅认可可确认的 Haiku 模型家族。', 'Verified Haiku family only.'],
  'cache-wizard': ['缓存读取 Token', 'cache-read tokens', '衡量缓存读取总量，不是命中率。', 'Cache-read volume, not cache hit rate.'],
  'claude-output': ['输出 Token', 'output tokens', '只计 Claude 输出，不计输入与缓存。', 'Claude output only; input and cache excluded.'],
  'claude-output-sessions': ['有输出的会话', 'sessions with output', '完整会话汇总去重，不受列表 1000 条上限影响。', 'Deduplicated full session evidence; not the 1,000-row display cap.'],
  'claude-cache-creation': ['缓存写入 Token', 'cache-creation tokens', '衡量缓存写入总量，不评价缓存效率。', 'Cache-creation volume, not an efficiency score.'],
  'codex-output': ['输出 Token', 'output tokens', '只计已核验的 Codex 输出；推理是输出的子集，不重复相加。', 'Verified Codex output only; reasoning is an output subset and is not added again.'],
  'codex-cache-read': ['缓存输入 Token', 'cached input tokens', '只计已核验的 Codex 缓存输入；它是输入的子集，不是 Claude 缓存写入或命中率。', 'Verified Codex cached input only; an input subset, not Claude cache writes or cache hit rate.'],
  'fable-volume': ['已处理 Token', 'processed tokens', '仅使用明确支持的 Fable／Mythos 5、5.1 模型 ID。', 'Only explicitly supported Fable/Mythos 5 and 5.1 IDs.'],
  'fable-days': ['Fable 达标日', 'qualified Fable days', '当前配置时区内，每个已结束自然日 Fable 家族均须有输出且已处理 Token ≥1M；须有完整、已验证的日期数值证据，不要求连续。', 'In the current configured timezone, Fable needs output and 1M+ processed tokens on each counted closed civil day; complete validated numeric day evidence required, with no consecutive-day requirement.'],
  'fable-sessions': ['有 Fable 输出的会话', 'sessions with Fable output', '同一会话只计一次；仅输入不算。', 'Each session once; input-only activity does not count.'],
  'fable-relay': ['同一会话', 'one session', 'Fable 与另一 Claude 家族在同一会话中各有输出。', 'Fable and another Claude family both output in the same session.'],
  'astra-regular': ['已处理 Token', 'processed tokens', '完整当前索引中已独立核验的 Astra 谱系用量；冲突分支及其子会话不计入。', 'Astra usage from independently verified lineages in the complete current index; conflicting branches and descendants excluded.'],
  'sol-regular': ['已处理 Token', 'processed tokens', '完整当前索引中已独立核验的 Sol 谱系用量；冲突分支及其子会话不计入。', 'Sol usage from independently verified lineages in the complete current index; conflicting branches and descendants excluded.'],
  'luna-regular': ['已处理 Token', 'processed tokens', '完整当前索引中已独立核验的 Luna 谱系用量；冲突分支及其子会话不计入。', 'Luna usage from independently verified lineages in the complete current index; conflicting branches and descendants excluded.'],
  'sonnet-days': ['Sonnet 达标日', 'qualified Sonnet days', '当前配置时区内，每个已结束自然日 Sonnet 家族有输出且已处理 Token ≥1M；不要求连续。', 'In the current configured timezone, Sonnet has output and 1M+ processed tokens on each counted closed civil day; days need not be consecutive.'],
  'opus-days': ['Opus 达标日', 'qualified Opus days', '当前配置时区内，每个已结束自然日 Opus 家族有输出且已处理 Token ≥1M；不要求连续。', 'In the current configured timezone, Opus has output and 1M+ processed tokens on each counted closed civil day; days need not be consecutive.'],
  'haiku-days': ['Haiku 达标日', 'qualified Haiku days', '当前配置时区内，每个已结束自然日 Haiku 家族有输出且已处理 Token ≥1M；不要求连续。', 'In the current configured timezone, Haiku has output and 1M+ processed tokens on each counted closed civil day; days need not be consecutive.'],
  'astra-days': ['Astra 达标日', 'qualified Astra days', '当前配置时区内，每个已结束自然日 Astra 家族有输出且已处理 Token ≥1M；须有完整索引、身份及全历史日期核验。', 'In the current configured timezone, Astra has output and 1M+ processed tokens on each counted closed civil day; complete index, identity and all-time day verification required.'],
  'sol-days': ['Sol 达标日', 'qualified Sol days', '当前配置时区内，每个已结束自然日 Sol 家族有输出且已处理 Token ≥1M；须有完整索引、身份及全历史日期核验。', 'In the current configured timezone, Sol has output and 1M+ processed tokens on each counted closed civil day; complete index, identity and all-time day verification required.'],
  'luna-days': ['Luna 达标日', 'qualified Luna days', '当前配置时区内，每个已结束自然日 Luna 家族有输出且已处理 Token ≥1M；须有完整索引、身份及全历史日期核验。', 'In the current configured timezone, Luna has output and 1M+ processed tokens on each counted closed civil day; complete index, identity and all-time day verification required.'],
  'dual-provider-days': ['双供应商达标日', 'qualified dual-provider days', '当前配置时区内，同一已结束自然日 Claude 与 Codex 各有输出且各已处理 Token ≥1M；不要求连续，Codex 日期证据须完整核验。', 'In the current configured timezone, Claude and Codex each have output and 1M+ processed tokens on the same closed civil day; days need not be consecutive and Codex day evidence must be fully verified.'],
  'dual-provider-day': ['同一自然日', 'one civil day', '当前配置时区内，Claude 与 Codex 在同一已结束自然日各有输出且各已处理 Token ≥1M；Codex 日期证据须完整核验。', 'In the current configured timezone, Claude and Codex each have output and 1M+ processed tokens on the same closed civil day; Codex day evidence must be fully verified.'],
  'three-family-day': ['同日达标的三个家族', 'three qualified families in one day', '当前配置时区内，同一已结束自然日从 Sonnet／Opus／Fable／Haiku／Astra／Sol／Luna 中至少三个家族各有输出且各已处理 Token ≥1M；日期数值证据须完整核验。', 'In the current configured timezone, at least three of Sonnet/Opus/Fable/Haiku/Astra/Sol/Luna each need output and 1M+ processed tokens on the same closed civil day; complete validated numeric day evidence required.'],
  'agent-team': ['达标任务数', 'qualified tasks', '', ''],
  'agent-conductor': ['达标编排任务数', 'qualified orchestration tasks', '', ''],
  'root-portfolio': ['可确认的主会话', 'verified main sessions', '须有真实模型用量；孤儿与冲突副本不算。', 'Actual model usage required; orphans and conflicting copies excluded.'],
  'agent-participation': ['达标的不同子智能体', 'distinct qualified subagents', '', ''],
  'model-relay-roots': ['达标多模型任务数', 'qualified multi-model tasks', '', ''],
  'same-root-models': ['达标多模型任务数', 'qualified multi-model tasks', '', ''],
  'effort-breadth': ['达标的 effort 档位', 'qualified effort tiers', '', ''],
  'weekly-volume': ['单个自然周的已处理 Token', 'processed tokens in one calendar week', '当前配置时区、周一开始；仅用完整、已验证的日期数值证据，不代表账户额度或个人工作量。', 'Current configured timezone, Monday start; complete validated numeric day evidence only, not account quota or personal work.'],
  'active-weeks': ['至少四个达标日的完整自然周', 'completed calendar weeks with 4+ qualified days', '当前配置时区、周一开始；每周至少四个已结束自然日 Claude 或 Codex 有输出且已处理 Token ≥1M，跨供应商按日期去重；完整核验日期数值证据，不要求周连续。', 'Current configured timezone, Monday start; at least four closed days per completed week on which Claude or Codex has output and 1M+ processed tokens, deduplicated across providers. Complete validated numeric day evidence required; weeks need not be consecutive.'],
  'weekly-average': ['四个已结束自然周的周均值峰值', 'best mean processed tokens/week over four completed weeks', '当前配置时区、周一开始；取连续四个完整已结束周的总量除以四后的峰值，排除首个不完整周及本周。仅经完整数值证据核验的零用量周留在分母；日历覆盖不完整不能证明实际用量为零。成功持久保存后，本地仅留存一个已核验的数值最大值；复用须计量版本、时区、供应商存在状态一致，且所有预期供应商的当前规范化证据完整有效。清空成就删除该值。', 'Current configured timezone, Monday start; best total divided by four across four complete consecutive closed weeks, excluding the first partial week and current week. Only verified zero-usage weeks stay in the denominator; incomplete calendar coverage cannot prove zero actual usage. After a successful durable save, one verified numeric maximum is retained locally; reuse requires matching measurement versions, timezone and provider presence, plus complete valid current normalized proofs from every expected provider. Clearing achievements removes it.'],
  'output-hours': ['连续 UTC 小时', 'consecutive UTC hours', '每小时都有输出，可跨日／模型／供应商；不是连续工作。24／48 小时静默。', 'Output each hour across dates/models/providers; not human work. 24/48 hours stay quiet.'],
  'active-day-streak': ['连续活跃日', 'consecutive active days', '所选时区中每日均有可确认本地用量。', 'Verified local usage every civil day in the configured timezone.'],
  'active-days': ['累计活跃日', 'distinct active days', '跨供应商按日期去重，不要求连续。', 'Dates deduplicated across providers; no consecutive-day requirement.'],
  'model-rainbow': ['达标模型家族', 'qualified model families', '', ''],
  'night-output-peak': ['30 日内的夜间画像', 'night-time pattern over 30 days', '≥14 输出日、≥5 夜间输出日；22–06 点有输出小时数比另两时段均高 ≥20%。静默。', '14+ output days, 5+ night days; 22–06 output-positive hours exceed both other bands by 20%+. Quiet.'],
  'streak-machine': ['连续活跃日', 'consecutive active days', '保留原十四日单次徽章，放入连续活跃主题详情，不替代三级连续日系列。', 'Legacy fourteen-day single badge inside the active streak details, not a replacement for its three tiers.'],
  'settings-explorer': ['主动修改的不同安全设置项', 'distinct deliberately changed safe settings', '只计成功保存；不计默认、迁移、重置或重复操作。', 'Successful deliberate changes only; defaults, migrations, resets and repeats excluded.'],
  'safe-feature-explorer': ['安全体验步骤', 'safe feature steps', '查看成就页 → 主动预览分享卡 → 成功本地导出。', 'View gallery, deliberately preview sharing, successfully export locally.'],
  'local-share-export': ['成功本地 SVG 导出', 'successful local SVG export', '预览不算；无需 GitHub 或公开发布。', 'Preview is not export; no GitHub access or public publication required.'],
  'local-advice-feedback': ['已保存的本地反馈', 'saved local feedback', '查看有证据的本地建议并反馈；无需密钥或模型请求。', 'View evidence-backed local advice and save feedback; no API key or model request.'],
};
for (const id of ['cumulative-volume']) {
  evidence[id] = ['累计已处理 Token', 'cumulative processed tokens', 'Claude 与 Codex 本地用量；歧义 Codex 仅计保守下界。', 'Combined local usage; ambiguous Codex copies contribute only a conservative lower bound.'];
}

function achievementCatalog(locale = 'zh-CN') {
  if (!['zh-CN', 'en'].includes(locale)) throw new Error('Review catalog supports zh-CN and en');
  const zh = locale === 'zh-CN';
  const copy = achievementCopyFor(locale);
  const moneyCopy = achievementMoneyCopyFor(locale);
  const byId = new Map(ACHIEVEMENT_DEFINITIONS.map((row) => [row.id, row]));
  const seriesById = new Map(Object.entries(ACHIEVEMENT_SERIES)
    .flatMap(([key, ids]) => ids.map((id) => [id, key])));
  const seen = new Set();
  const cards = [];
  for (const definition of ACHIEVEMENT_DEFINITIONS) {
    const key = seriesById.get(definition.id) ?? definition.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const ids = ACHIEVEMENT_SERIES[key] ?? [definition.id];
    const monetary = API_ACHIEVEMENT_DEFINITIONS.find((row) => row.id === ids[0]);
    const scope = monetary && (monetary.scope === 'cumulative' ? 'total' :
      monetary.scope === 'completedMondayWeekPeak' ? 'week' : monetary.group === 'claude' ? 'session' : 'task');
    const detail = monetary ? [moneyCopy.unit, moneyCopy.unit,
      moneyCopy[scope] + ' ' + moneyCopy.note + ' 冻结参考价目表，不采用实时账单价格；未知价格用量不计入金额，可靠的已定价部分以 ≥ 下界表示。内部目标为整数 microUSD，显示美元向下取整。',
      moneyCopy[scope] + ' ' + moneyCopy.note + ' Frozen reference pricebook, not live billing prices; unknown-price usage is excluded from money and a reliable priced partial is shown as a ≥ lower bound. Internal targets are integer microUSD; displayed USD is floored.'] : evidence[key];
    if (!detail) throw new Error(`Missing reviewed evidence note: ${key}`);
    let title = copy.titles[ids[0]];
    if (ids.length > 1) {
      const suffix = [` · ${copy.levels[0]}`, `·${copy.levels[0]}`, ' I']
        .find((ending) => title.endsWith(ending));
      if (suffix) title = title.slice(0, -suffix.length);
    }
    if (key === 'active-day-streak') title = zh ? '连续活跃日' : 'Active-day streak';
    if (key === 'cumulative-volume') title = zh ? '累计 Token' : 'Cumulative tokens';
    const levels = ids.map((id, index) => ({
      id, target: byId.get(id).target, title: copy.titles[id],
      condition: achievementConditionFor(locale, id),
      tier: ids.length === 1 ? 'single' : ['ordinary', 'silver', 'gold', 'platinum', 'legendary'][index],
      label: ids.length === 1 ? copy.milestone : copy.levels[index],
      artwork: ACHIEVEMENT_IMAGE_FILES[id], image: achievementImageDataUrl(id),
    }));
    // Qualification text is production-owned; the formal target supplies the
    // repetition/breadth requirement rather than a second threshold table.
    const qualifications = levels.filter((level) => level.condition).map((level) =>
      `${level.label}: ≥${compact(level.target)} ${detail[zh ? 0 : 1]}; ${level.condition}`).join(' ');
    cards.push({
      key, displayKey: achievementGalleryKey(key), group: definition.group, title,
      metric: detail[zh ? 0 : 1], note: qualifications || detail[zh ? 2 : 3], levels,
    });
  }
  return cards;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}
function compact(value) {
  return require('../../../out/achievementFormat').formatAchievementCompact(value);
}
function displayTarget(level, locale) {
  return isAchievementMoneyId(level.id)
    ? '$' + require('../../../out/achievementFormat').formatAchievementInteger(Math.floor(level.target / 1_000_000), locale)
    : compact(level.target);
}

function renderCatalogGroup(catalog, group, locale = 'zh-CN') {
  const zh = locale === 'zh-CN';
  const cards = catalog.filter((card) => card.group === group);
  const copy = achievementCopyFor(locale);
  const ruleCount = cards.reduce((sum, card) => sum + card.levels.length, 0);
  return `<!doctype html><html lang="${locale}"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(copy.groups[group])}</title><style>
    *{box-sizing:border-box}body{margin:0;background:#1e1e1e;color:#d4d4d4;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
    main{padding:22px 18px;width:100%;max-width:480px;margin:auto}h1{font-size:29px;line-height:1.2;margin:4px 0 8px}header p,footer{font-size:14px;line-height:1.55;color:#b9b9b9;margin:7px 0}header{margin-bottom:20px}
    article{padding:17px 0;border-top:1px solid #444;display:grid;grid-template-columns:104px minmax(0,1fr);column-gap:14px;break-inside:avoid}
    img.main-icon{width:104px;height:104px;object-fit:contain}h2{font-size:21px;line-height:1.35;margin:1px 0 6px;color:#f0f0f0}p{margin:0}p.metric{font-size:14px;line-height:1.45;color:#b9b9b9}
    .levels{display:flex;gap:12px;margin-top:9px;flex-wrap:wrap}.level{display:flex;flex-direction:column;font-size:14px;line-height:1.6}.level strong{font-size:19px}.ordinary{color:#e7b899}.silver{color:#d6dce5}.gold{color:#efce76}.platinum{color:#8dcaf0}.legendary{color:#cfadff}.single{color:#d4d4d4}
    p.note{grid-column:1/-1;font-size:14px;line-height:1.6;color:#b9b9b9;margin:11px 0 0}.tier-icons{grid-column:1/-1;display:flex;gap:14px;margin-top:9px}.tier-icons span{display:flex;align-items:center;gap:5px;font-size:13px}.tier-icons img{width:36px;height:36px;object-fit:contain}footer{border-top:1px solid #444;padding-top:14px;margin-top:6px}
  </style><main><header><h1>${escapeHtml(copy.groups[group])}</h1><p>${zh ? '图鉴审阅，非个人解锁记录' : 'Catalog review, not personal award history'}</p><p>${cards.length} ${zh ? '张卡片' : 'cards'} / ${ruleCount} ${zh ? '个可解锁等级' : 'unlockable awards'}</p></header>
  ${cards.map((card) => `<article data-review-card="${card.key}"><img class="main-icon" src="${card.levels[0].image}" alt="${escapeHtml(card.title)}"><div><h2>${escapeHtml(card.title)}</h2><p class="metric">${escapeHtml(card.metric)}</p><div class="levels">${card.levels.map((level) => `<span class="level ${level.tier}">${level.label}<strong>${displayTarget(level, locale)}</strong></span>`).join('')}</div></div><p class="note">${escapeHtml(card.note)}</p>${new Set(card.levels.map((level) => level.artwork)).size > 1 ? `<div class="tier-icons">${card.levels.map((level) => `<span class="${level.tier}"><img src="${level.image}" alt="${escapeHtml(level.title)}">${level.label}</span>`).join('')}</div>` : ''}</article>`).join('')}
  <footer>${zh ? '使用候选内图标，重复系列图案已替换。M＝百万，B＝十亿，T＝万亿。记录本地使用经历，不评价能力、生产力或个人工作时间。' : 'Bundled candidate artwork; duplicate series art replaced. M = million; B = billion; T = trillion. Local usage history, not skill, productivity or human working time.'}</footer></main></html>`;
}

function renderCatalogMarkdown(catalog, locale = 'zh-CN') {
  const zh = locale === 'zh-CN';
  const copy = achievementCopyFor(locale);
  const threeTierCount = catalog.filter(card => card.levels.length === 3).length;
  const fourTierCount = catalog.filter(card => card.levels.length === 4).length;
  const fiveTierCount = catalog.filter(card => card.levels.length === 5).length;
  const singleCount = catalog.filter(card => card.levels.length === 1).length;
  const lines = [`# ${zh ? 'v2.4.2 成就与图标审阅清单' : 'v2.4.2 achievement and artwork review'}`, '',
    zh ? `${threeTierCount} 个三级系列 + ${fourTierCount} 个四级系列 + ${fiveTierCount} 个五级系列 + ${singleCount} 个单次成就，共 ${catalog.length} 套图案、${catalog.reduce((sum, card) => sum + card.levels.length, 0)} 个解锁条件；默认界面归为 ${ACHIEVEMENT_GALLERY.length} 张主题卡。十四日与双供应商首日保留原图，进入对应主题详情。图鉴不是个人获奖记录。门槛与图片直接来自编译后的候选代码；每个系列图案独立，各等级共用同一徽章。` :
      `${threeTierCount} three-tier series + ${fourTierCount} four-tier series + ${fiveTierCount} five-tier series + ${singleCount} single awards: ${catalog.length} artwork groups and ${catalog.reduce((sum, card) => sum + card.levels.length, 0)} award conditions in ${ACHIEVEMENT_GALLERY.length} default theme cards. Fourteen-day and first shared-day milestones retain their art inside theme details. This catalog is not personal award history. Targets and artwork come directly from the compiled candidate; each series has distinct artwork shared by its tiers.`, ''];
  for (const group of ['claude', 'codex', 'combined', 'plugin']) {
    lines.push(`## ${copy.groups[group]}`, '', zh ? '| 成就 | 等级门槛（低→高） | 计量与条件 | 原图 |' :
      '| Achievement | Level targets (low to high) | Evidence | Artwork |', '|:--|:--|:--|:--|');
    for (const card of catalog.filter((entry) => entry.group === group)) {
      lines.push(`| ${card.title} | ${card.levels.map((level) => displayTarget(level, locale)).join(' / ')} | ${card.metric}；${card.note} | ${[...new Set(card.levels.map((level) => level.artwork))].map((name) => `\`${name}\``).join(', ')} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { achievementCatalog, renderCatalogGroup, renderCatalogMarkdown };
