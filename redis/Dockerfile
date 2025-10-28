# redis/Dockerfile
FROM redis:7-alpine

# Copy our configuration
COPY redis.conf /usr/local/etc/redis/redis.conf

# Ensure data dir exists & owned by redis user
RUN mkdir -p /data && chown -R redis:redis /data /usr/local/etc/redis

USER redis

EXPOSE 6379
VOLUME ["/data"]

# Healthcheck: be explicit about host/port
HEALTHCHECK --interval=10s --timeout=3s --retries=10 \
  CMD redis-cli -h 127.0.0.1 -p 6379 ping || exit 1

# Run with our config
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]
