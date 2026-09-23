/**
 * Root-independent client controller for replacing provider dashboard data
 * without reloading the complete Webview document. The surrounding Webview
 * script owns the render-specific restore functions referenced here.
 */
export function getDashboardRefreshClientScript(): string {
  return `
var __ccuLastDashboardPatchRevision = 0;
var __ccuRefreshIdentityAttributes = [
  'aria-controls',
  'data-persist',
  'data-session-id',
  'data-dashboard-tab',
  'data-date',
  'data-hour',
  'data-group',
  'data-sortkey',
  'data-metric',
  'data-project-matrix-range',
  'data-project-matrix-view',
  'name'
];
var __ccuFocusableSelector = 'a[href],button,input,select,textarea,summary,[tabindex]';
var __ccuRefreshScrollerKinds = [
  ['dashboard-tabs', '.tabs'],
  ['chart', '.hc-scroll'],
  ['table', '.daily-table-container'],
  ['project-heatmap', '.project-matrix-scroll'],
  ['project-trend', '.project-matrix-trend-scroll'],
  ['local-data-table', '.local-data-table-wrap'],
  ['heatmap', '.heatmap-svg'],
  ['share-preview', '.share-preview'],
  ['advice-preview', '.advice-payload-preview pre']
];
var __ccuRefreshScrollerSelector = __ccuRefreshScrollerKinds
  .map(function(entry) { return entry[1]; })
  .join(',');
var __ccuRefreshScrollLandmarkAttributes = [
  'data-project-matrix',
  'data-project-matrix-range-panel',
  'data-project-matrix-heatmap',
  'data-project-matrix-trend',
  'data-codex-time-series',
  'data-codex-last30-daily',
  'data-claude-last30-daily',
  'data-last30-daily',
  'data-codex-alltime-daily',
  'data-codex-today-hourly',
  'data-hourly-overview',
  'data-advice-provider',
  'data-date',
  'data-month'
];

function ccuRefreshScope(element, panel) {
  var tab = element && element.closest ? element.closest('.tab-content[id]') : null;
  return tab || panel;
}

function ccuRefreshDescriptor(element, panel, allowOwner) {
  if (!element || !panel || !panel.contains(element) || !element.tagName) { return null; }
  if (element.id && element.id.length <= 256) {
    return { kind: 'id', value: element.id };
  }
  var scope = ccuRefreshScope(element, panel);
  var tag = element.tagName.toLowerCase();
  for (var i = 0; i < __ccuRefreshIdentityAttributes.length; i += 1) {
    var attribute = __ccuRefreshIdentityAttributes[i];
    var value = element.getAttribute(attribute);
    if (value === null || value.length > 512) { continue; }
    var matches = Array.prototype.filter.call(scope.getElementsByTagName(tag), function(candidate) {
      return candidate.getAttribute(attribute) === value;
    });
    return {
      kind: 'attribute',
      scopeId: scope.id || 'provider-panel',
      tag: tag,
      attribute: attribute,
      value: value,
      occurrence: Math.max(0, matches.indexOf(element))
    };
  }
  if (allowOwner !== false) {
    var owner = element.parentElement;
    while (owner && owner !== panel) {
      var ownerDescriptor = ccuRefreshDescriptor(owner, panel, false);
      if (ownerDescriptor) {
        var descendants = Array.prototype.slice.call(owner.querySelectorAll(__ccuFocusableSelector));
        var descendantIndex = descendants.indexOf(element);
        if (descendantIndex >= 0) {
          return { kind: 'descendant', owner: ownerDescriptor, focusIndex: descendantIndex };
        }
      }
      owner = owner.parentElement;
    }
  }
  var focusables = Array.prototype.slice.call(scope.querySelectorAll(__ccuFocusableSelector));
  var focusIndex = focusables.indexOf(element);
  return focusIndex < 0 ? null : {
    kind: 'focus-index',
    scopeId: scope.id || 'provider-panel',
    focusIndex: focusIndex
  };
}

function ccuResolveRefreshDescriptor(descriptor, panel) {
  if (!descriptor || !panel) { return null; }
  if (descriptor.kind === 'id') {
    var byId = document.getElementById(descriptor.value);
    return byId && panel.contains(byId) ? byId : null;
  }
  if (descriptor.kind === 'descendant') {
    var owner = ccuResolveRefreshDescriptor(descriptor.owner, panel);
    if (!owner) { return null; }
    return owner.querySelectorAll(__ccuFocusableSelector)[descriptor.focusIndex] || null;
  }
  var scope = descriptor.scopeId === 'provider-panel'
    ? panel
    : document.getElementById(descriptor.scopeId);
  if (!scope || !panel.contains(scope)) { return null; }
  if (descriptor.kind === 'focus-index') {
    return scope.querySelectorAll(__ccuFocusableSelector)[descriptor.focusIndex] || null;
  }
  if (descriptor.kind !== 'attribute') { return null; }
  var matches = Array.prototype.filter.call(scope.getElementsByTagName(descriptor.tag), function(candidate) {
    return candidate.getAttribute(descriptor.attribute) === descriptor.value;
  });
  return matches[descriptor.occurrence] || null;
}

function ccuRefreshSafeScrollLandmark(attribute, value) {
  if (attribute === 'data-project-matrix') {
    return value === 'claude' || value === 'codex' ? value : '';
  }
  if (attribute === 'data-project-matrix-range-panel') {
    return value === '30' || value === '90' ? value : '';
  }
  if (attribute === 'data-advice-provider') {
    return value === 'claude' || value === 'codex' || value === 'optimizer' ? value : '';
  }
  if (attribute === 'data-date') {
    return /^\\d{4}-\\d{2}-\\d{2}$/.test(value) ? value : '';
  }
  if (attribute === 'data-month') {
    return /^\\d{4}-\\d{2}$/.test(value) ? value : '';
  }
  return value === '' ? 'present' : '';
}

function ccuRefreshScrollerBaseKey(element, panel) {
  if (!element || !element.matches) { return ''; }
  var scope = ccuRefreshScope(element, panel);
  var allowedScopeIds = [
    'today', 'month', 'all', 'sessions', 'projects', 'content',
    'branches', 'workflows', 'settings'
  ];
  var scopeId = scope !== panel && allowedScopeIds.indexOf(scope.id) !== -1
    ? scope.id
    : 'provider-panel';
  var kind = '';
  for (var i = 0; i < __ccuRefreshScrollerKinds.length; i += 1) {
    if (element.matches(__ccuRefreshScrollerKinds[i][1])) {
      kind = __ccuRefreshScrollerKinds[i][0];
      break;
    }
  }
  if (!kind) { return ''; }
  var landmarks = [];
  var owner = element;
  while (owner && owner !== scope.parentElement) {
    for (var j = 0; j < __ccuRefreshScrollLandmarkAttributes.length; j += 1) {
      var attribute = __ccuRefreshScrollLandmarkAttributes[j];
      if (!owner.hasAttribute(attribute)) { continue; }
      var safeValue = ccuRefreshSafeScrollLandmark(attribute, owner.getAttribute(attribute) || '');
      if (safeValue) { landmarks.push(attribute + '=' + safeValue); }
    }
    if (owner === scope) { break; }
    owner = owner.parentElement;
  }
  return scopeId + '|' + kind + '|' + landmarks.join('/');
}

function ccuRefreshScrollerEntries(panel) {
  var occurrences = {};
  var entries = [];
  Array.prototype.forEach.call(
    panel.querySelectorAll(__ccuRefreshScrollerSelector),
    function(scroller) {
      var baseKey = ccuRefreshScrollerBaseKey(scroller, panel);
      if (!baseKey) { return; }
      var occurrence = occurrences[baseKey] || 0;
      occurrences[baseKey] = occurrence + 1;
      entries.push({ scroller: scroller, key: baseKey + '|' + occurrence });
    },
  );
  return entries;
}

function ccuCaptureLocalScrollPositions(panel) {
  var positions = [];
  ccuRefreshScrollerEntries(panel).forEach(function(entry) {
    var scroller = entry.scroller;
    if (!(scroller.scrollLeft > 0) && !(scroller.scrollTop > 0)) { return; }
    positions.push({
      key: entry.key,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop
    });
  });
  return positions;
}

function ccuRestoreLocalScrollPositions(positions, panel) {
  if (!positions || positions.length === 0) { return; }
  var saved = {};
  positions.forEach(function(position) {
    if (
      position &&
      typeof position.key === 'string' &&
      typeof position.scrollLeft === 'number' &&
      typeof position.scrollTop === 'number'
    ) {
      saved[position.key] = {
        scrollLeft: position.scrollLeft,
        scrollTop: position.scrollTop
      };
    }
  });
  ccuRefreshScrollerEntries(panel).forEach(function(entry) {
    if (Object.prototype.hasOwnProperty.call(saved, entry.key)) {
      entry.scroller.scrollLeft = saved[entry.key].scrollLeft;
      entry.scroller.scrollTop = saved[entry.key].scrollTop;
    }
  });
}

function ccuCaptureAdvicePreviews(panel) {
  var previews = [];
  panel.querySelectorAll('.advice-payload-preview[data-advice-preview]').forEach(function(preview) {
    var provider = preview.getAttribute('data-advice-preview');
    var snapshotId = preview.getAttribute('data-snapshot-id');
    var body = preview.querySelector('[data-advice-preview-body]');
    if (
      (provider !== 'claude' && provider !== 'codex') ||
      !snapshotId ||
      !/^snapshot-[a-f0-9]{24}$/.test(snapshotId) ||
      !body ||
      body.textContent.length > 16 * 1024 * 1024
    ) { return; }
    var elements = adviceConsentElements(provider);
    previews.push({
      provider: provider,
      snapshotId: snapshotId,
      hidden: preview.hidden,
      open: preview.open,
      body: body.textContent,
      digest: (preview.querySelector('[data-advice-preview-digest]') || {}).textContent || '',
      mode: (preview.querySelector('[data-advice-preview-mode]') || {}).textContent || '',
      contentType: (preview.querySelector('[data-advice-preview-content-type]') || {}).textContent || '',
      bytes: (preview.querySelector('[data-advice-preview-bytes]') || {}).textContent || '',
      count: (preview.querySelector('[data-advice-preview-count]') || {}).textContent || '',
      sendDisabled: elements.sendButton ? elements.sendButton.disabled : true,
      sendText: elements.sendButton ? elements.sendButton.textContent : '',
      statusText: elements.consentStatus ? elements.consentStatus.textContent : ''
    });
  });
  return previews;
}

function ccuValidatedAdviceSnapshotIds(value) {
  var active = {};
  if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
    return active;
  }
  ['claude', 'codex'].forEach(function(provider) {
    var snapshotId = value[provider];
    if (typeof snapshotId === 'string' && /^snapshot-[a-f0-9]{24}$/.test(snapshotId)) {
      active[provider] = snapshotId;
    }
  });
  return active;
}

function ccuDiscardCapturedAdvicePreview(saved) {
  if (!saved || typeof saved !== 'object') { return; }
  saved.body = '';
  saved.digest = '';
  saved.mode = '';
  saved.contentType = '';
  saved.bytes = '';
  saved.count = '';
  saved.sendText = '';
  saved.statusText = '';
}

function ccuRestoreAdvicePreviews(previews, adviceSnapshotIds) {
  var active = ccuValidatedAdviceSnapshotIds(adviceSnapshotIds);
  (previews || []).forEach(function(saved) {
    if (
      !saved ||
      (saved.provider !== 'claude' && saved.provider !== 'codex') ||
      typeof saved.snapshotId !== 'string' ||
      !/^snapshot-[a-f0-9]{24}$/.test(saved.snapshotId) ||
      active[saved.provider] !== saved.snapshotId
    ) {
      ccuDiscardCapturedAdvicePreview(saved);
      return;
    }
    var elements = adviceConsentElements(saved.provider);
    if (!elements.preview) { return; }
    var preview = elements.preview;
    var setText = function(selector, value) {
      var target = preview.querySelector(selector);
      if (target && typeof value === 'string') { target.textContent = value; }
    };
    setText('[data-advice-preview-body]', saved.body);
    setText('[data-advice-preview-digest]', saved.digest);
    setText('[data-advice-preview-mode]', saved.mode);
    setText('[data-advice-preview-content-type]', saved.contentType);
    setText('[data-advice-preview-bytes]', saved.bytes);
    setText('[data-advice-preview-count]', saved.count);
    preview.setAttribute('data-snapshot-id', saved.snapshotId);
    preview.hidden = saved.hidden === true;
    preview.open = saved.open === true;
    if (elements.sendButton) {
      elements.sendButton.disabled = saved.sendDisabled !== false;
      if (typeof saved.sendText === 'string') { elements.sendButton.textContent = saved.sendText; }
    }
    if (elements.consentStatus && typeof saved.statusText === 'string') {
      elements.consentStatus.textContent = saved.statusText;
    }
  });
}

function ccuCaptureRefreshAnchor(panel, focusedDescriptor) {
  var focused = focusedDescriptor ? ccuResolveRefreshDescriptor(focusedDescriptor, panel) : null;
  if (focused) {
    var focusedRect = focused.getBoundingClientRect();
    if (focusedRect.height > 0 && focusedRect.bottom > 0 && focusedRect.top < window.innerHeight) {
      return { descriptor: focusedDescriptor, top: focusedRect.top };
    }
  }
  var activePanel = panel.querySelector('.tab-content.active') || panel;
  var selector = '[id],[aria-controls],[data-persist],[data-date],[data-hour],[data-group]';
  var best = null;
  Array.prototype.forEach.call(activePanel.querySelectorAll(selector), function(candidate) {
    var descriptor = ccuRefreshDescriptor(candidate, panel, false);
    if (!descriptor) { return; }
    var rect = candidate.getBoundingClientRect();
    if (rect.height <= 0 || rect.bottom <= 0 || rect.top >= window.innerHeight) { return; }
    var score = Math.abs(rect.top);
    if (!best || score < best.score) {
      best = { descriptor: descriptor, top: rect.top, score: score };
    }
  });
  return best ? { descriptor: best.descriptor, top: best.top } : null;
}

function ccuCaptureTransientControl(element, panel) {
  if (!element || !element.matches || !element.matches('input,select,textarea')) { return null; }
  // Consent is durable host-owned state. Preserving a focused checkbox value
  // across a patch could visually revive permission that the host just revoked.
  if (element.matches('[data-advice-consent-kind]')) { return null; }
  var descriptor = ccuRefreshDescriptor(element, panel, true);
  if (!descriptor) { return null; }
  var state = { descriptor: descriptor, value: element.value };
  if (element.matches('input[type="checkbox"],input[type="radio"]')) {
    state.checked = element.checked;
  }
  if (typeof element.selectionStart === 'number' && typeof element.selectionEnd === 'number') {
    state.selectionStart = element.selectionStart;
    state.selectionEnd = element.selectionEnd;
  }
  return state;
}

function ccuCaptureRefreshContext(panel) {
  var focused = document.activeElement && panel.contains(document.activeElement)
    ? document.activeElement
    : null;
  var focus = ccuRefreshDescriptor(focused, panel, true);
  var controls = [];
  var seen = [];
  [focused, document.getElementById('optDraft'), document.getElementById('optResolve'),
    document.getElementById('optDistil'), document.getElementById('optAesthetic')]
    .forEach(function(element) {
      if (!element || seen.indexOf(element) !== -1 || !panel.contains(element)) { return; }
      seen.push(element);
      var captured = ccuCaptureTransientControl(element, panel);
      if (captured) { controls.push(captured); }
    });
  return {
    focus: focus,
    anchor: ccuCaptureRefreshAnchor(panel, focus),
    controls: controls,
    advicePreviews: ccuCaptureAdvicePreviews(panel),
    localScrollPositions: ccuCaptureLocalScrollPositions(panel),
    scrollY: window.scrollY
  };
}

function ccuRestoreTransientControls(context, panel) {
  (context.controls || []).forEach(function(saved) {
    var control = ccuResolveRefreshDescriptor(saved.descriptor, panel);
    if (!control || !control.matches || !control.matches('input,select,textarea')) { return; }
    control.value = saved.value;
    if (typeof saved.checked === 'boolean') { control.checked = saved.checked; }
    if (
      typeof saved.selectionStart === 'number' &&
      typeof saved.selectionEnd === 'number' &&
      typeof control.setSelectionRange === 'function'
    ) {
      try { control.setSelectionRange(saved.selectionStart, saved.selectionEnd); } catch (e) {}
    }
  });
}

function ccuRestoreRefreshPosition(context, panel) {
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      var anchor = context.anchor
        ? ccuResolveRefreshDescriptor(context.anchor.descriptor, panel)
        : null;
      if (anchor) {
        window.scrollBy(0, anchor.getBoundingClientRect().top - context.anchor.top);
      } else {
        window.scrollTo(0, context.scrollY);
      }
      ccuRestoreLocalScrollPositions(context.localScrollPositions, panel);
      var focused = ccuResolveRefreshDescriptor(context.focus, panel);
      if (focused && typeof focused.focus === 'function') {
        try { focused.focus({ preventScroll: true }); } catch (e) { focused.focus(); }
      }
      ccuRestoreLocalScrollPositions(context.localScrollPositions, panel);
      if (anchor) {
        window.scrollBy(0, anchor.getBoundingClientRect().top - context.anchor.top);
      }
      __ccuUiReady = true;
    });
  });
}

function ccuRestoreDashboardUiAfterPatch(context, panel, tab, adviceSnapshotIds) {
  try { localStorage.setItem('ccu.activeTab', tab); } catch (e) {}
  showTab(tab, true);
  restoreSessionFilter();
  restorePersistedDetails();
  restoreClaudeDrilldownDetails();
  restoreCodexHourlyDetails();
  restoreSessionDetails();
  restoreTableSorts(panel);
  restoreChartMetrics(panel);
  initializeChartDrilldowns(panel);
  initializeHourlyOverviewSelections(panel);
  restoreHourlyOverviewSelections(panel);
  initializeStatusRegions(panel);
  restoreCombinedHeatmapConfig();
  restoreProjectMatrixState(panel);
  ccuRestoreTransientControls(context, panel);
  restoreAdviceEffectivenessState();
  ccuRestoreAdvicePreviews(context.advicePreviews, adviceSnapshotIds);
  formatOptSettings();
  requestLocalDataInventoryForVisibleSettings();
  ccuRestoreRefreshPosition(context, panel);
}

function ccuApplyDashboardDataPatch(message) {
  var revision = message && message.revision;
  if (!Number.isSafeInteger(revision) || revision <= 0) { return false; }
  if (revision <= __ccuLastDashboardPatchRevision) {
    vscode.postMessage({ command: 'dashboardDataPatchAck', revision: revision, ok: true });
    return true;
  }
  var panel = document.getElementById('provider-panel');
  var valid = panel &&
    (message.provider === 'claude' || message.provider === 'codex') &&
    message.provider === ccuProviderName() &&
    ['today', 'month', 'all', 'sessions', 'projects', 'content', 'branches', 'workflows', 'settings']
      .indexOf(message.tab) !== -1 &&
    typeof message.html === 'string' &&
    message.html.length <= 32 * 1024 * 1024 &&
    !/<script(?:\\s|>)/i.test(message.html) &&
    message.claudeLast30HoursByDay &&
    Object.prototype.toString.call(message.claudeLast30HoursByDay) === '[object Object]';
  if (!valid) {
    vscode.postMessage({ command: 'dashboardDataPatchAck', revision: revision, ok: false });
    return false;
  }
  try {
    var context = ccuCaptureRefreshContext(panel);
    if (__ccuScrollSaveTimer) {
      clearTimeout(__ccuScrollSaveTimer);
      __ccuScrollSaveTimer = 0;
    }
    __ccuScrollDirty = false;
    __ccuUiReady = false;
    panel.innerHTML = message.html;
    __claudeLast30HoursByDay = message.claudeLast30HoursByDay;
    __ccuLastDashboardPatchRevision = revision;
    ccuRestoreDashboardUiAfterPatch(context, panel, message.tab, message.adviceSnapshotIds);
    vscode.postMessage({ command: 'dashboardDataPatchAck', revision: revision, ok: true });
    return true;
  } catch (e) {
    __ccuUiReady = true;
    vscode.postMessage({ command: 'dashboardDataPatchAck', revision: revision, ok: false });
    return false;
  }
}

// A full provider-panel swap during wheel/trackpad motion forces layout on the
// scrolling frame. Keep the newest patch in memory until the burst quiets;
// the cap ensures a long continuous gesture cannot starve live data forever.
var __ccuLastScrollEventAt = -Infinity;
var __ccuScrollPatchPending = null;
var __ccuScrollPatchQuietTimer = 0;
var __ccuScrollPatchMaxTimer = 0;
function ccuFlushScrollPatch() {
  if (__ccuScrollPatchQuietTimer) { clearTimeout(__ccuScrollPatchQuietTimer); }
  if (__ccuScrollPatchMaxTimer) { clearTimeout(__ccuScrollPatchMaxTimer); }
  __ccuScrollPatchQuietTimer = 0;
  __ccuScrollPatchMaxTimer = 0;
  var latest = __ccuScrollPatchPending;
  __ccuScrollPatchPending = null;
  if (latest) { ccuApplyDashboardDataPatch(latest); }
}
function ccuScheduleScrollPatchQuiet() {
  if (__ccuScrollPatchQuietTimer) { clearTimeout(__ccuScrollPatchQuietTimer); }
  __ccuScrollPatchQuietTimer = setTimeout(ccuFlushScrollPatch, 120);
}
window.addEventListener('scroll', function() {
  __ccuLastScrollEventAt = performance.now();
  if (__ccuScrollPatchPending) { ccuScheduleScrollPatchQuiet(); }
}, { passive: true });
function ccuQueueDashboardDataPatch(message) {
  if (!__ccuScrollPatchPending && performance.now() - __ccuLastScrollEventAt >= 120) {
    ccuApplyDashboardDataPatch(message);
    return;
  }
  __ccuScrollPatchPending = message;
  ccuScheduleScrollPatchQuiet();
  if (!__ccuScrollPatchMaxTimer) {
    __ccuScrollPatchMaxTimer = setTimeout(ccuFlushScrollPatch, 500);
  }
}
`;
}
