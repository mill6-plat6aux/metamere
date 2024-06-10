FROM --platform=linux/arm64 node:20-slim
RUN apt-get update && apt-get install -y git && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./package.json
RUN npm install
COPY src ./
CMD ["node", "index"]