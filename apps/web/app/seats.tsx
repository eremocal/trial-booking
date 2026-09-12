import { cn } from '@/lib/utils';

/**
 * Seat availability as pips.
 *
 * The system is entirely about a 4-seat cap, so seat state should be legible
 * without reading a number. The last remaining seat gets its own colour,
 * because that is where everything interesting happens.
 */
export function Seats({ taken, capacity }: { taken: number; capacity: number }) {
  const remaining = capacity - taken;
  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: capacity }, (_, i) => (
          <span
            key={i}
            className={cn(
              'size-2.5 rounded-full',
              i < taken ? 'bg-foreground/55' : 'bg-border',
              remaining === 1 && i === taken && 'bg-amber-500',
            )}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-xs tabular-nums">
        {taken}/{capacity}
      </span>
    </div>
  );
}
