import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Header } from './Header';
import {
  FIRST_RUN_GUIDE_STORAGE_KEY,
  FirstRunGuide,
} from '@/components/onboarding/FirstRunGuide';
import { useKnowledgeStatus, useSetKnowledgeResearchAuthorization } from '@/hooks/usePractices';

export function Layout() {
  const [guideOpen, setGuideOpen] = useState(false);
  const knowledge = useKnowledgeStatus();
  const setKnowledgeAuthorization = useSetKnowledgeResearchAuthorization();

  useEffect(() => {
    try {
      if (window.localStorage.getItem(FIRST_RUN_GUIDE_STORAGE_KEY) === 'completed') return;
    } catch {
      // Restricted storage should not prevent the local dashboard from rendering.
    }
    setGuideOpen(true);
  }, []);

  const closeGuide = useCallback(() => {
    try {
      window.localStorage.setItem(FIRST_RUN_GUIDE_STORAGE_KEY, 'completed');
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
          researchEnabled={knowledge.data?.authorization.enabled ?? false}
          onResearchEnabledChange={(enabled) => setKnowledgeAuthorization.mutate(enabled)}
        />
      </div>
    </TooltipProvider>
  );
}
