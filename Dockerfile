FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY index.html ./
COPY server.mjs ./
COPY README.md ./

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
