import { test, expect, openClaude, openCodex } from './support/app.mjs';

for (const theme of ['dark','light','highContrast']) {
  test(`shared square frames fit the gallery, overview and history: ${theme}`,async({page},info)=>{
    await openClaude(page,{fixture:'achievement-share-resources',theme,locale:'zh-CN',width:360});
    await page.locator('#tab-achievements').click();
    const gallery=page.locator('[data-achievement-key="cumulative-volume"]');
    await expect(gallery.locator('summary .achievement-framed-icon')).toHaveAttribute('data-achievement-frame','bronze');
    const neutral=await gallery.evaluate(el=>getComputedStyle(el).borderTopColor);
    expect(neutral).toBe(await page.locator('.achievement-card.locked').first().evaluate(el=>getComputedStyle(el).borderTopColor));
    for (const size of ['small','medium','large']) {
      await page.locator('#achievementSize').selectOption(size);
      for (const width of [320,360]) {
        await page.setViewportSize({width,height:900});
        expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        const geometry=await gallery.locator('summary .achievement-framed-icon').evaluate(el=>{
          const box=el.getBoundingClientRect(), art=el.querySelector('img').getBoundingClientRect(),frame=el.querySelector('svg').getBoundingClientRect();
          return {artInside:art.left>=box.left&&art.right<=box.right&&art.top>=box.top&&art.bottom<=box.bottom,
            bounded:frame.width===box.width&&frame.height===box.height, artworkWidth:art.width, artworkHeight:art.height};
        });
        expect(geometry).toEqual({artInside:true,bounded:true,artworkWidth:{small:56,medium:80,large:112}[size],artworkHeight:{small:56,medium:80,large:112}[size]});
      }
    }
    const targets=page.locator('[data-achievement-overview="next"] .achievement-framed-icon');
    expect(await targets.count()).toBeGreaterThan(0);
    for (const target of await targets.all()) {
      await expect(target).toHaveAttribute('data-emblem-state','target');
      await expect(target.locator('[data-art-size]:visible [data-frame-part="square"]')).toHaveAttribute('stroke-dasharray','4 3');
    }
    const records=page.locator('.achievement-record-badge .achievement-framed-icon');
    expect(await records.count()).toBeGreaterThan(0);
    for (const record of await records.all()) await expect(record).toHaveAttribute('data-emblem-state','earned');
    await gallery.scrollIntoViewIfNeeded();
    await gallery.screenshot({path:info.outputPath(`adornment-${theme}.png`),animations:'disabled'});
    await page.reload();
    await expect(page.locator('#achievementSize')).toHaveValue('large');
  });
}

for (const locale of ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id']) {
  test(`${locale}: milestone-only cards remain neutral and disclose exact real tiers`,async({page})=>{
    await openCodex(page,{fixture:'achievement-theme-milestones',locale,width:320});
    await page.locator('#tab-achievements').click();
    const card=page.locator('[data-achievement-key="active-day-streak"]');
    await expect(card.locator('summary .achievement-framed-icon')).toHaveAttribute('data-achievement-frame','milestone');
    await expect(card.locator('summary [data-art-size]:visible [data-frame-part="complete"]')).toHaveCount(1);
    await expect(card.locator('summary [data-frame-part="laurel"]')).toHaveCount(0);
    await card.locator('summary').click();
    await expect(card.locator('[data-achievement-milestone="streak-machine"] .achievement-framed-icon')).toHaveAttribute('data-achievement-frame','milestone');
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
    await page.reload();
    await expect(card.locator('details')).toHaveAttribute('open');
    await expect(card.locator('summary .achievement-framed-icon')).toHaveAttribute('data-achievement-frame','milestone');
  });
}

test('sharing keeps native image URIs and compact versions of the same rank identities',async({page})=>{
  await page.setViewportSize({width:360,height:900});
  await page.goto(`http://127.0.0.1:${process.env.CCU_UI_TEST_PORT ?? 4173}/?provider=claude&fixture=achievement-share-resources&commandTemplate=achievements`);
  await expect(page.locator('#sharingTemplate')).toHaveValue('achievements');
  const options=page.locator('.achievement-share-option');
  expect(await options.count()).toBeGreaterThan(9);
  for (const option of await options.all()) {
    const id=await option.locator('input').getAttribute('value');
    await expect(option.locator('.achievement-framed-icon')).toHaveAttribute('data-emblem-state','earned');
    await expect(option.locator('img')).toHaveAttribute('data-achievement-icon',id);
    await expect(option.locator('img')).toHaveAttribute('loading','lazy');
    const frame=option.locator('svg');
    const gallery=page.locator(`.achievement-card summary img[data-achievement-icon="${id}"]`);
    if(await gallery.count()) {
      expect(await gallery.locator('..').getAttribute('data-achievement-frame')).toBe(await option.locator('.achievement-framed-icon').getAttribute('data-achievement-frame'));
      await expect(frame.locator('[data-art-size="48"]')).toHaveCount(1);
      await expect(frame.locator('[data-frame-part="laurel"]')).toHaveCount(0);
    }
  }
});

for (const theme of ['dark','light']) {
  test(`readable artwork at original scale in every achievement surface: ${theme}`,async({page},info)=>{
    await openClaude(page,{fixture:'achievement-share-resources',theme,locale:'zh-CN',width:1280});
    await page.locator('#tab-achievements').click();
    await page.locator('#achievementSize').selectOption('medium');
    for(const selector of ['.achievement-card summary','.achievement-overview-badge','.achievement-record-badge']) {
      for(const icon of await page.locator(selector+' > .achievement-framed-icon, '+selector+' > .achievement-emblem > .achievement-framed-icon').all()) {
        if(!await icon.isVisible()) continue;
        const dimensions=await icon.evaluate(el=>{
          const box=el.getBoundingClientRect(),art=el.querySelector('img').getBoundingClientRect();
          return {box:box.width,width:art.width,height:art.height};
        });
        expect(dimensions.width).toBe(dimensions.box-(dimensions.box>56?16:0));
        expect(dimensions.height).toBe(dimensions.box-(dimensions.box>56?16:0));
      }
    }
    await page.locator('.achievement-showcase').screenshot({path:info.outputPath(`overview-${theme}.png`)});
    await page.locator('.achievement-group').first().screenshot({path:info.outputPath(`gallery-${theme}.png`)});
    await page.locator('#achievementSize').selectOption('small');
    const leaf=page.locator('.achievement-card summary [data-art-size="112"] [data-frame-part="laurel"]').first();
    if(await leaf.count()) await expect(leaf).toBeHidden();
    await page.locator('#achievementSize').selectOption('large');
    if(await leaf.count()) await expect(leaf).toBeVisible();
  });
}
