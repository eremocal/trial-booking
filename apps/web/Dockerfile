FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /repo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @trial-class-booking/web...

COPY apps/web apps/web
WORKDIR /repo/apps/web
# NEXT_PUBLIC_* is inlined at build time. The browser runs on the HOST, so it
# must reach the API on the host's published port, not the compose service name.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm exec next build

FROM node:22-alpine AS runtime
RUN corepack enable
WORKDIR /repo
COPY --from=build /repo /repo
WORKDIR /repo/apps/web
# next start loads next.config.mjs too, and ARG/ENV do not cross stages.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NODE_ENV=production
EXPOSE 3000
CMD ["pnpm", "exec", "next", "start", "-p", "3000"]
