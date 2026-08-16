FROM node:20-alpine

WORKDIR /app

# Copy package definitions
COPY package*.json ./

# Install production dependencies
RUN npm install --only=production

# Copy application files
COPY . .

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV NODE_ENV=production

# Command to launch server
CMD ["node", "server.js"]
