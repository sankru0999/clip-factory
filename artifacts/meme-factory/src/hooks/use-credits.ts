import { useState, useEffect, useCallback } from 'react';

const CREDITS_KEY = 'mf_credits';
const INITIAL_CREDITS = 3;

export function useCredits() {
  const [credits, setCreditsState] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(CREDITS_KEY);
      if (stored !== null) return parseInt(stored, 10);
      return INITIAL_CREDITS;
    } catch {
      return INITIAL_CREDITS;
    }
  });

  const setCredits = useCallback((newCredits: number) => {
    setCreditsState(newCredits);
    localStorage.setItem(CREDITS_KEY, newCredits.toString());
  }, []);

  const deductCredit = useCallback(() => {
    setCreditsState(prev => {
      const newCredits = Math.max(0, prev - 1);
      localStorage.setItem(CREDITS_KEY, newCredits.toString());
      return newCredits;
    });
  }, []);

  const addCredits = useCallback((amount: number) => {
    setCreditsState(prev => {
      const newCredits = prev + amount;
      localStorage.setItem(CREDITS_KEY, newCredits.toString());
      return newCredits;
    });
  }, []);

  return { credits, setCredits, deductCredit, addCredits };
}
