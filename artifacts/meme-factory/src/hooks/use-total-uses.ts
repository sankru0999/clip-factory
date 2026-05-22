import { useState, useCallback } from 'react';

const USES_KEY = 'mf_total_uses';

export function useTotalUses() {
  const [totalUses, setTotalUses] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(USES_KEY);
      return stored ? parseInt(stored, 10) : 0;
    } catch {
      return 0;
    }
  });

  const incrementUses = useCallback(() => {
    setTotalUses(prev => {
      const newUses = prev + 1;
      localStorage.setItem(USES_KEY, newUses.toString());
      return newUses;
    });
  }, []);

  const shouldShowAd = totalUses > 0 && totalUses % 3 === 0;

  return { totalUses, incrementUses, shouldShowAd };
}
