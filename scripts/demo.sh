#!/bin/bash
#
# End-to-end walkthrough of the trial booking flow against a running API.
#
#   docker compose up -d --build --wait
#   pnpm db:seed && pnpm demo
#
# Assumes freshly seeded data: 'Fractions Without Fear' must be at 3/4.
# Re-run `pnpm db:seed` before each run.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ -f "$ROOT/.env" ] || { echo "Missing .env. Copy .env.example to .env at the repo root."; exit 1; }
set -a; . "$ROOT/.env"; set +a
API="$NEXT_PUBLIC_API_URL/api"
MATH=33333333-3333-4333-8333-333333333332   # 3/4 confirmed - ONE SEAT LEFT
BEN=22222222-2222-4222-8222-222222222222
ELIF=22222222-2222-4222-8222-222222222225
ANA=22222222-2222-4222-8222-222222222221

jqf() { python3 -c "import sys,json;d=json.load(sys.stdin);print(json.dumps({k:d[k] for k in sys.argv[1:] if k in d}))" "$@"; }

echo "STEP 1  seats left in 'Fractions Without Fear'"
curl -s $API/trial-classes | python3 -c "
import sys,json
for c in json.load(sys.stdin):
    if 'Fractions' in c['title']: print('       ', c['title'], '->', c['seatsRemaining'], 'of', c['capacity'], 'remaining')"

echo
echo "STEP 2  User A (Elif) selects the last slot"
A=$(curl -s -X POST $API/bookings -H 'content-type: application/json' \
  -d "{\"studentId\":\"$ELIF\",\"trialClassId\":\"$MATH\"}")
AID=$(echo "$A" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "        booking A = $AID  status=$(echo "$A" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")"

echo
echo "STEP 3  User B (Ben) selects the SAME last slot -- not blocked, holds no seat"
B=$(curl -s -X POST $API/bookings -H 'content-type: application/json' \
  -d "{\"studentId\":\"$BEN\",\"trialClassId\":\"$MATH\"}")
BID=$(echo "$B" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
echo "        booking B = $BID  status=$(echo "$B" | python3 -c "import sys,json;print(json.load(sys.stdin)['status'])")"

echo
echo "STEP 4  User B pays FIRST"
curl -s -X POST $API/bookings/$BID/pay -H 'content-type: application/json' \
  -d '{"idempotencyKey":"demo-ben-0001","token":"tok_ok"}' | jqf status payment seat | sed 's/^/        /'

echo
echo "STEP 5  User A then tries to pay  <-- THE RACE"
curl -s -X POST $API/bookings/$AID/pay -H 'content-type: application/json' \
  -d '{"idempotencyKey":"demo-elif-0001","token":"tok_ok"}' | jqf status payment seat refunded | sed 's/^/        /'

echo
echo "STEP 6  roster (teacher view)"
curl -s $API/admin/trial-classes/$MATH/roster | python3 -c "
import sys,json
r=json.load(sys.stdin)
print('       ',r['title'],'-',r['seatsTaken'],'/',r['capacity'],'  counterHealthy=',r['counterHealthy'])
for s in r['students']: print('          -',s['studentName'],'(',s['parentName'],')')"

echo
echo "STEP 7  duplicate: Ana is already confirmed in this class"
DUP=$(mktemp)
curl -s -o "$DUP" -w '        HTTP %{http_code}  ' -X POST $API/bookings \
  -H 'content-type: application/json' -d "{\"studentId\":\"$ANA\",\"trialClassId\":\"$MATH\"}"
jqf error message < "$DUP"
rm -f "$DUP"

echo
echo "STEP 8  payment failure on an open class leaves the roster untouched"
SCI=33333333-3333-4333-8333-333333333331
F=$(curl -s -X POST $API/bookings -H 'content-type: application/json' \
  -d "{\"studentId\":\"$ELIF\",\"trialClassId\":\"$SCI\"}")
FID=$(echo "$F" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -s -X POST $API/bookings/$FID/pay -H 'content-type: application/json' \
  -d '{"idempotencyKey":"demo-fail-0001","token":"tok_declined"}' | jqf status payment failureReason | sed 's/^/        /'
curl -s $API/admin/trial-classes/$SCI/roster | python3 -c "
import sys,json;r=json.load(sys.stdin);print('        roster still',r['seatsTaken'],'/',r['capacity'])"

echo
echo "STEP 9  refund work queue"
curl -s $API/admin/refunds-owed | python3 -c "
import sys,json;d=json.load(sys.stdin);print('       ',len(d),'booking(s) awaiting refund (0 = all already refunded inline)')"
