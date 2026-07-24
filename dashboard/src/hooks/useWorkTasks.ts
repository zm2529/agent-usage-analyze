import { useQuery } from '@tanstack/react-query';
import { fetchWorkTask, fetchWorkTasks } from '@/lib/api';

export function useWorkTasks(page = 0, pageSize = 50) {
  return useQuery({
    queryKey: ['work-tasks', page, pageSize],
    queryFn: () => fetchWorkTasks({ limit: pageSize, offset: page * pageSize }),
  });
}

export function useWorkTask(id: string | undefined) {
  return useQuery({
    queryKey: ['work-task', id],
    queryFn: async () => (await fetchWorkTask(id!)).task,
    enabled: Boolean(id),
  });
}
