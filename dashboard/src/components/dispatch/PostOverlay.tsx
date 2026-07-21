import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { PostPreview } from './PostPreview';
import { CoverImagePromptSection } from './CoverImagePromptSection';
import type { DispatchResponse } from '@/lib/api';

interface PostOverlayProps {
  open: boolean;
  onClose: () => void;
  result: DispatchResponse;
}

export function PostOverlay({ open, onClose, result }: PostOverlayProps) {
  const { title, tags, tldr } = result.frontmatter;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(isOpen) => { if (!isOpen) onClose(); }}>
      <DialogPrimitive.Portal>
        {/* Backdrop — z-[60] to sit above the Sheet (z-50) */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />

        {/* Full-screen content — z-[61] so it renders above the backdrop */}
        <DialogPrimitive.Content
          aria-describedby="post-overlay-desc"
          className="fixed inset-0 z-[61] flex flex-col bg-background outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        >
          <DialogPrimitive.Title className="sr-only">{title || 'Post preview'}</DialogPrimitive.Title>
          <p id="post-overlay-desc" className="sr-only">
            Full-screen preview of the generated post. Use Escape or the close button to dismiss.
          </p>

          {/* Header */}
          <div className="shrink-0 flex items-center justify-between border-b px-4 py-3">
            <p className="text-sm font-medium truncate max-w-[80%]">{title || 'Generated post'}</p>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close preview"
              className="rounded-xs text-muted-foreground hover:text-foreground opacity-70 hover:opacity-100 transition-opacity focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 ring-offset-background"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Scrollable post preview */}
          <div className="flex-1 overflow-hidden">
            <PostPreview result={result} />
          </div>

          {/* Cover image prompt section */}
          <CoverImagePromptSection
            title={title}
            tags={tags}
            tldr={tldr}
            format={result.format}
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
