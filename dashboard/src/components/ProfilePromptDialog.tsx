import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUserProfile } from '@/hooks/useUserProfile';
import type { UserProfile } from '@/hooks/useUserProfile';

interface ProfilePromptDialogProps {
  open: boolean;
  /**
   * Called when the user saves the profile.
   * Receives the just-saved profile so the caller can use it immediately
   * without waiting for a React re-render (avoids stale closure on triggerDownload).
   */
  onSave: (profile: UserProfile) => void;
  /** Called when the user skips — the download should proceed without profile. */
  onSkip: () => void;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog shown before share card download when the user profile is incomplete.
 * Collects a display name and an optional generic avatar URL.
 * On save, persists to localStorage and calls onSave so the caller can proceed with the download.
 */
export function ProfilePromptDialog({
  open,
  onSave,
  onSkip,
  onOpenChange,
}: ProfilePromptDialogProps) {
  const { profile, saveProfile } = useUserProfile();

  const [name, setName] = useState(profile?.name ?? '');
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatarUrl ?? '');
  const [avatarError, setAvatarError] = useState(false);

  // Reset fields when dialog opens, pre-fill from existing profile if any
  useEffect(() => {
    if (open) {
      setName(profile?.name ?? '');
      setAvatarUrl(profile?.avatarUrl ?? '');
      setAvatarError(false);
    }
  }, [open, profile?.name, profile?.avatarUrl]);

  const canSave = name.trim().length > 0;

  async function handleSave() {
    if (!canSave) return;
    // Await saveProfile — it fetches and caches the avatar as base64
    const saved = await saveProfile(name, avatarUrl);
    // Pass the saved profile (with cached avatar) directly to the caller
    // to avoid stale closure on triggerDownload
    onSave(saved);
  }

  function handleSkip() {
    onSkip();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加分享卡片署名</DialogTitle>
          <DialogDescription>
            显示名称会出现在卡片底部；头像地址可选，不依赖 GitHub。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Live avatar preview */}
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full overflow-hidden bg-muted border border-border shrink-0 flex items-center justify-center">
              {avatarUrl && !avatarError ? (
                <img
                  src={avatarUrl}
                  alt="头像预览"
                  className="h-full w-full object-cover"
                  onError={() => setAvatarError(true)}
                  onLoad={() => setAvatarError(false)}
                />
              ) : (
                <span className="text-xl text-muted-foreground select-none">
                  {name.trim().charAt(0).toUpperCase() || '?'}
                </span>
              )}
            </div>
            <div className="text-sm">
              <p className="font-medium">{name.trim() || 'Your Name'}</p>
              <p className="text-muted-foreground text-xs">{avatarUrl ? '已填写头像地址' : '未设置头像'}</p>
            </div>
          </div>

          {/* Name input */}
          <div>
            <label className="text-sm font-medium">显示名称</label>
            <Input
              className="mt-1"
              placeholder="例如：你的姓名"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Optional generic avatar URL */}
          <div>
            <label className="text-sm font-medium">头像 URL（可选）</label>
            <Input
              className="mt-1"
              placeholder="https://example.com/avatar.png"
              value={avatarUrl}
              onChange={(e) => {
                setAvatarUrl(e.target.value);
                setAvatarError(false);
              }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              仅在本地生成分享卡片时读取。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={handleSkip} type="button">
            跳过
          </Button>
          <Button onClick={handleSave} disabled={!canSave} type="button">
            保存并下载
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
