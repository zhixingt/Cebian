import { PanelRightOpen, SquarePen, History, Settings, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSidebar } from './SidebarContext';
import { useStorageItem } from '@/hooks/useStorageItem';
import { activeModel } from '@/lib/storage';
import { t } from '@/lib/i18n';

interface CollapsedBarProps {
  onNewChat: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  isAgentRunning?: boolean;
  unreadCount?: number;
}

export function CollapsedBar({ onNewChat, onOpenHistory, onOpenSettings, isAgentRunning = false, unreadCount = 0 }: CollapsedBarProps) {
  const { setCollapsed } = useSidebar();
  const [currentModel] = useStorageItem(activeModel, null);

  const handleExpand = () => setCollapsed(false);
  const handleNewChat = () => { setCollapsed(false); onNewChat(); };
  const handleHistory = () => { setCollapsed(false); onOpenHistory(); };
  const handleSettings = () => { setCollapsed(false); onOpenSettings(); };

  return (
    <div className="flex flex-col items-center w-12 h-full border-r border-border bg-background py-3 gap-1">
      {/* 展开按钮 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleExpand} className="mb-2">
            <PanelRightOpen className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.expandSidebar')}</TooltipContent>
      </Tooltip>

      {/* 当前会话状态 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="relative mb-2">
            <Button variant="ghost" size="icon-xs" onClick={handleExpand}>
              <Bot className={`size-4.5 ${isAgentRunning ? 'text-primary animate-pulse' : currentModel ? 'text-foreground' : 'text-muted-foreground'}`} />
            </Button>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 size-3.5 rounded-full bg-destructive text-[8px] text-destructive-foreground grid place-items-center leading-none font-bold">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="right">
          {isAgentRunning ? t('common.session.running') : t('common.currentSession')}
        </TooltipContent>
      </Tooltip>

      <div className="w-6 border-t border-border my-1" />

      {/* 快捷操作 */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleNewChat}>
            <SquarePen className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.newChat')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleHistory}>
            <History className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.history')}</TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-xs" onClick={handleSettings}>
            <Settings className="size-4.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="right">{t('common.settings')}</TooltipContent>
      </Tooltip>
    </div>
  );
}
