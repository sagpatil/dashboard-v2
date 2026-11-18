# Builds the frontend, then runs the API server, which also serves the app.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm test

FROM node:22-alpine
ENV NODE_ENV=production PORT=8787
WORKDIR /app
COPY package.json package-lock.json ./
# Only the server's dependencies: the frontend's are bundled into dist/
RUN npm ci --omit=dev && npm cache clean --force
COPY shared shared
COPY server/src server/src
COPY --from=build /app/dist dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:8787/api/health > /dev/null || exit 1
CMD ["node", "server/src/index.ts"]
