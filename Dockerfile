FROM node:18-bullseye
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
CMD ["npm", "start"]