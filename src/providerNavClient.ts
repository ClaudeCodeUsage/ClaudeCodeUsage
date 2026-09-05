/** Root-independent controller for the shared provider tablist. */
export function getProviderNavClientScript(): string {
  return `(function() {
  var tablist = document.querySelector('.provider-tabs[role="tablist"]');
  if (!tablist) { return; }
  var providerValues = ['claude', 'codex', 'compare'];

  function tabs() {
    return Array.prototype.slice.call(tablist.querySelectorAll('[role="tab"][data-provider-target]'));
  }

  function providerTab(target) {
    var tab = target && target.closest ? target.closest('[role="tab"][data-provider-target]') : null;
    return tab && tabs().indexOf(tab) !== -1 ? tab : null;
  }

  function activate(tab) {
    var provider = tab.getAttribute('data-provider-target');
    if (providerValues.indexOf(provider) === -1) { return; }
    tabs().forEach(function(item) {
      var selected = item === tab;
      item.classList.toggle('active', selected);
      item.setAttribute('aria-selected', selected ? 'true' : 'false');
      item.setAttribute('tabindex', selected ? '0' : '-1');
    });
    var panel = document.getElementById('provider-panel');
    if (panel) { panel.setAttribute('aria-labelledby', tab.id); }
    showProvider(provider);
  }

  tablist.addEventListener('click', function(event) {
    var tab = providerTab(event.target);
    if (!tab) { return; }
    event.preventDefault();
    event.stopPropagation();
    activate(tab);
  });

  tablist.addEventListener('keydown', function(event) {
    var tab = providerTab(event.target);
    if (!tab || ['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) === -1) { return; }
    var items = tabs();
    var index = items.indexOf(tab);
    if (index === -1 || items.length === 0) { return; }
    if (event.key === 'Home') { index = 0; }
    else if (event.key === 'End') { index = items.length - 1; }
    else { index = (index + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length; }
    event.preventDefault();
    event.stopPropagation();
    items[index].focus();
    activate(items[index]);
  });
}());`;
}
