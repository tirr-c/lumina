FROM node:10-alpine AS build

WORKDIR /app
COPY . /app
RUN npm install && npm run build

FROM node:10-alpine

WORKDIR /app
COPY package.json /app/package.json
COPY package-lock.json /app/package-lock.json
RUN npm install --only=prod
COPY --from=build /app/dist /app/dist

CMD ["npm", "start"]
