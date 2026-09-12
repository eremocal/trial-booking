'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, TriangleAlert, XCircle } from 'lucide-react';
import { ApiError, apiFetch, Parent, PayResult, TrialClass } from './api';
import { Seats } from './seats';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const TOKENS = [
  { value: 'tok_ok', label: 'Card that works' },
  { value: 'tok_declined', label: 'Card declined' },
  { value: 'tok_insufficient_funds', label: 'Insufficient funds' },
  { value: 'tok_gateway_error', label: 'Gateway error (outcome unknown)' },
];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  });

/** How each terminal status should read to a parent, in plain language. */
const OUTCOME: Record<
  string,
  { tone: 'ok' | 'warn' | 'err'; icon: typeof CheckCircle2; title: string; body: string }
> = {
  confirmed: {
    tone: 'ok',
    icon: CheckCircle2,
    title: 'Booked',
    body: 'Your child has a seat in this trial class, and the teacher can see them on the roster.',
  },
  seat_unavailable: {
    tone: 'warn',
    icon: TriangleAlert,
    title: 'Seat taken first',
    body: 'Someone confirmed the last seat moments before you. Your payment went through and has been refunded in full — no seat was reserved.',
  },
  payment_failed: {
    tone: 'err',
    icon: XCircle,
    title: 'Payment failed',
    body: 'No money was taken and no seat was reserved. You can try again with a different card.',
  },
  cancelled: {
    tone: 'warn',
    icon: TriangleAlert,
    title: 'Booking cancelled',
    body: 'This booking is not on the roster.',
  },
};

/**
 * What a parent should read when something goes wrong. The API's own message
 * names ids, which is right for a log and wrong for a person.
 */
const ERROR_COPY: Record<string, { title: string; body: string }> = {
  ALREADY_CONFIRMED: {
    title: 'Already booked',
    body: 'This child already has a seat in this trial class. Pick a different class, or a different child.',
  },
  CLASS_FULL: {
    title: 'Class is full',
    body: 'Someone took the last seat while you were choosing. Please pick another class.',
  },
  CLASS_ALREADY_STARTED: {
    title: 'Class has started',
    body: 'This trial class has already begun and can no longer be booked.',
  },
  PAYMENT_PROVIDER_UNAVAILABLE: {
    title: 'Payment provider unavailable',
    body: 'We could not reach the payment provider. Nothing was charged and your booking is unchanged — please try again.',
  },
  INVALID_BOOKING_STATE: {
    title: 'This booking can no longer be paid for',
    body: 'Start a new booking and try again.',
  },
  BOOKING_NOT_FOUND: { title: 'Booking not found', body: 'Please start a new booking.' },
  CLASS_NOT_FOUND: { title: 'Class not found', body: 'Please choose another class.' },
  STUDENT_NOT_FOUND: { title: 'Child not found', body: 'Please choose another child.' },
};

const FALLBACK_ERROR = {
  title: 'Something went wrong',
  body: 'Please try again. If it keeps happening, nothing has been charged.',
};

const TONE: Record<string, string> = {
  ok: 'border-emerald-500/40 bg-emerald-500/8 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400',
  warn: 'border-amber-500/40 bg-amber-500/8 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
  err: 'border-destructive/40 bg-destructive/8 [&>svg]:text-destructive',
};

function StepHeader({ n, active, done, children, description }: {
  n: number; active: boolean; done: boolean;
  children: React.ReactNode; description?: React.ReactNode;
}) {
  return (
    <CardHeader>
      <div className="flex items-center gap-2.5">
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
            done && 'bg-emerald-600 text-white',
            !done && active && 'bg-primary text-primary-foreground',
            !done && !active && 'bg-muted text-muted-foreground',
          )}
        >
          {done ? '✓' : n}
        </span>
        <CardTitle className="text-base">{children}</CardTitle>
      </div>
      {description && <CardDescription className="pl-8.5">{description}</CardDescription>}
    </CardHeader>
  );
}

export default function BookPage() {
  const [parents, setParents] = useState<Parent[]>([]);
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [loading, setLoading] = useState(true);
  const [studentId, setStudentId] = useState('');
  const [classId, setClassId] = useState('');
  const [token, setToken] = useState('tok_ok');
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [result, setResult] = useState<PayResult | null>(null);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const [p, c] = await Promise.all([
      apiFetch<Parent[]>('/api/parents'),
      apiFetch<TrialClass[]>('/api/trial-classes'),
    ]);
    setParents(p);
    setClasses(c);
  }

  useEffect(() => {
    load().catch((e) => setError(toErrorCopy(e))).finally(() => setLoading(false));
  }, []);

  async function book() {
    setBusy(true); setError(null); setResult(null);
    try {
      const b = await apiFetch<{ id: string }>('/api/bookings', {
        method: 'POST',
        body: JSON.stringify({ studentId, trialClassId: classId }),
      });
      setBookingId(b.id);
    } catch (e) {
      setError(toErrorCopy(e));
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (!bookingId) return;
    setBusy(true); setError(null);
    try {
      const r = await apiFetch<PayResult>(`/api/bookings/${bookingId}/pay`, {
        method: 'POST',
        body: JSON.stringify({
          // One key per booking: clicking Pay twice replays the first attempt
          // rather than charging again or claiming a second seat.
          idempotencyKey: `web-${bookingId}`,
          token,
        }),
      });
      setResult(r);
      await load();
    } catch (e) {
      setError(toErrorCopy(e));
      // The provider's outcome is unknown, so refresh what the server believes.
      await load().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setBookingId(null);
    setResult(null);
    setError(null);
    setClassId('');
    // Back to a working card: keeping a declined one selected makes the next
    // attempt fail for a reason the parent thinks they already dealt with.
    setToken('tok_ok');
    load().catch((e) => setError(toErrorCopy(e)));
  }

  const chosen = classes.find((c) => c.id === classId);
  const outcome = result ? OUTCOME[result.status] : null;
  const done = Boolean(result);
  const locked = Boolean(bookingId);

  return (
    <main className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Book a trial class</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Trial classes take four students. A seat is only held once payment succeeds.
        </p>
      </div>

      {/* 1 — child */}
      <Card>
        <StepHeader n={1} active={!studentId} done={Boolean(studentId)}>
          Choose a child
        </StepHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <Select value={studentId} onValueChange={setStudentId} disabled={locked}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select a child…" />
              </SelectTrigger>
              <SelectContent>
                {parents.map((p) => (
                  <SelectGroup key={p.id}>
                    <SelectLabel>{p.name}</SelectLabel>
                    {p.students.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          )}
        </CardContent>
      </Card>

      {/* 2 — class */}
      <Card>
        <StepHeader n={2} active={Boolean(studentId) && !classId} done={Boolean(classId)}>
          Choose a trial class
        </StepHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          ) : (
            <RadioGroup value={classId} onValueChange={setClassId} className="gap-1">
              {classes.map((c) => {
                const full = c.seatsRemaining <= 0;
                const last = c.seatsRemaining === 1;
                const disabled = full || locked;
                return (
                  <div
                    key={c.id}
                    role="presentation"
                    onClick={() => !disabled && setClassId(c.id)}
                    className={cn(
                      'flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors',
                      // not-allowed means "you cannot have this seat", which is
                      // true of a full class and not of a form that is merely
                      // locked while a booking is in flight.
                      full && 'cursor-not-allowed opacity-55',
                      !full && locked && 'cursor-default opacity-55',
                      !disabled && 'cursor-pointer hover:bg-muted/50',
                      classId === c.id && 'border-primary bg-muted/50 opacity-100',
                    )}
                  >
                    <RadioGroupItem
                      id={c.id}
                      value={c.id}
                      disabled={disabled}
                      className={cn(!full && locked && 'disabled:cursor-default')}
                    />
                    <label
                      htmlFor={c.id}
                      className={cn(
                        'min-w-0 flex-1',
                        full && 'cursor-not-allowed',
                        !disabled && 'cursor-pointer',
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{c.title}</span>
                        {full && <Badge variant="secondary">Full</Badge>}
                        {last && (
                          <Badge className="border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400">
                            Last seat
                          </Badge>
                        )}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {when(c.startsAt)} · {money(c.priceCents)}
                      </span>
                    </label>
                    <Seats taken={c.seatsTaken} capacity={c.capacity} />
                  </div>
                );
              })}
            </RadioGroup>
          )}
        </CardContent>
      </Card>

      {/* 3 — pay */}
      <Card>
        <StepHeader
          n={3}
          active={Boolean(classId) && !done}
          done={done}
          description="Mock gateway — pick an outcome to exercise the failure paths."
        >
          Pay{chosen ? ` — ${money(chosen.priceCents)}` : ''}
        </StepHeader>
        <CardContent className="space-y-4">
          <Select value={token} onValueChange={setToken} disabled={done}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TOKENS.map((t) => (
                <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex flex-wrap items-center gap-2">
            {!locked ? (
              <Button onClick={book} disabled={!studentId || !classId || busy}>
                {busy && <Loader2 className="animate-spin" />}
                Continue to payment
              </Button>
            ) : (
              <>
                {!done && (
                  <Button onClick={pay} disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <CreditCard />}
                    Pay {chosen ? money(chosen.priceCents) : ''}
                  </Button>
                )}
                <Button variant="outline" onClick={reset}>
                  {done ? 'Book another' : 'Start over'}
                </Button>
              </>
            )}
          </div>

          {locked && !done && (
            <p className="text-muted-foreground text-xs">
              Booking <code className="font-mono">{bookingId!.slice(0, 8)}</code> is{' '}
              <Badge variant="secondary">pending payment</Badge> — it does not hold a seat yet.
              Another parent can still confirm this seat before you pay.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <Alert className={TONE.err}>
          <XCircle />
          <AlertTitle>{error.title}</AlertTitle>
          <AlertDescription>{error.body}</AlertDescription>
        </Alert>
      )}

      {result && outcome && (
        <Alert className={TONE[outcome.tone]}>
          <outcome.icon />
          <AlertTitle>{outcome.title}</AlertTitle>
          <AlertDescription>
            <p>{outcome.body}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="outline">status: {result.status}</Badge>
              <Badge variant="outline">payment: {result.payment}</Badge>
              {result.seat && <Badge variant="outline">seat: {result.seat}</Badge>}
              {result.failureReason && <Badge variant="outline">{result.failureReason}</Badge>}
              {result.refunded && <Badge variant="outline">refunded</Badge>}
              {result.replayed && <Badge variant="outline">replayed</Badge>}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </main>
  );
}

/** Domain error code -> copy a parent can actually act on. */
function toErrorCopy(e: unknown): { title: string; body: string } {
  if (e instanceof ApiError) {
    const copy = ERROR_COPY[e.code];
    if (copy) return copy;
  }
  return FALLBACK_ERROR;
}
