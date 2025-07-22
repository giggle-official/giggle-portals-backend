# nextjs example: https://github.com/vercel/next.js/blob/canary/examples/with-docker/Dockerfile

# Build and test
ARG REGISTRY
FROM reg.podwide.ai/library/node:20.14.0-alpine3.19 as build

# Copy source code
WORKDIR /home/node/app

# Copy the rest of the application
COPY .  /home/node/app/

# Install all dependencies
RUN yarn install --unsafe-perm --frozen-lockfile

# Build 
RUN yarn
RUN yarn prisma generate
RUN yarn build

# Deployment
FROM reg.podwide.ai/library/node:20.14.0-alpine3.19
WORKDIR /home/node/app 
RUN apk add --no-cache curl ffmpeg

## COPY production dependencies and code
COPY --from=build /home/node/app/dist /home/node/app/dist
COPY --from=build /home/node/app/node_modules /home/node/app/node_modules
COPY --from=build /home/node/app/package.json /home/node/app/package.json

## Expose port
EXPOSE 8090

USER root
ENV NODE_ENV production

CMD ["yarn", "run", "start:prod"]

