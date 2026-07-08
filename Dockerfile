FROM node:18-bullseye-slim

WORKDIR /app

# Install FFmpeg + the toolchain mediasoup needs to compile its native worker
# binary during `pnpm install` (python3, pip, make/g++ via build-essential).
# Debian/glibc base is required: mediasoup does not support Alpine/musl.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 python3-pip build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm tsx typescript

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

# Install dependencies with pnpm
RUN pnpm install

# Copy source code
COPY src ./src
COPY public ./public
COPY client ./client
COPY vite.config.js tsconfig.json ./
COPY start.sh ./

# Build the client bundle
RUN pnpm run build:client

# Ensure start.sh is executable
RUN chmod +x start.sh

# Expose ports (5400 for HTTP/WS server, RTC ports for mediasoup)
EXPOSE 5400
EXPOSE 10000-10100/udp
EXPOSE 10000-10100/tcp

CMD ["sh", "start.sh"]
