FROM node:22 AS base
WORKDIR /app

# Install dependencies — cannot use --ignore-scripts because
# @reclaimprotocol/tls is a GitHub dep that needs its prepare script to build
COPY package.json package-lock.json ./
RUN npm ci

# Download ZK circuit files
RUN node node_modules/@reclaimprotocol/zk-symmetric-crypto/lib/scripts/download-files.js

# Copy source
COPY tsconfig.json ./
COPY src/ ./src/

# Run as non-root
RUN addgroup --system app && adduser --system --ingroup app app
USER app

EXPOSE 5177
CMD ["node", "--experimental-strip-types", "--import=./src/init-crypto.ts", "src/server.ts"]
