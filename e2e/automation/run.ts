import { runTests, type RunnerOptions } from './test-runner.js';
import { generateReport } from './reporter.js';
import { startMockServers, clearMockServerState } from './mock-servers.js';
import { tests as coreChat } from './suites/core-chat.spec.js';
import { tests as quickActions } from './suites/quick-actions.spec.js';
import { tests as pageWatcher } from './suites/page-watcher.spec.js';
import { tests as recording } from './suites/recording.spec.js';
import { tests as skillBrowserwing } from './suites/skill-browserwing.spec.js';
import { tests as mcpIntegration } from './suites/mcp-integration.spec.js';

async function main() {
  const args = process.argv.slice(2);
  const resume = args.includes('--resume') || args.includes('resume');
  const onlySuite = args.find((a) => a.startsWith('--suite='))?.replace('--suite=', '');
  const onlyAuto = args.includes('--auto-only');

  const options: RunnerOptions = {
    resume,
    onlySuite,
    onlyAuto,
  };

  const registry = {
    ...coreChat,
    ...quickActions,
    ...pageWatcher,
    ...recording,
    ...skillBrowserwing,
    ...mcpIntegration,
  };

  console.log('启动 Mock 服务器...');
  const mocks = await startMockServers();
  clearMockServerState();

  try {
    console.log(`开始执行测试${resume ? '（断点续跑）' : ''}...`);
    const results = await runTests(registry, options);
    const passed = results.filter((r) => r.status === 'passed').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const manual = results.filter((r) => r.status === 'manual').length;

    console.log(`\n测试执行完毕: 通过 ${passed}, 失败 ${failed}, 跳过 ${skipped}, 人工 ${manual}`);

    const reportPath = generateReport(results);
    console.log(`HTML 报告已生成: ${reportPath}`);

    if (failed > 0) {
      process.exit(1);
    }
  } finally {
    await mocks.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
