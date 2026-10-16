FROM alpine:3.23

# pg_dump must match the server's major version, which compose.prod.yml pins.
RUN apk add --no-cache restic postgresql18-client sqlite \
    && adduser -D -u 1000 backup \
    && mkdir /data && chown backup:backup /data

COPY backup.sh restore.sh run.sh healthcheck.sh /usr/local/bin/

# Uid 1000 owns the /data volume the backend writes. Another owner would leave
# a root-owned -wal file beside the database that the backend cannot open.
USER backup
ENV RESTIC_CACHE_DIR=/tmp/restic-cache
CMD ["run.sh"]
