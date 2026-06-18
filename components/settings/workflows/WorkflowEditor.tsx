import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  GripVertical,
  Save,
  Sparkles,
  History,
} from 'lucide-react';
import { WorkflowHistory } from './WorkflowHistory';
import { toast } from 'sonner';
import type { Workflow, WorkflowStep, WorkflowTrigger, AssertStep, ExportStep } from '@/lib/workflow/types';
import { STEP_TYPE_LABELS } from '@/lib/workflow/types';
import { t } from '@/lib/i18n';
import { generateWorkflow, resolvePlannerModel } from '@/lib/workflow/ai-planner';
import { isValidCron, describeCron } from '@/lib/workflow/cron-parser';
import { useStorageItem } from '@/hooks/useStorageItem';
import { activeModel, providerCredentials, customProviders } from '@/lib/storage';

const STEP_TYPES = Object.entries(STEP_TYPE_LABELS).map(([type, label]) => ({
  type: type as WorkflowStep['type'],
  label,
}));

interface WorkflowEditorProps {
  workflow: Workflow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string | null, changes: Partial<Omit<Workflow, 'id' | 'createdAt'>>) => Promise<string | void>;
}

export function WorkflowEditor({ workflow, open, onOpenChange, onSave }: WorkflowEditorProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [trigger, setTrigger] = useState<WorkflowTrigger>({ type: 'manual' });
  const [saving, setSaving] = useState(false);

  // AI 生成状态
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGoal, setAiGoal] = useState('');
  const [aiLoading, setAiLoading] = useState(false);

  // 历史记录状态
  const [historyOpen, setHistoryOpen] = useState(false);

  // 模型配置（用于 AI 生成）
  const [currentActiveModel] = useStorageItem(activeModel, null);
  const [creds] = useStorageItem(providerCredentials, {});
  const [customProvs] = useStorageItem(customProviders, []);

  // 在 open/workflow 变化时同步状态
  useEffect(() => {
    if (open && workflow) {
      setName(workflow.name);
      setDescription(workflow.description ?? '');
      setSteps([...workflow.steps]);
      setTrigger(workflow.trigger ?? { type: 'manual' });
      setAiOpen(false);
      setAiGoal('');
    }
  }, [open, workflow?.id]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(workflow?.id ?? null, {
        name: name.trim(),
        description: description.trim() || undefined,
        steps,
        trigger,
      });
      toast.success(t('settings.workflows.editor.saveSuccess', [name.trim()]));
      onOpenChange(false);
    } catch (err) {
      toast.error(t('settings.workflows.editor.saveFailed'));
      console.error('[WorkflowEditor]', err);
    } finally {
      setSaving(false);
    }
  }, [workflow, name, description, steps, onSave, onOpenChange]);

  const updateStep = useCallback((index: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, ...patch } as WorkflowStep : s)),
    );
  }, []);

  const removeStep = useCallback((index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const moveStep = useCallback((index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      const copy = [...prev];
      const [moved] = copy.splice(index, 1);
      copy.splice(newIndex, 0, moved);
      return copy;
    });
  }, []);

  const addStep = useCallback((type: WorkflowStep['type']) => {
    let newStep: WorkflowStep;
    switch (type) {
      case 'navigate':
        newStep = { type: 'navigate', url: 'https://example.com' };
        break;
      case 'click':
      case 'focus':
      case 'hover':
      case 'dblclick':
      case 'rightclick':
        // 多个变体共享相同结构；此处 type 是字面量联合，需断言
        newStep = { type, selector: '' } as WorkflowStep;
        break;
      case 'type':
        newStep = { type: 'type', selector: '', text: '', clear: true };
        break;
      case 'select':
        newStep = { type: 'select', selector: '', text: '' };
        break;
      case 'scroll':
        newStep = { type: 'scroll', deltaY: 300 };
        break;
      case 'keypress':
        newStep = { type: 'keypress', key: 'Enter' };
        break;
      case 'wait':
        newStep = { type: 'wait', timeout: 3000 };
        break;
      case 'wait_navigation':
        newStep = { type: 'wait_navigation', timeout: 5000 };
        break;
      case 'extract':
        newStep = { type: 'extract', selector: '', toVariable: 'result' };
        break;
      case 'assert':
        newStep = { type: 'assert', selector: '', operator: 'exists', timeout: 5000 };
        break;
      case 'if':
        newStep = {
          type: 'if',
          condition: { variable: 'status', operator: 'eq', value: 'ok' },
          thenSteps: [],
        };
        break;
      case 'export':
        newStep = { type: 'export', destination: 'clipboard' };
        break;
      case 'visual_locate':
        newStep = { type: 'visual_locate', description: '', toVariable: 'result' };
        break;
      case 'visual_click':
        newStep = { type: 'visual_click', description: '' };
        break;
      case 'visual_type':
        newStep = { type: 'visual_type', description: '', text: '' };
        break;
      default: {
        const _exhaustive: never = type;
        throw new Error(`Unknown step type: ${_exhaustive}`);
      }
    }
    setSteps((prev) => [...prev, newStep]);
  }, []);

  const handleAiGenerate = useCallback(async () => {
    if (!aiGoal.trim() || aiLoading) return;
    setAiLoading(true);
    const toastId = toast.loading(t('settings.workflows.editor.aiGenerating'));
    try {
      const model = await resolvePlannerModel(currentActiveModel, creds, customProvs);
      if (!model) {
        toast.error(t('settings.workflows.editor.aiNoModel'), { id: toastId });
        setAiLoading(false);
        return;
      }
      const result = await generateWorkflow(model, aiGoal.trim());
      if (!result) {
        toast.error(t('settings.workflows.editor.aiFailed'), { id: toastId });
        setAiLoading(false);
        return;
      }
      setName(result.name);
      if (result.description) setDescription(result.description);
      setSteps(result.steps);
      toast.success(t('settings.workflows.editor.aiSuccess', [result.steps.length]), { id: toastId });
      setAiOpen(false);
      setAiGoal('');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(t('settings.workflows.editor.aiFailed') + ': ' + msg, { id: toastId });
    } finally {
      setAiLoading(false);
    }
  }, [aiGoal, aiLoading, currentActiveModel, creds, customProvs]);

  if (!workflow) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b flex flex-row items-center justify-between">
            <DialogTitle className="text-base font-semibold">
              {t('settings.workflows.editor.title')}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon-xs"
              title={t('settings.workflows.history.title', [name])}
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-4" />
            </Button>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* 基本信息 */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('settings.workflows.editor.nameLabel')}
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('settings.workflows.editor.namePlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('settings.workflows.editor.descLabel')}
              </label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('settings.workflows.editor.descPlaceholder')}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                {t('settings.workflows.editor.triggerLabel')}
              </label>
              <div className="flex items-center gap-2">
                <select
                  className="h-8 text-xs px-2 rounded-md border border-input bg-background"
                  value={trigger.type}
                  onChange={(e) => {
                    const type = e.target.value as WorkflowTrigger['type'];
                    if (type === 'url') {
                      setTrigger({ type, config: { pattern: '' } });
                    } else if (type === 'cron') {
                      setTrigger({ type, config: { expression: '0 9 * * *' } });
                    } else if (type === 'dom') {
                      setTrigger({ type, config: { selector: '' } });
                    } else {
                      setTrigger({ type });
                    }
                  }}
                >
                  <option value="manual">{t('settings.workflows.editor.triggerManual')}</option>
                  <option value="url">{t('settings.workflows.editor.triggerUrl')}</option>
                  <option value="cron">{t('settings.workflows.editor.triggerCron')}</option>
                  <option value="dom">{t('settings.workflows.editor.triggerDom')}</option>
                </select>
                {trigger.type === 'url' && (
                  <Input
                    value={(trigger.config as { pattern?: string })?.pattern ?? ''}
                    onChange={(e) => setTrigger({ type: 'url', config: { pattern: e.target.value } })}
                    placeholder={t('settings.workflows.editor.triggerUrlPlaceholder')}
                    className="h-8 text-xs flex-1"
                  />
                )}
                {trigger.type === 'cron' && (
                  <div className="flex-1 flex items-center gap-2">
                    <Input
                      value={(trigger.config as { expression?: string })?.expression ?? ''}
                      onChange={(e) => setTrigger({ type: 'cron', config: { expression: e.target.value } })}
                      placeholder={t('settings.workflows.editor.triggerCronPlaceholder')}
                      className="h-8 text-xs"
                    />
                    <span
                      className={`text-[11px] shrink-0 ${isValidCron((trigger.config as { expression?: string })?.expression ?? '') ? 'text-emerald-500' : 'text-destructive'}`}
                    >
                      {describeCron((trigger.config as { expression?: string })?.expression ?? '')}
                    </span>
                  </div>
                )}
                {trigger.type === 'dom' && (
                  <Input
                    value={(trigger.config as { selector?: string })?.selector ?? ''}
                    onChange={(e) => setTrigger({ type: 'dom', config: { selector: e.target.value } })}
                    placeholder={t('settings.workflows.editor.triggerDomPlaceholder')}
                    className="h-8 text-xs flex-1"
                  />
                )}
              </div>
            </div>
          </div>

            {/* 步骤列表 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('settings.workflows.editor.stepsLabel')}
                  <span className="ml-1 text-muted-foreground/60">({steps.length})</span>
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="xs"
                    className="h-7 text-xs gap-1"
                    onClick={() => setAiOpen((v) => !v)}
                    disabled={aiLoading}
                  >
                    <Sparkles className="size-3.5" />
                    {t('settings.workflows.editor.aiGenerate')}
                  </Button>
                  <select
                    className="h-7 text-xs px-2 rounded-md border border-input bg-background w-40"
                    value=""
                    onChange={(e) => {
                      if (e.target.value) {
                        addStep(e.target.value as WorkflowStep['type']);
                        e.target.value = '';
                      }
                    }}
                  >
                    <option value="" disabled>{t('settings.workflows.editor.addStep')}</option>
                    {STEP_TYPES.map(({ type, label }) => (
                      <option key={type} value={type}>{label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* AI 生成输入区 */}
              {aiOpen && (
                <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {t('settings.workflows.editor.aiHint')}
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={aiGoal}
                      onChange={(e) => setAiGoal(e.target.value)}
                      placeholder={t('settings.workflows.editor.aiPlaceholder')}
                      className="h-8 text-xs flex-1"
                      disabled={aiLoading}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void handleAiGenerate();
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-8 text-xs"
                      onClick={() => void handleAiGenerate()}
                      disabled={!aiGoal.trim() || aiLoading}
                    >
                      {aiLoading ? t('common.loading') : t('settings.workflows.editor.aiGenerateBtn')}
                    </Button>
                  </div>
                </div>
              )}

              {steps.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground border rounded-lg">
                  {t('settings.workflows.editor.emptySteps')}
                </div>
              ) : (
                <div className="space-y-1.5">
                  {steps.map((step, index) => (
                    <StepEditRow
                      key={`${index}-${step.type}`}
                      index={index}
                      step={step}
                      total={steps.length}
                      onUpdate={updateStep}
                      onRemove={removeStep}
                      onMove={moveStep}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={!name.trim() || saving}>
              <Save className="size-4 mr-1.5" />
              {saving ? '...' : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {workflow && (
        <WorkflowHistory
          workflow={workflow}
          open={historyOpen}
          onOpenChange={setHistoryOpen}
        />
      )}
    </>
  );
}

// ─── 单步编辑行 ───

function StepEditRow({
  index,
  step,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  index: number;
  step: WorkflowStep;
  total: number;
  onUpdate: (index: number, patch: Partial<WorkflowStep>) => void;
  onRemove: (index: number) => void;
  onMove: (index: number, direction: -1 | 1) => void;
}) {
  const typeLabel = STEP_TYPE_LABELS[step.type];

  return (
    <div className="group rounded-lg border border-border bg-card p-2.5 space-y-2">
      <div className="flex items-center gap-2">
        <GripVertical className="size-3.5 text-muted-foreground/30 shrink-0" />
        <span className="text-muted-foreground text-xs w-4 text-right">{index + 1}</span>
        <Badge variant="outline" className="text-[0.65rem] h-5 px-1.5 font-mono shrink-0">
          {typeLabel}
        </Badge>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="icon-xs" onClick={() => onMove(index, -1)} disabled={index === 0}>
            <ChevronUp className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => onMove(index, 1)} disabled={index === total - 1}>
            <ChevronDown className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" onClick={() => onRemove(index)} className="text-destructive hover:text-destructive">
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>

      {/* 参数字段 */}
      <div className="flex flex-wrap gap-2">
        {'selector' in step && (
          <Input
            value={step.selector ?? ''}
            onChange={(e) => onUpdate(index, { selector: e.target.value } as Partial<WorkflowStep>)}
            placeholder="CSS selector"
            className="h-6 text-xs flex-1 min-w-[160px]"
          />
        )}
        {'url' in step && (
          <Input
            value={step.url}
            onChange={(e) => onUpdate(index, { url: e.target.value } as Partial<WorkflowStep>)}
            placeholder="https://..."
            className="h-6 text-xs flex-1 min-w-[200px]"
          />
        )}
        {'text' in step && (
          <Input
            value={step.text}
            onChange={(e) => onUpdate(index, { text: e.target.value } as Partial<WorkflowStep>)}
            placeholder="text"
            className="h-6 text-xs flex-1 min-w-[120px]"
          />
        )}
        {'key' in step && (
          <Input
            value={step.key}
            onChange={(e) => onUpdate(index, { key: e.target.value } as Partial<WorkflowStep>)}
            placeholder="Enter"
            className="h-6 text-xs w-24"
          />
        )}
        {'deltaY' in step && (
          <Input
            type="number"
            value={step.deltaY ?? 0}
            onChange={(e) => onUpdate(index, { deltaY: Number(e.target.value) } as Partial<WorkflowStep>)}
            placeholder="deltaY"
            className="h-6 text-xs w-20"
          />
        )}
        {'timeout' in step && (
          <Input
            type="number"
            value={step.timeout ?? 3000}
            onChange={(e) => onUpdate(index, { timeout: Number(e.target.value) } as Partial<WorkflowStep>)}
            placeholder="ms"
            className="h-6 text-xs w-20"
          />
        )}
        {'toVariable' in step && (
          <Input
            value={step.toVariable}
            onChange={(e) => onUpdate(index, { toVariable: e.target.value } as Partial<WorkflowStep>)}
            placeholder="variable name"
            className="h-6 text-xs w-28"
          />
        )}
        {'variable' in step && step.type === 'assert' && (
          <Input
            value={step.variable ?? ''}
            onChange={(e) => onUpdate(index, { variable: e.target.value || undefined } as Partial<WorkflowStep>)}
            placeholder="variable name (alt to selector)"
            className="h-6 text-xs w-40"
          />
        )}
        {'operator' in step && (
          <select
            className="h-6 text-xs px-1.5 rounded-md border border-input bg-background"
            value={step.operator}
            onChange={(e) => {
              const op = e.target.value as AssertStep['operator'];
              const patch: Partial<AssertStep> = { operator: op };
              // exists / not_exists do not need value
              if (op === 'exists' || op === 'not_exists') {
                patch.value = undefined;
              }
              onUpdate(index, patch as Partial<WorkflowStep>);
            }}
          >
            <option value="exists">exists</option>
            <option value="not_exists">not exists</option>
            <option value="contains">contains</option>
            <option value="eq">equals</option>
            <option value="gt">&gt;</option>
            <option value="lt">&lt;</option>
          </select>
        )}
        {'value' in step && step.value !== undefined && (
          <Input
            value={String(step.value)}
            onChange={(e) => onUpdate(index, { value: e.target.value } as Partial<WorkflowStep>)}
            placeholder="expected value"
            className="h-6 text-xs flex-1 min-w-[100px]"
          />
        )}
        {step.type === 'if' && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono">${step.condition.variable}</span>
            <span>{step.condition.operator}</span>
            <span className="font-mono">{step.condition.value}</span>
            <span className="text-[10px] ml-1">
              ({step.thenSteps.length} then
              {step.elseSteps?.length ? `, ${step.elseSteps.length} else` : ''})
            </span>
          </div>
        )}
        {step.type === 'export' && (
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <select
              className="h-6 text-xs px-1.5 rounded-md border border-input bg-background"
              value={step.destination}
              onChange={(e) => onUpdate(index, { destination: e.target.value as ExportStep['destination'] } as Partial<WorkflowStep>)}
            >
              <option value="clipboard">clipboard</option>
              <option value="csv">csv</option>
              <option value="json">json</option>
            </select>
            {step.destination !== 'clipboard' && (
              <Input
                value={step.filename ?? ''}
                onChange={(e) => onUpdate(index, { filename: e.target.value || undefined } as Partial<WorkflowStep>)}
                placeholder="filename (optional)"
                className="h-6 text-xs flex-1 min-w-[100px]"
              />
            )}
            <Input
              value={(step.variables ?? []).join(', ')}
              onChange={(e) => {
                const vars = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
                onUpdate(index, { variables: vars.length > 0 ? vars : undefined } as Partial<WorkflowStep>);
              }}
              placeholder="variables (optional, comma separated)"
              className="h-6 text-xs flex-1 min-w-[120px]"
            />
          </div>
        )}
      </div>
    </div>
  );
}
