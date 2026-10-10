# Optional guarded native diagnostic

For actual background-window resource observation use mode: 'background' with
an explicit durationMs (for example120000). This stages a separate test-only
runner; it never calls a simulated focus handler, opens/reveals panels or
suppresses native window events. Watch settings are enabled, then forty explicit
manual warm refreshes cover whole-achievement OFF/ON. During observation, exact
native/logical focus must agree; settled background samples require every owned
recurring resource count to be known zero. Twenty idle observations, actual
duration, known-zero warm I/O and completed production teardown are all required.
Foreground samples are recorded, not misclassified as background. Memory uses
the existing fixed soak budgets. Separate profiles do not prove same-profile
writes, actual foreground interaction, notice ACK, thirty-minute combined soak,
final installed VSIX/F5 or Windows crash resolution. Prior simulated-focus soak
failures remain preserved, not relabelled passes by this different test.

中文审阅：mode: 'background' 是独立的原生后台资源诊断，明确指定时长；不模拟聚焦、
不打开/显示面板、不屏蔽真实窗口事件。开启监听设置，成就关闭/开启各执行20次明确
手动暖刷新；观测期以真实/逻辑焦点一致为前提，稳定后台样本所属循环资源须全为已知0。
至少20次空闲样本、实际时长、已知零正文读取和生产停止清理均通过才算本诊断通过。
真实前台样本照实记录，不冒充后台。预算沿用既有上限；各自独立profile不代表同profile
写竞争，亦非前台交互/通知ACK、30分钟组合长测、最终VSIX/F5或Windows崩溃验收。
既有模拟焦点soak失败继续保留，不能因新测试通过而改写其结果。

These helpers are excluded from the VSIX. They do not replace a production
VSIX installation, manual F5, pixel inspection, long-history soak or Windows
acceptance. Production src/ and compiled runtime modules are not modified.

Compile normally. Call prepareNativeDiagnostic({ repository, sourceHead })
from prepare.cjs with the absolute repository and its verified local commit.
Preparation creates a fresh ccu-native-v242-* temporary root, copies regular
compiled .js files and the actual assets/ directory, excludes out/test and source maps, and seeds
six bounded anonymous synthetic JSONL files. It never launches an app, reads
normal provider homes, fetches dependencies or installs into daily Code.

The returned launchArguments explicitly isolate user, extensions, shared and
agent stores. The installed Code must support every option; check its local
CLI metadata before use. Start only a new instance with those exact arguments.
Use background launch to avoid unnecessary focus changes. In-memory
SecretStorage, no recent-folder entry, disabled crash reporting/experiments,
disabled telemetry/update/sync-related online entry points, and synthetic
provider paths complement (but do not replace) actual storage verification.
Do not set or repurpose HOME or CODEX_HOME.
On macOS preparation uses a fresh short /private/tmp root, keeping the observed
Code IPC socket below its 103-character path limit; no system temp setting changes.

bootstrap.cjs is the staged test-only main. It validates real Test-mode
ExtensionContext/config paths and symlink-free owned directories before any
globalState seed. Only then does it load and activate the production module.
It captures that host's own instance at the existing command-setup boundary,
restores the method immediately, and gives the test runner access to that
instance. This wrapper is not shipped as a release candidate.

runner.cjs uses the real native VS Code API, not a mocked webview. It exercises
the small synthetic cold scan, twenty explicit warm refreshes, twenty actual
WebviewPanel open/dispose cycles, achievement OFF/ON, twenty content-analysis
toggles with awaited old-provider retirement, and awaited production
disposal. Reports contain fixed stages, numeric process-memory samples and
anonymous resource counts, not credentials, logs, paths or instance objects.
Disposal waits for the real onDidDispose event, not a fixed paint delay. A
directly seeded synthetic single preview tests retirement, not earned-badge
selection, share consent, the preview UI or an export. Separate pure helper
tests use synthetic async events and the actual AchievementSharePreview class;
they are not native evidence.
A missing client-ready observation is not pixel acceptance. Process RSS includes
worker threads; samples are not instantaneous peaks or a post-GC leak verdict.
Warm I/O uses a fixed-size numeric-only probe of existing production diagnostic
formats: unknown is not treated as zero, at least twenty observations per provider
are required, and no raw channel text is retained. The content-analysis setting
path legitimately replaces providers; its I/O is separate from unchanged warm
refreshes and is not asserted to be a presentation-only zero-I/O operation.

Before claiming non-disruption, inspect the normal instance's relevant storage
metadata/settings and installed-runtime hashes before/after. A separate window,
directory naming or this guard is not an OS sandbox. Changes during active
normal use may be natural; investigate rather than asserting all bytes stayed
unchanged. Do not close or restart daily Code, change its extension/profile,
stop unrelated processes, or weaken a failed isolation check.

## Optional resource-duration diagnostic / 资源持续运行诊断

prepareNativeDiagnostic({ repository, sourceHead, mode: 'soak', durationMs: 1800000 })
stages a separate opt-in runner. Use a short duration first to verify setup.
A short preflight always reports longSoakDurationPassed=false; setup/exit alone
is never a 30-minute pass. The monotonic clock is not scaled.
After the two single watcher-setting writes, setup samples only public expected
readbacks every 25 ms until they match for 500 ms. This consumes the existing
five-second readiness deadline; it never rewrites settings or retries a case.
The original settings/configuration/watcher assertions still run afterward,
and any later mismatch fails. Only equality/type fields and bounded convergence
counts enter the report. This test-only SDK initialization barrier does not prove
normal-profile persistence or replace installed/F5 acceptance; earlier failures remain failures.
An anonymous stage marker is written before each asynchronous phase. A normal
host exit with no final native-soak-result.json remains incomplete; its last
marker does not identify a product crash or satisfy any resource-duration gate.
Failures additionally record only exact logical/native focus booleans and a
known watcher count, or null when unavailable. Real window transitions are
counted, never suppressed to make simultaneous background windows appear active.
Failure reasons distinguish only helper-owned guards and fixed readiness assertions:
resource/sample limits, operation/wait timeout and the Claude/Codex watcher setup.
Classification uses private error-object identity, not exception messages/codes/getters;
unrecognised errors stay assertion-or-stage-failure. Setting values are not reported.
This additional diagnostic does not relax budgets, suppress native events or establish
the cause of a previously incomplete run.

Each minute the runner switches the whole achievement feature ON/OFF, appends
one bounded synthetic record to each of two exact regular fixture files, waits
for actual Claude/Codex fs.watch refresh diagnostics and exact usage changes,
then performs twenty known-zero manual warm refreshes. Actual panels open and
await their disposal events. Watched append checks finish before panel creation;
the panel remains open during the warm refreshes. Native window events remain
observed and unsuppressed. Simulated focus invokes the existing production
focus handler to exercise suspension/rearming without foregrounding Code.
It is not proof of native OS-focus behavior or notice delivery/ACK.

Five-second fixed numeric samples bound host RSS/heap/external memory, owned
timers/watchers/worker-controller/backfill/network counts and panel/notice caches.
No raw messages, logs, paths, settings values or heap dumps enter the report.
The small fixture grows by at most two records per cycle; sources are not real
logs. Unknown measurements do not become zero. Deadlines and resource guards
fail the run, and the finally block awaits only this host's production teardown.
Reports preserve limitations: no final VSIX/F5/pixel acceptance, worker-isolate
heap/message measurements, same-profile multi-window races, or Windows OOM
conclusion. Sampled host heap without forced GC is not a retained-heap leak test.

中文审阅：使用 mode: 'soak' 明确启用持续诊断，先短程自检；短测必然标为未通过
30分钟时长门，不能以准备或进程退出冒充验收，不加速单调时钟。
监听设置各只写一次；随后每25毫秒只读公开预期值，匹配满500毫秒才继续。
稳定检查占用原有五秒就绪期限，不反复覆盖设置或重试用例；之后仍执行原来的
设置／配置／监听严格断言，晚到不匹配仍失败。报告只含相等／类型及有界计数。
这只是测试初始化屏障，不证明日常配置持久化或已安装包／F5；此前失败不改记为通过。
各异步阶段开始前记录有界匿名标记；即使宿主正常退出，没有最终结果文件也仍是
未完成，不能凭最后阶段标记认定产品崩溃或算持续运行门通过。
失败时仅补充逻辑／原生焦点布尔值及已知监听数量，未知记null；计数真实窗口
状态变化，不屏蔽它们来让多个后台窗口看似同时活跃。
失败原因仅细分辅助程序自身的资源／采样上限、操作／等待超时和固定监听初始化
断言；按错误对象的私有身份分类，不读取任意异常消息、code、getter等属性。
未知仍记assertion-or-stage-failure，不保存设置值，不放宽预算或屏蔽真实事件，
新增诊断也不能倒推此前未完成运行的根因。
每分钟开关整个成就功能，向两个精确的自有常规合成文件各追加一条有界记录，等待真实文件监听
诊断与精确用量更新，再执行20次有明确零正文计数的手动暖刷新，并等待真实面板
销毁事件。追加监听检查先于面板创建；暖刷新期间仍有真实面板，不屏蔽原生窗口事件。
模拟焦点只调用既有生产处理器、检验暂停/重新安装，不切到前台，也不
当作OS焦点或通知投递/ACK验收。每5秒保存固定匿名数字，限制宿主内存、所属
定时器/监听/worker协调器/回填/网络和面板/提示缓存；报告不含原始消息、日志、
路径、设置值或heap dump。每轮最多增加两条合成记录，不使用真实日志；未知不
算零。超时或预算超限即失败，最终只等待本测试宿主的实际资源释放。这个小样本
不能替代最终VSIX/F5/像素、worker独立内存/消息、同profile跨窗口竞争或Windows
OOM验收；未强制GC的宿主heap采样也不能证明存活对象泄漏。
