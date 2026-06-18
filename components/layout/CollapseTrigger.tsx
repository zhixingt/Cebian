import { useState } from 'react';
import { PanelRightClose } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useSidebar } from './SidebarContext';
import { t } from '@/lib/i18n';

/**
 * 展开状态下，鼠标靠近右边缘时显示的折叠触发按钮。
 * 悬浮在内容区域右侧，自动显隐。
 */
export function CollapseTrigger() {
  const { toggleCollapsed } = useSidebar();
  const [visible, setVisible] = useState(false);

  return (
    <div
      className="absolute right-0 top-0 bottom-0 w-2 z-20"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      <div
        className={`absolute right-1 top-1/2 -translate-y-1/2 transition-opacity duration-150 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="secondary"
              size="icon-xs"
              onClick={toggleCollapsed}
              className="size-6 rounded-full shadow-sm border border-border/60 bg-background/90 backdrop-blur"
            >
              <PanelRightClose className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left">{t('common.collapseSidebar')}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
