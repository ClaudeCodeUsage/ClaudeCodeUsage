import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';

import { getProviderNavClientScript } from '../providerNavClient';

class Classes {
  private readonly values = new Set<string>();

  constructor(initial = '') {
    initial.split(/\s+/).filter(Boolean).forEach((value) => this.values.add(value));
  }

  toggle(value: string, force: boolean): void {
    if (force) this.values.add(value); else this.values.delete(value);
  }

  contains(value: string): boolean { return this.values.has(value); }
}

class ProviderTab {
  readonly classList: Classes;
  focused = false;

  constructor(readonly attributes: Record<string, string>) {
    this.classList = new Classes(attributes.class ?? '');
  }

  get id(): string { return this.attributes.id; }
  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
  setAttribute(name: string, value: string): void { this.attributes[name] = String(value); }
  focus(): void { this.focused = true; }
  closest(selector: string): ProviderTab | null {
    return selector === '[role="tab"][data-provider-target]' ? this : null;
  }
}

class ProviderEvent {
  defaultPrevented = false;
  propagationStopped = false;

  constructor(
    readonly type: string,
    readonly target: ProviderTab,
    readonly key = '',
  ) {}

  preventDefault(): void { this.defaultPrevented = true; }
  stopPropagation(): void { this.propagationStopped = true; }
}

class ProviderTabList {
  private readonly listeners = new Map<string, Array<(event: ProviderEvent) => void>>();

  constructor(readonly tabs: ProviderTab[]) {}

  querySelectorAll(selector: string): ProviderTab[] {
    return selector === '[role="tab"][data-provider-target]' ? this.tabs : [];
  }

  addEventListener(type: string, listener: (event: ProviderEvent) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  dispatch(type: string, target: ProviderTab, key = ''): ProviderEvent {
    const event = new ProviderEvent(type, target, key);
    for (const listener of this.listeners.get(type) ?? []) listener(event);
    return event;
  }
}

function providerFixture(): {
  tabs: Record<'claude' | 'codex' | 'compare', ProviderTab>;
  tablist: ProviderTabList;
  panel: { attributes: Record<string, string>; setAttribute(name: string, value: string): void };
  messages: unknown[];
} {
  const tab = (provider: 'claude' | 'codex' | 'compare', selected: boolean): ProviderTab =>
    new ProviderTab({
      id: `provider-tab-${provider}`,
      role: 'tab',
      'data-provider-target': provider,
      'aria-controls': 'provider-panel',
      'aria-selected': selected ? 'true' : 'false',
      tabindex: selected ? '0' : '-1',
      class: `provider-tab${selected ? ' active' : ''}`,
    });
  const tabs = {
    claude: tab('claude', true),
    codex: tab('codex', false),
    compare: tab('compare', false),
  };
  const tablist = new ProviderTabList(Object.values(tabs));
  const panel: { attributes: Record<string, string>; setAttribute(name: string, value: string): void } = {
    attributes: { id: 'provider-panel', role: 'tabpanel', 'aria-labelledby': 'provider-tab-claude' },
    setAttribute(name: string, value: string): void { this.attributes[name] = value; },
  };
  const messages: unknown[] = [];
  runInNewContext(getProviderNavClientScript(), {
    document: {
      querySelector(selector: string): ProviderTabList | null {
        return selector === '.provider-tabs[role="tablist"]' ? tablist : null;
      },
      getElementById(id: string): typeof panel | null {
        return id === 'provider-panel' ? panel : null;
      },
    },
    showProvider(provider: string): void {
      messages.push({ command: 'providerChanged', provider, tab: '' });
    },
  });
  return { tabs, tablist, panel, messages };
}

test('provider tablist arrows wrap and Home End focus and activate exactly once', () => {
  const cases: Array<{
    start: 'claude' | 'codex' | 'compare';
    key: string;
    expected: 'claude' | 'codex' | 'compare';
  }> = [
    { start: 'claude', key: 'ArrowLeft', expected: 'compare' },
    { start: 'compare', key: 'ArrowRight', expected: 'claude' },
    { start: 'codex', key: 'Home', expected: 'claude' },
    { start: 'claude', key: 'End', expected: 'compare' },
  ];

  for (const keyCase of cases) {
    const fixture = providerFixture();
    const event = fixture.tablist.dispatch('keydown', fixture.tabs[keyCase.start], keyCase.key);
    assert.equal(event.defaultPrevented, true, keyCase.key);
    assert.equal(event.propagationStopped, true, keyCase.key);
    assert.equal(fixture.tabs[keyCase.expected].focused, true, keyCase.key);
    assert.equal(fixture.tabs[keyCase.expected].getAttribute('aria-selected'), 'true', keyCase.key);
    assert.equal(fixture.tabs[keyCase.expected].getAttribute('tabindex'), '0', keyCase.key);
    assert.equal(fixture.panel.attributes['aria-labelledby'], `provider-tab-${keyCase.expected}`, keyCase.key);
    assert.equal(JSON.stringify(fixture.messages), JSON.stringify([
      { command: 'providerChanged', provider: keyCase.expected, tab: '' },
    ]), keyCase.key);
  }
});

for (const keyCase of [{ key: 'Enter', label: 'Enter' }, { key: ' ', label: 'Space' }]) {
  test(`provider ${keyCase.label} relies on one native click activation`, () => {
    const fixture = providerFixture();
    const keyEvent = fixture.tablist.dispatch('keydown', fixture.tabs.codex, keyCase.key);
    assert.equal(keyEvent.defaultPrevented, false);
    assert.equal(fixture.messages.length, 0);

    const clickEvent = fixture.tablist.dispatch('click', fixture.tabs.codex);
    assert.equal(clickEvent.defaultPrevented, true);
    assert.equal(clickEvent.propagationStopped, true);
    assert.equal(JSON.stringify(fixture.messages), JSON.stringify([
      { command: 'providerChanged', provider: 'codex', tab: '' },
    ]));
  });
}

test('provider tablist ignores unrelated keys without changing focus or posting', () => {
  const fixture = providerFixture();
  const event = fixture.tablist.dispatch('keydown', fixture.tabs.claude, 'Escape');
  assert.equal(event.defaultPrevented, false);
  assert.equal(event.propagationStopped, false);
  assert.equal(fixture.tabs.claude.focused, false);
  assert.equal(fixture.messages.length, 0);
});
