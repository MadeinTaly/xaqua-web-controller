FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
# npm ci: install riproducibile dal lockfile (node_modules non è più nel repo)
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "src/app.js"]
