package com.dramaip.platform.ai.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.dramaip.platform.ai.CorpusProperties;
import java.io.ByteArrayInputStream;
import java.net.InetAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpHeaders;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import javax.net.ssl.SSLSession;
import org.junit.jupiter.api.Test;

class CorpusCrawlerTest {
    private static final InetAddress PUBLIC = address("8.8.8.8");

    @Test
    void canonicalizesAndRejectsUnsafeUrlShapes() {
        CorpusCrawler crawler = crawler(request -> response(request, 404, "text/plain", ""));

        assertEquals("https://example.com/a?alpha=1&z=2",
                crawler.canonicalize(" HTTPS://Example.COM:443/a?utm_source=x&z=2&alpha=1#part ").toString());
        assertEquals("http://example.com/", crawler.canonicalize("http://example.com:80").toString());
        assertEquals("UNSUPPORTED_URL", assertThrows(CorpusCrawler.CrawlException.class,
                () -> crawler.canonicalize("ftp://example.com/file")).code());
        assertEquals("UNSUPPORTED_URL", assertThrows(CorpusCrawler.CrawlException.class,
                () -> crawler.canonicalize("https://user:password@example.com/")).code());
        assertEquals("INVALID_HOST", assertThrows(CorpusCrawler.CrawlException.class,
                () -> crawler.canonicalize("https:///missing-host")).code());
    }

    @Test
    void blocksPrivateSpecialUseAndDnsRebindingAnswers() {
        assertTrue(CorpusCrawler.isPublic(PUBLIC));
        assertFalse(CorpusCrawler.isPublic(address("127.0.0.1")));
        assertFalse(CorpusCrawler.isPublic(address("10.0.0.1")));
        assertFalse(CorpusCrawler.isPublic(address("100.64.0.1")));
        assertFalse(CorpusCrawler.isPublic(address("169.254.169.254")));
        assertFalse(CorpusCrawler.isPublic(address("172.31.1.1")));
        assertFalse(CorpusCrawler.isPublic(address("192.168.1.1")));
        assertFalse(CorpusCrawler.isPublic(address("192.0.2.1")));
        assertFalse(CorpusCrawler.isPublic(address("198.51.100.1")));
        assertFalse(CorpusCrawler.isPublic(address("203.0.113.1")));
        assertFalse(CorpusCrawler.isPublic(address("fc00::1")));

        CorpusProperties properties = properties();
        CorpusCrawler rebound = new CorpusCrawler(properties, mock(HttpClient.class),
                ignored -> new InetAddress[] { PUBLIC, address("127.0.0.1") });
        CorpusCrawler.CrawlException error = assertThrows(CorpusCrawler.CrawlException.class,
                () -> rebound.validatePublic(URI.create("https://example.com/")));
        assertEquals("PRIVATE_ADDRESS", error.code());
    }

    @Test
    void honorsRobotsAndConfiguredCrawlDelay() {
        CorpusCrawler blocked = crawler(request -> response(request, 200, "text/plain",
                "User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2"));
        assertFalse(blocked.robots(URI.create("https://example.com/private/story")).allowed());
        CorpusCrawler.RobotsPolicy allowed = blocked.robots(URI.create("https://example.com/private/public/story"));
        assertTrue(allowed.allowed());
        assertEquals(2_000, allowed.crawlDelayMs());
        assertEquals("ROBOTS_DENIED", assertThrows(CorpusCrawler.CrawlException.class,
                () -> blocked.fetch("https://example.com/private/story")).code());

        CorpusCrawler missing = crawler(request -> response(request, 404, "text/plain", ""));
        assertTrue(missing.robots(URI.create("https://example.com/anything")).allowed());

        CorpusCrawler delayed = crawler(request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 200, "text/plain", "User-agent: *\nCrawl-delay: 2")
                : response(request, 200, "text/plain", "public"));
        assertEquals(2_000, delayed.fetch("https://example.com/story").crawlDelayMs());
    }

    @Test
    void fetchesTextWithoutScriptsAndFindsLinks() {
        CorpusCrawler crawler = crawler(request -> {
            if (request.uri().getPath().equals("/robots.txt")) return response(request, 404, "text/plain", "");
            return response(request, 200, "text/html; charset=utf-8",
                    "<html><head><title> 有趣 标题 </title><style>secret-style</style></head>"
                            + "<body>正文 <script>secret-script</script><a href='/next?utm_source=x'>下一页</a>"
                            + "<a href='mailto:test@example.com'>邮件</a></body></html>",
                    Map.of("ETag", List.of("etag-1"), "Last-Modified", List.of("Wed, 27 Aug 2026 00:00:00 GMT")));
        });

        CorpusCrawler.FetchResult result = crawler.fetch("https://example.com/story#fragment");
        assertEquals("有趣 标题", result.title());
        assertTrue(result.text().contains("正文"));
        assertFalse(result.text().contains("secret-script"));
        assertFalse(result.text().contains("secret-style"));
        assertEquals(List.of(URI.create("https://example.com/next?utm_source=x")), result.links());
        assertEquals("etag-1", result.etag());
        assertEquals(200, result.status());
    }

    @Test
    void blocksPrivateRedirectsLoginWallsWrongMimeAndOversizedBodies() {
        CorpusCrawler redirect = crawler(request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 404, "text/plain", "")
                : response(request, 302, "text/plain", "", Map.of("Location", List.of("http://127.0.0.1/admin"))));
        assertEquals("PRIVATE_ADDRESS", assertThrows(CorpusCrawler.CrawlException.class,
                () -> redirect.fetch("https://example.com/story")).code());

        CorpusCrawler login = statusCrawler(401, "text/html", "login");
        assertEquals("ACCESS_RESTRICTED", assertThrows(CorpusCrawler.CrawlException.class,
                () -> login.fetch("https://example.com/login")).code());

        CorpusCrawler mime = statusCrawler(200, "image/png", "not-an-image");
        assertEquals("UNSUPPORTED_CONTENT_TYPE", assertThrows(CorpusCrawler.CrawlException.class,
                () -> mime.fetch("https://example.com/image")).code());

        CorpusCrawler compressed = crawler(request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 404, "text/plain", "")
                : response(request, 200, "text/html", "compressed",
                        Map.of("Content-Encoding", List.of("gzip"))));
        assertEquals("UNSUPPORTED_CONTENT_ENCODING", assertThrows(CorpusCrawler.CrawlException.class,
                () -> compressed.fetch("https://example.com/compressed")).code());

        CorpusProperties tiny = properties();
        tiny.setMaxBytes(4);
        CorpusCrawler oversized = crawler(tiny, request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 404, "text/plain", "") : response(request, 200, "text/plain", "12345"));
        assertEquals("CONTENT_TOO_LARGE", assertThrows(CorpusCrawler.CrawlException.class,
                () -> oversized.fetch("https://example.com/large")).code());
    }

    @Test
    void treatsRetryAfterAsBoundedRetryAndStopsRedirectLoops() {
        CorpusCrawler retry = crawler(request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 404, "text/plain", "")
                : response(request, 429, "text/plain", "", Map.of("Retry-After", List.of("120"))));
        CorpusCrawler.RetryableCrawlException retryError = assertThrows(
                CorpusCrawler.RetryableCrawlException.class,
                () -> retry.fetch("https://example.com/busy"));
        assertEquals("RETRY_AFTER", retryError.code());
        assertTrue(retryError.retryAt().isAfter(Instant.now().plusSeconds(100)));

        CorpusProperties noRedirects = properties();
        noRedirects.setMaxRedirects(0);
        CorpusCrawler loop = crawler(noRedirects, request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 404, "text/plain", "")
                : response(request, 302, "text/plain", "", Map.of("Location", List.of("/again"))));
        assertEquals("TOO_MANY_REDIRECTS", assertThrows(CorpusCrawler.CrawlException.class,
                () -> loop.fetch("https://example.com/start")).code());
    }

    @Test
    void sendsConditionalHeadersAndAcceptsNotModified() {
        CorpusCrawler crawler = crawler(request -> {
            if (request.uri().getPath().equals("/robots.txt")) return response(request, 404, "text/plain", "");
            assertEquals("etag-old", request.headers().firstValue("If-None-Match").orElseThrow());
            assertEquals("Wed, 27 Aug 2026 00:00:00 GMT",
                    request.headers().firstValue("If-Modified-Since").orElseThrow());
            return response(request, 304, "text/plain", "");
        });

        CorpusCrawler.FetchResult result = crawler.fetch("https://example.com/story", "etag-old",
                "Wed, 27 Aug 2026 00:00:00 GMT");
        assertEquals(304, result.status());
        assertEquals(0, result.body().length);
    }

    private static CorpusCrawler statusCrawler(int status, String contentType, String body) {
        return crawler(request -> request.uri().getPath().equals("/robots.txt")
                ? response(request, 404, "text/plain", "") : response(request, status, contentType, body));
    }

    private static CorpusCrawler crawler(Function<HttpRequest, HttpResponse<?>> responder) {
        return crawler(properties(), responder);
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    private static CorpusCrawler crawler(CorpusProperties properties,
            Function<HttpRequest, HttpResponse<?>> responder) {
        HttpClient client = mock(HttpClient.class);
        try {
            when(client.send(any(HttpRequest.class), any(HttpResponse.BodyHandler.class)))
                    .thenAnswer(invocation -> responder.apply(invocation.getArgument(0)));
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
        return new CorpusCrawler(properties, client, host -> new InetAddress[] {
                host.equals("127.0.0.1") ? address(host) : PUBLIC
        });
    }

    private static CorpusProperties properties() {
        CorpusProperties properties = new CorpusProperties();
        properties.setMinimumDomainDelayMs(1_000);
        properties.setMaxRedirects(5);
        properties.setMaxBytes(2_097_152);
        return properties;
    }

    private static HttpResponse<?> response(HttpRequest request, int status, String contentType, String body) {
        return response(request, status, contentType, body, Map.of());
    }

    private static HttpResponse<?> response(HttpRequest request, int status, String contentType, String body,
            Map<String, List<String>> extraHeaders) {
        Map<String, List<String>> headers = new java.util.LinkedHashMap<>(extraHeaders);
        headers.putIfAbsent("Content-Type", List.of(contentType));
        Object value = request.uri().getPath().equals("/robots.txt") ? body
                : new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));
        return new StubResponse<>(request, status, HttpHeaders.of(headers, (left, right) -> true), value);
    }

    private static InetAddress address(String value) {
        try {
            return InetAddress.getByName(value);
        } catch (Exception exception) {
            throw new IllegalStateException(exception);
        }
    }

    private record StubResponse<T>(HttpRequest request, int statusCode, HttpHeaders headers, T body)
            implements HttpResponse<T> {
        @Override public Optional<HttpResponse<T>> previousResponse() { return Optional.empty(); }
        @Override public Optional<SSLSession> sslSession() { return Optional.empty(); }
        @Override public URI uri() { return request.uri(); }
        @Override public HttpClient.Version version() { return HttpClient.Version.HTTP_1_1; }
    }
}
