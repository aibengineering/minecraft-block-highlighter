package dev.aibengineering.blockhighlighter;

import com.mojang.blaze3d.vertex.PoseStack;
import com.mojang.blaze3d.vertex.VertexConsumer;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.renderer.MultiBufferSource;
import net.minecraft.client.renderer.RenderType;
import net.minecraft.client.renderer.ShapeRenderer;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.Vec3;
import net.neoforged.neoforge.client.event.RenderLevelStageEvent;
import org.joml.Matrix4f;

/** Draw wireframes, floating world text, and on-screen HUD banners from the feed. */
final class HighlightRenderer {
    private HighlightRenderer() {
    }

    static void render(RenderLevelStageEvent event, HighlightStore.Snapshot snapshot) {
        if (event.getStage() != RenderLevelStageEvent.Stage.AFTER_PARTICLES || (snapshot.highlights().isEmpty() && snapshot.entities().isEmpty())) return;
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.level == null) return;
        String currentDimension = minecraft.level.dimension().location().toString();

        long now = System.currentTimeMillis();
        PoseStack poseStack = event.getPoseStack();
        Vec3 camera = event.getCamera().getPosition();
        MultiBufferSource.BufferSource buffers = minecraft.renderBuffers().bufferSource();
        RenderType renderType = RenderType.lines();
        VertexConsumer lines = buffers.getBuffer(renderType);

        HighlightStore.Highlight primaryHighlight = null;
        double sumX = 0;
        double maxY = Double.NEGATIVE_INFINITY;
        double sumZ = 0;
        int activeCount = 0;

        for (HighlightStore.Highlight highlight : snapshot.highlights()) {
            if (!sameDimension(highlight.dimension(), currentDimension)
                    || highlight.visibleAt() > now
                    || highlight.expiresAt() <= now) continue;
            if (primaryHighlight == null) {
                primaryHighlight = highlight;
            }
            sumX += highlight.x();
            maxY = Math.max(maxY, highlight.y());
            sumZ += highlight.z();
            activeCount++;

            AABB box = new AABB(
                    highlight.x() - camera.x - 0.01,
                    highlight.y() - camera.y - 0.01,
                    highlight.z() - camera.z - 0.01,
                    highlight.x() + 1 - camera.x + 0.01,
                    highlight.y() + 1 - camera.y + 0.01,
                    highlight.z() + 1 - camera.z + 0.01);
            HighlightStore.Colour colour = highlight.colour();
            ShapeRenderer.renderLineBox(poseStack, lines, box, colour.red(), colour.green(), colour.blue(), 1.0F);
        }
        // Entity IDs are resolved in the spectator's world. Their live bounds
        // follow falling/moving items without host-side position publications.
        for (HighlightStore.EntityHighlight highlight : snapshot.entities()) {
            if (!sameDimension(highlight.dimension(), currentDimension)) continue;
            var entity = minecraft.level.getEntity(highlight.entityId());
            if (entity == null || entity.isRemoved()) continue;
            var position = entity.getPosition(event.getPartialTick().getGameTimeDeltaPartialTick(false));
            AABB box = entity.getBoundingBox().move(position.subtract(entity.position()))
                    .inflate(0.03).move(-camera.x, -camera.y, -camera.z);
            var colour = highlight.colour();
            ShapeRenderer.renderLineBox(poseStack, lines, box, colour.red(), colour.green(), colour.blue(), 1.0F);
        }
        buffers.endBatch(renderType);

        // Render 3D Billboarded Label above the highlighted block(s)
        String label = snapshot.label();
        if (label != null && !label.isBlank() && activeCount > 0 && primaryHighlight != null) {
            double labelX = (activeCount == 1 ? primaryHighlight.x() : (sumX / activeCount)) + 0.5;
            double labelY = (activeCount == 1 ? primaryHighlight.y() : maxY) + 1.35;
            double labelZ = (activeCount == 1 ? primaryHighlight.z() : (sumZ / activeCount)) + 0.5;

            Font font = minecraft.font;
            poseStack.pushPose();
            poseStack.translate(labelX - camera.x, labelY - camera.y, labelZ - camera.z);
            poseStack.mulPose(event.getCamera().rotation());
            poseStack.scale(-0.025F, -0.025F, 0.025F);

            Matrix4f matrix = poseStack.last().pose();
            float textWidth = font.width(label);
            float xOffset = -textWidth / 2.0F;

            font.drawInBatch(
                    label,
                    xOffset,
                    0.0F,
                    0xFFFFFFFF,
                    false,
                    matrix,
                    buffers,
                    Font.DisplayMode.SEE_THROUGH,
                    0x80000000,
                    0xF000F0
            );
            buffers.endBatch();
            poseStack.popPose();
        }
    }

    static void renderGui(GuiGraphics guiGraphics, HighlightStore.Snapshot snapshot) {
        String label = snapshot.label();
        if (label == null || label.isBlank() || (snapshot.highlights().isEmpty() && snapshot.entities().isEmpty())) return;
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.options.hideGui || minecraft.level == null) return;

        long now = System.currentTimeMillis();
        String currentDimension = minecraft.level.dimension().location().toString();
        boolean hasVisibleHighlight = snapshot.highlights().stream().anyMatch(highlight ->
                sameDimension(highlight.dimension(), currentDimension)
                        && highlight.visibleAt() <= now
                        && highlight.expiresAt() > now);
        boolean hasVisibleEntity = snapshot.entities().stream().anyMatch(highlight ->
                sameDimension(highlight.dimension(), currentDimension)
                        && minecraft.level.getEntity(highlight.entityId()) != null);
        if (!hasVisibleHighlight && !hasVisibleEntity) return;

        Font font = minecraft.font;
        int textWidth = font.width(label);
        int screenWidth = guiGraphics.guiWidth();
        int x = (screenWidth - textWidth) / 2;
        int y = 14;

        // Background pill
        guiGraphics.fill(x - 8, y - 4, x + textWidth + 8, y + 12, 0xCC171B18);
        guiGraphics.fill(x - 7, y - 3, x + textWidth + 7, y + 11, 0xEE242D26);
        guiGraphics.drawString(font, label, x, y, 0xFFFFAA0D, true);
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
