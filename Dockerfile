FROM node:22.16.0-bookworm-slim

ARG BIOME_VERSION=2.3.8
RUN npm install --global "@biomejs/biome@${BIOME_VERSION}" \
    && npm cache clean --force

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
CMD ["npm", "run", "check"]
