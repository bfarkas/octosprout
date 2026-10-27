# octosprout-server image (spec §18.1). Build from the repository root:
#
#   docker build -f deploy/Dockerfile -t octosprout-server:latest .
#
# The repository layout is kept inside the image because @octosprout/core
# loads the JSON Schemas from <root>/schemas and the record templates from
# <root>/templates.

FROM node:24-slim AS build
ENV CI=true
RUN npm install --global pnpm@10.28.0
WORKDIR /opt/octosprout/app
COPY app/ ./
COPY schemas/ ../schemas/
COPY templates/ ../templates/
# `pnpm prune --prod` drops the workspace links (@octosprout/core), so reinstall
# production dependencies from scratch instead.
RUN pnpm install --frozen-lockfile \
 && pnpm build \
 && rm -rf node_modules packages/*/node_modules \
 && pnpm install --frozen-lockfile --prod

FROM node:24-slim
# git and ssh talk to GitHub; flock(1) and tar come with the base image.
RUN apt-get update \
 && apt-get install --yes --no-install-recommends git openssh-client tini \
 && rm -rf /var/lib/apt/lists/* \
 && git config --system --add safe.directory '*'
COPY --from=build /opt/octosprout /opt/octosprout
RUN mkdir -p /var/lib/octosprout/repo /var/lib/octosprout/state \
 && chown -R node:node /var/lib/octosprout
USER node
ENV NODE_ENV=production \
    OCTOSPROUT_REPO_DIR=/var/lib/octosprout/repo \
    OCTOSPROUT_STATE_DIR=/var/lib/octosprout/state \
    OCTOSPROUT_PORT=8080
VOLUME ["/var/lib/octosprout/repo", "/var/lib/octosprout/state"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
ENTRYPOINT ["tini", "--", "node", "/opt/octosprout/app/packages/server/dist/main.js"]
CMD ["serve"]
