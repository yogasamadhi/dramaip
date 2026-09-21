# Java sources are compiled with the developer or CI JDK 21 before this image
# is built. Docker is intentionally a thin runtime packager: it never downloads
# Maven dependencies or recompiles the nine services.
FROM amazoncorretto:21-alpine

WORKDIR /app
ARG MODULE
ARG SERVICE_VERSION=unknown

# The Nacos Java client writes diagnostic files below /logs by default. Create
# that directory before dropping privileges so every service can start without
# a writable root filesystem.
RUN mkdir -p /logs/nacos && chown -R 10001:0 /logs

# Every runnable module produces exactly one Spring Boot *-exec.jar. Keeping the
# module argument in the path lets the same Dockerfile package all Java services.
COPY server/${MODULE}/target/*-exec.jar /app/app.jar
COPY server/migration/historical-migrations /app/historical-migrations
COPY server/target/observability/opentelemetry-javaagent.jar /app/observability/opentelemetry-javaagent.jar

USER 10001:0
EXPOSE 8080

# JVM flags are overridable via the JAVA_OPTS environment variable so that
# Compose and Helm can tune heap per deployment without rebuilding the image.
# The default targets ~50% of the container memory limit (e.g. ~256m under a
# 512m limit) and keeps the JVM small enough for local dev; raise it or pass a
# fixed -Xmx via JAVA_OPTS for larger production profiles.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=50 -XX:+UseG1GC -XX:+ExitOnOutOfMemoryError"
# Left empty by platform-up; the observability target supplies -javaagent.
ENV OTEL_JAVAAGENT_OPTS=""
# Operators may override OTEL_RESOURCE_ATTRIBUTES directly. The two safe defaults
# make environment/release filtering available without putting identifiers or
# request data into resource attributes.
ENV DRAMAIP_DEPLOYMENT_ENVIRONMENT="unknown"
ENV DRAMAIP_SERVICE_VERSION="${SERVICE_VERSION}"
ENV DRAMAIP_RELEASE_NAME="unknown"
ENTRYPOINT OTEL_RESOURCE_ATTRIBUTES="${OTEL_RESOURCE_ATTRIBUTES:-deployment.environment.name=${DRAMAIP_DEPLOYMENT_ENVIRONMENT:-unknown},service.version=${DRAMAIP_SERVICE_VERSION:-unknown},service.namespace=dramaip-platform,dramaip.release=${DRAMAIP_RELEASE_NAME:-unknown}}" exec java $JAVA_OPTS $OTEL_JAVAAGENT_OPTS -jar /app/app.jar
