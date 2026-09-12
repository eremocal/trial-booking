// Inlined at build time; next.config.mjs refuses to build without it.
export const API = process.env.NEXT_PUBLIC_API_URL as string;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly detail: string,
  ) {
    super(detail || code);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The API returns { error, message } for domain failures. Carry the CODE
    // through so the UI can show a parent something human; the raw message
    // contains ids that mean nothing to them.
    throw new ApiError(body.error ?? `HTTP_${res.status}`, body.message ?? '');
  }
  return body as T;
}

export type TrialClass = {
  id: string;
  title: string;
  subject: string;
  startsAt: string;
  priceCents: number;
  capacity: number;
  seatsTaken: number;
  seatsRemaining: number;
};

export type Parent = {
  id: string;
  name: string;
  students: { id: string; name: string }[];
};

export type PayResult = {
  bookingId: string;
  status: string;
  payment: 'succeeded' | 'failed';
  seat?: string;
  failureReason?: string;
  refunded?: boolean;
  replayed?: boolean;
};
