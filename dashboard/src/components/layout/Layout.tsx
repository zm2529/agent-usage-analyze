import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Header } from './Header';
import {
  FIRST_RUN_GUIDE_OPEN_EVENT,
  FIRST_RUN_GUIDE_STORAGE_KEY,
  FirstRunGuide,
  firstRunGuideStorageKey,
} from '@/components/onboarding/FirstRunGuide';
import { useKnowledgeStatus, useSetKnowledgeResearchAuthorization } from '@/hooks/usePractices';
import { useRuntimeStatus } from '@/hooks/useRuntimeStatus';
import { fetchRuntimeConfig } from '@/lib/api';

export function Layout() {
  const [guideOpen, setGuideOpen] = useState(false);
  const guideStorageKey = useRef(FIRST_RUN_GUIDE_STORAGE_KEY);
  const knowledge = useKnowledgeStatus();
  const setKnowledgeAuthorization = useSetKnowledgeResearchAuthorization();
  const runtime = useRuntimeStatus();

  useEffect(() => {
    let cancelled = false;
    const openGuide = () => setGuideOpen(true);
    window.addEventListener(FIRST_RUN_GUIDE_OPEN_EVENT, openGuide);
    const forceGuide = new URLSearchParams(window.location.search).get('onboarding') === '1';
    if (forceGuide) {
      openGuide();
    } else {
      void fetchRuntimeConfig().then((runtime) => {
        if (cancelled) return;
        guideStorageKey.current = firstRunGuideStorageKey(runtime.installationId);
        try {
          if (window.localStorage.getItem(guideStorageKey.current) === 'completed') return;
        } catch {
          // Restricted storage should not prevent the guide from opening.
        }
        openGuide();
      }).catch(() => {
        if (cancelled) return;
        try {
          if (window.localStorage.getItem(FIRST_RUN_GUIDE_STORAGE_KEY) === 'completed') return;
        } catch {
          // Restricted storage should not prevent the guide from opening.
        }
        openGuide();
      });
    }
    return () => {
      cancelled = true;
      window.removeEventListener(FIRST_RUN_GUIDE_OPEN_EVENT, openGuide);
    };
  }, []);

  const closeGuide = useCallback(() => {
    try {
      window.localStorage.setItem(guideStorageKey.current, 'completed');
    } catch {
      // The guide still closes for this page load when storage is unavailable.
    }
    setGuideOpen(false);
  }, []);

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Header />
        <main data-onboarding="workspace" className="pb-16 md:ml-[188px] md:pt-[61px] md:pb-0">
          <Outlet />
        </main>
        <Toaster />
        <FirstRunGuide
          open={guideOpen}
          onClose={closeGuide}
          hookState={runtime.data?.stages.hook.state}
          researchEnabled={knowledge.data?.authorization.enabled ?? false}
          researchPending={setKnowledgeAuthorization.isPending}
          onResearchEnabledChange={(enabled) => setKnowledgeAuthorization.mutate(enabled)}
        />
      </div>
    </TooltipProvider>
  );
}
