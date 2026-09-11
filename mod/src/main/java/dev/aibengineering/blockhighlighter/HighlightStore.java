package dev.aibengineering.blockhighlighter;

import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ClientLevel;

/** Asynchronous local polling; the render loop only reads an immutable snapshot. */
final class HighlightStore {
    private static final long POLL_INTERVAL_MS = 25;
    private static final int MAX_HIGHLIGHTS = 768;
    private static final int MAX_PATH_POINTS = 512;
    private static final String DEFAULT_PATH_COLOUR = "#ffc440";
    private static final int MAX_RESPONSE_CHARS = 1_000_000;
    private static final String DEFAULT_ENDPOINT = "http://127.0.0.1:25575/debug/api/highlights";

    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofMillis(250))
            .build();
    private final URI endpoint = URI.create(System.getProperty("blockhighlighter.url", DEFAULT_ENDPOINT));
    private volatile Snapshot snapshot = Snapshot.empty();
    private boolean requestInFlight;
    private long nextPollAt;
    private ClientLevel level;
    private long generation;

    synchronized void tick(Minecraft minecraft) {
        if (level != minecraft.level) {
            level = minecraft.level;
            generation++;
            requestInFlight = false;
            nextPollAt = 0;
            snapshot = Snapshot.empty();
        }
        if (level == null) return;
        long now = System.currentTimeMillis();
        if (requestInFlight || now < nextPollAt) return;
        requestInFlight = true;
        nextPollAt = now + POLL_INTERVAL_MS;
        HttpRequest request = HttpRequest.newBuilder(endpoint)
                .timeout(Duration.ofMillis(500))
                .header("Accept", "application/json")
                .GET()
                .build();
        long requestGeneration = generation;
        ClientLevel requestLevel = level;
        client.sendAsync(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8))
                .whenComplete((response, error) -> {
                    Snapshot received = decode(response, error);
                    minecraft.execute(() -> {
                        // Check on the client thread; parsing stays on the HTTP worker.
                        if (minecraft.level != requestLevel) return;
                        complete(requestGeneration, received);
                    });
                });
    }

    Snapshot snapshot() {
        return snapshot;
    }

    private synchronized void complete(long requestGeneration, Snapshot received) {
        if (requestGeneration != generation) return;
        requestInFlight = false;
        snapshot = received;
    }

    private static Snapshot decode(HttpResponse<String> response, Throwable error) {
        if (error != null || response == null || response.statusCode() != 200) {
            return Snapshot.empty();
        }
        try {
            String body = response.body();
            if (body == null || body.length() > MAX_RESPONSE_CHARS) {
                throw new IllegalArgumentException("highlight snapshot was empty or too large");
            }
            return parse(body);
        } catch (RuntimeException parseError) {
            return Snapshot.empty();
        }
    }

    /**
     * The host publishes whatever it has while a client is polling. What is
     * drawn is decided here, not there, so the snapshot carries geometry only.
     */
    private static Snapshot parse(String body) {
        JsonObject root = JsonParser.parseString(body).getAsJsonObject();
        return new Snapshot(string(root, "label", ""), highlights(root), path(root));
    }

    private static List<Highlight> highlights(JsonObject root) {
        JsonArray values = array(root, "highlights");
        if (values == null || values.isEmpty()) return List.of();
        List<Highlight> highlights = new ArrayList<>();
        for (JsonElement value : values) {
            if (highlights.size() >= MAX_HIGHLIGHTS) break;
            if (!value.isJsonObject()) continue;
            JsonObject highlight = value.getAsJsonObject();
            try {
                Colour colour = Colour.parse(highlight.get("colour").getAsString());
                highlights.add(new Highlight(
                        highlight.get("x").getAsInt(),
                        highlight.get("y").getAsInt(),
                        highlight.get("z").getAsInt(),
                        colour,
                        string(highlight, "dimension", ""),
                        longValue(highlight, "visibleAt", 0),
                        highlight.get("expiresAt").getAsLong()));
            } catch (RuntimeException ignored) {
                // One malformed highlight cannot hide the rest of the collection.
            }
        }
        return List.copyOf(highlights);
    }

    /**
     * A route arrives as a finished line in world coordinates, already starting
     * where the bot stands. Fewer than two points is not a line, so it is
     * reported as no route rather than as something the renderer must guard.
     */
    private static Path path(JsonObject root) {
        if (!root.has("path") || !root.get("path").isJsonObject()) return null;
        JsonObject value = root.getAsJsonObject("path");
        JsonArray nodes = array(value, "points");
        if (nodes == null || nodes.isEmpty()) return null;

        List<Point> route = new ArrayList<>();
        for (JsonElement node : nodes) {
            if (route.size() >= MAX_PATH_POINTS) break;
            Point next = point(node);
            if (next != null) route.add(next);
        }
        if (route.size() < 2) return null;

        Colour colour;
        try {
            colour = Colour.parse(string(value, "colour", DEFAULT_PATH_COLOUR));
        } catch (RuntimeException error) {
            colour = Colour.parse(DEFAULT_PATH_COLOUR);
        }
        return new Path(List.copyOf(route), colour, string(value, "dimension", ""));
    }

    private static Point point(JsonElement value) {
        if (value == null || !value.isJsonObject()) return null;
        JsonObject object = value.getAsJsonObject();
        try {
            return new Point(
                    object.get("x").getAsDouble(),
                    object.get("y").getAsDouble(),
                    object.get("z").getAsDouble());
        } catch (RuntimeException error) {
            return null;
        }
    }

    private static JsonArray array(JsonObject parent, String name) {
        return parent.has(name) && parent.get(name).isJsonArray() ? parent.getAsJsonArray(name) : null;
    }

    private static String string(JsonObject value, String name, String fallback) {
        try {
            return value.has(name) && !value.get(name).isJsonNull() ? value.get(name).getAsString() : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    private static long longValue(JsonObject value, String name, long fallback) {
        try {
            return value.has(name) && !value.get(name).isJsonNull() ? value.get(name).getAsLong() : fallback;
        } catch (RuntimeException error) {
            return fallback;
        }
    }

    record Highlight(int x, int y, int z, Colour colour, String dimension, long visibleAt, long expiresAt) {
    }

    /** A route point, in world coordinates rather than block coordinates. */
    record Point(double x, double y, double z) {
    }

    record Path(List<Point> points, Colour colour, String dimension) {
    }

    record Colour(float red, float green, float blue) {
        static Colour parse(String value) {
            if (value == null || !value.matches("#[0-9a-fA-F]{6}")) {
                throw new IllegalArgumentException("colour must be #RRGGBB");
            }
            int rgb = Integer.parseInt(value.substring(1), 16);
            return new Colour(((rgb >> 16) & 0xff) / 255.0F, ((rgb >> 8) & 0xff) / 255.0F, (rgb & 0xff) / 255.0F);
        }
    }

    record Snapshot(String label, List<Highlight> highlights, Path path) {
        static Snapshot empty() {
            return new Snapshot("", List.of(), null);
        }
    }
}
