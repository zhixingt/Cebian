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

export function AboutSection() {
  // Read the manifest version directly so we don't have to call
  // `useUpdateCheck` (which would trigger a network call we don't want).
  const currentVersion =
    typeof chrome !== 'undefined' && chrome?.runtime?.getManifest
      ? chrome.runtime.getManifest().version
      : '';

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <h2 className="text-base font-semibold">{t('settings.about.title')}</h2>

      <div className="space-y-1">
        <p className="text-sm font-medium">CebianX v{currentVersion}</p>
        <p className="text-xs text-muted-foreground">{t('settings.about.tagline')}</p>
        <div className="flex gap-2 pt-2 text-xs text-muted-foreground">
          <a
            href="https://github.com/maotoumao/Cebian"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            GitHub
          </a>
          <span>·</span>
          <a
            href="https://github.com/maotoumao/Cebian/blob/HEAD/LICENSE"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            AGPL-3.0
          </a>
          <span>·</span>
          <a
            href="https://github.com/maotoumao/Cebian/issues"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground transition-colors"
          >
            {t('settings.about.feedback')}
          </a>
        </div>
      </div>

      <UpdateCheckSection />

      <ProjectSourceSection />
    </div>
  );
}

/**
 * Renders a section header (title + horizontal divider) followed by
 * a card-styled body. Used by the "项目说明" section so it has the same
 * visual shape as the "检查更新" section.
 */
function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}

function UpdateCheckSection() {
  // Disabled by design — the action is not exposed. The button is kept as
  // a visual affordance so users can see the feature exists.
  return (
    <div className="space-y-3">
      <SectionHeader title={t('settings.about.checkUpdate')} />
      <div className="flex items-center gap-3 rounded-md border border-border bg-card/50 px-4 py-3">
        <Button
          variant="outline"
          size="sm"
          disabled
          aria-disabled="true"
          title={t('settings.about.checkUpdate')}
        >
          {t('settings.about.checkUpdate')}
        </Button>
      </div>
    </div>
  );
}

function ProjectSourceSection() {
  return (
    <div className="space-y-3">
      <SectionHeader title="项目说明" />
      <div className="rounded-md border border-border bg-card/50 px-4 py-3 text-xs text-muted-foreground space-y-2.5">
        <p>
          Forked from:{' '}
          <a
            href="https://github.com/maotoumao/Cebian"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            maotoumao/Cebian
          </a>
        </p>
        <p>关注作者：微信公众号（一只猫头猫）</p>
        <p>
          Maintainer: 肖泽林 (
          <a
            href="https://github.com/zhixingt"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-foreground"
          >
            @zhixingt
          </a>
          )
        </p>
        <p>License: AGPL-3.0 (Inherited from upstream)</p>
      </div>
    </div>
  );
}

