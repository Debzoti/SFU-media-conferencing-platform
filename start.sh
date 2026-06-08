#!/bin/bash
set -e  # stop if any command fails

# Ensure HLS output directory exists
mkdir -p /app/public/hls

# Start the Node server
echo "Starting server..."
tsx src/index.ts
