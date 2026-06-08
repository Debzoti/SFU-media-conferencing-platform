FROM node:18-alpine

WORKDIR /app

# Install FFmpeg and pnpm
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm tsx typescript

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./

# Install dependencies with pnpm
RUN pnpm install

# Copy source code
COPY src ./src
COPY public ./public
COPY client ./client
COPY tools ./tools
COPY vite.config.js tsconfig.json ./
COPY start.sh ./

# Build the client bundle
RUN pnpm run build:client

# Ensure start.sh is executable
RUN chmod +x start.sh

# Expose ports (3000 for server, RTC ports for mediasoup)
EXPOSE 3000
EXPOSE 10000-10100/udp
EXPOSE 10000-10100/tcp

CMD ["sh", "start.sh"]
