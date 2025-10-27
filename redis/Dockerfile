# redis/Dockerfile
FROM redis:7-alpine

# Add a minimal config with persistence and sensible defaults for dev
COPY redis.conf /usr/local/etc/redis/redis.conf

EXPOSE 6379

# Create /data (persistence path) – docker volume or bind mount recommended
VOLUME ["/data"]

# Run with our config
CMD ["redis-server", "/usr/local/etc/redis/redis.conf"]
