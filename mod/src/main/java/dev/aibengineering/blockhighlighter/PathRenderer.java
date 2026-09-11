package dev.aibengineering.blockhighlighter;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;

/**
 * Draws the route the host published, as a line through the world.
 *
 * Only host-supplied geometry is drawn: no pathfinding or route inference
 * happens client-side, and the store has already rejected anything that is not
 * at least two points.
 */
final class PathRenderer {
    private static final double LINE_WIDTH = 5.0;

    private PathRenderer() {
    }

    static void render(RenderLevelStageEvent event, HighlightStore.Snapshot snapshot) {
        HighlightStore.Path path = snapshot.path();
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_PARTICLES || path == null) return;
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.level == null || !sameDimension(path.dimension(),
                minecraft.level.dimension().location().toString())) return;

        PoseStack poseStack = event.getPoseStack();
        Vec3 camera = event.getCamera().getPosition();
        MultiBufferSource.BufferSource buffers = minecraft.renderBuffers().bufferSource();
        RenderType renderType = RenderType.debugLineStrip(LINE_WIDTH);
        VertexConsumer line = buffers.getBuffer(renderType);

        HighlightStore.Colour colour = path.colour();
        for (HighlightStore.Point point : path.points()) {
            line.addVertex(
                            poseStack.last(),
                            (float) (point.x() - camera.x),
                            (float) (point.y() - camera.y),
                            (float) (point.z() - camera.z))
                    .setColor(colour.red(), colour.green(), colour.blue(), 1.0F);
        }
        buffers.endBatch(renderType);
    }

    private static boolean sameDimension(String observed, String current) {
        if (observed == null || observed.isBlank()) return true;
        return normalizeDimension(observed).equals(normalizeDimension(current));
    }

    private static String normalizeDimension(String value) {
        int separator = value.indexOf(':');
        return separator >= 0 ? value.substring(separator + 1) : value;
    }
}
