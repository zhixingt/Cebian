import { Sun, Moon, Monitor, Settings, SquarePen, History, PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { t } from '@/lib/i18n';

interface HeaderProps {
  title?: string;
  theme: 'dark' | 'light' | 'system';
  onToggleTheme: () => void;
  onOpenSettings: () => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
}

export function Header({ title, theme, onToggleTheme, onOpenSettings, onNewChat, onOpenHistory }: HeaderProps) {
  const handleCollapse = () => {
    chrome.runtime.sendMessage({ type: 'collapse-sidebar' }).catch(() => {});
    setTimeout(() => window.close(), 100);
  };

  return (
    <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-xl z-10 shrink-0">
      {/* 左侧：导航类 */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onNewChat}>
              <SquarePen className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.newChat')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onOpenHistory}>
              <History className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.history')}</TooltipContent>
        </Tooltip>
      </div>

      <span className="flex-1 text-center text-sm font-medium truncate px-2">
        {title}
      </span>

      {/* 右侧：操作类，折叠按钮用分隔线隔开 */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onToggleTheme}>
              {theme === 'system' ? <Monitor className="size-4" /> : theme === 'dark' ? <Moon className="size-4" /> : <Sun className="size-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.toggleTheme')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon-xs" onClick={onOpenSettings}>
              <Settings className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('common.settings')}</TooltipContent>
        </Tooltip>

        {/* 分隔线：区分功能操作和面板控制 */}
        <div className="w-px h-4 bg-border/60 mx-0.5" />

        {/* 折叠按钮：微妙的视觉区分 */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleCollapse}
              className="text-muted-foreground/60 hover:text-foreground hover:bg-muted/60"
            >
              <PanelRightClose className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('common.sidebarCollapse')}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
