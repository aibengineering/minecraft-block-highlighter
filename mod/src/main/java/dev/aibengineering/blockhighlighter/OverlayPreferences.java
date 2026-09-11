package dev.aibengineering.blockhighlighter;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;

import net.minecraft.client.Minecraft;

/** Client-owned overlay visibility that survives bot and game restarts. */
final class OverlayPreferences {
    private static final String FILE_NAME = "blockhighlighter-client.properties";
    private static final String HIGHLIGHTS_KEY = "highlights";
    private static final String PATHS_KEY = "paths";

    private boolean loaded;
    private Path file;
    private boolean highlights = true;
    private boolean paths = true;

    void load(Minecraft minecraft) {
        if (loaded) return;
        loaded = true;
        file = minecraft.gameDirectory.toPath().resolve("config").resolve(FILE_NAME);
        if (!Files.isRegularFile(file)) return;

        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(file)) {
            properties.load(input);
            highlights = booleanValue(properties.getProperty(HIGHLIGHTS_KEY), true);
            paths = booleanValue(properties.getProperty(PATHS_KEY), true);
        } catch (IOException ignored) {
            // A missing or unreadable preference file should never break rendering.
        }
    }

    boolean highlights() {
        return highlights;
    }

    boolean paths() {
        return paths;
    }

    void toggleHighlights() {
        highlights = !highlights;
        save();
    }

    void togglePaths() {
        paths = !paths;
        save();
    }

    private void save() {
        if (file == null) return;
        Properties properties = new Properties();
        properties.setProperty(HIGHLIGHTS_KEY, Boolean.toString(highlights));
        properties.setProperty(PATHS_KEY, Boolean.toString(paths));
        try {
            Files.createDirectories(file.getParent());
            try (OutputStream output = Files.newOutputStream(file)) {
                properties.store(output, "Block Highlighter client overlay preferences");
            }
        } catch (IOException ignored) {
            // Preferences are optional; a failed save must not affect the game.
        }
    }

    private static boolean booleanValue(String value, boolean fallback) {
        if (value == null) return fallback;
        if (value.equalsIgnoreCase("true")) return true;
        if (value.equalsIgnoreCase("false")) return false;
        return fallback;
    }
}
