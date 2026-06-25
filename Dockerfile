FROM node:26 AS base
WORKDIR /app

# Install dependencies — cannot use --ignore-scripts because
# @reclaimprotocol/tls is a GitHub dep that needs its prepare script to build.
# node:26 ships npm 11.16, which satisfies the .npmrc min-release-age cooldown (needs npm >= 11.10).
COPY package.json package-lock.json .npmrc ./
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
