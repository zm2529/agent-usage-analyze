export function eventAnchorId(eventId: string): string {
  return `event-${eventId}`;
}

export function eventAnchorHref(taskId: string, eventId: string): string {
  return `/tasks/${encodeURIComponent(taskId)}#${encodeURIComponent(eventAnchorId(eventId))}`;
}
