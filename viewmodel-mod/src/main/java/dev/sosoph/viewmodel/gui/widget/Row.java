package dev.sosoph.viewmodel.gui.widget;

import dev.sosoph.viewmodel.gui.Compat;
import dev.sosoph.viewmodel.gui.Theme;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.Font;
import net.minecraft.client.gui.GuiGraphicsExtractor;
import net.minecraft.client.gui.components.AbstractWidget;
import net.minecraft.client.gui.narration.NarrationElementOutput;
import net.minecraft.network.chat.Component;

/** Shared look and helpers for every row in the menu. */
public abstract class Row extends AbstractWidget {
    public static final int HEIGHT = 18;

    protected final Font font = Minecraft.getInstance().font;

    protected Row(int width, int height, Component message) {
        super(0, 0, width, height, message);
    }

    protected boolean isOver(double mouseX, double mouseY) {
        return this.visible
                && mouseX >= this.getX() && mouseX < this.getX() + this.getWidth()
                && mouseY >= this.getY() && mouseY < this.getY() + this.getHeight();
    }

    protected void drawBackground(GuiGraphicsExtractor graphics, boolean hovered) {
        graphics.fill(this.getX(), this.getY(), this.getX() + this.getWidth(), this.getY() + this.getHeight(),
                hovered ? Theme.ROW_BG_HOVER : Theme.ROW_BG);
    }

    protected int textY() {
        return this.getY() + (this.getHeight() - this.font.lineHeight) / 2 + 1;
    }

    protected void playClick() {
        this.playDownSound(Minecraft.getInstance().getSoundManager());
    }

    /** Draws a small "ON"/"OFF" style pill on the right hand side of the row. */
    protected void drawPill(GuiGraphicsExtractor graphics, Component label, int color, int background) {
        int labelWidth = this.font.width(label);
        int right = this.getX() + this.getWidth() - 4;
        int left = right - labelWidth - 8;
        graphics.fill(left, this.getY() + 3, right, this.getY() + this.getHeight() - 3, background);
        graphics.text(this.font, label, left + 4, this.textY(), color);
    }

    protected void drawBorder(GuiGraphicsExtractor graphics, int color) {
        Compat.border(graphics, this.getX(), this.getY(), this.getWidth(), this.getHeight(), color);
    }

    /**
     * AbstractWidget draws through extractWidgetRenderState; every row here implements
     * extractContents instead, so this is the single bridge between the two.
     */
    @Override
    protected void extractWidgetRenderState(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta) {
        this.extractContents(graphics, mouseX, mouseY, delta);
    }

    protected abstract void extractContents(GuiGraphicsExtractor graphics, int mouseX, int mouseY, float delta);

    @Override
    protected void updateWidgetNarration(NarrationElementOutput output) {
    }
}
