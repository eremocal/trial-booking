import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { NavLink } from './nav-link';

/**
 * Defines --font-sans and --font-mono, which globals.css maps its theme tokens
 * to. Without these the tokens resolve to nothing and every element falls back
 * to the browser default serif.
 */
const sans = Geist({ variable: '--font-sans', subsets: ['latin'], display: 'swap' });
const mono = Geist_Mono({ variable: '--font-mono', subsets: ['latin'], display: 'swap' });

export const metadata = {
  title: 'Ottodot — Trial Booking',
  description: 'Book a trial science or math class.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-background text-foreground min-h-dvh antialiased">
        <div className="mx-auto max-w-3xl px-4 pb-24 pt-6">
          <header className="mb-8 flex flex-wrap items-center justify-between gap-4 border-b pb-4">
            <div className="font-semibold tracking-tight">
              Ottodot <span className="text-muted-foreground font-normal">· trial booking</span>
            </div>
            <nav className="flex gap-1">
              <NavLink href="/">Book</NavLink>
              <NavLink href="/admin">Roster</NavLink>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
