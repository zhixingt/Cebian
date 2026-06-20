import { useCallback, useEffect, useRef, useState, memo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Play,
  Plus,
  Search,
  Trash2,
  Workflow as WorkflowIcon,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  GripVertical,
  Pencil,
  Download,
  Upload,
  MousePointerClick,
  Timer,
  Link2,
  ScanEye,
  SlidersHorizontal,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  listWorkflows,
  deleteWorkflow,
  searchWorkflows,
  recordWorkflowRun,
  createWorkflow,
  getWorkflow,
  updateWorkflow,
  createWorkflowRun,
} from '@/lib/workflow/repository';
import { refreshWorkflowTrigger } from '@/lib/workflow/trigger-manager';
import { startWorkflowRun } from '@/lib/workflow/engine';

import { ensurePresetWorkflows } from '@/lib/workflow/presets';
import { STEP_TYPE_LABELS } from '@/lib/workflow/types';
import type { Workflow, WorkflowTriggerType } from '@/lib/workflow/types';
import type { StepResult } from '@/lib/workflow/executor';
import { WorkflowEditor } from '@/components/settings/workflows/WorkflowEditor';
import { WorkflowHistory } from '@/components/settings/workflows/WorkflowHistory';
import { downloadWorkflowJson, downloadWorkflowCeb, readWorkflowFile } from '@/lib/workflow/import-export';
import { t } from '@/lib/i18n';

const TRIGGER_TYPES: WorkflowTriggerType[] = ['manual', 'cron', 'url', 'dom'];

function triggerIcon(type: WorkflowTriggerType) {
  switch (type) {
    case 'manual': return <MousePointerClick className="size-3" />;
    case 'cron': return <Timer className="size-3" />;
    case 'url': return <Link2 className="size-3" />;
    case 'dom': return <ScanEye className="size-3" />;
  }
}

function triggerLabel(type: WorkflowTriggerType) {
  switch (type) {
    case 'manual': return t('settings.workflows.editor.triggerManual');
    case 'cron': return t('settings.workflows.editor.triggerCron');
    case 'url': return t('settings.workflows.editor.triggerUrl');
    case 'dom': return t('settings.workflows.editor.triggerDom');
  }
}

function triggerBadgeVariant(type: WorkflowTriggerType): 'default' | 'secondary' | 'outline' | 'destructive' {
  switch (type) {
    case 'manual': return 'default';
    case 'cron': return 'secondary';
    case 'url': return 'outline';
    case 'dom': return 'destructive';
  }
}

function statusIcon(status?: Workflow['lastRunStatus']) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="size-3.5 text-emerald-500" />;
    case 'failure':
      return <XCircle className="size-3.5 text-destructive" />;
    case 'cancelled':
      return <AlertCircle className="size-3.5 text-amber-500" />;
    default:
      return null;
  }
}

function statusLabel(status?: Workflow['lastRunStatus']) {
  switch (status) {
    case 'success':
      return t('settings.workflows.status.success');
    case 'failure':
      return t('settings.workflows.status.failure');
    case 'cancelled':
      return t('settings.workflows.status.cancelled');
    default:
      return t('settings.workflows.status.neverRun');
  }
}

export function WorkflowsSection() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTrigger, setFilterTrigger] = useState<WorkflowTriggerType | 'all'>('all');
  const [loading, setLoading] = useState(true);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [editingWorkflow, setEditingWorkflow] = useState<Workflow | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [historyWorkflow, setHistoryWorkflow] = useState<Workflow | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [varDialogOpen, setVarDialogOpen] = useState(false);
  const [varDialogWorkflow, setVarDialogWorkflow] = useState<Workflow | null>(null);
  const [varValues, setVarValues] = useState<Record<string, string>>({});

  // 执行进度面板
  const [runProgressOpen, setRunProgressOpen] = useState(false);
  const [runProgressSteps, setRunProgressSteps] = useState<StepResult[]>([]);
  const [runProgressWorkflow, setRunProgressWorkflow] = useState<Workflow | null>(null);
  const [runProgressStatus, setRunProgressStatus] = useState<'running' | 'success' | 'failure'>('running');

  const loadWorkflows = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listWorkflows();
      setWorkflows(data);
    } catch (error) {
      console.error('Failed to load workflows', error);
      toast.error(t('settings.workflows.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRestorePresets = useCallback(async () => {
    try {
      await ensurePresetWorkflows(createWorkflow, async (id) => !!(await getWorkflow(id)));
      toast.success(t('settings.workflows.restorePresetsSuccess'));
    } catch (error) {
      console.error('Failed to restore preset workflows', error);
      toast.error(t('settings.workflows.restorePresetsFailed'));
    } finally {
      void loadWorkflows();
    }
  }, [loadWorkflows]);

  // 客户端筛选：搜索 + 触发器类型
  const filteredWorkflows = workflows.filter((wf) => {
    const matchesTrigger = filterTrigger === 'all' || (wf.trigger?.type ?? 'manual') === filterTrigger;
    const matchesSearch =
      !searchQuery.trim() ||
      wf.name.toLowerCase().includes(searchQuery.trim().toLowerCase()) ||
      (wf.description ?? '').toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesTrigger && matchesSearch;
  });

  useEffect(() => {
    void loadWorkflows();
  }, [loadWorkflows]);

  // 导入工作流
  const handleImport = useCallback(async (file: File) => {
    const result = await readWorkflowFile(file);
    if (!result.success || !result.workflow) {
      toast.error(t('settings.workflows.importFailed') + ': ' + (result.error ?? ''));
      return;
    }
    const now = Date.now();
    const newWorkflow: Workflow = {
      ...result.workflow,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      runCount: 0,
    };
    try {
      await createWorkflow(newWorkflow);
      toast.success(t('settings.workflows.importSuccess', [newWorkflow.name]));
      void loadWorkflows();
    } catch (err) {
      toast.error(t('settings.workflows.importFailed'));
      console.error('[WorkflowImport]', err);
    }
  }, [loadWorkflows]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (confirm(t('settings.workflows.deleteConfirm', [name]))) {
        try {
          await deleteWorkflow(id);
          setWorkflows((prev) => prev.filter((w) => w.id !== id));
          toast.success(t('settings.workflows.deleteSuccess', [name]));
        } catch (error) {
          console.error('Failed to delete workflow', error);
          toast.error(t('settings.workflows.deleteFailed'));
        }
      }
    },
    [],
  );

  const handleEdit = useCallback((wf: Workflow) => {
    setEditingWorkflow(wf);
    setEditorOpen(true);
  }, []);

  const handleEditorSave = useCallback(async (
    id: string | null,
    changes: Partial<Omit<Workflow, 'id' | 'createdAt'>>,
  ) => {
    if (id === null) {
      // 创建新工作流
      const now = Date.now();
      const newWorkflow: Workflow = {
        ...changes,
        id: crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
        runCount: 0,
      } as Workflow;
      await createWorkflow(newWorkflow);
      if (newWorkflow.trigger) await refreshWorkflowTrigger(newWorkflow);
      void loadWorkflows();
      return newWorkflow.id;
    }
    await updateWorkflow(id, changes);
    // 刷新触发器缓存
    if (changes.trigger) {
      const wf = await getWorkflow(id);
      if (wf) await refreshWorkflowTrigger(wf);
    }
    void loadWorkflows();
  }, [loadWorkflows]);

  // 实际执行工作流
  const doRun = useCallback(
    async (wf: Workflow, overrideVars?: Record<string, string>) => {
      if (runningId) return;
      setRunningId(wf.id);
      setRunProgressWorkflow(wf);
      setRunProgressSteps([]);
      setRunProgressStatus('running');
      setRunProgressOpen(true);
      const toastId = toast.loading(t('settings.workflows.running', [wf.name]));
      const startedAt = Date.now();
      try {
        const result = await startWorkflowRun(wf, {
          variables: overrideVars,
          onStepStart: (step, index) => {
            setRunProgressSteps((prev) => {
              if (prev.some((s) => s.index === index)) return prev;
              return [...prev, { step, index, success: false, durationMs: 0 }];
            });
            toast.loading(
              `${t('settings.workflows.running', [wf.name])} — ${STEP_TYPE_LABELS[step.type]} (${index + 1}/${wf.steps.length})`,
              { id: toastId },
            );
          },
          onStepEnd: (_step, index, result) => {
            setRunProgressSteps((prev) =>
              prev.map((s) => (s.index === index ? result : s)),
            );
          },
        });
        const status = result.success ? 'success' : 'failure';
        setRunProgressStatus(status);
        await recordWorkflowRun(wf.id, status);
        await createWorkflowRun({
          id: crypto.randomUUID(),
          workflowId: wf.id,
          workflowName: wf.name,
          status,
          steps: result.stepResults.map((r) => ({
            step: r.step,
            index: r.index,
            success: r.success,
            output: r.output,
            error: r.error,
            durationMs: r.durationMs,
          })),
          variables: result.variables,
          startedAt,
          endedAt: Date.now(),
          error: result.error,
        });
        if (result.success) {
          toast.success(t('settings.workflows.runSuccess', [wf.name]), { id: toastId });
        } else {
          toast.error(t('settings.workflows.runFailed', [wf.name, result.error ?? '']), { id: toastId });
        }
        void loadWorkflows();
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setRunProgressStatus('failure');
        toast.error(t('settings.workflows.runFailed', [wf.name, msg]), { id: toastId });
        await recordWorkflowRun(wf.id, 'failure');
        await createWorkflowRun({
          id: crypto.randomUUID(),
          workflowId: wf.id,
          workflowName: wf.name,
          status: 'failure',
          steps: runProgressSteps,
          startedAt,
          endedAt: Date.now(),
          error: msg,
        });
        void loadWorkflows();
      } finally {
        setRunningId(null);
      }
    },
    [runningId, loadWorkflows, runProgressSteps],
  );

  // 点击运行：若有变量则先弹出输入框
  const handleRun = useCallback(
    async (wf: Workflow) => {
      const vars = wf.variables ?? {};
      if (Object.keys(vars).length > 0) {
        setVarDialogWorkflow(wf);
        setVarValues({ ...vars });
        setVarDialogOpen(true);
        return;
      }
      await doRun(wf);
    },
    [doRun],
  );

  // 变量输入确认后执行
  const handleVarConfirm = useCallback(() => {
    if (!varDialogWorkflow) return;
    setVarDialogOpen(false);
    void doRun(varDialogWorkflow, varValues);
    setVarDialogWorkflow(null);
  }, [varDialogWorkflow, varValues, doRun]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 shrink-0 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">{t('settings.workflows.title')}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t('settings.workflows.hint')}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="size-4 mr-1.5" />
              {t('settings.workflows.import')}
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={() => {
                setEditingWorkflow(null);
                setEditorOpen(true);
              }}
            >
              <Plus className="size-4 mr-1.5" />
              {t('settings.workflows.new')}
            </Button>
          </div>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="px-6 py-3 shrink-0 border-b border-border space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            id="workflow-search"
            name="workflow-search"
            aria-label={t('settings.workflows.searchPlaceholder')}
            placeholder={t('settings.workflows.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <SlidersHorizontal className="size-3 text-muted-foreground shrink-0" />
          <button
            onClick={() => setFilterTrigger('all')}
            className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors ${
              filterTrigger === 'all'
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background text-muted-foreground border-border hover:border-muted-foreground/50'
            }`}
          >
            {t('common.all')}
          </button>
          {TRIGGER_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => setFilterTrigger(type)}
              className={`text-[11px] px-2 py-0.5 rounded-full border transition-colors flex items-center gap-1 ${
                filterTrigger === type
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background text-muted-foreground border-border hover:border-muted-foreground/50'
              }`}
            >
              {triggerIcon(type)}
              {triggerLabel(type)}
            </button>
          ))}
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            {t('common.loading')}
          </div>
        ) : filteredWorkflows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <WorkflowIcon className="size-10 text-muted-foreground/40 mb-3" />
            <p className="text-sm text-muted-foreground font-medium">
              {searchQuery.trim() || filterTrigger !== 'all'
                ? t('common.noMatch')
                : t('settings.workflows.empty.title')}
            </p>
            {!searchQuery.trim() && filterTrigger === 'all' && (
              <>
                <p className="text-xs text-muted-foreground/70 mt-1">
                  {t('settings.workflows.empty.hint')}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    void handleRestorePresets();
                  }}
                >
                  <Plus className="size-4 mr-1.5" />
                  {t('settings.workflows.restorePresets')}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredWorkflows.map((wf) => (
              <WorkflowListItem
                key={wf.id}
                workflow={wf}
                runningId={runningId}
                onRun={handleRun}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onViewHistory={(w) => {
                  setHistoryWorkflow(w);
                  setHistoryOpen(true);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* 隐藏的文件输入，用于导入工作流 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.ceb"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleImport(file);
          e.target.value = '';
        }}
      />

      <WorkflowEditor
        workflow={editingWorkflow}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        onSave={handleEditorSave}
      />

      {historyWorkflow && (
        <WorkflowHistory
          workflow={historyWorkflow}
          open={historyOpen}
          onOpenChange={(open) => {
            setHistoryOpen(open);
            if (!open) setHistoryWorkflow(null);
          }}
        />
      )}

      {/* 变量输入对话框 */}
      <Dialog open={varDialogOpen} onOpenChange={setVarDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-medium">
              {t('settings.workflows.runVariables', [varDialogWorkflow?.name ?? ''])}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {Object.entries(varValues).map(([key, value]) => (
              <div key={key} className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">{key}</label>
                <Input
                  value={value}
                  onChange={(e) => setVarValues((prev) => ({ ...prev, [key]: e.target.value }))}
                  placeholder={key}
                  className="h-8 text-xs"
                />
              </div>
            ))}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={() => setVarDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={handleVarConfirm}>
              {t('settings.workflows.run')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 执行进度面板 */}
      <Dialog open={runProgressOpen} onOpenChange={setRunProgressOpen}>
        <DialogContent className="max-w-lg max-h-[80vh] flex flex-col gap-0 p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b">
            <DialogTitle className="text-base font-semibold flex items-center gap-2">
              {runProgressStatus === 'running' && <Clock className="size-4 text-amber-500 animate-spin" />}
              {runProgressStatus === 'success' && <CheckCircle2 className="size-4 text-emerald-500" />}
              {runProgressStatus === 'failure' && <XCircle className="size-4 text-destructive" />}
              {t('settings.workflows.running', [runProgressWorkflow?.name ?? ''])}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-auto px-6 py-4 space-y-2">
            {runProgressSteps.map((s) => (
              <div
                key={s.index}
                className={`flex items-start gap-2 text-xs rounded-md border px-2.5 py-2 ${
                  s.success
                    ? 'bg-emerald-500/5 border-emerald-500/10'
                    : s.durationMs > 0
                      ? 'bg-destructive/5 border-destructive/10'
                      : 'bg-muted/30 border-border'
                }`}
              >
                <span className="text-muted-foreground w-4 text-right shrink-0">{s.index + 1}</span>
                <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono shrink-0">
                  {STEP_TYPE_LABELS[s.step.type]}
                </Badge>
                {s.success ? (
                  <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
                ) : s.durationMs > 0 ? (
                  <XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
                ) : (
                  <Clock className="size-3.5 text-muted-foreground shrink-0 mt-0.5 animate-spin" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="truncate">{s.output || s.error || t('common.loading')}</div>
                </div>
                {s.durationMs > 0 && (
                  <span className="text-muted-foreground shrink-0">{s.durationMs}ms</span>
                )}
              </div>
            ))}
            {runProgressSteps.length === 0 && (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                {t('common.loading')}
              </div>
            )}
          </div>
          <DialogFooter className="px-6 py-4 border-t gap-2">
            <Button variant="outline" size="sm" onClick={() => setRunProgressOpen(false)}>
              {t('common.cancel')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── 子组件：工作流列表项（memo 化减少重渲染）───

interface WorkflowListItemProps {
  workflow: Workflow;
  runningId: string | null;
  onRun: (wf: Workflow) => void;
  onEdit: (wf: Workflow) => void;
  onDelete: (id: string, name: string) => void;
  onViewHistory: (wf: Workflow) => void;
}

const WorkflowListItem = memo(function WorkflowListItem({
  workflow: wf,
  runningId,
  onRun,
  onEdit,
  onDelete,
  onViewHistory,
}: WorkflowListItemProps) {
  return (
    <div className="group flex items-center gap-3 px-3 py-3 rounded-lg border border-border bg-card hover:bg-accent/40 transition-colors">
      <GripVertical className="size-4 text-muted-foreground/30 shrink-0 cursor-grab" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">
            {wf.name}
          </span>
          <Badge
            variant={triggerBadgeVariant(wf.trigger?.type ?? 'manual')}
            className="text-[10px] h-5 px-1.5 gap-1 font-normal shrink-0"
          >
            {triggerIcon(wf.trigger?.type ?? 'manual')}
            {triggerLabel(wf.trigger?.type ?? 'manual')}
          </Badge>
          {wf.lastRunStatus && (
            <Badge
              variant="outline"
              className="text-[10px] h-5 px-1.5 gap-1 font-normal"
            >
              {statusIcon(wf.lastRunStatus)}
              {statusLabel(wf.lastRunStatus)}
            </Badge>
          )}
        </div>
        {wf.description && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {wf.description}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground/70">
          <span>
            {t('settings.workflows.stepCount', wf.steps.length)}
          </span>
          {wf.runCount > 0 && (
            <button
              className="hover:text-foreground hover:underline underline-offset-2 cursor-pointer"
              onClick={() => onViewHistory(wf)}
            >
              {t('settings.workflows.runCount', wf.runCount)}
            </button>
          )}
          {wf.lastRunAt && (
            <button
              className="flex items-center gap-1 hover:text-foreground hover:underline underline-offset-2 cursor-pointer"
              onClick={() => onViewHistory(wf)}
            >
              <Clock className="size-3" />
              {formatRelativeTime(wf.lastRunAt)}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('settings.workflows.run')}
          disabled={runningId === wf.id}
          onClick={() => onRun(wf)}
        >
          <Play className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('common.edit')}
          onClick={() => onEdit(wf)}
        >
          <Pencil className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('settings.workflows.export')}
          onClick={() => downloadWorkflowJson(wf)}
        >
          <Download className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          title={t('settings.workflows.exportCeb')}
          onClick={() => downloadWorkflowCeb(wf)}
        >
          <span className="text-[10px] font-bold leading-none">CEB</span>
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          title={t('common.delete')}
          onClick={() => onDelete(wf.id, wf.name)}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
});

/** 将时间戳格式化为相对时间 */
function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return t('common.time.justNow');
  if (minutes < 60) return t('common.time.minutesAgo', [minutes]);
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return t('common.time.hoursAgo', [hours]);
  const days = Math.floor(hours / 24);
  if (days < 30) return t('common.time.daysAgo', [days]);
  const months = Math.floor(days / 30);
  if (months < 12) return t('common.time.monthsAgo', [months]);
  const years = Math.floor(months / 12);
  return t('common.time.yearsAgo', [years]);
}
