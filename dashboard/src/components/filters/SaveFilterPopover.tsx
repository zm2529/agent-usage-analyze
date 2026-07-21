import { useState } from 'react';
import { Bookmark } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';

interface SaveFilterPopoverProps {
  activeFilters: Record<string, string>;
  defaultFilterValues: Record<string, string>;
  onSave: (name: string, filters: Record<string, string>) => void;
}

/** Generate a human-readable name from active filter values. */
function generateName(activeFilters: Record<string, string>, defaults: Record<string, string>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(activeFilters)) {
    if (value !== defaults[key] && value && value !== 'all') {
      // Prettify key names
      const label = key === 'q' ? value : value.replace(/_/g, ' ');
      parts.push(label);
    }
  }
  return parts.slice(0, 3).join(' / ') || 'My filter';
}

/**
 * "Save" button that opens a popover to name and save the current filters.
 * Only visible when at least one non-default filter is active.
 */
export function SaveFilterPopover({ activeFilters, defaultFilterValues, onSave }: SaveFilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');

  // Determine which filters are non-default
  const nonDefaultFilters: Record<string, string> = {};
  for (const [key, value] of Object.entries(activeFilters)) {
    if (value !== defaultFilterValues[key] && value && value !== 'all' && key !== 'session') {
      nonDefaultFilters[key] = value;
    }
  }

  const hasNonDefault = Object.keys(nonDefaultFilters).length > 0;

  if (!hasNonDefault) return null;

  function handleOpen(nextOpen: boolean) {
    if (nextOpen) {
      setName(generateName(activeFilters, defaultFilterValues));
    }
    setOpen(nextOpen);
  }

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed, nonDefaultFilters);
    setOpen(false);
    toast.success('Filter saved');
  }

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5 shrink-0">
          <Bookmark className="h-3.5 w-3.5" />
          Save
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-4" align="end">
        <div className="space-y-3">
          <div className="text-sm font-medium">Save current filters</div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSave()}
              className="h-8 text-sm"
              autoFocus
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">Filters:</div>
            <div className="space-y-0.5">
              {Object.entries(nonDefaultFilters).map(([key, value]) => (
                <div key={key} className="text-xs text-muted-foreground/80">
                  <span className="capitalize">{key.replace(/_/g, ' ')}</span>:{' '}
                  <span className="text-foreground">{value.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-7 text-xs" onClick={handleSave} disabled={!name.trim()}>
              Save
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
