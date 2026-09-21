package dev.sosoph.viewmodel;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

public class ViewModelClient implements ClientModInitializer {
    public static final String MOD_ID = "viewmodel";

    private static KeyBinding openMenu;

    @Override
    public void onInitializeClient() {
        ConfigManager.load();

        openMenu = KeyBindingHelper.registerKeyBinding(new KeyBinding(
                "key.viewmodel.open_menu",
                InputUtil.Type.KEYSYM,
                GLFW.GLFW_KEY_RIGHT_BRACKET,
                "key.categories.misc"));

        ClientTickEvents.END_CLIENT_TICK.register(client -> {
            while (openMenu.wasPressed()) {
                client.setScreen(new ViewModelScreen(client.currentScreen));
            }
        });
    }
}
