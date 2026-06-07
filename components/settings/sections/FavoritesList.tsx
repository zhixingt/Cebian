import { useEffect, useState } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useStorageItem } from '@/hooks/useStorageItem';
import { favoritePrompts } from '@/lib/storage';
import { resolveFavorites, type ResolvedFavorite } from '@/lib/prompts/favorites';
import { t } from '@/lib/i18n';

interface RowProps {
  favorite: ResolvedFavorite;
  onRemove: () => void;
}

function Row({ favorite, onRemove }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: favorite.fileName });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const display = favorite.meta?.name ?? favorite.fileName;
  const muted = !favorite.meta;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-3 py-1.5 rounded-md border border-border bg-card text-sm"
      data-testid={`favorite-row-${favorite.fileName}`}
    >
      <button
        type="button"
        aria-label="drag"
        className="cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>
      <Star
        className="size-3.5 shrink-0"
        fill="currentColor"
        aria-hidden
      />
      <span className={`flex-1 min-w-0 truncate ${muted ? 'text-muted-foreground italic' : ''}`}>
        {muted ? favorite.fileName : display}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={t('settings.prompts.favoriteRemove')}
        onClick={onRemove}
      >
        <X className="size-3" />
      </Button>
    </div>
  );
}

export function FavoritesList() {
  const [favorites, setFavorites] = useStorageItem(favoritePrompts, []);
  const [resolved, setResolved] = useState<ResolvedFavorite[]>([]);

  useEffect(() => {
    let cancelled = false;
    resolveFavorites(favorites).then((r) => {
      if (!cancelled) setResolved(r);
    });
    return () => {
      cancelled = true;
    };
  }, [favorites]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (resolved.length === 0) return null;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = resolved.findIndex((r) => r.fileName === active.id);
    const newIndex = resolved.findIndex((r) => r.fileName === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextResolved = arrayMove(resolved, oldIndex, newIndex);
    void setFavorites(nextResolved.map((r) => r.fileName));
  };

  const handleRemove = async (fileName: string) => {
    await setFavorites(favorites.filter((f) => f !== fileName));
    toast.info(t('settings.prompts.favoriteRemoved'));
  };

  return (
    <div className="px-6 pt-4 shrink-0" data-testid="favorites-list">
      <h3 className="text-xs font-medium text-muted-foreground mb-2">
        {t('settings.prompts.favoritesTitle')}
      </h3>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={resolved.map((r) => r.fileName)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {resolved.map((r) => (
              <Row key={r.fileName} favorite={r} onRemove={() => void handleRemove(r.fileName)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}
