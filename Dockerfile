# ---- Stage 1: compile TypeScript ----
# This stage has the compiler and all dev dependencies. None of it ends up
# in the final image; only the compiled dist/ folder is copied over.
FROM node:lts-alpine AS build
WORKDIR /usr/src/app

# Copy the dependency files first so Docker can cache the slow `npm ci` layer
# when only the source code changed
COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build


# ---- Stage 2: runtime image ----
FROM node:lts-alpine
WORKDIR /usr/src/app

# Download and install kepubify
RUN wget https://github.com/pgaskin/kepubify/releases/download/v4.0.4/kepubify-linux-64bit && \
    mv kepubify-linux-64bit /usr/local/bin/kepubify && \
    chmod +x /usr/local/bin/kepubify

# Download and install kindlegen
RUN wget https://github.com/zzet/fp-docker/raw/f2b41fb0af6bb903afd0e429d5487acc62cb9df8/kindlegen_linux_2.6_i386_v2_9.tar.gz && \
    echo "9828db5a2c8970d487ada2caa91a3b6403210d5d183a7e3849b1b206ff042296 kindlegen_linux_2.6_i386_v2_9.tar.gz" | sha256sum -c && \
    mkdir kindlegen && \
    tar xvf kindlegen_linux_2.6_i386_v2_9.tar.gz --directory kindlegen && \
    cp kindlegen/kindlegen /usr/local/bin/kindlegen && \
    chmod +x /usr/local/bin/kindlegen && \
    rm -rf kindlegen kindlegen_linux_2.6_i386_v2_9.tar.gz

# Install pdfCropMargins system-wide (not under /root) so the unprivileged
# "node" user below is able to run it
ENV PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin
RUN apk add --no-cache pipx && pipx install pdfCropMargins

# Production dependencies only (no TypeScript, no tsx)
COPY package*.json ./
RUN npm ci --omit=dev

# Compiled server code from stage 1, plus the static web pages
COPY --from=build /usr/src/app/dist ./dist
COPY static ./static

# The app wipes and recreates uploads/ on startup, which a non-root user can
# only do if it owns the parent folder
RUN chown node:node /usr/src/app
USER node

EXPOSE 3001

# Run node directly (not via `npm start`) so that the SIGTERM sent by
# `docker stop` reaches our shutdown handler, which deletes uploads/
CMD [ "node", "dist/index.js" ]
