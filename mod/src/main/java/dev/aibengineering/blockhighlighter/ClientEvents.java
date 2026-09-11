package dev.aibengineering.blockhighlighter;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.neoforged.bus.api.SubscribeEvent;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.event.RenderGuiEvent;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;
import org.lwjgl.glfw.GLFW;

final class ClientEvents {
    private static final HighlightStore HIGHLIGHTS = new HighlightStore();
    private static final OverlayPreferences OVERLAYS = new OverlayPreferences();
    private static final KeyMapping TOGGLE_PATH = new KeyMapping(
            "key.blockhighlighter.toggle_path",
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_N,
            "key.categories.blockhighlighter");
    private static final KeyMapping TOGGLE_HIGHLIGHTS = new KeyMapping(
            "key.blockhighlighter.toggle_highlights",
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_O,
            "key.categories.blockhighlighter");

    private ClientEvents() {
    }

    static void registerKeyMappings(RegisterKeyMappingsEvent event) {
        event.register(TOGGLE_PATH);
        event.register(TOGGLE_HIGHLIGHTS);
    }

    @SubscribeEvent
    public static void onClientTick(ClientTickEvent.Post ignoredEvent) {
        Minecraft minecraft = Minecraft.getInstance();
        OVERLAYS.load(minecraft);
        HIGHLIGHTS.tick(minecraft);
        while (TOGGLE_PATH.consumeClick()) OVERLAYS.togglePaths();
        while (TOGGLE_HIGHLIGHTS.consumeClick()) OVERLAYS.toggleHighlights();
    }

    @SubscribeEvent
    public static void onRenderLevel(RenderLevelStageEvent event) {
        HighlightStore.Snapshot snapshot = HIGHLIGHTS.snapshot();
        if (OVERLAYS.highlights()) HighlightRenderer.render(event, snapshot);
        if (OVERLAYS.paths()) PathRenderer.render(event, snapshot);
    }

    @SubscribeEvent
    public static void onRenderGui(RenderGuiEvent.Post event) {
        if (OVERLAYS.highlights()) HighlightRenderer.renderGui(event.getGuiGraphics(), HIGHLIGHTS.snapshot());
    }
}
