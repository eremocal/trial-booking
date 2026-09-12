#!/bin/bash
#
# Proves the concurrency tests can actually fail.
#
# Temporarily removes the `FOR UPDATE` row lock from TrialClassRepository, runs
# the suite, then restores the file and runs it again. A test that cannot fail
# is not a test, and this is how you show that rather than assert it.
#
# The interesting result is not that tests break without the lock. It is WHICH
# test survives: the brief's own last-seat scenario passes either way, because
# it is written as a sequence and never actually overlaps.
#
#   ./scripts/prove-the-lock.sh
#
set -u

SVC="apps/api/src/infrastructure/prisma/repositories.ts"
BAK="$(mktemp)"

restore() {
  cp "$BAK" "$SVC"
  rm -f "$BAK"
}
# Restore on ANY exit, including Ctrl-C, so a demo never leaves the repo broken.
trap restore EXIT INT TERM

cp "$SVC" "$BAK"

hr() { printf '%s\n' "────────────────────────────────────────────────────────────"; }

hr
echo "  1. BASELINE — the lock is in place"
hr
( cd apps/api && npx vitest run 2>&1 ) | grep -E '✓|×|Tests  ' | sed 's/^/  /'

echo
hr
echo "  2. SABOTAGE — removing SELECT ... FOR UPDATE"
hr
python3 - "$SVC" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
before = s
s = s.replace("""      SELECT id FROM trial_classes WHERE id = ${id} FOR UPDATE
    `;""", """      SELECT id FROM trial_classes WHERE id = ${id}
    `;""")
if s == before:
    sys.exit("could not find the FOR UPDATE clause to remove")
open(p, 'w').write(s)
print("  removed FOR UPDATE from TrialClassRepository")
PY

( cd apps/api && npx vitest run 2>&1 ) | grep -E '✓|×|Tests  ' | sed 's/^/  /'

echo
hr
echo "  3. RESTORED"
hr
restore
trap - EXIT INT TERM
( cd apps/api && npx vitest run 2>&1 ) | grep -E 'Tests  ' | sed 's/^/  /'

echo
echo "  The test that survived sabotage is the brief's own scenario."
echo "  It is sequential: A selects, B selects, B pays, A pays. Nothing overlaps,"
echo "  so no lock is needed to pass it. Only the concurrent tests find the bug."
