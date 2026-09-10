# Railway API deployment
FROM node:24-alpine

WORKDIR /app

COPY api/package*.json ./

RUN npm ci --omit=dev

COPY api/ .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
