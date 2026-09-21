package dev.sosoph.viewmodel;

import com.mojang.blaze3d.platform.InputConstants;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keymapping.v1.KeyMappingHelper;
import net.minecraft.client.KeyMapping;
import org.lwjgl.sdl.SDLScancode;

public class ViewModelClient implements ClientModInitializer {
    public static final String MOD_ID = "viewmodel";

    private static KeyMapping openMenu;

    @Override
    public void onInitializeClient() {
        ConfigManager.load();

        openMenu = KeyMappingHelper.registerKeyMapping(new KeyMapping(
                "key.viewmodel.open_menu",
                InputConstants.Type.KEYBOARD,
                SDLScancode.SDL_SCANCODE_RIGHTBRACKET,
                KeyMapping.Category.MISC));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (openMenu.consumeClick()) {
                client.setScreen(new ViewModelScreen(client.screen));
            }
        });
    }
}
