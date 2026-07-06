# Minimal image so registries (e.g. Glama) can start the server and run an
# MCP introspection handshake (initialize -> tools/list) over stdio.
FROM node:20-slim
WORKDIR /app

# Install deps (incl. devDeps for the TypeScript build) using the lockfile.
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

# Build the server.
COPY src ./src
RUN npm run build

# stdio MCP server — the registry pipes JSON-RPC over stdin/stdout.
ENTRYPOINT ["node", "dist/index.js"]
