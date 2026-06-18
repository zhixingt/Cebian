/**
 * 录制编辑器：查看、修改、删除、插入回放步骤
 */
import { useState, useCallback, useMemo } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Play, Trash2, Plus, ChevronUp, ChevronDown, GripVertical, Save,
  Wand2, Check, X,
} from 'lucide-react';
import { toast } from 'sonner';
import type { SequenceStep } from '@/lib/recorder/session-to-sequence';
import { sessionToSequence } from '@/lib/recorder/session-to-sequence';
import type { RecordedSession } from '@/lib/recorder/types';
import { vfs } from '@/lib/vfs';
import { CEBIAN_PROMPTS_DIR } from '@/lib/constants';
import { sequenceToWorkflowSteps } from '@/lib/workflow/session-to-workflow';
import { createWorkflow } from '@/lib/workflow/repository';
import type { Workflow } from '@/lib/workflow/types';
import { t } from '@/lib/i18n';
import { analyzeOptimizations, type OptimizationSuggestion } from '@/lib/recorder/ai-optimizer';

type Attachment = import('@/lib/attachments').Attachment;
type PromptDispatchResult = import('@/hooks/useBackgroundAgent').PromptDispatchResult;

/** 获取 action 的本地化标签 */
function getActionLabel(action: string): string {
  return t(`chat.recordingEditor.actionLabels.${action}` as any) || action;
}

const ACTION_COLORS: Record<string, string> = {
  click: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  type: 'bg-green-500/15 text-green-400 border-green-500/20',
  keypress: 'bg-purple-500/15 text-purple-400 border-purple-500/20',
  scroll: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
  wait: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  select: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/20',
  clear: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
  drag: 'bg-pink-500/15 text-pink-400 border-pink-500/20',
};

interface RecordingEditorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recording: Attachment | null;
  onReplay: (steps: SequenceStep[]) => void;
}

export function RecordingEditor({
  open, onOpenChange, recording, onReplay,
}: RecordingEditorProps) {
  // 解析录制数据为步骤
  const initialSteps = useMemo<SequenceStep[]>(() => {
    if (!recording || recording.type !== 'recording') return [];
    try {
      const session = JSON.parse(recording.json) as RecordedSession;
      return sessionToSequence(session);
    } catch {
      return [];
    }
  }, [recording]);

  // 为每个步骤附加稳定的 localId，用于 React key 和排序后的身份追踪
  let nextLocalId = 0;
  function assignLocalIds(s: SequenceStep[]): (SequenceStep & { localId: string })[] {
    return s.map(step => ({ ...step, localId: `${nextLocalId++}` }));
  }

  const [steps, setSteps] = useState<(SequenceStep & { localId: string })[]>(() => assignLocalIds(initialSteps));
  const [saveName, setSaveName] = useState('');
  const [saveDesc, setSaveDesc] = useState('');
  const [showSave, setShowSave] = useState(false);
  const [saveMode, setSaveMode] = useState<'command' | 'workflow'>('command');
  const [saving, setSaving] = useState(false);
  const [showOptimize, setShowOptimize] = useState(false);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  // 当 recording 变化时重置步骤
  const resetSteps = useCallback(() => {
    nextLocalId = 0;
    setSteps(assignLocalIds(initialSteps));
    setShowOptimize(false);
    setSuggestions([]);
    setAppliedIds(new Set());
  }, [initialSteps]);

  // 编辑步骤字段（类型安全：根据字段类型自动转换）
  const updateStep = useCallback(<K extends keyof SequenceStep>(index: number, field: K, value: SequenceStep[K]) => {
    setSteps(prev => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  }, []);

  // 删除步骤
  const removeStep = useCallback((index: number) => {
    setSteps(prev => prev.filter((_, i) => i !== index));
  }, []);

  // 插入步骤
  const insertStep = useCallback((index: number) => {
    setSteps(prev => {
      const next = [...prev];
      next.splice(index, 0, { action: 'click', selector: '', localId: `${nextLocalId++}` } as SequenceStep & { localId: string });
      return next;
    });
  }, []);

  // 上移/下移
  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps(prev => {
      const target = index + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  // 回放（过滤掉 localId，只传递纯净的 SequenceStep）
  const handleReplay = useCallback(() => {
    if (steps.length === 0) return;
    const pureSteps = steps.map(({ localId: _, ...rest }) => rest);
    onReplay(pureSteps);
    onOpenChange(false);
  }, [steps, onReplay, onOpenChange]);

  // AI 优化：分析录制步骤并生成优化建议
  const handleAnalyze = useCallback(() => {
    const pureSteps = steps.map(({ localId: _, ...rest }) => rest);
    const opts = analyzeOptimizations(pureSteps);
    setSuggestions(opts);
    setAppliedIds(new Set());
    setShowOptimize(true);
  }, [steps]);

  // 应用单条优化建议
  const handleApplySuggestion = useCallback((suggestion: OptimizationSuggestion) => {
    setSteps(prev => {
      const pureSteps = prev.map(({ localId: _, ...rest }) => rest);
      const applied = suggestion.apply(pureSteps);
      nextLocalId = 0;
      return assignLocalIds(applied);
    });
    setAppliedIds(prev => new Set(prev).add(suggestion.id));
    toast.success(t('chat.recordingEditor.optimizationApplied'));
  }, []);

  // 保存为快捷指令或工作流
  const handleSave = useCallback(async () => {
    if (!saveName.trim()) return;
    setSaving(true);
    try {
      const pureSteps = steps.map(({ localId: _, ...rest }) => rest);

      if (saveMode === 'workflow') {
        // 保存为 Workflow
        const workflowSteps = sequenceToWorkflowSteps(pureSteps);
        const now = Date.now();
        const workflow: Workflow = {
          id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: saveName.trim(),
          description: saveDesc.trim() || undefined,
          steps: workflowSteps,
          trigger: { type: 'manual' },
          createdAt: now,
          updatedAt: now,
          runCount: 0,
        };
        await createWorkflow(workflow);
        toast.success(t('chat.recordingEditor.savedAsWorkflow', [saveName.trim()]));
      } else {
        // 保存为快捷指令
        const stepsJson = JSON.stringify(pureSteps, null, 2);
        const content = [
          '---',
          `name: ${saveName.trim()}`,
          `description: "${(saveDesc.trim() || t('chat.recorder.defaultDesc')).replace(/"/g, '\\"')}"`,
          '---',
          '',
          t('chat.recorder.replayPromptPrefix'),
          '',
          '```json',
          stepsJson,
          '```',
        ].join('\n');
        // 文件名：用 name 生成安全的文件名
        const safeName = saveName.trim().toLowerCase()
          .replace(/[^a-z0-9\u4e00-\u9fff_-]/g, '-')
          .replace(/-+/g, '-')
          .replace(/^-|-$/g, '');
        const fileName = `${safeName}.md`;
        await vfs.writeFile(`${CEBIAN_PROMPTS_DIR}/${fileName}`, content, 'utf8');
        toast.success(t('chat.recordingEditor.saved', [saveName.trim()]));
      }

      setShowSave(false);
      setSaveName('');
      setSaveDesc('');
    } catch (err) {
      toast.error(t('chat.recordingEditor.saveFailed'));
      console.error('[SaveWorkflow]', err);
    } finally {
      setSaving(false);
    }
  }, [steps, saveName, saveDesc, saveMode]);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetSteps(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-medium">
            {t('chat.recordingEditor.title')}
            <span className="ml-2 text-xs text-muted-foreground font-normal">
              {steps.length} {t('chat.recordingEditor.stepsCount')}
            </span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="flex-1 px-4 max-h-[50vh]">
          {steps.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('chat.recordingEditor.noSteps')}
            </div>
          ) : (
            <div className="space-y-1 pb-2">
              {steps.map((step, i) => (
                <StepRow
                  key={step.localId}
                  index={i}
                  step={step}
                  total={steps.length}
                  onUpdate={updateStep}
                  onRemove={removeStep}
                  onInsert={insertStep}
                  onMove={moveStep}
                />
              ))}
            </div>
          )}
        </ScrollArea>

        {/* AI 优化建议面板 */}
        {showOptimize && (
          <div className="px-4 py-3 border-t bg-muted/30">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium flex items-center gap-1.5">
                <Wand2 className="size-3.5 text-primary" />
                {t('chat.recordingEditor.optimizeTitle')}
              </span>
              <Button variant="ghost" size="icon-xs" onClick={() => setShowOptimize(false)}>
                <X className="size-3" />
              </Button>
            </div>
            {suggestions.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2">
                {t('chat.recordingEditor.noSuggestions')}
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[28vh] overflow-y-auto">
                {suggestions.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-start gap-2 text-xs p-2 rounded border ${
                      appliedIds.has(s.id)
                        ? 'bg-emerald-500/5 border-emerald-500/20 opacity-60'
                        : 'bg-background border-border'
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-xs">{s.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{s.description}</div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="shrink-0 mt-0.5"
                      disabled={appliedIds.has(s.id)}
                      onClick={() => handleApplySuggestion(s)}
                      title={appliedIds.has(s.id) ? t('chat.recordingEditor.applied') : t('chat.recordingEditor.apply')}
                    >
                      {appliedIds.has(s.id) ? (
                        <Check className="size-3.5 text-emerald-500" />
                      ) : (
                        <Check className="size-3.5" />
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="px-4 py-3 border-t gap-2 flex-wrap">
          {showSave ? (
            <>
              <div className="flex items-center gap-1 w-full">
                <Button
                  variant={saveMode === 'command' ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => setSaveMode('command')}
                  className="text-xs h-7"
                >
                  {t('chat.recordingEditor.saveAsCommand')}
                </Button>
                <Button
                  variant={saveMode === 'workflow' ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => setSaveMode('workflow')}
                  className="text-xs h-7"
                >
                  {t('chat.recordingEditor.saveAsWorkflow')}
                </Button>
              </div>
              <Input
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                placeholder={saveMode === 'workflow' ? t('chat.recordingEditor.workflowNamePlaceholder') : t('chat.recordingEditor.saveNamePlaceholder')}
                className="h-7 text-xs flex-1 min-w-28"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              <Input
                value={saveDesc}
                onChange={(e) => setSaveDesc(e.target.value)}
                placeholder={t('chat.recordingEditor.saveDescPlaceholder')}
                className="h-7 text-xs flex-1 min-w-28"
              />
              <Button variant="outline" size="sm" onClick={() => setShowSave(false)}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleSave} disabled={!saveName.trim() || saving}>
                <Save className="size-3 mr-1" /> {saving ? '...' : t('common.save')}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => insertStep(steps.length)}
              >
                <Plus className="size-3 mr-1" /> {t('chat.recordingEditor.addStep')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSaveMode('command'); setShowSave(true); }}
                disabled={steps.length === 0}
              >
                <Save className="size-3 mr-1" /> {t('chat.recordingEditor.saveAsCommand')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setSaveMode('workflow'); setShowSave(true); }}
                disabled={steps.length === 0}
              >
                <Save className="size-3 mr-1" /> {t('chat.recordingEditor.saveAsWorkflow')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleAnalyze}
                disabled={steps.length === 0}
              >
                <Wand2 className="size-3 mr-1" /> {t('chat.recordingEditor.aiOptimize')}
              </Button>
              <Button
                size="sm"
                onClick={handleReplay}
                disabled={steps.length === 0}
              >
                <Play className="size-3 mr-1" /> {t('chat.recordingEditor.replay')} ({steps.length})
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── 单行步骤 ───

function StepRow({ index, step, total, onUpdate, onRemove, onInsert, onMove }: {
  index: number;
  step: SequenceStep;
  total: number;
  onUpdate: <K extends keyof SequenceStep>(index: number, field: K, value: SequenceStep[K]) => void;
  onRemove: (index: number) => void;
  onInsert: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const colorClass = ACTION_COLORS[step.action] || 'bg-gray-500/15 text-gray-400 border-gray-500/20';

  return (
    <div className="group flex items-center gap-1.5 py-1 px-1 rounded hover:bg-muted/50 text-xs">
      {/* 序号 + 拖拽手柄 */}
      <span className="text-muted-foreground w-4 text-right shrink-0">{index + 1}</span>
      <GripVertical className="size-3 text-muted-foreground/40 shrink-0" />

      {/* Action 标签 */}
      <Badge
        variant="outline"
        className={`shrink-0 h-5 text-[0.6rem] px-1.5 rounded font-mono ${colorClass}`}
      >
        {getActionLabel(step.action)}
      </Badge>

      {/* 可编辑字段 */}
      <div className="flex-1 flex items-center gap-1 min-w-0">
        {step.selector !== undefined && (
          <Input
            value={step.selector}
            onChange={(e) => onUpdate(index, 'selector', e.target.value)}
            className="h-5 text-[0.6rem] px-1.5 py-0 font-mono bg-transparent border-dashed"
            placeholder="selector"
          />
        )}
        {step.text !== undefined && (
          <Input
            value={step.text}
            onChange={(e) => onUpdate(index, 'text', e.target.value)}
            className="h-5 text-[0.6rem] px-1.5 py-0 bg-transparent border-dashed w-20"
            placeholder="text"
          />
        )}
        {step.key !== undefined && (
          <Input
            value={step.key}
            onChange={(e) => onUpdate(index, 'key', e.target.value)}
            className="h-5 text-[0.6rem] px-1.5 py-0 bg-transparent border-dashed w-14"
            placeholder="key"
          />
        )}
        {step.action === 'scroll' && (step.deltaX !== undefined || step.deltaY !== undefined) && (
          <span className="text-muted-foreground shrink-0">
            ({step.deltaX ?? 0}, {step.deltaY ?? 300})
          </span>
        )}
        {step.action === 'wait_navigation' && (
          <span className="text-muted-foreground">{t('chat.recordingEditor.actionLabels.wait_navigation')}</span>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <Button
          variant="ghost" size="icon-xs"
          onClick={() => onInsert(index + 1)}
          title={t('chat.recordingEditor.insertAfter')}
        >
          <Plus className="size-2.5" />
        </Button>
        <Button
          variant="ghost" size="icon-xs"
          onClick={() => onMove(index, -1)}
          disabled={index === 0}
          title={t('chat.recordingEditor.moveUp')}
        >
          <ChevronUp className="size-2.5" />
        </Button>
        <Button
          variant="ghost" size="icon-xs"
          onClick={() => onMove(index, 1)}
          disabled={index === total - 1}
          title={t('chat.recordingEditor.moveDown')}
        >
          <ChevronDown className="size-2.5" />
        </Button>
        <Button
          variant="ghost" size="icon-xs"
          onClick={() => onRemove(index)}
          title={t('chat.recordingEditor.delete')}
          className="text-destructive hover:text-destructive"
        >
          <Trash2 className="size-2.5" />
        </Button>
      </div>
    </div>
  );
}
