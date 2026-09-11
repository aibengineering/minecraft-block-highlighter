package dev.aibengineering.blockhighlighter;

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;

@Mod(BlockHighlighterMod.MOD_ID)
public final class BlockHighlighterMod {
    static final String MOD_ID = "blockhighlighter";

    public BlockHighlighterMod(IEventBus modBus) {
        NeoForge.EVENT_BUS.register(ClientEvents.class);
        // Key mappings are a mod-bus registration, unlike the render and tick
        // subscribers above which live on the game bus.
        modBus.addListener(ClientEvents::registerKeyMappings);
    }
}
