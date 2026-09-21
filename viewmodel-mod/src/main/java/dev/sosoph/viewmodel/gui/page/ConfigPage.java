package dev.sosoph.viewmodel.gui.page;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.font.TextRenderer;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.text.Text;

/** One tab of the menu. */
public abstract class ConfigPage {
    protected final ViewModelScreen screen;
    protected final MinecraftClient client = MinecraftClient.getInstance();
    protected final TextRenderer textRenderer = this.client.textRenderer;

    protected ConfigPage(ViewModelScreen screen) {
        this.screen = screen;
    }

    /** Always read through this: "reset everything" swaps the config instance. */
    protected static ViewModelConfig config() {
        return ConfigManager.get();
    }

    public abstract Text getTitle();

    /** Builds the widgets for this page. Called again on every resize. */
    public abstract void init(int x, int y, int width, int height);

    /** How wide the menu panel should be for this page. */
    public int panelWidth(int available) {
        return Math.min(260, available);
    }

    public void render(DrawContext context, int mouseX, int mouseY, float delta) {
    }

    public void tick() {
    }

    public abstract Text getHint();

    /** "Reset page" in the footer. */
    public abstract void resetPage();
}
