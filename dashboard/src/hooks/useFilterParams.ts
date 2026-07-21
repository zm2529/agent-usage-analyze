import { useCallback } from 'react';
import { useSearchParams } from 'react-router';

type FilterConfig = Record<string, string>;

export function useFilterParams<T extends FilterConfig>(defaults: T) {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = {} as T;
  for (const key in defaults) {
    (filters as FilterConfig)[key] = searchParams.get(key) || defaults[key];
  }

  const setFilter = useCallback(
    (key: keyof T & string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === defaults[key]) {
            next.delete(key);
          } else {
            next.set(key, value);
          }
          return next;
        },
        { replace: key === 'q' }
      );
    },
    [setSearchParams, defaults]
  );

  const setFilters = useCallback(
    (updates: Partial<T>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === defaults[key as keyof T]) {
              next.delete(key);
            } else {
              next.set(key, value as string);
            }
          }
          return next;
        },
        { replace: false }
      );
    },
    [setSearchParams, defaults]
  );

  const clearFilters = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const key in defaults) {
          next.delete(key);
        }
        return next;
      },
      { replace: true }
    );
  }, [setSearchParams, defaults]);

  return [filters, setFilter, setFilters, clearFilters] as const;
}
