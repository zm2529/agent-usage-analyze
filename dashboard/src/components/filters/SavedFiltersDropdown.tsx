import { Bookmark, ChevronDown, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { SavedFilter } from '@/hooks/useSavedFilters';

interface SavedFiltersDropdownProps {
  savedFilters: SavedFilter[];
  onApply: (filters: Record<string, string>) => void;
  onDelete: (id: string) => void;
}

/**
 * Dropdown listing saved filter presets.
 * Click a row to apply all filters from that preset.
 * Trash icon deletes the preset (no confirmation — low-cost action).
 */
export function SavedFiltersDropdown({
  savedFilters,
  onApply,
  onDelete,
}: SavedFiltersDropdownProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5 shrink-0">
          <Bookmark className="h-3.5 w-3.5" />
          Saved
          <ChevronDown className="h-3 w-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 p-1">
        {savedFilters.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">
            <p className="font-medium">No saved filters yet.</p>
            <p className="mt-0.5">Apply filters, then click Save.</p>
          </div>
        ) : (
          savedFilters.map((sf) => {
            const subtitle = Object.entries(sf.filters)
              .map(([k, v]) => `${k}: ${v.replace(/_/g, ' ')}`)
              .join(', ');

            return (
              <div
                key={sf.id}
                className="flex items-start gap-2 px-3 py-2 rounded hover:bg-accent cursor-pointer group transition-colors"
                onClick={() => onApply(sf.filters)}
              >
                <Bookmark className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{sf.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{subtitle}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(sf.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5 text-muted-foreground hover:text-destructive"
                  aria-label="Delete saved filter"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
