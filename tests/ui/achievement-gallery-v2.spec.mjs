import { test, expect, openClaude } from './support/app.mjs';

async function confirmAchievementPatch(page, fixture) {
  const url = new URL(page.url());
  url.searchParams.set('fixture', fixture);
  const response = await page.context().request.get(url.href);
  expect(response.ok()).toBe(true);
  await page.evaluate(html => {
    const next = new DOMParser().parseFromString(html, 'text/html').getElementById('provider-panel');
    window.__ccuPostedMessages = [];
    dispatchEvent(new MessageEvent('message', { data: {
      command: 'dashboardDataPatch', provider: 'claude', tab: 'achievements', revision: 1,
      html: next.innerHTML, claudeLast30HoursByDay: {}, adviceSnapshotIds: {},
    } }));
  }, await response.text());
  await expect.poll(() => page.evaluate(() => window.__ccuPostedMessages.filter(m => m.command === 'dashboardDataPatchAck')))
    .toEqual([{command:'dashboardDataPatchAck',revision:1,ok:true}]);
  await page.clock.runFor(200);
}

async function rememberShareAndDocument(page) {
  return page.evaluate(() => {
    // Seed a deliberate, nonempty choice so preservation cannot pass vacuously.
    const choices = Array.from(document.querySelectorAll('.achievement-share-choice'));
    if (!choices.length) throw new Error('Production fixture must contain earned share choices');
    const ids = [choices[0].value];
    choices.forEach(el => { el.checked = ids.includes(el.value); });
    localStorage.setItem('ccu.sharing.achievementBadges',JSON.stringify(ids));
    window.__galleryDocument = document.documentElement;
    return {
      share: localStorage.getItem('ccu.sharing.achievementBadges'),
      selected: Array.from(document.querySelectorAll('.achievement-share-choice:checked')).map(el => el.value),
    };
  });
}

async function expectShareAndDocumentUnchanged(page, before) {
  const after = await page.evaluate(() => ({
    sameDocument: window.__galleryDocument === document.documentElement,
    share: localStorage.getItem('ccu.sharing.achievementBadges'),
    selected: Array.from(document.querySelectorAll('.achievement-share-choice:checked')).map(el => el.value),
    messages: window.__ccuPostedMessages,
  }));
  const {messages,...state} = after;
  expect(state).toEqual({...before,sameDocument:true});
  // Existing Claude patch hydration reapplies saved choices to the real share
  // presentation. It must not request a deliberate preview/export or host work.
  expect(messages.map(m => m.command)).toEqual(['restoreAchievementShare','dashboardDataPatchAck']);
  expect(messages[0].ids).toEqual(before.selected);
}

test('gallery size changes emblem and card geometry, keeps text and survives reload without host work', async ({page}) => {
  await openClaude(page,{width:360,fixture:'achievement-pins'});
  await page.locator('#tab-achievements').click();
  const size = page.locator('#achievementSize');
  await expect(size).toHaveValue('medium');
  const card = page.locator('.achievement-card').first();
  const textSize = await card.locator('h4').evaluate(el=>getComputedStyle(el).fontSize);
  for (const [value,pixels] of [['small',56],['medium',80],['large',112]]) {
    await size.selectOption(value);
    expect(await card.locator('.achievement-emblem').evaluate(el=>el.getBoundingClientRect().width)).toBe(pixels);
    expect(await card.locator('h4').evaluate(el=>getComputedStyle(el).fontSize)).toBe(textSize);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  await page.reload();
  await expect(size).toHaveValue('large');
  expect(await page.evaluate(()=>window.__ccuPostedMessages.some(m=>['refresh','updateSetting','setAchievementPinned'].includes(m.command)))).toBe(false);
});

const galleryLocales = ['en','de-DE','zh-TW','zh-CN','ja','ko','pt-BR','id'];
const galleryThemes = ['light','dark','highContrast'];
const gallerySizes = [['small',56],['medium',80],['large',112]];
const moneyArtworkKeys = ['claude-api-total','claude-api-week','claude-api-session',
  'codex-api-total','codex-api-week','codex-api-task'];

test.describe('money v2 artwork narrow captures', () => {
  for (const locale of galleryLocales) for (const theme of ['light','dark']) for (const [size,emblem] of gallerySizes) {
    test(`${locale} ${theme} ${size}: six v2 money cards at 320px`, async ({page},testInfo) => {
      await openClaude(page,{locale,theme,fixture:'achievement-six-pins',width:320,height:900});
      await page.locator('#tab-achievements').click();
      await expectThemeFidelity(page,theme);
      await page.locator('#achievementSize').selectOption(size);
      await expect(page.locator('.achievement-collection')).toHaveAttribute('data-achievement-size',size);
      for (const key of moneyArtworkKeys) {
        const card = page.locator(`.achievement-card[data-achievement-key="${key}"]`);
        await expect(card).toHaveCount(1);
        const artwork = card.locator('.achievement-emblem img');
        // Version proof comes from the production registry's rendered metadata;
        // a pre-v2 image cannot silently produce an accepted v2 screenshot.
        await expect(artwork).toHaveAttribute('data-achievement-artwork',`${key}-v242-v2.png`);
        await card.scrollIntoViewIfNeeded();
        await expect.poll(() => artwork.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
        const geometry = await card.evaluate(el => ({
          emblem:el.querySelector('.achievement-emblem').getBoundingClientRect().width,
          titleFont:parseFloat(getComputedStyle(el.querySelector('h4')).fontSize),
          titleFits:el.querySelector('h4').scrollWidth <= el.querySelector('h4').clientWidth + 1,
          closed:!el.querySelector('details').open,
          noPageOverflow:document.documentElement.scrollWidth <= innerWidth + 1,
        }));
        expect(geometry).toEqual({emblem,titleFont:expect.any(Number),titleFits:true,closed:true,noPageOverflow:true});
        expect(geometry.titleFont).toBeGreaterThanOrEqual(13);
        // The standard fixture has no invented money awards. These captures
        // faithfully show the production locked/evidence-pending card state.
        await card.screenshot({path:testInfo.outputPath(`${locale}-${theme}-${size}-${key}-v242-v2.png`),animations:'disabled'});
      }
      expect(await page.evaluate(() => window.__ccuPostedMessages.some(m =>
        ['refresh','updateSetting','setAchievementPinned','editAchievementShowcase','previewAchievementShare','exportAchievementShare'].includes(m.command)))).toBe(false);
    });
  }
});

async function expectThemeFidelity(page, theme) {
  const tokens = await page.evaluate(() => {
    const css = Array.from(document.querySelectorAll('head style:not(#test-vscode-theme)'))
      .map(el => el.textContent).join('\n');
    const harness = document.querySelector('#test-vscode-theme').textContent;
    const defined = new Map(Array.from(harness.matchAll(/(--vscode-[\w-]+)\s*:\s*([^;{}]*);/g), m => [m[1],m[2].trim()]));
    const referenced = Array.from(new Set(Array.from(css.matchAll(/var\(\s*(--vscode-[\w-]+)/g), m => m[1])));
    // Only explicit `initial` for these registered nullable theme colors may
    // compute empty. Every reference, including fallbacks, needs a definition.
    const nullable = new Set(['--vscode-input-border','--vscode-textBlockQuote-background','--vscode-toolbar-hoverBackground',
      '--vscode-button-secondaryBackground','--vscode-button-secondaryHoverBackground','--vscode-charts-orange',
      '--vscode-list-inactiveSelectionBackground','--vscode-widget-shadow']);
    const computed = getComputedStyle(document.documentElement);
    return {
      referenced: referenced.length,
      missingRequired: referenced.filter(name => !defined.has(name) || (!computed.getPropertyValue(name).trim() &&
        !(nullable.has(name) && defined.get(name) === 'initial'))),
      background: getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim(),
      bodyClass: document.body.className,
    };
  });
  expect(tokens.referenced).toBeGreaterThan(0);
  expect(tokens.missingRequired).toEqual([]);
  expect(tokens.background).toBe({light:'#ffffff',dark:'#1e1e1e',highContrast:'#000000'}[theme]);
  expect(tokens.bodyClass).toContain({light:'vscode-light',dark:'vscode-dark',highContrast:'vscode-high-contrast'}[theme]);
}

test.describe('gallery locale, size, theme and narrow-layout matrix', () => {
  // Chromium's touch-capable context exercises the production coarse-pointer
  // media query; no CSS replacement is used to manufacture the 44px hit target.
  test.use({hasTouch:true});
  for (const locale of galleryLocales) for (const theme of galleryThemes) for (const width of [320,360]) {
    test(`${locale} ${theme} ${width}px: all sizes, coarse targets and 200% CSS zoom`, async ({page}, testInfo) => {
      await openClaude(page,{locale,theme,fixture:'achievement-six-pins',width,height:900});
      await page.locator('#tab-achievements').click();
      await expectThemeFidelity(page,theme);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      await page.locator('#achievementShowcaseEditor > summary').click();
      const collection = page.locator('.achievement-collection');
      const toolbar = page.locator('.achievement-filter-toolbar');
      const card = page.locator('.achievement-card').first();
      for (const zoom of [1,2]) {
        // CSS zoom is a layout stress surrogate, not a claim of native browser
        // zoom. Doubling the surface retains 320/360 effective CSS pixels.
        await page.setViewportSize({width:width*zoom,height:900});
        await page.evaluate(value => { document.documentElement.style.zoom = String(value); },zoom);
        let baseFonts;
        for (const [size,emblem] of gallerySizes) {
          await page.locator('#achievementSize').selectOption(size);
          await expect(collection).toHaveAttribute('data-achievement-size',size);
          const layout = await page.evaluate(({zoom}) => {
            const root = document.querySelector('.achievement-collection');
            const toolbar = root.querySelector('.achievement-filter-toolbar');
            const editor = root.querySelector('#achievementShowcaseEditor');
            const overview = root.querySelector('[data-achievement-overview="badges"]');
            const first = root.querySelector('.achievement-card');
            const textSelectors = ['h4','.achievement-next-target'];
            const fonts = textSelectors.map(selector => parseFloat(getComputedStyle(first.querySelector(selector)).fontSize));
            const overflowingText = Array.from(root.querySelectorAll('.achievement-card h4,.achievement-next-target,.achievement-overview-name,.achievement-selected-pins li > span'))
              .filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 1)
              .map(el => el.textContent.trim());
            const pinTargets = Array.from(root.querySelectorAll('.achievement-pin-icon'))
              .filter(el => el.getClientRects().length)
              .map(el => ({width:el.getBoundingClientRect().width/zoom,height:el.getBoundingClientRect().height/zoom}));
            return { fonts,overflowingText,pinTargets,
              overflow:document.documentElement.scrollWidth > innerWidth + 1,
              documentWidth:document.documentElement.scrollWidth,viewportWidth:innerWidth,
              overflowElements:Array.from(root.querySelectorAll('*')).filter(el => {
                if (!el.getClientRects().length) return false;
                const rect = el.getBoundingClientRect();
                return rect.right > innerWidth + 1 || rect.left < -1;
              }).slice(0,8).map(el => ({tag:el.tagName,id:el.id,class:el.className,
                right:el.getBoundingClientRect().right,left:el.getBoundingClientRect().left})),
              toolbarBeforeEditor:Boolean(toolbar.compareDocumentPosition(editor) & Node.DOCUMENT_POSITION_FOLLOWING),
              toolbarBeforeOverview:Boolean(toolbar.compareDocumentPosition(overview) & Node.DOCUMENT_POSITION_FOLLOWING),
              emblem:first.querySelector('.achievement-emblem').getBoundingClientRect().width/zoom,
            };
          },{zoom});
          expect(layout.overflow,JSON.stringify({locale,theme,width,zoom,size,
            documentWidth:layout.documentWidth,viewportWidth:layout.viewportWidth,overflowElements:layout.overflowElements})).toBe(false);
          expect(layout.overflowingText).toEqual([]);
          expect(layout.toolbarBeforeEditor).toBe(true);
          expect(layout.toolbarBeforeOverview).toBe(true);
          expect(layout.emblem).toBeCloseTo(emblem,1);
          expect(layout.fonts[0]).toBeGreaterThanOrEqual(13);
          expect(layout.fonts[1]).toBeGreaterThanOrEqual(11.5);
          if (!baseFonts) baseFonts = layout.fonts;
          expect(layout.fonts).toEqual(baseFonts);
          expect(layout.pinTargets.length).toBeGreaterThan(0);
          for (const target of layout.pinTargets) {
            expect(target.width).toBeGreaterThanOrEqual(44);
            expect(target.height).toBeGreaterThanOrEqual(44);
          }
          await toolbar.scrollIntoViewIfNeeded();
          await page.screenshot({path:testInfo.outputPath(`${size}-${zoom*100}pct-controls.png`),animations:'disabled'});
          await card.scrollIntoViewIfNeeded();
          await page.screenshot({path:testInfo.outputPath(`${size}-${zoom*100}pct-gallery.png`),animations:'disabled'});
        }
      }
      await page.evaluate(() => { document.documentElement.style.zoom = ''; });
      await page.setViewportSize({width,height:900});
      await page.locator('#achievementFilter').selectOption('earned');
      await page.reload();
      await expect(page.locator('#achievementSize')).toHaveValue('large');
      await expect(page.locator('#achievementFilter')).toHaveValue('earned');
      await expect(page.locator('#achievementShowcaseEditor')).toHaveAttribute('open');
      expect(await page.evaluate(() => window.__ccuPostedMessages.some(m =>
        ['refresh','updateSetting','setAchievementPinned','editAchievementShowcase'].includes(m.command)))).toBe(false);
    });
  }
});

test('a pin is visible on a closed card, sends one document-bound intent and does not expand', async ({page}) => {
  await openClaude(page,{width:320,fixture:'achievement-pins'});
  await page.locator('#tab-achievements').click();
  const card = page.locator('[data-achievement-key="local-share-export"]');
  const pin = card.locator('[data-achievement-pin="local-share-export"]');
  await expect(card.locator('details')).not.toHaveAttribute('open');
  await expect(pin).toBeVisible();
  expect(await pin.evaluate(el=>el.getBoundingClientRect().width)).toBeGreaterThanOrEqual(32);
  await pin.focus(); await pin.press('Enter');
  await expect(card.locator('details')).not.toHaveAttribute('open');
  const requests = await page.evaluate(()=>window.__ccuPostedMessages.filter(m=>m.command==='setAchievementPinned'));
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({key:'local-share-export',selected:false,generation:1});
  expect(requests[0].documentId).toMatch(/^[0-9a-f]{48}$/);
  await expect(pin).toBeDisabled();
  await page.evaluate(()=>dispatchEvent(new MessageEvent('message',{data:{command:'achievementPinResult',key:'local-share-export',ok:false,reason:'failed'}})));
  await expect(pin).toBeEnabled(); await expect(pin).toHaveAttribute('aria-pressed','true');
});

test('six explicit pins stay manual; keyboard reorder includes the complete saved list', async ({page}) => {
  await openClaude(page,{fixture:'achievement-six-pins',width:360});
  await page.locator('#tab-achievements').click();
  await expect(page.locator('[data-achievement-overview="badges"] .achievement-overview-badge')).toHaveCount(6);
  await page.locator('#achievementShowcaseEditor > summary').click();
  await expect(page.locator('#achievementSelectedCount')).toContainText('6/6');
  const selected = page.locator('#achievementSelectedPins > li');
  await expect(selected).toHaveCount(6);
  const before = await selected.evaluateAll(rows=>rows.map(row=>row.dataset.pinKey));
  await selected.nth(1).locator('[data-pin-move="up"]').focus();
  await selected.nth(1).locator('[data-pin-move="up"]').press('Enter');
  const request = await page.evaluate(()=>window.__ccuPostedMessages.find(m=>m.command==='editAchievementShowcase'));
  expect(request).toMatchObject({action:'reorder',generation:1,revision:0});
  expect(request.keys).toEqual([before[1],before[0],...before.slice(2)]);
  expect(request.documentId).toMatch(/^[0-9a-f]{48}$/);
});

test('confirmed reorder recovers focus on the same pin down button when its up button becomes disabled', async ({page}) => {
  await openClaude(page,{fixture:'achievement-six-pins',claudeOnly:true,width:360});
  await page.locator('#tab-achievements').click();
  await page.locator('#achievementShowcaseEditor > summary').click();
  const before = await rememberShareAndDocument(page);
  const keys = await page.locator('#achievementSelectedPins > li').evaluateAll(rows => rows.map(row => row.dataset.pinKey));
  const up = page.locator(`#achievement-move-up-${keys[1]}`);
  await up.focus(); await up.press('Enter');
  await expect(up).toBeFocused();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(m => m.command === 'editAchievementShowcase')))
    .toEqual([{command:'editAchievementShowcase',action:'reorder',generation:1,revision:0,
      documentId:expect.stringMatching(/^[0-9a-f]{48}$/),keys:[keys[1],keys[0],...keys.slice(2)]}]);
  await confirmAchievementPatch(page,'achievement-six-pins-reordered');
  await expect(page.locator('#achievementSelectedPins > li').first()).toHaveAttribute('data-pin-key',keys[1]);
  await expect(up).toBeDisabled();
  await expect(page.locator(`#achievement-move-down-${keys[1]}`)).toBeFocused();
  await expect(page.locator('#achievementShowcaseEditor')).toHaveAttribute('open');
  await expectShareAndDocumentUnchanged(page,before);
});

test('confirmed final pin removal recovers focus on the stable editor summary', async ({page}) => {
  await openClaude(page,{fixture:'achievement-last-pin',claudeOnly:true,width:320});
  await page.locator('#tab-achievements').click();
  await page.locator('#achievementShowcaseEditor > summary').click();
  const before = await rememberShareAndDocument(page);
  const unpin = page.locator('#achievement-edit-unpin-local-share-export');
  await unpin.focus(); await unpin.press('Enter');
  await expect(unpin).toBeFocused();
  expect(await page.evaluate(() => window.__ccuPostedMessages.filter(m => m.command === 'setAchievementPinned')))
    .toEqual([{command:'setAchievementPinned',key:'local-share-export',selected:false,generation:1,
      documentId:expect.stringMatching(/^[0-9a-f]{48}$/)}]);
  await confirmAchievementPatch(page,'achievement-last-pin-removed');
  await expect(page.locator('#achievementSelectedPins > li')).toHaveCount(0);
  await expect(page.locator('#achievementSelectedCount')).toContainText('0/6');
  await expect(page.locator('#achievementShowcaseEditorSummary')).toBeFocused();
  await expect(page.locator('#achievementShowcaseEditor')).toHaveAttribute('open');
  await expectShareAndDocumentUnchanged(page,before);
});
