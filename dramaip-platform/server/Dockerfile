# Java sources are compiled with the developer or CI JDK 21 before this image
# is built. Docker is intentionally a thin runtime packager: it never downloads
# Maven dependencies or recompiles the nine services.
FROM amazoncorretto:21-alpine

WORKDIR /app
ARG MODULE

# The Nacos Java client writes diagnostic files below /logs by default. Create
# that directory before dropping privileges so every service can start without
# a writable root filesystem.
RUN mkdir -p /logs/nacos && chown -R 10001:0 /logs

# Every runnable module produces exactly one Spring Boot *-exec.jar. Keeping the
# module argument in the path lets the same Dockerfile package all Java services.
COPY server/${MODULE}/target/*-exec.jar /app/app.jar
COPY server/migration/historical-migrations /app/historical-migrations

USER 10001:0
EXPOSE 8080

# JVM flags are overridable via the JAVA_OPTS environment variable so that
# Compose and Helm can tune heap per deployment without rebuilding the image.
# The default targets ~50% of the container memory limit (e.g. ~256m under a
# 512m limit) and keeps the JVM small enough for local dev; raise it or pass a
# fixed -Xmx via JAVA_OPTS for larger production profiles.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=50 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError"
ENTRYPOINT java $JAVA_OPTS -jar /app/app.jar
