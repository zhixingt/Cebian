import { useStorageItem } from '@/hooks/useStorageItem';
import {
  mcpServers,
  hermesEnabled,
  hermesMode,
  hermesAuditLog,
  type HermesAuditEntry,
  type HermesMode,
} from '@/lib/storage';
import { MCPServerCard } from '@/components/settings/mcp/MCPServerCard';
import { MCPServerAddForm } from '@/components/settings/mcp/MCPServerForm';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { addMCPServer } from '@/lib/mcp/store';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';

/**
 * MCPSection — manage MCP server configurations and Hermes integration.
 *
 * v1: list / add / edit / enable / disable / delete servers.
 * v2: Hermes integration — authorization toggle, access mode, audit log.
 * Connection lifecycle is handled by the background `MCPManager`; this
 * section only edits storage and reads status.
 */
export function MCPSection() {
  const [servers] = useStorageItem(mcpServers, []);
  const [enabled, setEnabled] = useStorageItem(hermesEnabled, false);
  const [mode, setMode] = useStorageItem(hermesMode, 'readonly' as HermesMode);
  const [auditLog, setAuditLog] = useStorageItem<HermesAuditEntry[]>(hermesAuditLog, []);

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('settings.mcp.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('settings.mcp.description')}</p>
      </div>

      {servers.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">{t('settings.mcp.empty.title')}</p>
          <p className="text-xs text-muted-foreground mt-1">{t('settings.mcp.empty.hint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((s) => (
            <MCPServerCard key={s.id} server={s} />
          ))}
        </div>
      )}

      <div className="space-y-2">
        <MCPServerAddForm />
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={async () => {
            try {
              await addMCPServer({
                name: 'Hermes',
                transport: { type: 'streamable-http', url: 'http://127.0.0.1:3000/mcp' },
                auth: { type: 'none' },
              });
              toast.success(t('settings.mcp.hermesAdded'));
            } catch (err) {
              toast.error(err instanceof Error ? err.message : String(err));
            }
          }}
        >
          {t('settings.mcp.addHermes')}
        </Button>
      </div>

      {/* ─── Hermes Integration (Native Messaging) ─── */}
      <div className="space-y-3 pt-4 border-t border-border">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{t('settings.mcp.hermes.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('settings.mcp.hermes.description')}</p>
        </div>

        {/* Authorization toggle */}
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div className="space-y-0.5 pr-3">
            <Label htmlFor="hermes-enabled" className="text-sm">
              {t('settings.mcp.hermes.enable')}
            </Label>
            <p className="text-xs text-muted-foreground">{t('settings.mcp.hermes.enableHint')}</p>
          </div>
          <Switch
            id="hermes-enabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        {/* Access mode */}
        <div className={`space-y-2 rounded-lg border border-border p-3 transition-opacity ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <Label className="text-sm">{t('settings.mcp.hermes.mode')}</Label>
          <div className="flex gap-2">
            <Button
              variant={mode === 'readonly' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setMode('readonly')}
            >
              {t('settings.mcp.hermes.modeReadonly')}
            </Button>
            <Button
              variant={mode === 'readwrite' ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => setMode('readwrite')}
            >
              {t('settings.mcp.hermes.modeReadwrite')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.mcp.hermes.modeHint')}</p>
        </div>

        {/* Audit log */}
        <div className={`space-y-2 rounded-lg border border-border p-3 transition-opacity ${!enabled ? 'opacity-50 pointer-events-none' : ''}`}>
          <div className="flex items-center justify-between">
            <Label className="text-sm">{t('settings.mcp.hermes.auditLog')}</Label>
            {auditLog.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setAuditLog([]);
                  toast.success(t('settings.mcp.hermes.auditCleared'));
                }}
              >
                {t('settings.mcp.hermes.auditClear')}
              </Button>
            )}
          </div>
          {auditLog.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">
              {t('settings.mcp.hermes.auditEmpty')}
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {auditLog.slice().reverse().map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-2 rounded border border-border/50 px-2 py-1.5 text-xs"
                >
                  <Badge variant={entry.success ? 'default' : 'destructive'} className="shrink-0">
                    {entry.success ? t('settings.mcp.hermes.auditSuccess') : t('settings.mcp.hermes.auditFailure')}
                  </Badge>
                  <code className="font-mono text-xs shrink-0">{entry.tool}</code>
                  <span className="text-muted-foreground ml-auto shrink-0">
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </span>
                  {entry.error && (
                    <span className="text-destructive truncate" title={entry.error}>
                      {entry.error}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
