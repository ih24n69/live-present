# Gunakan Node LTS
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package.json dulu (biar cache optimal)
COPY package*.json ./

# Install dependency
RUN npm install --production

# Copy semua source
COPY . .

# Expose port aplikasi
EXPOSE 9090

# Jalankan server
CMD ["node", "server.js"]