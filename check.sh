#!/bin/bash
# lint + typecheck + test + test:db ; devuelve 1 si algo falla
cd "$(dirname "$0")"
npm run lint >/tmp/l.out 2>&1 || { echo "LINT FALLA"; tail -15 /tmp/l.out; exit 1; }
npm run typecheck >/tmp/t.out 2>&1 || { echo "TYPECHECK FALLA"; tail -15 /tmp/t.out; exit 1; }
T=$(npm test 2>&1); echo "$T" | grep -E "ℹ (pass|fail)" | tr '\n' ' '; echo "$T" | grep -q "ℹ fail 0" || { echo "TEST FALLA"; echo "$T" | grep -E "✖" | head; exit 1; }
D=$(npm run test:db 2>&1); echo "$D" | grep -E "correctas" | tr '\n' ' '; echo; echo "$D" | grep -E "[1-9][0-9]* fallidas" && exit 1
echo "TODO VERDE"
