import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { RecordingEditor } from '@/components/chat/RecordingEditor';
import type { SequenceStep } from '@/lib/recorder/session-to-sequence';

// ─── Mocks ───

vi.mock('@/lib/recorder/session-to-sequence', () => ({
  sessionToSequence: vi.fn(),
}));

vi.mock('@/lib/vfs', () => ({
  vfs: { writeFile: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock('@/lib/i18n', () => ({
  t: vi.fn((...args: unknown[]) => {
    const key = args[0] as string;
    // actionLabels
    if (key === 'chat.recordingEditor.actionLabels.click') return '点击';
    if (key === 'chat.recordingEditor.actionLabels.type') return '输入';
    if (key === 'chat.recordingEditor.actionLabels.scroll') return '滚动';
    if (key === 'chat.recordingEditor.actionLabels.wait_navigation') return '等待导航';
    // UI 文本
    if (key === 'chat.recordingEditor.title') return '录制编辑器';
    if (key === 'chat.recordingEditor.stepsCount') return '个步骤';
    if (key === 'chat.recordingEditor.saved') return `已保存: ${args[1] ?? ''}`;
    if (key === 'chat.recordingEditor.saveFailed') return '保存失败';
    if (key === 'chat.recordingEditor.saveNamePlaceholder') return '输入名称';
    if (key === 'chat.recordingEditor.saveDescPlaceholder') return '输入描述';
    if (key === 'chat.recordingEditor.save') return '保存';
    if (key === 'chat.recordingEditor.saveAsCommand') return '保存为快捷指令';
    if (key === 'chat.recordingEditor.saveAsWorkflow') return '保存为工作流';
    if (key === 'chat.recordingEditor.workflowNamePlaceholder') return '工作流名称';
    if (key === 'chat.recordingEditor.addStep') return '添加步骤';
    if (key === 'chat.recordingEditor.replay') return '回放';
    if (key === 'chat.recordingEditor.noSteps') return '无可回放步骤';
    if (key === 'chat.recordingEditor.insertAfter') return '在下方插入步骤';
    if (key === 'chat.recordingEditor.moveUp') return '上移';
    if (key === 'chat.recordingEditor.moveDown') return '下移';
    if (key === 'chat.recordingEditor.delete') return '删除';
    if (key === 'common.save') return '保存';
    if (key === 'common.cancel') return '取消';
    return key;
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

import { sessionToSequence } from '@/lib/recorder/session-to-sequence';
import { vfs } from '@/lib/vfs';
import { t } from '@/lib/i18n';
import { toast } from 'sonner';

// ─── 测试数据 ───

const mockRecording = {
  type: 'recording' as const,
  name: 'test-recording.json',
  sizeBytes: 100,
  eventCount: 3,
  durationMs: 5000,
  json: JSON.stringify({
    version: 1,
    startedAt: Date.now() - 5000,
    endedAt: Date.now(),
    durationMs: 5000,
    windowId: 1,
    events: [],
  }),
};

const mockSteps: SequenceStep[] = [
  { action: 'click', selector: '#btn' },
  { action: 'type', selector: '#input', text: 'hello' },
  { action: 'scroll', deltaY: 100 },
];

// ─── 辅助 ───

function renderEditor(overrides: Partial<Parameters<typeof RecordingEditor>[0]> = {}) {
  const props = {
    open: true,
    onOpenChange: vi.fn(),
    recording: mockRecording as any,
    onReplay: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RecordingEditor {...props} />) };
}

// ─── 测试 ───

describe('RecordingEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(sessionToSequence).mockReturnValue(mockSteps);
    vi.mocked(vfs.writeFile).mockResolvedValue(undefined as any);
  });

  it('recording 为 null 时显示"无可回放步骤"', () => {
    renderEditor({ recording: null });
    expect(screen.getByText('无可回放步骤')).toBeInTheDocument();
  });

  it('有步骤时正确渲染步骤列表（每个步骤显示 action badge）', async () => {
    renderEditor();
    // 等待 Dialog 渲染
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });
    expect(screen.getByText('输入')).toBeInTheDocument();
    expect(screen.getByText('滚动')).toBeInTheDocument();
  });

  it('点击删除按钮移除步骤', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });

    // 找到所有删除按钮（title="删除"）
    const deleteButtons = screen.getAllByTitle('删除');
    expect(deleteButtons.length).toBe(3);

    // 点击第一个步骤的删除按钮
    fireEvent.click(deleteButtons[0]);

    // "点击" 步骤应被移除
    await waitFor(() => {
      expect(screen.queryByText('点击')).toBeNull();
    });
    // 其他步骤仍在
    expect(screen.getByText('输入')).toBeInTheDocument();
  });

  it('点击添加步骤按钮在末尾插入默认 click 步骤', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });

    // 点击"添加步骤"按钮
    const addBtn = screen.getByText('添加步骤');
    fireEvent.click(addBtn);

    // 应该多一个"点击"badge（原有1个 + 新增1个 = 2个）
    await waitFor(() => {
      const clickBadges = screen.getAllByText('点击');
      expect(clickBadges.length).toBe(2);
    });
  });

  it('点击上移/下移按钮移动步骤', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });

    // 找到所有上移/下移按钮
    const upButtons = screen.getAllByTitle('上移');
    const downButtons = screen.getAllByTitle('下移');

    // 第一个步骤的上移按钮应 disabled
    expect(upButtons[0]).toBeDisabled();
    // 最后一个步骤的下移按钮应 disabled
    expect(downButtons[downButtons.length - 1]).toBeDisabled();

    // 点击第一个步骤的下移按钮 → "点击"和"输入"交换
    fireEvent.click(downButtons[0]);

    await waitFor(() => {
      // 步骤顺序变化后，步骤行中的 badge 顺序也变了
      const allBadges = screen.getAllByText(/点击|输入|滚动/);
      expect(allBadges[0]).toHaveTextContent('输入');
      expect(allBadges[1]).toHaveTextContent('点击');
    });
  });

  it('回放按钮调用 onReplay 并关闭 dialog', async () => {
    const { props } = renderEditor();
    await waitFor(() => {
      expect(screen.getByText(/回放/)).toBeInTheDocument();
    });

    const replayBtn = screen.getByRole('button', { name: /回放/ });
    fireEvent.click(replayBtn);

    expect(props.onReplay).toHaveBeenCalledTimes(1);
    expect(props.onReplay).toHaveBeenCalledWith(mockSteps);
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('空步骤时回放按钮 disabled', async () => {
    vi.mocked(sessionToSequence).mockReturnValue([]);
    renderEditor();

    await waitFor(() => {
      expect(screen.getByText('无可回放步骤')).toBeInTheDocument();
    });

    const replayBtn = screen.getByRole('button', { name: /回放/ });
    expect(replayBtn).toBeDisabled();
  });

  it('保存为快捷指令：输入名称后点击保存，调用 vfs.writeFile', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });

    // 点击"保存为快捷指令"按钮
    const saveAsBtn = screen.getByText('保存为快捷指令');
    fireEvent.click(saveAsBtn);

    // 等待保存表单出现
    const nameInput = await screen.findByPlaceholderText('输入名称');
    const descInput = screen.getByPlaceholderText('输入描述');

    // 输入名称
    fireEvent.change(nameInput, { target: { value: 'My Workflow' } });
    fireEvent.change(descInput, { target: { value: 'test desc' } });

    // 点击保存按钮
    const saveBtn = screen.getByText('保存');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(vfs.writeFile).toHaveBeenCalledTimes(1);
    });

    // 验证写入路径包含安全化后的文件名
    const writePath = vi.mocked(vfs.writeFile).mock.calls[0][0] as string;
    expect(writePath).toContain('my-workflow.md');
    expect(writePath).toContain('~/.cebian/prompts/');

    // 验证内容包含步骤 JSON
    const writeContent = vi.mocked(vfs.writeFile).mock.calls[0][1] as string;
    expect(writeContent).toContain('name: My Workflow');
    expect(writeContent).toContain('click');

    // 验证 toast 成功
    expect(toast.success).toHaveBeenCalled();
  });

  it('保存时名称含特殊字符被安全化', async () => {
    renderEditor();
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });

    const saveAsBtn = screen.getByText('保存为快捷指令');
    fireEvent.click(saveAsBtn);

    const nameInput = await screen.findByPlaceholderText('输入名称');
    fireEvent.change(nameInput, { target: { value: 'Hello World!@#' } });

    const saveBtn = screen.getByText('保存');
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(vfs.writeFile).toHaveBeenCalledTimes(1);
    });

    const writePath = vi.mocked(vfs.writeFile).mock.calls[0][0] as string;
    // 特殊字符被替换为 -，连续 - 合并，首尾 - 被 trim
    expect(writePath).toContain('hello-world.md');
  });

  it('Dialog 关闭时步骤重置', async () => {
    const onOpenChange = vi.fn();
    const onReplay = vi.fn();

    // 第一次渲染
    const { unmount } = render(
      <RecordingEditor
        open={true}
        onOpenChange={onOpenChange}
        recording={mockRecording as any}
        onReplay={onReplay}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
    });

    // 删除一个步骤
    const deleteButtons = screen.getAllByTitle('删除');
    fireEvent.click(deleteButtons[0]);
    await waitFor(() => {
      expect(screen.queryByText('点击')).toBeNull();
    });

    // 卸载后重新挂载（模拟 Dialog 关闭再打开）
    unmount();
    render(
      <RecordingEditor
        open={true}
        onOpenChange={onOpenChange}
        recording={mockRecording as any}
        onReplay={onReplay}
      />,
    );

    // 步骤应该被重置回初始状态（3个步骤）
    await waitFor(() => {
      expect(screen.getByText('点击')).toBeInTheDocument();
      expect(screen.getByText('输入')).toBeInTheDocument();
      expect(screen.getByText('滚动')).toBeInTheDocument();
    });
  });
});
