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

# Install system dependencies for PDF generation and media processing
RUN apk add --no-cache \
    curl \
    ffmpeg \
    chromium \
    nss \
    freetype \
    freetype-dev \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    ttf-dejavu \
    fontconfig \
    dbus \
    && rm -rf /var/cache/apk/*

# Create a user for running Chromium (security best practice)
RUN addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001

# Set up font cache
RUN fc-cache -f

## COPY production dependencies and code
COPY --from=build /home/node/app/dist /home/node/app/dist
COPY --from=build /home/node/app/node_modules /home/node/app/node_modules
COPY --from=build /home/node/app/package.json /home/node/app/package.json

## Expose port
EXPOSE 8090

USER root
ENV NODE_ENV production

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

CMD ["yarn", "run", "start:prod"]

