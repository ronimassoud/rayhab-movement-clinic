# The booking API and the worker: one image, two commands.
#   docker build -t rayhab-server server/
#   api:     node dist/server.js
#   worker:  node dist/worker.js
#   migrate: node dist/migrate.js
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY shared ./shared
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY shared ./shared
COPY migrations ./migrations
# No shell needed at runtime beyond Alpine's; run as the unprivileged node user.
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/server.js"]
