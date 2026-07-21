import { useQuery } from '@tanstack/react-query';
import { fetchWorkTask, fetchWorkTasks } from '@/lib/api';

export function useWorkTasks() {
  return useQuery({ queryKey: ['work-tasks'], queryFn: async () => (await fetchWorkTasks()).tasks });
}

export function useWorkTask(id: string | undefined) {
  return useQuery({
    queryKey: ['work-task', id],
    queryFn: async () => (await fetchWorkTask(id!)).task,
    enabled: Boolean(id),
  });
}
