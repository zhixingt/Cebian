import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { WebProviderPreset } from '@/lib/ai-config/web-provider-presets';
import type { WebProvider } from '@/lib/types';

export interface WebProviderCardProps {
  provider: WebProvider;
  preset: WebProviderPreset;
  isChecking: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onModelIdChange: (modelId: string) => void;
  onCapabilityChange: (
    capability: 'supportsToolCalls' | 'supportsReasoning',
    value: boolean,
  ) => void;
  onRecheck: () => void;
}

export function WebProviderCard({
  provider,
  preset,
  isChecking,
  onEnabledChange,
  onModelIdChange,
  onCapabilityChange,
  onRecheck,
}: WebProviderCardProps) {
  return (
    <div
      data-testid={`web-provider-card-${provider.presetId}`}
      className="rounded-lg border p-4 space-y-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {provider.loginStatus === 'loggedIn' && (
            <Badge variant="default" data-testid="status-logged-in">
              Logged in
            </Badge>
          )}
          {provider.loginStatus === 'loggedOut' && (
            <Badge variant="destructive" data-testid="status-logged-out">
              Not logged in
            </Badge>
          )}
          {provider.loginStatus === 'unknown' && (
            <Badge variant="secondary" data-testid="status-unknown">
              Never checked
            </Badge>
          )}
          <span className="font-semibold">
            {preset.id.toUpperCase()} — {preset.loginUrl}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span>Enabled</span>
          <Switch
            checked={provider.enabled}
            onCheckedChange={onEnabledChange}
            aria-label={`Enable ${preset.id}`}
          />
          <Button variant="link" asChild>
            <a href={preset.loginUrl} target="_blank" rel="noreferrer">
              Open
            </a>
          </Button>
        </div>
      </div>

      <div>
        <label htmlFor={`model-${provider.presetId}`} className="text-sm">
          Model ID
        </label>
        <Input
          id={`model-${provider.presetId}`}
          value={provider.modelId}
          onChange={(e) => onModelIdChange(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-6">
        <span className="text-sm">Capabilities:</span>
        <label className="flex items-center gap-2">
          <Switch
            checked={provider.supportsToolCalls}
            onCheckedChange={(v) => onCapabilityChange('supportsToolCalls', v)}
            aria-label="Tool calls"
          />
          <span>Tool calls</span>
        </label>
        <label className="flex items-center gap-2">
          <Switch
            checked={provider.supportsReasoning}
            onCheckedChange={(v) => onCapabilityChange('supportsReasoning', v)}
            aria-label="Reasoning"
          />
          <span>Reasoning</span>
        </label>
      </div>

      <Button
        variant="outline"
        onClick={onRecheck}
        disabled={isChecking}
      >
        {isChecking ? 'Checking…' : 'Re-check login status'}
      </Button>
    </div>
  );
}
