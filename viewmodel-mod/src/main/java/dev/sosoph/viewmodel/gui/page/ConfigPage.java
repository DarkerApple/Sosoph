package dev.sosoph.viewmodel.gui.page;

import dev.sosoph.viewmodel.config.ConfigManager;
import dev.sosoph.viewmodel.config.ViewModelConfig;
import dev.sosoph.viewmodel.gui.ViewModelScreen;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.network.chat.Component;

/** One tab of the menu. */
public abstract class ConfigPage {
    protected final ViewModelScreen screen;
    protected final Minecraft minecraft = Minecraft.getInstance();
    protected final Font font = this.minecraft.font;

    protected ConfigPage(ViewModelScreen screen) {
        this.screen = screen;
    }

    /** Always read through this: "reset everything" swaps the config instance. */
    protected static ViewModelConfig config() {
        return ConfigManager.get();
    }

    public abstract Component getTitle();

    /** Builds the widgets for this page. Called again on every resize. */
    public abstract void init(int x, int y, int width, int height);

    /** How wide the menu panel should be for this page. */
    public int panelWidth(int available) {
        return Math.min(260, available);
    }

    /** Anything drawn on top of the widgets, such as previews. */
    public void extract(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
    }

    public void tick() {
    }

    public abstract Component getHint();

    /** "Reset page" in the footer. */
    public abstract void resetPage();
}
