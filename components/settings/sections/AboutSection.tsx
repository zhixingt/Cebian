/**
 * AboutSection — version, project links, and project description.
 *
 * The "检查更新" feature is intentionally disabled at the surface level:
 * we keep the button (greyed out) so users see the affordance exists, but
 * we do NOT call `useUpdateCheck` from this component. That hook fetches
 * the GitHub releases atom feed; if we called it, the user would see
 * "检查中…" → "检查更新失败" on every About-page mount, which is misleading
 * because the action is not actually exposed.
 */
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import { ExternalLink, Globe, FileText, MessageCircle } from 'lucide-react';

export function AboutSection() {
  // Read the manifest version directly so we don't have to call
  // `useUpdateCheck` (which would trigger a network call we don't want).
  const currentVersion =
    typeof chrome !== 'undefined' && chrome?.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-5">
      <h2 className="text-base font-semibold">{t('settings.about.title')}</h2>

      {/* Version + tagline */}
      <div className="rounded-lg border border-border bg-card/50 p-4 space-y-1">
        <p className="text-sm font-semibold">CebianX v{currentVersion}</p>
        <p className="text-xs text-muted-foreground">{t('settings.about.tagline')}</p>
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <a
          href="https://github.com/maotoumao/Cebian"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <Globe size={13} />
          GitHub
        </a>
        <a
          href="https://github.com/maotoumao/Cebian/issues"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <MessageCircle size={13} />
          {t('settings.about.feedback')}
        </a>
        <a
          href="https://github.com/maotoumao/Cebian/blob/HEAD/LICENSE"
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <FileText size={13} />
          AGPL-3.0
        </a>
      </div>

      <UpdateCheckSection />

      <ProjectSourceSection />
    </div>
  );
}

function UpdateCheckSection() {
  // Disabled by design — the action is not exposed. The section is kept as
  // a visual affordance so users can see the feature exists.
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium">{t('settings.about.checkUpdate')}</p>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-dashed border-border/60 bg-muted/30 px-4 py-3">
        <span className="text-xs text-muted-foreground">{t('settings.about.upToDate')}</span>
        <Button variant="ghost" size="sm" disabled className="h-7 text-xs opacity-50 cursor-not-allowed">
          {t('settings.about.checkUpdate')}
        </Button>
      </div>
    </div>
  );
}

function ProjectSourceSection() {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3">
        <p className="text-sm font-medium">{t('settings.about.projectDesc')}</p>
        <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
      </div>
      <div className="rounded-lg border border-border bg-card/50 px-4 py-3 text-xs text-muted-foreground space-y-2">
        <p>
          Forked from:{' '}
          <a
            href="https://github.com/maotoumao/Cebian"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            maotoumao/Cebian <ExternalLink size={10} className="opacity-60" />
          </a>
        </p>
        <p>{t('settings.about.followAuthor')}</p>
        <p>
          Maintainer: 肖泽林 (
          <a
            href="https://github.com/zhixingt"
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-0.5 underline underline-offset-2 hover:text-foreground transition-colors"
          >
            @zhixingt <ExternalLink size={10} className="opacity-60" />
          </a>
          )
        </p>
        <p>License: AGPL-3.0 (Inherited from upstream)</p>
      </div>
    </div>
  );
}
