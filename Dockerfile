# Use the official Node.js image as base
FROM node:20-alpine

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies for building Vite)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Build the Vite React application
RUN npm run build

# Expose the port the app runs on (Cloud Run provides PORT env variable, defaulting to 8080)
EXPOSE 8080

# Command to run the Express server
CMD ["node", "server.js"]
