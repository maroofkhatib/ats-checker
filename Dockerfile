FROM node:20-alpine

# Hugging Face Spaces expects the app on port 7860 and runs as UID 1000 (the "node" user).
ENV NODE_ENV=production \
    PORT=7860
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY lib ./lib
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 7860
CMD ["node", "server.js"]
