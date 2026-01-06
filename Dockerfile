# Railway API deployment
FROM node:20-alpine

WORKDIR /app

COPY api/package*.json ./

RUN npm install --production

COPY api/ .

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
