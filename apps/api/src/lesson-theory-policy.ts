import { createHash } from 'node:crypto';

export type TheoryBlockVersion = { id: string; blockOrder: number; blockType: string; content: unknown; updatedAt: Date | string };

export function theoryContentVersion(blocks: TheoryBlockVersion[]): string {
  const source = [...blocks].sort((a, b) => a.blockOrder - b.blockOrder).map((block) => ({
    id: block.id, order: block.blockOrder, type: block.blockType, content: block.content,
    updatedAt: block.updatedAt instanceof Date ? block.updatedAt.toISOString() : block.updatedAt,
  }));
  return createHash('sha256').update(JSON.stringify(source)).digest('hex');
}

export function advanceTheoryProgress(currentOrder: number, requestedOrder: number, lastOrder: number, completed: boolean) {
  if (!Number.isInteger(requestedOrder) || requestedOrder < 0 || requestedOrder > lastOrder) return { ok: false as const, reason: 'invalid' as const };
  if (requestedOrder > currentOrder + 1) return { ok: false as const, reason: 'sequence' as const };
  const maxViewedOrder = Math.max(currentOrder, requestedOrder);
  return { ok: true as const, maxViewedOrder, completed: completed && maxViewedOrder === lastOrder };
}
