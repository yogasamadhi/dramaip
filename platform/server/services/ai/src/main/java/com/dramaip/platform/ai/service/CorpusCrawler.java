package com.dramaip.platform.ai.service;

import com.dramaip.platform.ai.CorpusProperties;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.net.IDN;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Pattern;
import javax.swing.text.MutableAttributeSet;
import javax.swing.text.html.HTML;
import javax.swing.text.html.HTMLEditorKit;
import javax.swing.text.html.parser.ParserDelegator;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

@Component
public class CorpusCrawler {
    private static final Set<String> ALLOWED_TYPES = Set.of(
            "text/html", "application/xhtml+xml", "text/plain", "application/rss+xml",
            "application/atom+xml", "application/xml", "text/xml");
    private static final Set<String> TRACKING_PARAMETERS = Set.of(
            "fbclid", "gclid", "igshid", "spm", "from", "source", "ref", "referrer");
    private static final Pattern SPACE = Pattern.compile("\\s+");
    private final CorpusProperties properties;
    private final HttpClient client;
    private final Function<String, InetAddress[]> resolver;

    @Autowired
    public CorpusCrawler(CorpusProperties properties) {
        this(properties, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10))
                .followRedirects(HttpClient.Redirect.NEVER).build(), CorpusCrawler::resolve);
    }

    CorpusCrawler(CorpusProperties properties, HttpClient client, Function<String, InetAddress[]> resolver) {
        this.properties = properties;
        this.client = client;
        this.resolver = resolver;
    }

    public URI canonicalize(String raw) {
        try {
            URI parsed = new URI(raw.trim());
            String scheme = parsed.getScheme() == null ? "" : parsed.getScheme().toLowerCase(Locale.ROOT);
            if (!List.of("http", "https").contains(scheme) || parsed.getUserInfo() != null) {
                throw new CrawlException("UNSUPPORTED_URL", "only public http/https URLs are accepted");
            }
            String host = parsed.getHost();
            if (host == null || host.isBlank()) throw new CrawlException("INVALID_HOST", "URL host is required");
            host = IDN.toASCII(host).toLowerCase(Locale.ROOT);
            int port = parsed.getPort();
            if ((scheme.equals("http") && port == 80) || (scheme.equals("https") && port == 443)) port = -1;
            String path = parsed.getRawPath() == null || parsed.getRawPath().isBlank() ? "/" : parsed.getRawPath();
            String query = canonicalQuery(parsed.getRawQuery());
            return new URI(scheme, null, host, port, path, query, null).normalize();
        } catch (URISyntaxException error) {
            throw new CrawlException("INVALID_URL", "URL is invalid");
        }
    }

    public FetchResult fetch(String raw) {
        return fetch(raw, null, null);
    }

    public FetchResult fetch(String raw, String etag, String lastModified) {
        URI target = canonicalize(raw);
        RobotsPolicy policy = robots(target);
        if (!policy.allowed()) throw new CrawlException("ROBOTS_DENIED", "robots policy does not allow crawling");
        FetchResult result = request(target, properties.getMaxRedirects(), etag, lastModified);
        return new FetchResult(result.canonicalUrl(), result.status(), result.contentType(), result.body(),
                result.title(), result.text(), result.links(), result.etag(), result.lastModified(),
                policy.crawlDelayMs());
    }

    RobotsPolicy robots(URI target) {
        URI robots;
        try {
            robots = new URI(target.getScheme(), null, target.getHost(), target.getPort(), "/robots.txt", null, null);
        } catch (URISyntaxException error) {
            throw new CrawlException("INVALID_URL", "unable to build robots URL");
        }
        validatePublic(robots);
        try {
            HttpRequest request = HttpRequest.newBuilder(robots).timeout(Duration.ofSeconds(10))
                    .header("User-Agent", properties.getUserAgent()).header("Accept", "text/plain").GET().build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() == 404) return new RobotsPolicy(true, properties.getMinimumDomainDelayMs());
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                return new RobotsPolicy(false, properties.getMinimumDomainDelayMs());
            }
            return parseRobots(response.body(), target.getPath());
        } catch (IOException error) {
            throw new CrawlException("ROBOTS_UNAVAILABLE", "robots policy could not be read");
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CrawlException("CRAWL_INTERRUPTED", "crawler was interrupted");
        }
    }

    private FetchResult request(URI target, int redirectsRemaining, String etag, String lastModified) {
        validatePublic(target);
        HttpRequest.Builder builder = HttpRequest.newBuilder(target).timeout(Duration.ofSeconds(20))
                .header("User-Agent", properties.getUserAgent())
                .header("Accept", "text/html,application/xhtml+xml,text/plain,application/rss+xml,application/atom+xml,application/xml;q=0.8")
                .GET();
        if (etag != null && !etag.isBlank()) builder.header("If-None-Match", etag);
        if (lastModified != null && !lastModified.isBlank()) builder.header("If-Modified-Since", lastModified);
        HttpRequest request = builder.build();
        try {
            HttpResponse<java.io.InputStream> response = client.send(request, HttpResponse.BodyHandlers.ofInputStream());
            int status = response.statusCode();
            if (status == 304) {
                response.body().close();
                return new FetchResult(target, status, "", new byte[0], "", "", List.of(), etag, lastModified,
                        properties.getMinimumDomainDelayMs());
            }
            if (status >= 300 && status < 400) {
                response.body().close();
                if (redirectsRemaining <= 0) throw new CrawlException("TOO_MANY_REDIRECTS", "redirect limit exceeded");
                String location = response.headers().firstValue("Location")
                        .orElseThrow(() -> new CrawlException("INVALID_REDIRECT", "redirect has no Location"));
                return request(canonicalize(target.resolve(location).toString()), redirectsRemaining - 1, null, null);
            }
            if (status == 401 || status == 403) {
                response.body().close();
                throw new CrawlException("ACCESS_RESTRICTED", "authenticated or restricted content is not collected");
            }
            if (status == 429 || status == 503) {
                response.body().close();
                throw new RetryableCrawlException("RETRY_AFTER", "source requested retry", retryAfter(response));
            }
            if (status < 200 || status >= 300) {
                response.body().close();
                throw new CrawlException("HTTP_" + status, "source returned HTTP " + status);
            }
            String contentType = response.headers().firstValue("Content-Type").orElse("application/octet-stream")
                    .split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
            if (!ALLOWED_TYPES.contains(contentType)) {
                response.body().close();
                throw new CrawlException("UNSUPPORTED_CONTENT_TYPE", "source content type is not text");
            }
            String contentEncoding = response.headers().firstValue("Content-Encoding").orElse("identity");
            if (!contentEncoding.equalsIgnoreCase("identity")) {
                response.body().close();
                throw new CrawlException("UNSUPPORTED_CONTENT_ENCODING", "compressed source bodies are not accepted");
            }
            long declaredLength = response.headers().firstValueAsLong("Content-Length").orElse(-1);
            if (declaredLength > properties.getMaxBytes()) {
                response.body().close();
                throw new CrawlException("CONTENT_TOO_LARGE", "source exceeds byte limit");
            }
            byte[] body = response.body().readNBytes(properties.getMaxBytes() + 1);
            response.body().close();
            if (body.length > properties.getMaxBytes()) throw new CrawlException("CONTENT_TOO_LARGE", "source exceeds byte limit");
            ParsedDocument parsed = parse(target, body, contentType);
            return new FetchResult(target, status, contentType, body, parsed.title(), parsed.text(), parsed.links(),
                    response.headers().firstValue("ETag").orElse(null),
                    response.headers().firstValue("Last-Modified").orElse(null),
                    properties.getMinimumDomainDelayMs());
        } catch (IOException error) {
            throw new RetryableCrawlException("NETWORK_ERROR", "source could not be read", Instant.now().plusSeconds(60));
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw new CrawlException("CRAWL_INTERRUPTED", "crawler was interrupted");
        }
    }

    void validatePublic(URI uri) {
        InetAddress[] addresses = resolver.apply(uri.getHost());
        if (addresses.length == 0) throw new CrawlException("DNS_EMPTY", "host has no address");
        for (InetAddress address : addresses) {
            if (!isPublic(address)) throw new CrawlException("PRIVATE_ADDRESS", "private and special-use addresses are blocked");
        }
    }

    static boolean isPublic(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) return false;
        byte[] bytes = address.getAddress();
        if (bytes.length == 4) {
            int first = Byte.toUnsignedInt(bytes[0]);
            int second = Byte.toUnsignedInt(bytes[1]);
            if (first == 0 || first == 10 || first == 127 || first >= 224) return false;
            if (first == 100 && second >= 64 && second <= 127) return false;
            if (first == 169 && second == 254) return false;
            if (first == 172 && second >= 16 && second <= 31) return false;
            if (first == 192 && second == 168) return false;
            if (first == 192 && second == 0) return false;
            if (first == 192 && second == 2) return false;
            if (first == 198 && second == 51) return false;
            if (first == 198 && (second == 18 || second == 19)) return false;
            if (first == 203 && second == 0 && Byte.toUnsignedInt(bytes[2]) == 113) return false;
        } else if (bytes.length == 16) {
            int first = Byte.toUnsignedInt(bytes[0]);
            if ((first & 0xfe) == 0xfc) return false;
        }
        return true;
    }

    private RobotsPolicy parseRobots(String text, String path) {
        boolean applies = false;
        boolean allowed = true;
        int bestLength = -1;
        long delay = properties.getMinimumDomainDelayMs();
        for (String sourceLine : text.split("\\R")) {
            String line = sourceLine.split("#", 2)[0].trim();
            int delimiter = line.indexOf(':');
            if (delimiter < 0) continue;
            String key = line.substring(0, delimiter).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(delimiter + 1).trim();
            if (key.equals("user-agent")) {
                applies = value.equals("*") || properties.getUserAgent().toLowerCase(Locale.ROOT)
                        .startsWith(value.toLowerCase(Locale.ROOT));
            } else if (applies && (key.equals("allow") || key.equals("disallow"))) {
                if (!value.isEmpty() && path.startsWith(value) && value.length() >= bestLength) {
                    allowed = key.equals("allow");
                    bestLength = value.length();
                }
            } else if (applies && key.equals("crawl-delay")) {
                try {
                    delay = Math.max(delay, (long) (Double.parseDouble(value) * 1000));
                } catch (NumberFormatException ignored) {
                    // Invalid directives do not weaken the configured minimum.
                }
            }
        }
        return new RobotsPolicy(allowed, delay);
    }

    private ParsedDocument parse(URI base, byte[] body, String contentType) throws IOException {
        if (contentType.equals("text/plain")) {
            String text = normalized(new String(body, StandardCharsets.UTF_8));
            return new ParsedDocument(text.substring(0, Math.min(text.length(), 120)), text, List.of());
        }
        HtmlCollector callback = new HtmlCollector(base);
        new ParserDelegator().parse(new InputStreamReader(new ByteArrayInputStream(body), StandardCharsets.UTF_8), callback, true);
        return new ParsedDocument(callback.title(), normalized(callback.text()), List.copyOf(callback.links));
    }

    private static String normalized(String input) {
        return SPACE.matcher(input).replaceAll(" ").trim();
    }

    private static String canonicalQuery(String raw) {
        if (raw == null || raw.isBlank()) return null;
        return Arrays.stream(raw.split("&"))
                .filter(value -> {
                    String key = value.split("=", 2)[0].toLowerCase(Locale.ROOT);
                    return !key.startsWith("utm_") && !TRACKING_PARAMETERS.contains(key);
                })
                .sorted(Comparator.naturalOrder()).reduce((left, right) -> left + "&" + right).orElse(null);
    }

    private static InetAddress[] resolve(String host) {
        try {
            return InetAddress.getAllByName(host);
        } catch (IOException error) {
            throw new CrawlException("DNS_ERROR", "host could not be resolved");
        }
    }

    private static Instant retryAfter(HttpResponse<?> response) {
        String value = response.headers().firstValue("Retry-After").orElse("");
        try {
            return Instant.now().plusSeconds(Math.min(Long.parseLong(value), 86_400));
        } catch (NumberFormatException ignored) {
            try {
                return ZonedDateTime.parse(value, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant();
            } catch (RuntimeException invalid) {
                return Instant.now().plusSeconds(300);
            }
        }
    }

    private static final class HtmlCollector extends HTMLEditorKit.ParserCallback {
        private final URI base;
        private final StringBuilder text = new StringBuilder();
        private final StringBuilder title = new StringBuilder();
        private final Set<URI> links = new LinkedHashSet<>();
        private boolean inTitle;
        private int ignoredDepth;

        private HtmlCollector(URI base) { this.base = base; }

        @Override public void handleStartTag(HTML.Tag tag, MutableAttributeSet attributes, int position) {
            if (tag == HTML.Tag.SCRIPT || tag == HTML.Tag.STYLE) ignoredDepth++;
            if (tag == HTML.Tag.TITLE) inTitle = true;
            if (tag == HTML.Tag.A) addLink(attributes);
        }
        @Override public void handleSimpleTag(HTML.Tag tag, MutableAttributeSet attributes, int position) {
            if (tag == HTML.Tag.A) addLink(attributes);
        }
        @Override public void handleEndTag(HTML.Tag tag, int position) {
            if ((tag == HTML.Tag.SCRIPT || tag == HTML.Tag.STYLE) && ignoredDepth > 0) ignoredDepth--;
            if (tag == HTML.Tag.TITLE) inTitle = false;
        }
        @Override public void handleText(char[] data, int position) {
            if (ignoredDepth > 0) return;
            text.append(data).append(' ');
            if (inTitle) title.append(data).append(' ');
        }
        private void addLink(MutableAttributeSet attributes) {
            Object href = attributes.getAttribute(HTML.Attribute.HREF);
            if (href == null || links.size() >= 200) return;
            try {
                URI resolved = base.resolve(href.toString());
                if (List.of("http", "https").contains(resolved.getScheme())) links.add(resolved);
            } catch (IllegalArgumentException ignored) {
                // Invalid links are not crawl candidates.
            }
        }
        private String title() {
            String value = normalized(title.toString());
            return value.isBlank() ? base.getHost() : value.substring(0, Math.min(500, value.length()));
        }
        private String text() { return text.toString(); }
    }

    public record RobotsPolicy(boolean allowed, long crawlDelayMs) { }
    public record FetchResult(URI canonicalUrl, int status, String contentType, byte[] body, String title,
                              String text, List<URI> links, String etag, String lastModified,
                              long crawlDelayMs) { }
    private record ParsedDocument(String title, String text, List<URI> links) { }

    public static class CrawlException extends RuntimeException {
        private final String code;
        public CrawlException(String code, String message) { super(message); this.code = code; }
        public String code() { return code; }
    }
    public static final class RetryableCrawlException extends CrawlException {
        private final Instant retryAt;
        public RetryableCrawlException(String code, String message, Instant retryAt) {
            super(code, message); this.retryAt = retryAt;
        }
        public Instant retryAt() { return retryAt; }
    }
}
