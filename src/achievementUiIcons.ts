/** Small code-native chrome, separate from the established badge artwork. */
const paths = {
  medal:'<circle cx="12" cy="9" r="6"/><path d="m8 14-1 7 5-3 5 3-1-7M10 9l1.2 1.2L14 7"/>',
  target:'<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><path d="m12 12 8-8M16 4h4v4"/>',
  share:'<circle cx="6" cy="12" r="3"/><circle cx="18" cy="5" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m9 3-.7 2.3-2 1.2L4 6 2 9l1.6 1.8v2.4L2 15l2 3 2.3-.5 2 1.2L9 21h6l.7-2.3 2-1.2 2.3.5 2-3-1.6-1.8v-2.4L22 9l-2-3-2.3.5-2-1.2L15 3z"/>',
  filter:'<path d="M3 5h18M6 12h12M9 19h6"/>',
  size:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  display:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M10 9v11"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v.5"/>',
  expand:'<path d="M4 7h16M4 17h16m-9-6 1 1 1-1m-2 2 1-1 1 1M12 2v3m0 14v3"/>',
  collapse:'<path d="M4 10h16M4 14h16m-9-8 1-1 1 1m-2 12 1 1 1-1M12 2v3m0 14v3"/>',
  recalibrate:'<path d="M20 8a8 8 0 0 0-13-4L3 8m0-5v5h5M4 16a8 8 0 0 0 13 4l4-4m0 5v-5h-5"/>',
} as const;
export function achievementUiIcon(name:keyof typeof paths):string {
  return '<svg class="achievement-ui-icon" data-achievement-ui-icon="'+name+'" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+paths[name]+'</svg>';
}
