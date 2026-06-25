/**
 * API Discovery 设置分区 — 控制流量捕获、查看自动发现的 API Skill。
 */

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { t } from '@/lib/i18n';
import { apiDiscoveryEnabled } from '@/lib/storage';
import { useStorageItem } from '@/hooks/useStorageItem';
import { API_DISCOVERY_MSG } from '@/lib/capture/types';
import type {
  ApiDiscoveryControlMessage,
  ApiDiscoveryStatusMessage,
  CaptureSessionState,
  AutoSkillDefinition,
} from '@/lib/capture/types';

/** 发送 API Discovery 控制消息 */
function sendApiDiscoveryMessage(payload: ApiDiscoveryControlMessage): Promise<unknown> {
  return chrome.runtime.sendMessage({ type: API_DISCOVERY_MSG, payload });
}

export function ApiDiscoverySection() {
  const [enabled, setEnabled] = useStorageItem(apiDiscoveryEnabled, false);
  const [captureState, setCaptureState] = useState<CaptureSessionState | null>(null);
  const [skills, setSkills] = useState<AutoSkillDefinition[]>([]);
  const [loading, setLoading] = useState(false);

  // 监听状态消息
  useEffect(() => {
    const listener = (msg: { type: typeof API_DISCOVERY_MSG; status?: ApiDiscoveryStatusMessage }) => {
      if (msg.type === API_DISCOVERY_MSG && msg.status) {
        switch (msg.status.type) {
          case 'capture_status':
            setCaptureState(msg.status.state);
            break;
          case 'skills_list':
            setSkills(msg.status.skills);
            break;
          case 'error':
            toast.error(msg.status.message);
            break;
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);

  // 加载 Skill 列表
  const refreshSkills = useCallback(async () => {
    const result = await sendApiDiscoveryMessage({ type: 'list_auto_skills' }) as { skills?: AutoSkillDefinition[] };
    if (result?.skills) {
      setSkills(result.skills);
    }
  }, []);

  useEffect(() => {
    if (enabled) {
      void refreshSkills();
    }
  }, [enabled, refreshSkills]);

  // 开始捕获
  const handleStartCapture = async () => {
    setLoading(true);
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        toast.error(t('settings.apiDiscovery.noActiveTab'));
        return;
      }

      // debugger 是 optional_permissions，必须在用户手势触发的前台上下文中请求权限，
      // 否则 background 中的 chrome.permissions.request() 无法弹出授权弹窗。
      if (!(await chrome.permissions.contains({ permissions: ['debugger'] }))) {
        const granted = await chrome.permissions.request({ permissions: ['debugger'] });
        if (!granted) {
          toast.error(t('settings.apiDiscovery.permissionDenied'));
          return;
        }
      }

      const result = await sendApiDiscoveryMessage({ type: 'start_capture', tabId: tab.id }) as { ok: boolean; error?: string };
      if (!result.ok) {
        toast.error(result.error ?? t('settings.apiDiscovery.startFailed'));
      } else {
        toast.success(t('settings.apiDiscovery.captureStarted'));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 停止捕获并分析
  const handleStopAndAnalyze = async () => {
    setLoading(true);
    try {
      await sendApiDiscoveryMessage({ type: 'stop_capture' });
      const result = await sendApiDiscoveryMessage({ type: 'analyze_capture' }) as {
        ok: boolean;
        endpointsFound?: number;
        skillsGenerated?: number;
        error?: string;
      };
      if (result.ok) {
        toast.success(
          `Found ${result.endpointsFound ?? 0} endpoints, generated ${result.skillsGenerated ?? 0} skills`,
        );
        await refreshSkills();
      } else {
        toast.error(result.error ?? 'Analysis failed');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // 切换 Skill 启用状态
  const toggleSkill = async (skillName: string, currentEnabled: boolean) => {
    const action = currentEnabled ? 'disable_skill' : 'enable_skill';
    await sendApiDiscoveryMessage({ type: action, skillName });
    await refreshSkills();
  };

  // 删除 Skill
  const handleDeleteSkill = async (skillName: string) => {
    await sendApiDiscoveryMessage({ type: 'delete_skill', skillName });
    await refreshSkills();
    toast.success('Skill deleted');
  };

  // 将 auto-skill 转换为普通 skill
  const handleConvertSkill = async (skillName: string) => {
    const result = await sendApiDiscoveryMessage({ type: 'convert_skill', skillName }) as {
      ok: boolean;
      regularSkillName?: string;
      error?: string;
    };
    if (result.ok) {
      toast.success(t('settings.apiDiscovery.convertSuccess', [result.regularSkillName ?? skillName]));
      await refreshSkills();
    } else {
      toast.error(result.error ?? t('settings.apiDiscovery.convertFailed'));
    }
  };

  const isCapturing = captureState?.status === 'capturing' || captureState?.status === 'attaching';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="space-y-1">
        <h2 className="text-base font-semibold">{t('settings.apiDiscovery.title')}</h2>
        <p className="text-xs text-muted-foreground">{t('settings.apiDiscovery.description')}</p>
      </div>

      {/* 启用开关 */}
      <div className="flex items-center justify-between rounded-lg border border-border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="api-discovery-enabled" className="text-sm font-medium">{t('settings.apiDiscovery.enable')}</Label>
          <p className="text-xs text-muted-foreground">{t('settings.apiDiscovery.enableHint')}</p>
        </div>
        <Switch id="api-discovery-enabled" checked={enabled} onCheckedChange={setEnabled} />
      </div>

      {enabled && (
        <>
          {/* 捕获控制 */}
          <div className="space-y-3">
            <h3 className="text-sm font-medium">{t('settings.apiDiscovery.capture')}</h3>
            <div className="flex gap-2">
              {!isCapturing ? (
                <Button onClick={handleStartCapture} disabled={loading} size="sm">
                  {t('settings.apiDiscovery.startCapture')}
                </Button>
              ) : (
                <Button onClick={handleStopAndAnalyze} disabled={loading} size="sm" variant="destructive">
                  {t('settings.apiDiscovery.stopAndAnalyze')}
                </Button>
              )}
            </div>

            {/* 捕获状态 */}
            {captureState && (
              <div className="rounded-lg border border-border p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <span className="font-mono">{captureState.status}</span>
                </div>
                {captureState.hostname && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Host</span>
                    <span className="font-mono">{captureState.hostname}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requests</span>
                  <span className="font-mono">{captureState.requestCount}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">API Candidates</span>
                  <span className="font-mono">{captureState.apiCandidateCount}</span>
                </div>
              </div>
            )}
          </div>

          {/* Skill 列表 */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">{t('settings.apiDiscovery.skills')}</h3>
              <Button onClick={refreshSkills} variant="ghost" size="sm">
                {t('settings.apiDiscovery.refresh')}
              </Button>
            </div>

            {skills.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-6 text-center">
                <p className="text-sm text-muted-foreground">{t('settings.apiDiscovery.noSkills')}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {skills.map((skill) => (
                  <div
                    key={skill.name}
                    className="rounded-lg border border-border p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <p className="text-sm font-mono truncate">{skill.method} {skill.pathname}</p>
                        <p className="text-xs text-muted-foreground truncate">{skill.hostname}</p>
                      </div>
                      <Switch
                        checked={skill.enabled}
                        onCheckedChange={() => toggleSkill(skill.name, skill.enabled)}
                      />
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span>Confidence: {(skill.initialConfidence * 100).toFixed(0)}%</span>
                      <span>Samples: {skill.stats.callCount}</span>
                      <Button
                        onClick={() => handleConvertSkill(skill.name)}
                        variant="ghost"
                        size="sm"
                        className="h-5 px-2 text-xs"
                      >
                        {t('settings.apiDiscovery.convert')}
                      </Button>
                      <Button
                        onClick={() => handleDeleteSkill(skill.name)}
                        variant="ghost"
                        size="sm"
                        className="h-5 px-2 text-xs"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
