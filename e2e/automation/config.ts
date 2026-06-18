import type { Page, BrowserContext } from '@playwright/test';

export type AutoLevel = 'full' | 'partial' | 'manual';
export type Priority = 'P0' | 'P1' | 'P2';

export interface TestCaseMeta {
  id: string;
  name: string;
  suite: string;
  priority: Priority;
  auto: AutoLevel;
  description: string;
}

export interface TestContext {
  page: Page;
  context: BrowserContext;
  extensionId: string;
  sidepanelUrl: string;
  log: (message: string) => void;
  screenshot: (name: string) => Promise<string | null>;
}

export type TestCaseFn = (ctx: TestContext) => Promise<void>;

export const testCases: TestCaseMeta[] = [
  // 1. 核心聊天功能
  { id: 'TC-1.1.1', name: '正常创建新会话', suite: 'core-chat', priority: 'P0', auto: 'full', description: '打开侧边栏 → 点击新建 → 发送「你好」，检查 URL 和消息气泡' },
  { id: 'TC-1.1.2', name: '连续创建多个会话', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查第二个会话独立，不携带第一个会话的上下文' },
  { id: 'TC-1.1.3', name: '未配置模型时发送', suite: 'core-chat', priority: 'P1', auto: 'full', description: '清除所有模型配置后发送，检查错误提示' },
  { id: 'TC-1.1.4', name: '新会话自动滚动', suite: 'core-chat', priority: 'P1', auto: 'full', description: '发送消息后观察自动滚动到最新消息底部' },
  { id: 'TC-1.2.1', name: '纯文本消息', suite: 'core-chat', priority: 'P0', auto: 'partial', description: '发送纯文本，检查流式响应和 Markdown 渲染' },
  { id: 'TC-1.2.2', name: '超长文本输入', suite: 'core-chat', priority: 'P1', auto: 'full', description: '粘贴 5000 字文本发送，检查正常响应无截断' },
  { id: 'TC-1.2.3', name: '空消息发送', suite: 'core-chat', priority: 'P1', auto: 'full', description: '不输入内容直接点击发送，检查按钮禁用或提示' },
  { id: 'TC-1.2.4', name: '仅空格/换行', suite: 'core-chat', priority: 'P1', auto: 'full', description: '输入多个空格或换行发送，检查不允许发送' },
  { id: 'TC-1.2.5', name: '特殊字符输入', suite: 'core-chat', priority: 'P0', auto: 'full', description: '输入 XSS 脚本，检查消息正常显示且脚本不执行' },
  { id: 'TC-1.2.6', name: '网络中断', suite: 'core-chat', priority: 'P1', auto: 'full', description: '发送后断开网络，检查错误状态和重试按钮' },
  { id: 'TC-1.2.7', name: '响应中取消', suite: 'core-chat', priority: 'P1', auto: 'full', description: 'AI 响应过程中点击取消，检查立即停止并保留已生成内容' },
  { id: 'TC-1.2.8', name: '重试失败消息', suite: 'core-chat', priority: 'P1', auto: 'full', description: '对失败消息点击重试，检查重新发送并保留上下文' },
  { id: 'TC-1.3.1', name: '代码块', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查语法高亮和复制按钮' },
  { id: 'TC-1.3.2', name: '表格', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查 Markdown 表格渲染为 HTML 表格' },
  { id: 'TC-1.3.3', name: '嵌套列表', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查多层列表缩进正确' },
  { id: 'TC-1.3.4', name: '链接渲染', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查链接可点击且新标签页打开' },
  { id: 'TC-1.3.5', name: '图片渲染', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查图片正常加载和 alt 文本' },
  { id: 'TC-1.3.6', name: '文本两端对齐', suite: 'core-chat', priority: 'P1', auto: 'full', description: '检查纯文本段落应用 text-align: justify' },
  { id: 'TC-1.4.1', name: '上传图片', suite: 'core-chat', priority: 'P1', auto: 'full', description: '上传 PNG 图片，检查图片显示在输入框且 AI 可分析' },
  { id: 'TC-1.4.2', name: '上传多个文件', suite: 'core-chat', priority: 'P1', auto: 'full', description: '选择 3 个文件同时上传，检查分别显示和可删除' },
  { id: 'TC-1.4.3', name: '超大文件', suite: 'core-chat', priority: 'P1', auto: 'full', description: '选择 50MB 文件，检查提示文件过大或拒绝上传' },
  { id: 'TC-1.4.4', name: '删除附件', suite: 'core-chat', priority: 'P1', auto: 'full', description: '上传后点击删除，检查附件从输入框移除' },

  // 2. QuickActionsBar
  { id: 'TC-2.1.1', name: '正常阅读文章页', suite: 'quick-actions', priority: 'P0', auto: 'partial', description: '打开新闻文章 → 点击阅读页面，检查 AI 返回总结' },
  { id: 'TC-2.1.2', name: '阅读 SPA 页面', suite: 'quick-actions', priority: 'P1', auto: 'partial', description: '打开 React/Vue SPA → 点击按钮，检查获取动态渲染内容' },
  { id: 'TC-2.1.3', name: '阅读需要登录的页面', suite: 'quick-actions', priority: 'P1', auto: 'manual', description: '登录后打开内部系统 → 点击按钮，检查获取登录后内容' },
  { id: 'TC-2.1.4', name: '阅读空页面', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '打开 about:blank → 点击按钮，检查 AI 提示无内容' },
  { id: 'TC-2.1.5', name: '阅读 404 页面', suite: 'quick-actions', priority: 'P1', auto: 'partial', description: '打开不存在的 URL → 点击按钮，检查 AI 总结或提示错误' },
  { id: 'TC-2.1.6', name: '重复点击', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '快速连续点击两次，检查第二次被忽略' },
  { id: 'TC-2.2.1', name: '正常截图分析', suite: 'quick-actions', priority: 'P0', auto: 'partial', description: '打开包含图表的页面 → 点击截图分析，检查 AI 收到截图并分析' },
  { id: 'TC-2.2.2', name: '截图包含复杂 UI', suite: 'quick-actions', priority: 'P1', auto: 'partial', description: '打开数据仪表盘 → 点击按钮，检查 AI 识别图表' },
  { id: 'TC-2.2.3', name: '截图权限拒绝', suite: 'quick-actions', priority: 'P1', auto: 'manual', description: '在需要特殊权限的页面截图，检查回退到纯文本 prompt' },
  { id: 'TC-2.2.4', name: '长页面截图', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '打开长页面，检查仅截取当前视口' },
  { id: 'TC-2.2.5', name: '与阅读页面对比', suite: 'quick-actions', priority: 'P1', auto: 'partial', description: '同一页面分别使用截图分析和阅读页面，检查关注点差异' },
  { id: 'TC-2.3.1', name: '点击按钮', suite: 'quick-actions', priority: 'P0', auto: 'partial', description: '发送「点击提交按钮」，检查 AI 调用 interact click' },
  { id: 'TC-2.3.2', name: '输入文本', suite: 'quick-actions', priority: 'P0', auto: 'partial', description: '发送「在姓名框输入张三」，检查 AI 调用 interact type' },
  { id: 'TC-2.3.3', name: '滚动页面', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '发送「滚动到页面底部」，检查页面滚动到底部' },
  { id: 'TC-2.3.4', name: '选择下拉框', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '发送「选择国家为中国」，检查下拉框选中中国' },
  { id: 'TC-2.3.5', name: '操作不存在元素', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '发送「点击一个不存在的按钮」，检查 AI 报告错误' },
  { id: 'TC-2.3.6', name: '使用坐标点击', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '发送「在坐标 (100, 200) 点击」，检查该坐标执行点击' },
  { id: 'TC-2.3.7', name: 'sequence 多步操作', suite: 'quick-actions', priority: 'P0', auto: 'partial', description: '发送多步操作指令，检查按顺序执行 clear → type → type → click' },
  { id: 'TC-2.3.8', name: 'condition 条件分支', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '检查 condition 为 visible/hidden 时正确判断' },
  { id: 'TC-2.4.1', name: '简单登录表单', suite: 'quick-actions', priority: 'P0', auto: 'partial', description: '打开登录页 → 点击填写表单，检查 AI 识别用户名/密码框' },
  { id: 'TC-2.4.2', name: '复杂注册表单', suite: 'quick-actions', priority: 'P1', auto: 'partial', description: '打开注册页，检查 AI 识别各字段并填写' },
  { id: 'TC-2.4.3', name: '无表单页面', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '打开无表单页面 → 点击按钮，检查 AI 提示无表单' },
  { id: 'TC-2.4.4', name: '重复点击', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '已填写后再次点击，检查每次点击都重新触发' },
  { id: 'TC-2.5.1', name: '开启监控', suite: 'quick-actions', priority: 'P0', auto: 'full', description: '点击监控按钮，检查按钮变绿色并显示脉冲动画' },
  { id: 'TC-2.5.2', name: '检测 DOM 变化', suite: 'quick-actions', priority: 'P0', auto: 'full', description: '开启监控后在页面点击按钮加载新内容，检查侧边栏显示变化通知' },
  { id: 'TC-2.5.3', name: '忽略微小变化', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '开启监控后出现 loading spinner，检查不触发通知' },
  { id: 'TC-2.5.4', name: '关闭监控', suite: 'quick-actions', priority: 'P0', auto: 'full', description: '再次点击监控按钮，检查按钮恢复默认状态并停止监控' },
  { id: 'TC-2.5.5', name: '切换标签页', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '在标签页 A 开启监控后切换到 B，检查监控仍针对 A' },
  { id: 'TC-2.5.6', name: '页面刷新', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '开启监控后刷新页面，检查监控状态丢失' },
  { id: 'TC-2.5.7', name: '冷却期机制', suite: 'quick-actions', priority: 'P1', auto: 'full', description: '触发一次后 8 秒内再次变化，检查累计和 30 秒冷却期' },

  // 3. 页面监控
  { id: 'TC-3.1.1', name: '检测新增元素', suite: 'page-watcher', priority: 'P0', auto: 'full', description: '动态插入 15 个 div，检查触发 page_change_detected 消息' },
  { id: 'TC-3.1.2', name: '忽略 script/style', suite: 'page-watcher', priority: 'P1', auto: 'full', description: '动态插入 script，检查不触发通知（IGNORED_TAGS）' },
  { id: 'TC-3.1.3', name: '忽略广告类元素', suite: 'page-watcher', priority: 'P1', auto: 'full', description: '插入 ad-banner 元素，检查不触发通知（IGNORED_PATTERNS）' },
  { id: 'TC-3.1.4', name: '文本内容变化', suite: 'page-watcher', priority: 'P1', auto: 'full', description: '修改已有元素的 textContent，检查触发通知' },
  { id: 'TC-3.1.5', name: '低于阈值', suite: 'page-watcher', priority: 'P1', auto: 'full', description: '仅插入 5 个 div，检查不触发通知（< 12）' },
  { id: 'TC-3.1.6', name: '多实例保护', suite: 'page-watcher', priority: 'P1', auto: 'full', description: '连续两次调用 startPageWatcher，检查第二次返回 already_watching' },
  { id: 'TC-3.1.7', name: '停止监控', suite: 'page-watcher', priority: 'P0', auto: 'full', description: '调用 stopPageWatcher，检查 observer disconnect 和状态清除' },

  // 4. 录制与回放
  { id: 'TC-4.1.1', name: '正常开始录制', suite: 'recording', priority: 'P0', auto: 'full', description: '点击录制按钮，检查按钮变为红色脉冲状态并开始记录' },
  { id: 'TC-4.1.2', name: '多实例冲突', suite: 'recording', priority: 'P1', auto: 'full', description: '在窗口 B 点击录制，检查提示已有其他实例正在录制' },
  { id: 'TC-4.1.3', name: '无权限页面', suite: 'recording', priority: 'P1', auto: 'manual', description: '在 chrome://settings 点击录制，检查提示不支持' },
  { id: 'TC-4.2.1', name: '手动停止', suite: 'recording', priority: 'P0', auto: 'full', description: '点击停止按钮，检查录制结束和附件 chip 出现' },
  { id: 'TC-4.2.2', name: '发送时自动停止', suite: 'recording', priority: 'P1', auto: 'full', description: '录制中发送消息，检查自动停止并作为附件发送' },
  { id: 'TC-4.2.3', name: 'cap-trigger 停止', suite: 'recording', priority: 'P1', auto: 'full', description: '达到事件上限或时间上限，检查自动停止和原因提示' },
  { id: 'TC-4.2.4', name: '重复点击停止', suite: 'recording', priority: 'P1', auto: 'full', description: '快速点击两次停止，检查不重复发送' },
  { id: 'TC-4.3.1', name: '查看步骤', suite: 'recording', priority: 'P0', auto: 'full', description: '点击录制附件，检查弹出 Dialog 并显示所有步骤' },
  { id: 'TC-4.3.2', name: '修改步骤值', suite: 'recording', priority: 'P1', auto: 'full', description: '修改某步骤 value，检查该步骤更新不影响其他' },
  { id: 'TC-4.3.3', name: '修改 condition', suite: 'recording', priority: 'P1', auto: 'full', description: '将 condition 设为 visible，检查保存后仅元素可见时执行' },
  { id: 'TC-4.3.4', name: '删除步骤', suite: 'recording', priority: 'P1', auto: 'full', description: '点击删除按钮，检查步骤移除和剩余顺序' },
  { id: 'TC-4.3.5', name: '插入步骤', suite: 'recording', priority: 'P1', auto: 'full', description: '点击插入步骤，检查在指定位置插入默认 click 步骤' },
  { id: 'TC-4.3.6', name: '上移/下移', suite: 'recording', priority: 'P1', auto: 'full', description: '点击上移/下移箭头，检查步骤位置交换且 localId 不变' },
  { id: 'TC-4.3.7', name: '排序后 key 稳定', suite: 'recording', priority: 'P1', auto: 'full', description: '检查使用 localId 而非 index 作为 key，无状态错乱' },
  { id: 'TC-4.3.8', name: '回放步骤', suite: 'recording', priority: 'P0', auto: 'full', description: '点击回放，检查关闭编辑器并通过 interact sequence 执行' },
  { id: 'TC-4.3.9', name: '保存为快捷指令', suite: 'recording', priority: 'P1', auto: 'full', description: '输入名称和描述后保存，检查文件生成和 toast 提示' },
  { id: 'TC-4.3.10', name: '保存文件名安全', suite: 'recording', priority: 'P1', auto: 'full', description: '输入特殊字符名称，检查替换为 - 并 trim' },
  { id: 'TC-4.3.11', name: '空步骤回放', suite: 'recording', priority: 'P1', auto: 'full', description: '删除所有步骤后点击回放，检查不执行或提示无步骤' },
  { id: 'TC-4.4.1', name: '正常回放', suite: 'recording', priority: 'P0', auto: 'partial', description: '录制登录流程后回放，检查按顺序执行点击输入提交' },
  { id: 'TC-4.4.2', name: '页面结构变化后回放', suite: 'recording', priority: 'P1', auto: 'partial', description: 'DOM 结构改变后回放，检查定位失败报错并停止' },
  { id: 'TC-4.4.3', name: 'SPA 导航后回放', suite: 'recording', priority: 'P1', auto: 'partial', description: '包含页面跳转的流程回放，检查 scroll delta 基准重置' },
  { id: 'TC-4.4.4', name: '条件步骤回放', suite: 'recording', priority: 'P1', auto: 'full', description: '步骤含 condition:visible，检查不可见时跳过' },
  { id: 'TC-4.4.5', name: '超时处理', suite: 'recording', priority: 'P1', auto: 'full', description: '设置 timeout:1000，检查超时报错并停止' },
  { id: 'TC-4.5.1', name: '导出为附件', suite: 'recording', priority: 'P0', auto: 'full', description: '停止录制，检查 recording 类型附件出现在输入框' },
  { id: 'TC-4.5.2', name: '导出文件完整性', suite: 'recording', priority: 'P1', auto: 'full', description: '检查附件 JSON 包含完整 RecordedSession 字段' },

  // 5. BrowserWing Skill
  { id: 'TC-5.1.1', name: '首次部署', suite: 'skill-browserwing', priority: 'P0', auto: 'full', description: '安装扩展后首次打开，检查 VFS 下出现 skill 文件' },
  { id: 'TC-5.1.2', name: '幂等部署', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '重启扩展，检查已存在 skill 文件不被覆盖' },
  { id: 'TC-5.1.3', name: '用户修改保护', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '用户修改后重启，检查用户修改保留' },
  { id: 'TC-5.2.1', name: 'navigate', suite: 'skill-browserwing', priority: 'P0', auto: 'full', description: '调用 navigate，检查 BrowserWing 打开 URL' },
  { id: 'TC-5.2.2', name: 'snapshot', suite: 'skill-browserwing', priority: 'P0', auto: 'full', description: '调用 snapshot，检查返回 accessibility tree 和 RefIDs' },
  { id: 'TC-5.2.3', name: 'click by RefID', suite: 'skill-browserwing', priority: 'P0', auto: 'full', description: '调用 click，检查对应元素被点击' },
  { id: 'TC-5.2.4', name: 'type', suite: 'skill-browserwing', priority: 'P0', auto: 'full', description: '调用 type，检查对应输入框出现文本' },
  { id: 'TC-5.2.5', name: 'batch', suite: 'skill-browserwing', priority: 'P0', auto: 'full', description: '调用 batch，检查按顺序执行多个操作' },
  { id: 'TC-5.2.6', name: 'fillForm', suite: 'skill-browserwing', priority: 'P0', auto: 'partial', description: '调用 fillForm，检查智能识别并填写表单' },
  { id: 'TC-5.2.7', name: 'screenshot', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '调用 screenshot，检查返回 base64 数据' },
  { id: 'TC-5.2.8', name: 'evaluate', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '调用 evaluate，检查返回 JS 执行结果' },
  { id: 'TC-5.2.9', name: '错误处理', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '调用不存在的 action，检查抛出错误并提示列表' },
  { id: 'TC-5.2.10', name: '网络错误', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: 'BrowserWing 未启动时调用，检查连接错误' },
  { id: 'TC-5.3.1', name: '正常批量填写', suite: 'skill-browserwing', priority: 'P0', auto: 'partial', description: '提供 3 条数据调用 batch-fill，检查逐条填写并返回 success:3' },
  { id: 'TC-5.3.2', name: '截图留痕', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '设置 screenshot:true，检查结果包含 screenshotUrl' },
  { id: 'TC-5.3.3', name: '提交失败回退', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '某条提交失败后，检查记录原因并继续处理下一条' },
  { id: 'TC-5.3.4', name: '空数据', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: 'entries 为空数组，检查返回 total:0 success:0 failed:0' },
  { id: 'TC-5.3.5', name: '人工确认', suite: 'skill-browserwing', priority: 'P1', auto: 'manual', description: '设置 confirm:true，检查每条后暂停等待用户确认' },
  { id: 'TC-5.3.6', name: '自定义提交按钮', suite: 'skill-browserwing', priority: 'P1', auto: 'full', description: '设置 submitSelector，检查点击指定 RefID 提交' },

  // 6. MCP 集成
  { id: 'TC-6.1.1', name: '添加 HTTP MCP', suite: 'mcp-integration', priority: 'P0', auto: 'full', description: '输入 streamable-http URL，检查保存成功和已连接状态' },
  { id: 'TC-6.1.2', name: '添加 SSE MCP', suite: 'mcp-integration', priority: 'P0', auto: 'full', description: '输入 SSE URL，检查保存成功' },
  { id: 'TC-6.1.3', name: '添加带认证 MCP', suite: 'mcp-integration', priority: 'P1', auto: 'full', description: '选择 Bearer Token，检查请求头包含 Authorization' },
  { id: 'TC-6.1.4', name: '连接失败', suite: 'mcp-integration', priority: 'P1', auto: 'full', description: '输入未启动的服务 URL，检查状态显示失败或超时' },
  { id: 'TC-6.1.5', name: '删除 MCP', suite: 'mcp-integration', priority: 'P1', auto: 'full', description: '点击删除，检查列表移除且 LLM 不再调用其工具' },
  { id: 'TC-6.1.6', name: '工具自动发现', suite: 'mcp-integration', priority: 'P0', auto: 'full', description: '连接 BrowserWing MCP，检查 LLM 获得工具列表' },
  { id: 'TC-6.2.1', name: '正常调用', suite: 'mcp-integration', priority: 'P0', auto: 'partial', description: '发送「打开 example.com」，检查 LLM 调用 MCP navigate 并跳转' },
  { id: 'TC-6.2.2', name: '限流保护', suite: 'mcp-integration', priority: 'P1', auto: 'full', description: '快速连续发送 10 条，检查 ServerThrottle 限制' },
  { id: 'TC-6.2.3', name: '断路器', suite: 'mcp-integration', priority: 'P1', auto: 'full', description: 'MCP 服务连续失败 5 次，检查断路器打开' },
  { id: 'TC-6.2.4', name: '自定义 Header', suite: 'mcp-integration', priority: 'P1', auto: 'full', description: '添加 X-Custom header，检查每次请求携带' },

  // 7. 右键上下文菜单
  { id: 'TC-7.1.1', name: '页面右键', suite: 'context-menu', priority: 'P0', auto: 'full', description: '空白处右键，检查显示 CebianX 菜单项' },
  { id: 'TC-7.1.2', name: '选中文本右键', suite: 'context-menu', priority: 'P0', auto: 'full', description: '选中文字后右键，检查额外显示「操作选中内容」' },
  { id: 'TC-7.1.3', name: '链接右键', suite: 'context-menu', priority: 'P0', auto: 'full', description: '链接上右键，检查额外显示「打开此链接」' },
  { id: 'TC-7.1.4', name: '图片右键', suite: 'context-menu', priority: 'P1', auto: 'full', description: '图片上右键，检查不显示 CebianX 专属菜单项' },
  { id: 'TC-7.2.1', name: '阅读此页面', suite: 'context-menu', priority: 'P0', auto: 'full', description: '点击菜单项，检查侧边栏打开并自动发送 prompt' },
  { id: 'TC-7.2.2', name: '总结此页面', suite: 'context-menu', priority: 'P0', auto: 'full', description: '同上，检查自动发送总结 prompt' },
  { id: 'TC-7.2.3', name: '操作选中内容', suite: 'context-menu', priority: 'P0', auto: 'full', description: '选中内容后点击，检查自动发送包含选中内容的 prompt' },
  { id: 'TC-7.2.4', name: '打开此链接', suite: 'context-menu', priority: 'P0', auto: 'full', description: '链接上点击，检查自动发送链接 prompt' },
  { id: 'TC-7.2.5', name: '截图此页面', suite: 'context-menu', priority: 'P0', auto: 'full', description: '点击菜单项，检查自动发送截图 prompt' },
  { id: 'TC-7.2.6', name: '侧边栏未打开', suite: 'context-menu', priority: 'P1', auto: 'full', description: '关闭侧边栏后点击菜单，检查自动打开并发送' },

  // 8. 设置与配置
  { id: 'TC-8.1.1', name: '选择 API Key 模型', suite: 'settings', priority: 'P0', auto: 'full', description: '选择 GPT-4 并输入 API Key，检查保存后可使用' },
  { id: 'TC-8.1.2', name: '选择 Web Provider', suite: 'settings', priority: 'P0', auto: 'manual', description: '选择 GLM 并登录，检查登录成功后显示已登录' },
  { id: 'TC-8.1.3', name: 'Web Provider 登录态过期', suite: 'settings', priority: 'P1', auto: 'manual', description: '使用过期会话发送，检查提示重新登录' },
  { id: 'TC-8.1.4', name: '切换模型', suite: 'settings', priority: 'P1', auto: 'full', description: '从 GPT-4 切换到 Kimi，检查新消息使用新模型' },
  { id: 'TC-8.1.5', name: '无效 API Key', suite: 'settings', priority: 'P1', auto: 'full', description: '输入错误格式 Key，检查发送时提示认证失败' },
  { id: 'TC-8.3.1', name: '展开侧边栏', suite: 'settings', priority: 'P1', auto: 'full', description: '点击悬浮按钮，检查侧边栏从右侧滑出' },
  { id: 'TC-8.3.2', name: '折叠侧边栏', suite: 'settings', priority: 'P1', auto: 'full', description: '再次点击，检查侧边栏收起' },
  { id: 'TC-8.3.3', name: '多标签页同步', suite: 'settings', priority: 'P1', auto: 'full', description: '标签页 A 展开后切换到 B，检查 B 显示悬浮按钮' },

  // 9. 国际化
  { id: 'TC-9.1.1', name: '切换为英文', suite: 'i18n', priority: 'P1', auto: 'full', description: '设置中切换为 English，检查所有 UI 文本变为英文' },
  { id: 'TC-9.1.2', name: '切换为繁体中文', suite: 'i18n', priority: 'P1', auto: 'full', description: '切换为繁体中文，检查所有 UI 文本变为繁体' },
  { id: 'TC-9.1.3', name: 'key 缺失回退', suite: 'i18n', priority: 'P1', auto: 'full', description: '删除某个 key，检查显示英文 fallback 或 key 本身' },
  { id: 'TC-9.1.4', name: '允许列表检查', suite: 'i18n', priority: 'P1', auto: 'full', description: '添加不在 ALLOWLIST 中的 key，运行 pnpm check 检查报错' },

  // 10. 边缘场景与回归测试
  { id: 'TC-10.1.1', name: 'SW 空闲后唤醒', suite: 'regression', priority: 'P1', auto: 'full', description: '长时间不操作后发送消息，检查 SW 正常处理' },
  { id: 'TC-10.1.2', name: 'SW 崩溃重启', suite: 'regression', priority: 'P1', auto: 'partial', description: '强制终止 SW 后发送消息，检查自动重启和状态恢复' },
  { id: 'TC-10.1.3', name: '端口断开重连', suite: 'regression', priority: 'P1', auto: 'full', description: '关闭侧边栏后重新打开，检查端口重连和状态恢复' },
  { id: 'TC-10.2.1', name: '会话持久化', suite: 'regression', priority: 'P0', auto: 'full', description: '发送多条消息后关闭浏览器，重新打开检查历史完整' },
  { id: 'TC-10.2.2', name: 'IndexedDB 迁移', suite: 'regression', priority: 'P1', auto: 'partial', description: '升级扩展版本，检查旧数据自动迁移' },
  { id: 'TC-10.2.3', name: '存储配额满', suite: 'regression', priority: 'P1', auto: 'manual', description: '使存储接近上限，检查优雅处理和提示' },
  { id: 'TC-10.3.1', name: 'Chrome 运行', suite: 'regression', priority: 'P0', auto: 'full', description: 'Chrome 安装扩展并测试核心功能' },
  { id: 'TC-10.3.2', name: 'Firefox 运行', suite: 'regression', priority: 'P0', auto: 'manual', description: 'Firefox 安装扩展并测试核心功能' },
  { id: 'TC-10.3.3', name: '不同分辨率', suite: 'regression', priority: 'P1', auto: 'full', description: '在 1920x1080 和 1366x768 下检查 UI 自适应' },
  { id: 'TC-10.4.1', name: 'XSS 防护', suite: 'regression', priority: 'P0', auto: 'full', description: '发送 XSS 脚本，检查脚本不执行且纯文本显示' },
  { id: 'TC-10.4.2', name: 'CSP 合规', suite: 'regression', priority: 'P1', auto: 'manual', description: '检查所有内联脚本，无不安全的 eval 或内联事件' },
  { id: 'TC-10.4.3', name: '敏感信息不泄露', suite: 'regression', priority: 'P0', auto: 'full', description: '检查日志和网络请求中 API Key 不出现' },
];

export const testConfig = {
  timeout: 60_000,
  retries: 1,
  screenshotDir: 'e2e/automation/screenshots',
  logDir: 'e2e/automation/logs',
  stateFile: 'e2e/automation/state.json',
  reportDir: 'e2e/automation/report',
  mockServers: {
    llmPort: 9999,
    mcpPort: 3456,
    browserwingPort: 8080,
  },
  extensionPath: '.output/chrome-mv3',
  userDataDir: 'e2e/.userdata',
  viewport: { width: 1280, height: 800 },
};
