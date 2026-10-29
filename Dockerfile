FROM node:24-alpine
WORKDIR /app
RUN npm install --global pnpm@10.20.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build
ENV HOST=0.0.0.0 PORT=8080 NODE_ENV=production
EXPOSE 8080
USER node
CMD ["node", "server/index.js"]
