# Build context is the REPO ROOT, so the pnpm workspace and lockfile are visible.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @trial-class-booking/api...

COPY apps/api apps/api
WORKDIR /repo/apps/api
# generate only reads the schema and never connects, but loading the Prisma
# config needs some URL. Real settings arrive from .env when the container runs.
RUN DATABASE_URL=postgresql://build-placeholder pnpm exec prisma generate
RUN pnpm exec tsc -p tsconfig.build.json

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/api
ENV NODE_ENV=production
# Migrations are applied on boot so a reviewer's first `docker compose up`
# lands on a schema-correct database without a second command.
CMD sh -c "pnpm exec prisma migrate deploy && pnpm exec tsx prisma/seed.ts && node dist/main.js"
