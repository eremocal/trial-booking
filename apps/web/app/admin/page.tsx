'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { apiFetch, TrialClass } from '../api';
import { Seats } from '../seats';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

type Roster = {
  trialClassId: string;
  title: string;
  capacity: number;
  seatsTaken: number;
  counterHealthy: boolean;
  students: {
    bookingId: string;
    studentName: string;
    parentName: string;
    parentEmail: string;
    confirmedAt: string | null;
  }[];
};

type RefundRow = {
  id: string;
  student: { name: string };
  trialClass: { title: string };
};

export default function AdminPage() {
  const [rosters, setRosters] = useState<Roster[]>([]);
  const [refunds, setRefunds] = useState<RefundRow[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    const cs = await apiFetch<TrialClass[]>('/api/trial-classes');
    setRosters(
      await Promise.all(
        cs.map((c) => apiFetch<Roster>(`/api/admin/trial-classes/${c.id}/roster`)),
      ),
    );
    setRefunds(await apiFetch<RefundRow[]>('/api/admin/refunds-owed'));
  }

  useEffect(() => {
    load().catch(console.error).finally(() => setLoading(false));
  }, []);

  return (
    <main className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Trial class rosters</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Confirmed bookings only. A child whose parent is mid-payment is not on the register.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()}>
          <RefreshCw />
          Refresh
        </Button>
      </div>

      {loading && <Skeleton className="h-40 w-full" />}

      {rosters.map((r) => (
        <Card key={r.trialClassId}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle className="text-base">{r.title}</CardTitle>
              <div className="flex items-center gap-3">
                {r.seatsTaken >= r.capacity && <Badge variant="secondary">Full</Badge>}
                <Seats taken={r.seatsTaken} capacity={r.capacity} />
              </div>
            </div>
            {!r.counterHealthy && (
              <CardDescription className="text-destructive flex items-center gap-1.5">
                <TriangleAlert className="size-3.5" />
                confirmed_count disagrees with the booking rows — investigate.
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {r.students.length === 0 ? (
              <p className="text-muted-foreground text-sm">No confirmed students yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Parent</TableHead>
                    <TableHead className="hidden sm:table-cell">Email</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.students.map((s) => (
                    <TableRow key={s.bookingId}>
                      <TableCell className="font-medium">{s.studentName}</TableCell>
                      <TableCell className="text-muted-foreground">{s.parentName}</TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">
                        {s.parentEmail}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Refunds owed</CardTitle>
          <CardDescription>
            Money taken, no seat given. Empty is the healthy state — refunds are issued inline, so
            anything sitting here is work for the reconciliation job.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {refunds.length === 0 ? (
            <p className={cn('text-sm', 'text-muted-foreground')}>Nothing outstanding.</p>
          ) : (
            <Alert className="border-amber-500/40 bg-amber-500/8">
              <TriangleAlert className="text-amber-600 dark:text-amber-400" />
              <AlertTitle>{refunds.length} refund(s) pending</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4">
                  {refunds.map((r) => (
                    <li key={r.id}>
                      {r.student.name} — {r.trialClass.title}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
