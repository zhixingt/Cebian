import { useCallback, useEffect, useMemo, useRef, useState, memo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, AlertCircle, Clock, ChevronRight, Trash2, Copy, Download, Loader2 } from 'lucide-react';
import { listWorkflowRuns, getWorkflowRun, deleteWorkflowRun, clearWorkflowRuns } from '@/lib/workflow/repository';
import type { Workflow, WorkflowRunRecord, WorkflowRunStepRecord } from '@/lib/workflow/types';
import { STEP_TYPE_LABELS } from '@/lib/workflow/types';
import { t } from '@/lib/i18n';

const PAGE_SIZE = 30;

interface WorkflowHistoryProps {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface RunSummaryItemProps {
  run: WorkflowRunRecord;
  isSelected: boolean;
  onView: (id: string) => void;
  onDelete: (id: string) => void;
}

const RunSummaryItem = memo(function RunSummaryItem({ run, isSelected, onView, onDelete }: RunSummaryItemProps) {
  return (
    <div key={run.id} className="border rounded-lg bg-card">
      <div
        className="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent/30 transition-colors"
        onClick={() => onView(run.id)}
      >
        <RunStatusIcon status={run.status} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">
              {t(`settings.workflows.status.${run.status}`)}
            </span>
            <span className="text-[11px] text-muted-foreground">
              {run.steps.length} {t('settings.workflows.history.steps')}
            </span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {new Date(run.startedAt).toLocaleString()}
            {' · '}
            {formatDuration(run.endedAt - run.startedAt)}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(run.id);
            }}
          >
            <Trash2 className="size-3.5" />
          </Button>
          <ChevronRight
            className={`size-4 text-muted-foreground transition-transform ${isSelected ? 'rotate-90' : ''}`}
          />
        </div>
      </div>

      {isSelected && <RunDetail run={run} />}
    </div>
  );
});

function RunDetail({ run }: { run: WorkflowRunRecord }) {
  return (
    <div className="border-t px-3 py-2.5 space-y-1.5 bg-muted/30">
      {run.steps.map((step) => (
        <StepRecordRow key={step.index} record={step} />
      ))}
      {run.error && (
        <div className="text-xs text-destructive mt-2 px-1">
          {run.error}
        </div>
      )}
      {run.variables && Object.keys(run.variables).length > 0 && (
        <VariablePanel variables={run.variables} />
      )}
    </div>
  );
}

export function WorkflowHistory({ workflow, open, onOpenChange }: WorkflowHistoryProps) {
  const [runs, setRuns] = useState<WorkflowRunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<WorkflowRunRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setSelectedRun(null);
    setDisplayCount(PAGE_SIZE);
    try {
      const data = await listWorkflowRuns(workflow.id);
      setRuns(data.reverse());
    } catch (err) {
      console.error('Failed to load workflow runs', err);
    } finally {
      setLoading(false);
    }
  }, [workflow.id]);

  useEffect(() => {
    if (open) {
      void loadRuns();
    }
  }, [open, loadRuns]);

  const visibleRuns = useMemo(() => runs.slice(0, displayCount), [runs, displayCount]);
  const hasMore = visibleRuns.length < runs.length;

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!open || !hasMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setDisplayCount((prev) => prev + PAGE_SIZE);
        }
      },
      { root: null, rootMargin: '100px', threshold: 0 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, hasMore, visibleRuns.length]);

  const handleViewRun = useCallback(async (id: string) => {
    if (selectedRun?.id === id) {
      setSelectedRun(null);
      return;
    }
    try {
      const run = await getWorkflowRun(id);
      setSelectedRun(run || null);
    } catch (err) {
      console.error('Failed to load run details', err);
    }
  }, [selectedRun]);

  const handleDeleteRun = useCallback(async (id: string) => {
    try {
      await deleteWorkflowRun(id);
      setRuns((prev) => prev.filter((r) => r.id !== id));
      if (selectedRun?.id === id) setSelectedRun(null);
    } catch (err) {
      console.error('Failed to delete run', err);
    }
  }, [selectedRun]);

  const handleClear = useCallback(async () => {
    if (!confirm(t('settings.workflows.history.clearConfirm', [workflow.name]))) return;
    try {
      await clearWorkflowRuns(workflow.id);
      setRuns([]);
      setSelectedRun(null);
    } catch (err) {
      console.error('Failed to clear runs', err);
    }
  }, [workflow.id, workflow.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-base font-semibold">
            {t('settings.workflows.history.title', [workflow.name])}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Clock className="size-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground font-medium">
                {t('settings.workflows.history.empty')}
              </p>
            </div>
          ) : (
            <ScrollArea className="flex-1 px-6 py-4">
              <div className="space-y-2">
                {visibleRuns.map((run) => (
                  <RunSummaryItem
                    key={run.id}
                    run={run}
                    isSelected={selectedRun?.id === run.id}
                    onView={handleViewRun}
                    onDelete={handleDeleteRun}
                  />
                ))}

                {/* Sentinel for infinite scroll */}
                {hasMore && (
                  <div ref={sentinelRef} className="flex items-center justify-center py-3 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t gap-2">
          {runs.length > 0 && (
            <Button variant="outline" size="sm" onClick={handleClear}>
              {t('settings.workflows.history.clearAll')}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RunStatusIcon({ status }: { status: WorkflowRunRecord['status'] }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="size-4 text-emerald-500 shrink-0" />;
    case 'failure':
      return <XCircle className="size-4 text-destructive shrink-0" />;
    case 'cancelled':
      return <AlertCircle className="size-4 text-amber-500 shrink-0" />;
  }
}

function StepRecordRow({ record }: { record: WorkflowRunStepRecord }) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-muted-foreground w-4 text-right shrink-0">{record.index + 1}</span>
      <Badge variant="outline" className="text-[10px] h-4 px-1 font-mono shrink-0">
        {STEP_TYPE_LABELS[record.step.type]}
      </Badge>
      {record.success ? (
        <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="size-3.5 text-destructive shrink-0 mt-0.5" />
      )}
      <div className="flex-1 min-w-0">
        <div className="truncate">{record.output || record.error || '-'}</div>
      </div>
      <span className="text-muted-foreground shrink-0">{record.durationMs}ms</span>
    </div>
  );
}

function VariablePanel({ variables }: { variables: Record<string, string> }) {
  const handleCopy = useCallback(async () => {
    const text = Object.entries(variables)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');
    await navigator.clipboard.writeText(text);
    toast.success(t('settings.workflows.history.copied'));
  }, [variables]);

  const handleDownload = useCallback(() => {
    const json = JSON.stringify(variables, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `workflow-variables-${Date.now()}.json`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [variables]);

  return (
    <div className="mt-2 pt-2 border-t border-dashed border-border/60">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          {t('settings.workflows.history.variables')}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-xs" className="h-6 w-6" onClick={handleCopy} title={t('settings.workflows.history.copyVariables')}>
            <Copy className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-xs" className="h-6 w-6" onClick={handleDownload} title={t('settings.workflows.history.downloadVariables')}>
            <Download className="size-3" />
          </Button>
        </div>
      </div>
      <div className="space-y-0.5">
        {Object.entries(variables).map(([key, value]) => (
          <div key={key} className="flex items-start gap-2 text-[11px]">
            <span className="font-mono text-muted-foreground shrink-0 min-w-[60px] text-right">{key}</span>
            <span className="text-foreground break-all">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
