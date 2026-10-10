import {test} from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
// Render the actual production stylesheet under each registered fixture theme.
// Null registry values are explicitly represented by CSS `initial`; neither
// missing definitions nor an unregistered fallback variable are exemptions.
const loader=require('node:module'),original=loader._load;
loader._load=function(name:string,...args:unknown[]) {return name==='vscode'?{}:original.call(this,name,...args);};
let Provider:typeof import('../webview').UsageWebviewProvider;
try {Provider=require('../webview').UsageWebviewProvider;}finally {loader._load=original;}
const harness=fs.readFileSync(path.resolve(__dirname,'../../tests/ui/support/render-harness.cjs'),'utf8');
const start=harness.indexOf('const THEMES = {'),end=harness.indexOf('function settingsStore(');
assert.ok(start>0&&end>start);
// Execute only the repository-owned literal registered color declarations,
// never the fixture renderer's shared compiled runtime or provider bootstrap.
const themes:Record<string,string>=new Function(harness.slice(start,end)+';return THEMES;')();
for(const theme of ['light','dark','highContrast'])test('every production VS Code variable has a registered harness definition: '+theme,async()=>{
  const production:string=(Object.create(Provider.prototype) as any).getStyles();
  const colors=themes[theme];
  const used=new Set(Array.from(production.matchAll(/var\(\s*(--vscode-[\w-]+)/g),m=>m[1]));
  const defined=new Set(Array.from(colors.matchAll(/(--vscode-[\w-]+)\s*:/g),m=>m[1]));
  assert.ok(used.size>30);assert.deepEqual([...used].filter(v=>!defined.has(v)),[]);
});
